// Local LLM manager: model catalog, GGUF downloads, apply/rollback and
// llama-server version management.
//
// Why this lives outside _boot.js: the boot file is ~4000 lines and its daemon /
// download / update blocks sit right next to the anchors packaging/patch-appimage.sh
// rewrites. A separate module is invisible to every existing anchor.
//
// Everything here is asynchronous on purpose. The Electron main process also
// serves the renderer's terminal socket and every IPC reply; a synchronous hash
// or `tar` on a 4 GB file would stall the UI animations, which is explicitly
// out of bounds for this feature. So: spawn for transfers/extraction, streams in
// 4 MB chunks for hashing, timers for health polling. The only synchronous calls
// are existsSync/statSync on small files and one statfs.

const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");
const https = require("https");
const crypto = require("crypto");
const { spawn, execFile } = require("child_process");
const { ipcMain, app, dialog, BrowserWindow } = require("electron");

const PORT = 8080;
const HOST = "127.0.0.1";
const BUNDLED_DIR = "/opt/edex/llm";
const BUNDLED_FILE = "qwen2.5-0.5b-instruct-q4_k_m.gguf";
const BUNDLED_ID = "qwen2.5-0.5b-instruct-q4_k_m";
const RELEASES_URL = "https://api.github.com/repos/ggml-org/llama.cpp/releases?per_page=30";
const ASSET_RE = /^llama-(b\d+)-bin-ubuntu-x64\.tar\.gz$/;
const UA = "eDEX-UI local model manager";

// One-line progress from axel: "[ 42%][ 3.1MB/s][00:12]". curl -# prints a
// different bar, so both transports are also polled with stat() below; the
// regex only saves a syscall when axel is the one running.
const AXEL_PROG_RE = /\[\s*(\d{1,3})%\][^\[]*\[\s*([0-9.,]+)\s*([KMGT]?B)\/s\][^\[]*\[\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*\]/;

const sleep = ms => new Promise(r => setTimeout(r, ms));

function fmtBytes(n) {
    if (!isFinite(n) || n <= 0) return "0 B";
    const u = n >= 1073741824 ? [n / 1073741824, "GB"] : n >= 1048576 ? [n / 1048576, "MB"] : n >= 1024 ? [n / 1024, "KB"] : [n, "B"];
    return u[0].toFixed(u[0] >= 100 ? 0 : 1) + " " + u[1];
}

function slugify(name) {
    return String(name || "")
        .replace(/\.gguf$/i, "")
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80) || "model";
}

function isGgufMagic(buf) {
    return buf.length >= 4 && buf.toString("latin1", 0, 4) === "GGUF";
}

module.exports.create = function createLlmManager(opts) {
    const settingsFile = opts.settingsFile;
    const broadcast = opts.broadcast;
    const signale = opts.signale || { info() {}, warn() {}, debug() {} };
    const DEFAULTS = opts.defaults || {};

    const ROOT = path.join(app.getPath("userData"), "llm");
    const MODELS = path.join(ROOT, "models");
    const INCOMPLETE = path.join(MODELS, ".incomplete");
    const DOWNLOADS = path.join(ROOT, "downloads");
    const BIN_DIR = path.join(ROOT, "bin");
    const BIN_PREV = path.join(ROOT, "bin.prev");
    const STAGING_ROOT = path.join(ROOT, "staging");
    const REGISTRY = path.join(ROOT, "registry.json");
    const CATALOG_FILE = path.join(__dirname, "assets", "llm", "catalog.json");

    // Create the tree up front: statfs needs an existing path for the "disk
    // free" readout, and .incomplete/ must exist before the first .part lands.
    [ROOT, MODELS, INCOMPLETE, DOWNLOADS, BIN_DIR, STAGING_ROOT].forEach(d => {
        try { fs.mkdirSync(d, { recursive: true }); } catch (e) {}
    });

    const state = {
        proc: null,
        adopted: false,
        startedAt: 0,
        log: [],
        applying: false,
        tasks: new Map(),
        seq: 0,
        lastTick: 0,
        serverReleases: null,
        serverReleasesAt: 0,
        binProbe: null
    };

    // ---------------------------------------------------------------------
    // Settings
    // ---------------------------------------------------------------------

    function readSettingsRaw() {
        try {
            return JSON.parse(fs.readFileSync(settingsFile, "utf8")) || {};
        } catch (e) {
            return {};
        }
    }

    function readSettingsFull() {
        try {
            return opts.readSettings ? opts.readSettings() : Object.assign({}, readSettingsRaw());
        } catch (e) {
            return readSettingsRaw();
        }
    }

    // settings.json is shallow-merged on boot (an existing partial block wins
    // over defaults), so every read normalizes instead of trusting the file.
    function normalizeLlm(raw) {
        const src = raw || {};
        const cores = Math.max(1, os.cpus().length);
        const int = (v, lo, hi, d) => {
            const n = parseInt(v, 10);
            return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d;
        };
        const str = (v, d) => (typeof v === "string" && v.trim() ? v.trim() : d);
        return {
            modelId: str(src.modelId, DEFAULTS.modelId || BUNDLED_ID),
            lastGoodModelId: str(src.lastGoodModelId, DEFAULTS.lastGoodModelId || BUNDLED_ID),
            serverVersion: str(src.serverVersion, "bundled"),
            threads: int(src.threads, 0, Math.max(1, cores - 1), 0),
            ctxSize: [0, 4096, 8192, 16384, 32768, 65536, 131072].indexOf(Number(src.ctxSize)) >= 0
                ? Number(src.ctxSize) : 0,
            parallel: 1,
            cacheTypeK: ["q8_0", "q4_0", "f16"].indexOf(src.cacheTypeK) >= 0 ? src.cacheTypeK : "q8_0",
            cacheTypeV: ["q8_0", "q4_0", "f16"].indexOf(src.cacheTypeV) >= 0 ? src.cacheTypeV : "q8_0",
            hfMirror: src.hfMirror === true || src.hfMirror === "true" || src.hfMirror === "1"
        };
    }

    function readLlm() {
        return normalizeLlm(readSettingsRaw().llm);
    }

    // Read → mutate → write. Returns the merged view the renderer expects.
    function patchSettings(mutate) {
        let disk = {};
        try {
            disk = JSON.parse(fs.readFileSync(settingsFile, "utf8"));
        } catch (e) {
            disk = {};
        }
        mutate(disk);
        try {
            fs.writeFileSync(settingsFile, JSON.stringify(disk, "", 4));
        } catch (e) {
            signale.warn("llm: could not write settings.json: " + e.message);
        }
        return readSettingsFull();
    }

    // ---------------------------------------------------------------------
    // Catalog + registry
    // ---------------------------------------------------------------------

    function loadCatalog() {
        try {
            const raw = JSON.parse(fs.readFileSync(CATALOG_FILE, "utf8"));
            return Array.isArray(raw.models) ? raw.models : [];
        } catch (e) {
            signale.warn("llm: catalog unavailable: " + e.message);
            return [];
        }
    }

    const CATALOG = loadCatalog();

    function loadRegistry() {
        try {
            const r = JSON.parse(fs.readFileSync(REGISTRY, "utf8"));
            if (!r || typeof r !== "object") return { version: 1, models: {} };
            if (!r.models || typeof r.models !== "object") r.models = {};
            return r;
        } catch (e) {
            return { version: 1, models: {} };
        }
    }

    function saveRegistry(reg) {
        try {
            ensureDir(ROOT);
            const tmp = REGISTRY + ".tmp";
            fs.writeFileSync(tmp, JSON.stringify(reg, "", 4));
            fs.renameSync(tmp, REGISTRY);
        } catch (e) {
            signale.warn("llm: could not write registry: " + e.message);
        }
    }

    function ensureDir(dir) {
        try {
            fs.mkdirSync(dir, { recursive: true });
        } catch (e) {}
    }

    function statSize(file) {
        try {
            return fs.statSync(file).size;
        } catch (e) {
            return 0;
        }
    }

    function bundledPath() {
        return path.join(BUNDLED_DIR, BUNDLED_FILE);
    }

    function bundledRecord() {
        const p = bundledPath();
        if (!fs.existsSync(p)) return null;
        return {
            id: BUNDLED_ID,
            alias: BUNDLED_ID,
            file: BUNDLED_FILE,
            path: p,
            name: { zh: "Qwen2.5 0.5B（内置）", en: "Qwen2.5 0.5B (bundled)" },
            sizeBytes: statSize(p),
            source: "bundled",
            bundled: true,
            undeletable: true,
            paramsB: 0.5,
            nativeCtx: 32768,
            kvBytesPerToken: 6144
        };
    }

    function resolveModel(id) {
        const want = id || readLlm().modelId;
        if (!want) return bundledRecord();
        if (want === BUNDLED_ID) {
            const b = bundledRecord();
            if (b) return b;
        }
        const reg = loadRegistry();
        const rec = reg.models[want];
        if (rec && rec.path && fs.existsSync(rec.path)) return Object.assign({ alias: rec.id }, rec);
        // Configured model vanished (deleted file, copied settings.json):
        // fall back to the ISO model and say so.
        const b = bundledRecord();
        if (b) {
            b.fallback = !!id || want !== BUNDLED_ID;
            return b;
        }
        return null;
    }

    function activeModel() {
        return resolveModel(readLlm().modelId);
    }

    function activeAlias() {
        const m = activeModel();
        return m ? m.alias || m.id : null;
    }

    // ---------------------------------------------------------------------
    // Binary resolution
    // ---------------------------------------------------------------------

    function readBinVersionFile(dir) {
        try {
            const v = JSON.parse(fs.readFileSync(path.join(dir, "version.json"), "utf8"));
            return v && v.version ? String(v.version) : null;
        } catch (e) {
            return null;
        }
    }

    function resolveBinary() {
        const pref = readLlm().serverVersion;
        const userBin = path.join(BIN_DIR, "llama-server");
        if (pref !== "bundled" && fs.existsSync(userBin)) {
            return { bin: userBin, libDir: BIN_DIR, source: "user", version: readBinVersionFile(BIN_DIR) || pref };
        }
        const baked = path.join(BUNDLED_DIR, "llama-server");
        if (process.platform === "linux" && fs.existsSync(baked)) {
            return { bin: baked, libDir: BUNDLED_DIR, source: "bundled", version: readBinVersionFile(BUNDLED_DIR) };
        }
        return { bin: null, libDir: null, source: "none", version: null };
    }

    // ---------------------------------------------------------------------
    // Threads / context
    // ---------------------------------------------------------------------

    function resolveThreads() {
        const cores = Math.max(1, os.cpus().length);
        const pref = readLlm().threads;
        // Never hand every core to llama.cpp: the renderer's animations need
        // real CPU, so auto keeps half the machine (2 on the 4-thread test
        // laptop) and the manual cap is cores-1.
        if (pref > 0) return Math.max(1, Math.min(pref, Math.max(1, cores - 1)));
        return Math.max(1, Math.min(8, Math.floor(cores / 2)));
    }

    function resolveCtx(rec) {
        const pref = readLlm().ctxSize;
        const native = (rec && rec.nativeCtx) || 32768;
        if (pref > 0) return Math.max(2048, Math.min(pref, native));
        return Math.min(32768, native);
    }

    // ---------------------------------------------------------------------
    // Hardware + recommendations
    // ---------------------------------------------------------------------

    function readMemAvailable() {
        // Linux: MemAvailable is exactly the number we want. Elsewhere
        // os.freemem() reports "free" pages only (200 MB on an idle Mac), which
        // would rate every model as unusable, so macOS asks vm_stat for
        // free + inactive + speculative instead. Async by design: this must
        // never fork-and-wait on the main thread.
        try {
            const mi = fs.readFileSync("/proc/meminfo", "utf8");
            const m = /^MemAvailable:\s+(\d+)\s+kB/m.exec(mi);
            if (m) return Promise.resolve(Number(m[1]) * 1024);
        } catch (e) {}
        if (process.platform === "darwin") {
            return new Promise(resolve => {
                execFile("vm_stat", [], { timeout: 3000 }, (err, out) => {
                    if (err || !out) return resolve(os.freemem());
                    const pg = /page size of (\d+) bytes/.exec(out);
                    const pageSize = pg ? Number(pg[1]) : 4096;
                    const grab = key => {
                        const m = new RegExp("^" + key + ":\\s+(\\d+)", "m").exec(out);
                        return m ? Number(m[1]) : 0;
                    };
                    const pages = grab("Pages free") + grab("Pages inactive") + grab("Pages speculative");
                    resolve(pages > 0 ? pages * pageSize : os.freemem());
                });
            });
        }
        return Promise.resolve(os.freemem());
    }

    function diskFreeSync() {
        try {
            const st = fs.statfsSync(MODELS);
            return Number(st.bavail) * Number(st.bsize);
        } catch (e) {
            return 0;
        }
    }

    async function hardware() {
        const cores = Math.max(1, os.cpus().length);
        const total = os.totalmem();
        const available = await readMemAvailable();
        return {
            cores,
            suggestedThreads: Math.max(1, Math.min(8, Math.floor(cores / 2))),
            totalMem: total,
            availableMem: available,
            diskFree: diskFreeSync(),
            platform: process.platform
        };
    }

    function kvPerToken(model) {
        if (model && model.kvBytesPerToken > 0) return model.kvBytesPerToken;
        // Rough fallback: GQA models land around 8 KiB/token at 7B. Only used
        // for models imported by hand, where the catalog has no figure.
        const p = (model && model.paramsB) || 7;
        return Math.round(Math.max(2048, Math.min(65536, 8192 * (p / 7))));
    }

    function recommend(model, hw, llm) {
        const threads = llm.threads > 0
            ? Math.max(1, Math.min(llm.threads, Math.max(1, hw.cores - 1)))
            : hw.suggestedThreads;
        // Reserve ~1.2 GB for the desktop session + Electron + claude, and never
        // plan against more than 72% of physical RAM.
        const usable = Math.max(512 * 1024 * 1024,
            Math.min(hw.availableMem || hw.totalMem, hw.totalMem * 0.72) - 1.2 * 1024 * 1024 * 1024);

        const native = model.nativeCtx || 32768;
        let ctx = llm.ctxSize > 0 ? Math.min(llm.ctxSize, native) : Math.min(32768, native);
        const kv = kvPerToken(model);
        const needAt = c => (model.sizeBytes || 0) * 1.02 + kv * c + 400 * 1024 * 1024;
        while (ctx > 4096 && needAt(ctx) > usable) ctx = Math.floor(ctx / 2);

        const need = needAt(ctx);
        const ratio = usable > 0 ? need / usable : Infinity;

        // Calibrated on the test laptop: 0.5B, 2 threads, 19.5k-token prefill
        // ≈ 52 s → ~375 tok/s. Other models are scaled by parameter count and
        // thread count; decode is roughly prefill/12.
        const paramsB = model.paramsB || 0.5;
        const prefillTps = 375 * (0.5 / Math.max(0.1, paramsB)) * (threads / 2);
        const firstPrefillSec = Math.round(19500 / Math.max(1, prefillTps));
        const decodeTps = Math.max(1, Math.round(prefillTps / 12));

        let tier;
        if (ratio > 1) tier = "insufficient";
        else if (ratio > 0.8 || firstPrefillSec > 120) tier = "runnable";
        else tier = "recommended";

        return {
            threads,
            ctxSize: Math.max(2048, ctx),
            kvBytesAtCtx: Math.round(kv * ctx),
            needBytes: Math.round(need),
            availableBytes: Math.round(usable),
            ratio: Math.round(ratio * 1000) / 1000,
            tier,
            prefillTps: Math.round(prefillTps),
            firstPrefillSec,
            decodeTps,
            ctxBelowClaude: ctx < 32768,
            diskOk: (model.sizeBytes || 0) + 512 * 1024 * 1024 <= hw.diskFree
        };
    }

    async function catalogView() {
        const hw = await hardware();
        const llm = readLlm();
        const registry = loadRegistry();
        const active = activeModel();
        const seen = {};
        const out = [];

        // Catalog order first, then anything installed that is not in it.
        for (const m of CATALOG) {
            seen[m.id] = true;
            const installed = registry.models[m.id];
            const rec = Object.assign({}, m, {
                installed: !!(installed && fs.existsSync(installed.path)),
                installedPath: installed ? installed.path : null,
                active: !!(active && active.id === m.id),
                recommendation: recommend(m, hw, llm)
            });
            out.push(rec);
        }
        for (const id of Object.keys(registry.models)) {
            if (seen[id]) continue;
            const r = registry.models[id];
            if (!r || !fs.existsSync(r.path)) continue;
            out.push(Object.assign({}, r, {
                installed: true,
                installedPath: r.path,
                active: !!(active && active.id === id),
                recommendation: recommend(r, hw, llm)
            }));
        }
        // The bundled model always shows, even if it is missing from the ISO.
        const b = bundledRecord();
        if (b && !seen[b.id]) {
            out.unshift(Object.assign({}, b, {
                installed: true,
                installedPath: b.path,
                active: !!(active && active.id === b.id),
                recommendation: recommend(b, hw, llm)
            }));
        }
        // A transfer in flight for something the catalog does not know (a custom
        // URL or a renamed file) still gets a row, so the list — not just the
        // job bar — shows what is downloading. It disappears on the next refresh
        // once the model is registered, or if the transfer failed/was cancelled.
        for (const t of state.tasks.values()) {
            if (!t.modelId || seen[t.modelId]) continue;
            if (t.status === "done" || t.status === "error" || t.status === "cancelled") continue;
            seen[t.modelId] = true;
            out.push({
                id: t.modelId,
                file: t.file,
                name: null,
                family: "",
                paramsB: 0,
                quant: "",
                sizeBytes: t.totalBytes || 0,
                url: t.url,
                source: "url",
                languages: [],
                nativeCtx: 32768,
                kvBytesPerToken: 0,
                installed: false,
                installedPath: null,
                active: false,
                recommendation: null
            });
        }
        return { hardware: hw, settings: llm, active: active ? { id: active.id, alias: active.alias, fallback: !!active.fallback } : null, models: out };
    }

    // ---------------------------------------------------------------------
    // Health + server lifecycle
    // ---------------------------------------------------------------------

    function logLine(line) {
        state.log.push(line);
        if (state.log.length > 400) state.log.splice(0, state.log.length - 400);
        broadcast("llm-log", line);
    }

    function healthCheck() {
        return new Promise(resolve => {
            const req = http.get({ host: HOST, port: PORT, path: "/health", timeout: 1500 }, res => {
                let d = "";
                res.on("data", c => { d += c; });
                res.on("end", () => resolve(res.statusCode === 200 && String(d).indexOf("ok") >= 0));
            });
            req.on("error", () => resolve(false));
            req.on("timeout", () => { req.destroy(); resolve(false); });
        });
    }

    function serverArgs(rec, llm) {
        return [
            "-m", rec.path,
            "--host", HOST, "--port", String(PORT),
            "--threads", String(resolveThreads()),
            "--parallel", "1",
            "--ctx-size", String(resolveCtx(rec)),
            "--cache-type-k", llm.cacheTypeK || "q8_0",
            "--cache-type-v", llm.cacheTypeV || "q8_0",
            "--alias", rec.alias || rec.id
        ];
    }

    function tailLog(n) {
        return state.log.slice(-(n || 60));
    }

    // Spawn and wait until /health answers. Resolves once the model is loaded,
    // not when it finished the first prefill (which can take minutes on a 4B).
    function spawnServer(rec, bin) {
        return new Promise(resolve => {
            const llm = readLlm();
            const args = serverArgs(rec, llm);
            state.log.length = 0;
            logLine("[llama-server] " + bin.bin + " " + args.join(" "));

            let proc;
            try {
                const env = Object.assign({}, process.env);
                if (bin.libDir) {
                    env.LD_LIBRARY_PATH = bin.libDir + (env.LD_LIBRARY_PATH ? ":" + env.LD_LIBRARY_PATH : "");
                }
                proc = spawn(bin.bin, args, {
                    cwd: bin.libDir || undefined,
                    env,
                    stdio: ["ignore", "pipe", "pipe"]
                });
            } catch (e) {
                return resolve({ ok: false, error: "SPAWN_FAILED", log: [e.message], spawned: false });
            }

            state.proc = proc;
            state.adopted = false;
            state.startedAt = Date.now();
            global.llmProc = proc;

            const pump = d => String(d).split("\n").forEach(l => l.trim() && logLine(l.trim()));
            proc.stdout.on("data", pump);
            proc.stderr.on("data", pump);

            let exitCode = null;
            let settled = false;
            proc.on("error", e => {
                if (state.proc === proc) { state.proc = null; global.llmProc = null; }
                logLine("[llama-server spawn error: " + e.message + "]");
                if (!settled) { settled = true; resolve({ ok: false, error: "SPAWN_FAILED", log: tailLog(), spawned: true }); }
            });
            proc.on("exit", code => {
                exitCode = code;
                if (state.proc === proc) { state.proc = null; global.llmProc = null; }
                logLine("[llama-server exited, code " + code + "]");
                broadcastStatus();
            });

            const deadline = Date.now() + 120000;
            (async function poll() {
                if (settled) return;
                if (exitCode !== null) {
                    settled = true;
                    return resolve({ ok: false, error: "EXITED", code: exitCode, log: tailLog(), spawned: true });
                }
                if (await healthCheck()) {
                    settled = true;
                    logLine("[llama-server ready, model=" + (rec.alias || rec.id) + "]");
                    broadcastStatus();
                    return resolve({ ok: true, spawned: true });
                }
                if (Date.now() > deadline) {
                    try { proc.kill("SIGKILL"); } catch (e) {}
                    settled = true;
                    return resolve({ ok: false, error: "HEALTH_TIMEOUT", log: tailLog(), spawned: true });
                }
                setTimeout(poll, 500);
            })();
        });
    }

    // The old llmStop flipped the flag and returned immediately, which races the
    // next spawn for :8080. Wait for the process to really go away.
    function stopServer(timeoutMs) {
        return new Promise(resolve => {
            const proc = state.proc;
            if (!proc) {
                state.adopted = false;
                return resolve({ ok: true, was: false });
            }
            let done = false;
            const finish = how => {
                if (done) return;
                done = true;
                if (state.proc === proc) { state.proc = null; global.llmProc = null; }
                state.adopted = false;
                resolve({ ok: true, how });
                broadcastStatus();
            };
            proc.once("exit", () => finish("exit"));
            try { proc.kill("SIGTERM"); } catch (e) {}
            setTimeout(() => {
                if (done) return;
                try { proc.kill("SIGKILL"); } catch (e) {}
                setTimeout(() => finish("sigkill"), 1500);
            }, timeoutMs || 8000);
        });
    }

    async function startServer() {
        if (state.proc) return { ok: true, already: true };
        const rec = activeModel();
        const bin = resolveBinary();
        if (!rec) return { ok: false, error: "NO_MODEL" };
        if (!bin.bin) return { ok: false, error: "NO_BINARY" };
        if (await healthCheck()) {
            // Someone else's llama-server (or our own from a previous run):
            // adopt it for status purposes, but never kill what we did not spawn.
            state.adopted = true;
            logLine("[llama-server already up on :" + PORT + ", adopting]");
            broadcastStatus();
            return { ok: true, adopted: true };
        }
        state.adopted = false;
        return spawnServer(rec, bin);
    }

    async function waitReady(timeoutMs) {
        const deadline = Date.now() + (timeoutMs || 60000);
        for (;;) {
            if (await healthCheck()) return true;
            if (Date.now() > deadline) return false;
            await sleep(500);
        }
    }

    async function status() {
        const llm = readLlm();
        const rec = resolveModel(llm.modelId);
        const bin = resolveBinary();
        const ready = await healthCheck();
        return {
            ok: true,
            platform: process.platform,
            available: !!(rec && bin.bin),
            running: !!state.proc,
            ready,
            adopted: state.adopted,
            port: PORT,
            modelId: rec ? rec.id : null,
            model: rec ? (rec.alias || rec.id) : null,
            modelPath: rec ? rec.path : null,
            modelSizeBytes: rec ? rec.sizeBytes || 0 : 0,
            fallback: !!(rec && rec.fallback),
            binPath: bin.bin,
            binSource: bin.source,
            binVersion: bin.version,
            binError: bin.source === "none" ? "BIN_MISSING" : null,
            threads: resolveThreads(),
            ctxSize: rec ? resolveCtx(rec) : 0,
            parallel: 1,
            modelsDir: MODELS,
            startedAt: state.startedAt || 0,
            uptimeSec: state.startedAt ? Math.round((Date.now() - state.startedAt) / 1000) : 0,
            log: state.log.slice(-200)
        };
    }

    let statusTimer = null;
    function broadcastStatus() {
        if (statusTimer) return;
        statusTimer = setTimeout(async () => {
            statusTimer = null;
            try {
                broadcast("llm-status-changed", await status());
            } catch (e) {}
        }, 150);
    }

    // ---------------------------------------------------------------------
    // Transfers (axel when present, curl otherwise)
    // ---------------------------------------------------------------------

    function axelAvailable() {
        try {
            if (fs.existsSync("/usr/bin/axel") || fs.existsSync("/usr/local/bin/axel")) return true;
        } catch (e) {}
        return false;
    }

    function taskSnapshot() {
        return Array.from(state.tasks.values()).map(t => ({
            id: t.id,
            kind: t.kind,
            modelId: t.modelId || null,
            file: t.file,
            url: t.url,
            status: t.status,
            percent: t.percent || 0,
            speed: t.speed || 0,
            eta: t.eta || "",
            receivedBytes: t.receivedBytes || 0,
            totalBytes: t.totalBytes || 0,
            paused: !!t.paused,
            error: t.error || null
        }));
    }

    function broadcastTasks(force) {
        const now = Date.now();
        if (!force && now - state.lastTick < 500) return;
        state.lastTick = now;
        broadcast("llm-models-tick", { tasks: taskSnapshot() });
    }

    function fmtEta(sec) {
        if (!isFinite(sec) || sec <= 0) return "";
        const h = Math.floor(sec / 3600);
        const m = Math.floor((sec % 3600) / 60);
        const s = Math.floor(sec % 60);
        const p = n => ("0" + n).slice(-2);
        return h > 0 ? h + ":" + p(m) + ":" + p(s) : m + ":" + p(s);
    }

    // Progress is sampled from the file on disk: uniform for axel and curl, and
    // it reflects what actually landed rather than what the tool printed.
    function watchProgress(task) {
        if (task.progressTimer) return;
        task.progressTimer = setInterval(() => {
            let size = 0;
            try { size = fs.statSync(task.part).size; } catch (e) { return; }
            const now = Date.now();
            if (task._lastSize !== undefined && task._lastAt) {
                const dt = (now - task._lastAt) / 1000;
                if (dt > 0) task.speed = Math.max(0, Math.round((size - task._lastSize) / dt));
            }
            task._lastSize = size;
            task._lastAt = now;
            task.receivedBytes = size;
            if (task.totalBytes > 0) {
                task.percent = Math.max(0, Math.min(100, Math.round((size / task.totalBytes) * 100)));
                task.eta = fmtEta((task.totalBytes - size) / Math.max(1, task.speed || 1));
            }
            broadcastTasks();
        }, 800);
    }

    function stopWatching(task) {
        if (task.progressTimer) {
            clearInterval(task.progressTimer);
            task.progressTimer = null;
        }
    }

    function runTransfer(task) {
        return new Promise(resolve => {
            // axel never resumes: it truncates and starts over, and it writes
            // segments out of order, so a .part it left behind may have holes a
            // `curl -C -` range would happily skip. Use curl whenever a partial
            // file is already there (true byte-range resume), axel only for a
            // fresh transfer (multi-connection, much faster on big files).
            const partial = statSize(task.part);
            const useAxel = axelAvailable() && partial === 0 && !task._forceCurl;
            const env = Object.assign({}, process.env, { LC_ALL: "C", LANG: "C" });
            const args = useAxel
                ? ["-a", "-n", "6", "-o", task.part, task.url]
                : ["-fL", "-C", "-", "--connect-timeout", "20", "--retry", "3", "-o", task.part, task.url];
            let proc;
            try {
                proc = spawn(useAxel ? "axel" : "curl", args, { env, stdio: ["ignore", "pipe", "pipe"] });
            } catch (e) {
                return resolve({ ok: false, code: -1, error: e.message });
            }
            task.proc = proc;
            task.status = "downloading";
            task.paused = false;
            task._lastSize = undefined;
            task._lastAt = 0;
            watchProgress(task);
            broadcastTasks(true);

            const pump = d => {
                const s = String(d);
                const m = AXEL_PROG_RE.exec(s);
                if (m) {
                    task.percent = parseInt(m[1], 10) || task.percent;
                }
            };
            proc.stdout.on("data", pump);
            proc.stderr.on("data", pump);
            proc.on("error", err => {
                stopWatching(task);
                task.proc = null;
                resolve({ ok: false, code: -1, error: err.code === "ENOENT" ? "TOOL_MISSING" : err.message });
            });
            proc.on("close", code => {
                stopWatching(task);
                task.proc = null;
                if (task.paused) return; // SIGSTOP does not close; kept for safety
                resolve({ ok: code === 0, code, error: code === 0 ? null : "exit " + code });
            });
        });
    }

    async function verifyGguf(file, expectedSha) {
        let head = Buffer.alloc(8);
        try {
            const fh = await fs.promises.open(file, "r");
            try { await fh.read(head, 0, 8, 0); } finally { await fh.close(); }
        } catch (e) {
            return { ok: false, error: "READ_FAILED" };
        }
        if (!isGgufMagic(head)) return { ok: false, error: "NOT_GGUF" };
        if (!expectedSha) return { ok: true, version: head.readUInt32LE(4) };
        const actual = await new Promise(resolve => {
            const hash = crypto.createHash("sha256");
            const rs = fs.createReadStream(file, { highWaterMark: 4 * 1024 * 1024 });
            rs.on("data", d => hash.update(d));
            rs.on("error", () => resolve(null));
            rs.on("end", () => resolve(hash.digest("hex")));
        });
        if (!actual) return { ok: false, error: "READ_FAILED" };
        if (actual.toLowerCase() !== String(expectedSha).toLowerCase()) {
            return { ok: false, error: "SHA256_MISMATCH", actual };
        }
        return { ok: true, version: head.readUInt32LE(4), sha256: actual };
    }

    function hashFile(file) {
        return new Promise(resolve => {
            const hash = crypto.createHash("sha256");
            const rs = fs.createReadStream(file, { highWaterMark: 4 * 1024 * 1024 });
            rs.on("data", d => hash.update(d));
            rs.on("error", () => resolve(null));
            rs.on("end", () => resolve(hash.digest("hex")));
        });
    }

    function mirrorUrl(url) {
        const llm = readLlm();
        if (!llm.hfMirror) return url;
        return String(url).replace(/^https?:\/\/(www\.)?huggingface\.co/i, "https://hf-mirror.com");
    }

    function probeSize(url) {
        return new Promise(resolve => {
            let hops = 0;
            const go = u => {
                if (hops++ > 5) return resolve(0);
                let mod;
                try { mod = /^https:/i.test(u) ? https : http; } catch (e) { return resolve(0); }
                const req = mod.request(u, { method: "HEAD", timeout: 8000, headers: { "User-Agent": UA } }, res => {
                    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                        res.resume();
                        return go(new URL(res.headers.location, u).toString());
                    }
                    const len = parseInt(res.headers["content-length"], 10);
                    res.resume();
                    resolve(Number.isFinite(len) ? len : 0);
                });
                req.on("error", () => resolve(0));
                req.on("timeout", () => { req.destroy(); resolve(0); });
                req.end();
            };
            go(url);
        });
    }

    function jsonGet(url) {
        return new Promise(resolve => {
            const req = https.get(url, { timeout: 15000, headers: { "User-Agent": UA, "Accept": "application/json" } }, res => {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    res.resume();
                    return jsonGet(new URL(res.headers.location, url).toString()).then(resolve);
                }
                let d = "";
                res.setEncoding("utf8");
                res.on("data", c => { d += c; });
                res.on("end", () => {
                    if (res.statusCode !== 200) return resolve({ error: "HTTP_" + res.statusCode });
                    try { resolve({ json: JSON.parse(d) }); } catch (e) { resolve({ error: "BAD_JSON" }); }
                });
            });
            req.on("error", e => resolve({ error: e.message }));
            req.on("timeout", () => { req.destroy(); resolve({ error: "TIMEOUT" }); });
        });
    }

    // ---------------------------------------------------------------------
    // Model download pipeline
    // ---------------------------------------------------------------------

    function findCatalogModel(id) {
        return CATALOG.find(m => m.id === id) || null;
    }

    function fileFromUrl(u) {
        try {
            const clean = String(u).split("?")[0].split("#")[0];
            return decodeURIComponent(clean.split("/").pop() || "");
        } catch (e) {
            return "";
        }
    }

    function newTask(meta) {
        const task = Object.assign({
            id: "m" + (++state.seq),
            status: "queued",
            percent: 0,
            speed: 0,
            eta: "",
            receivedBytes: 0,
            totalBytes: 0,
            paused: false,
            error: null,
            proc: null
        }, meta);
        state.tasks.set(task.id, task);
        return task;
    }

    async function downloadModel(opts2) {
        const req = opts2 || {};
        let id = req.modelId || null;
        let url = req.url || "";
        let file = req.fileName || "";
        let sha256 = req.sha256 || "";
        let sizeBytes = req.sizeBytes || 0;
        let paramsB = 0;
        let nativeCtx = 32768;
        let kv = 0;
        let name = null;
        let source = "url";

        const cat = id ? findCatalogModel(id) : null;
        if (cat) {
            url = cat.url;
            file = cat.file;
            sha256 = cat.sha256 || "";
            sizeBytes = cat.sizeBytes || 0;
            paramsB = cat.paramsB || 0;
            nativeCtx = cat.nativeCtx || 32768;
            kv = cat.kvBytesPerToken || 0;
            name = cat.name || null;
            source = "catalog";
        }
        if (!url || !/^https?:\/\//i.test(url)) return { ok: false, error: "BAD_URL" };
        if (!file) file = fileFromUrl(url);
        file = path.basename(file);
        if (!/\.gguf$/i.test(file)) return { ok: false, error: "NOT_GGUF_NAME" };

        ensureDir(MODELS);
        ensureDir(INCOMPLETE);
        ensureDir(DOWNLOADS);

        if (!id) id = slugify(file);
        const finalPath = path.join(MODELS, file);
        if (fs.existsSync(finalPath)) {
            const reg = loadRegistry();
            if (reg.models[id]) return { ok: false, error: "ALREADY_INSTALLED" };
        }

        if (!sizeBytes) sizeBytes = await probeSize(mirrorUrl(url));
        if (!sizeBytes) sizeBytes = await probeSize(url);
        const need = sizeBytes ? sizeBytes * 1.05 + 512 * 1024 * 1024 : 0;
        if (need && diskFreeSync() && need > diskFreeSync()) return { ok: false, error: "DISK_LOW" };

        const task = newTask({
            kind: "model",
            modelId: id,
            url,
            file,
            part: path.join(INCOMPLETE, file + ".part"),
            finalPath,
            sha256,
            totalBytes: sizeBytes
        });

        // Fire and forget: the renderer tracks it through llm-models-tick.
        (async () => {
            let res = await runTransfer(task);
            if (!res.ok && !task._forceCurl && axelAvailable()) {
                // axel failed (old build on the mirror, server refusing 6
                // connections, ...): one retry through curl before giving up.
                task._forceCurl = true;
                res = await runTransfer(task);
            }
            if (!res.ok && res.error === "TOOL_MISSING") {
                task.error = res.error;
                task.status = "error";
                broadcastTasks(true);
                return;
            }
            if (!res.ok) {
                task.status = "error";
                task.error = res.error || "DOWNLOAD_FAILED";
                broadcastTasks(true);
                return;
            }
            task.status = "verifying";
            task.percent = 100;
            broadcastTasks(true);

            let verify = await verifyGguf(task.part, sha256);
            if (!verify.ok && (verify.error === "SHA256_MISMATCH" || verify.error === "NOT_GGUF")) {
                // Either a corrupt transfer or holes left by a resumed axel
                // download. Throw the partial away and take one clean pass
                // before reporting failure.
                try { fs.unlinkSync(task.part); } catch (e) {}
                task.receivedBytes = 0;
                task.percent = 0;
                res = await runTransfer(task);
                if (res.ok) verify = await verifyGguf(task.part, sha256);
            }
            if (!verify.ok) {
                try { fs.unlinkSync(task.part); } catch (e) {}
                task.status = "error";
                task.error = verify.error;
                broadcastTasks(true);
                return;
            }

            try {
                await fs.promises.rename(task.part, finalPath);
            } catch (e) {
                task.status = "error";
                task.error = "INSTALL_FAILED";
                broadcastTasks(true);
                return;
            }

            const reg = loadRegistry();
            reg.models[id] = {
                id,
                alias: id,
                file,
                path: finalPath,
                name: name || { zh: file.replace(/\.gguf$/i, ""), en: file.replace(/\.gguf$/i, "") },
                sizeBytes: statSize(finalPath),
                sha256: verify.sha256 || sha256 || null,
                source,
                url,
                paramsB,
                nativeCtx,
                kvBytesPerToken: kv,
                installedAt: Date.now()
            };
            saveRegistry(reg);

            task.status = "done";
            task.percent = 100;
            task.speed = 0;
            task.eta = "";
            broadcastTasks(true);
            broadcastStatus();
            logLine("[model installed] " + id + " -> " + finalPath);
        })().catch(e => {
            task.status = "error";
            task.error = e.message;
            broadcastTasks(true);
        });

        return { ok: true, taskId: task.id, modelId: id, file };
    }

    function pauseTask(taskId) {
        const t = state.tasks.get(taskId);
        if (!t || !t.proc) return { ok: false, error: "NOT_RUNNING" };
        try { t.proc.kill("SIGSTOP"); } catch (e) { return { ok: false, error: "SIGNAL_FAILED" }; }
        t.paused = true;
        t.status = "paused";
        broadcastTasks(true);
        return { ok: true };
    }

    function resumeTask(taskId) {
        const t = state.tasks.get(taskId);
        if (!t || !t.proc) return { ok: false, error: "NOT_RUNNING" };
        try { t.proc.kill("SIGCONT"); } catch (e) { return { ok: false, error: "SIGNAL_FAILED" }; }
        t.paused = false;
        t.status = "downloading";
        t._lastSize = undefined;
        t._lastAt = 0;
        broadcastTasks(true);
        return { ok: true };
    }

    function cancelTask(taskId) {
        const t = state.tasks.get(taskId);
        if (!t) return { ok: true };
        if (t.proc) {
            // SIGTERM hangs a SIGSTOPped process; CONT then KILL (same as the
            // download manager does).
            try { t.proc.kill("SIGCONT"); } catch (e) {}
            try { t.proc.kill("SIGKILL"); } catch (e) {}
        }
        stopWatching(t);
        t.status = "cancelled";
        t.proc = null;
        broadcastTasks(true);
        // Keep .part so a second attempt resumes instead of restarting at 0.
        return { ok: true };
    }

    // ---------------------------------------------------------------------
    // Import + delete
    // ---------------------------------------------------------------------

    async function importModel(sender) {
        const win = sender ? BrowserWindow.fromWebContents(sender) : null;
        let picked;
        try {
            picked = await dialog.showOpenDialog(win || undefined, {
                title: "Import GGUF model",
                properties: ["openFile"],
                filters: [{ name: "GGUF models", extensions: ["gguf"] }]
            });
        } catch (e) {
            return { ok: false, error: "DIALOG_FAILED" };
        }
        if (!picked || picked.canceled || !picked.filePaths || !picked.filePaths.length) {
            return { ok: false, error: "CANCELLED" };
        }
        const src = picked.filePaths[0];
        const check = await verifyGguf(src, "");
        if (!check.ok) return { ok: false, error: check.error };

        ensureDir(MODELS);
        const base = path.basename(src);
        let file = base;
        let n = 1;
        while (fs.existsSync(path.join(MODELS, file))) {
            file = base.replace(/\.gguf$/i, "") + "-" + n + ".gguf";
            n++;
        }
        const dest = path.join(MODELS, file);
        try {
            await fs.promises.copyFile(src, dest);
        } catch (e) {
            return { ok: false, error: "COPY_FAILED" };
        }
        const id = slugify(file);
        const reg = loadRegistry();
        reg.models[id] = {
            id,
            alias: id,
            file,
            path: dest,
            name: { zh: file.replace(/\.gguf$/i, ""), en: file.replace(/\.gguf$/i, "") },
            sizeBytes: statSize(dest),
            sha256: await hashFile(dest),
            source: "import",
            url: "",
            paramsB: 0,
            nativeCtx: 32768,
            kvBytesPerToken: 0,
            installedAt: Date.now()
        };
        saveRegistry(reg);
        broadcastStatus();
        return { ok: true, model: reg.models[id] };
    }

    function deleteModel(id) {
        if (!id) return { ok: false, error: "BAD_ID" };
        if (id === BUNDLED_ID) return { ok: false, error: "BUNDLED_MODEL" };
        const llm = readLlm();
        if (llm.modelId === id) return { ok: false, error: "MODEL_ACTIVE" };
        const reg = loadRegistry();
        const rec = reg.models[id];
        if (!rec) return { ok: false, error: "NOT_FOUND" };
        try {
            if (rec.path && fs.existsSync(rec.path)) fs.unlinkSync(rec.path);
        } catch (e) {
            return { ok: false, error: "DELETE_FAILED" };
        }
        delete reg.models[id];
        saveRegistry(reg);
        broadcastStatus();
        return { ok: true };
    }

    // ---------------------------------------------------------------------
    // Apply / rollback
    // ---------------------------------------------------------------------

    async function applyModel(modelId) {
        if (state.applying) return { ok: false, error: "BUSY" };
        state.applying = true;
        try {
            const rec = resolveModel(modelId);
            if (!rec) return { ok: false, error: "MODEL_NOT_FOUND" };
            if (!fs.existsSync(rec.path)) return { ok: false, error: "MODEL_MISSING" };
            const bin = resolveBinary();
            if (!bin.bin) return { ok: false, error: "LLM_UNAVAILABLE" };

            // A healthy server we did not spawn is someone else's process; never
            // kill it, and never pretend we can swap its model.
            if (!state.proc && await healthCheck()) return { ok: false, error: "PORT_FOREIGN" };

            const llm = readLlm();
            if (rec.id === llm.modelId && state.proc && await healthCheck()) {
                return { ok: true, unchanged: true, model: { id: rec.id, alias: rec.alias || rec.id, path: rec.path } };
            }

            const prevId = llm.modelId;
            await stopServer(8000);
            broadcastStatus();

            const r = await spawnServer(rec, bin);
            if (!r.ok) {
                const prev = resolveModel(prevId);
                if (prev && prev.id !== rec.id) {
                    const back = await spawnServer(prev, bin);
                    logLine("[apply failed: " + r.error + "] rolled back to " + prev.id + (back.ok ? "" : " (rollback also failed)"));
                }
                broadcastStatus();
                return {
                    ok: false,
                    error: r.error,
                    log: r.log || [],
                    rolledBack: true,
                    modelId: prevId
                };
            }

            const fresh = patchSettings(s => {
                s.llm = Object.assign({}, s.llm || {}, {
                    modelId: rec.id,
                    lastGoodModelId: rec.id
                });
            });
            broadcast("settings:changed", fresh);
            broadcastStatus();
            const st = await status();
            return {
                ok: true,
                model: {
                    id: rec.id,
                    alias: rec.alias || rec.id,
                    path: rec.path,
                    ctxSize: st.ctxSize,
                    threads: st.threads
                },
                previous: { id: prevId },
                settings: fresh
            };
        } finally {
            state.applying = false;
        }
    }

    function syncClaude(payload) {
        const modelId = (payload && payload.modelId) || readLlm().modelId;
        const rec = resolveModel(modelId);
        if (!rec) return { ok: false, error: "MODEL_NOT_FOUND" };
        const alias = rec.alias || rec.id;
        const fresh = patchSettings(s => {
            s.claude = Object.assign({}, s.claude || {}, {
                provider: "local",
                baseUrl: "http://" + HOST + ":" + PORT,
                apiKey: "local",
                model: alias,
                haikuModel: alias
            });
            if (payload && payload.enable) s.claude.enabled = true;
        });
        broadcast("settings:changed", fresh);
        return { ok: true, settings: fresh };
    }

    // ---------------------------------------------------------------------
    // llama-server versions
    // ---------------------------------------------------------------------

    function runSpawn(bin, args, timeoutMs, extraEnv) {
        return new Promise(resolve => {
            let out = "";
            let proc;
            try {
                proc = spawn(bin, args, {
                    env: Object.assign({}, process.env, extraEnv || {}),
                    stdio: ["ignore", "pipe", "pipe"]
                });
            } catch (e) {
                return resolve({ ok: false, output: e.message });
            }
            const pump = d => { out += String(d); if (out.length > 20000) out = out.slice(-20000); };
            proc.stdout.on("data", pump);
            proc.stderr.on("data", pump);
            const timer = setTimeout(() => {
                try { proc.kill("SIGKILL"); } catch (e) {}
            }, timeoutMs || 60000);
            proc.on("error", e => { clearTimeout(timer); resolve({ ok: false, output: out + "\n" + e.message }); });
            proc.on("close", code => { clearTimeout(timer); resolve({ ok: code === 0, code, output: out }); });
        });
    }

    async function listServerReleases(force) {
        const now = Date.now();
        if (!force && state.serverReleases && now - state.serverReleasesAt < 10 * 60 * 1000) {
            return { ok: true, releases: state.serverReleases, cached: true };
        }
        const res = await jsonGet(RELEASES_URL);
        if (res.error) return { ok: false, error: "NETWORK", detail: res.error };
        const out = [];
        for (const rel of res.json || []) {
            for (const asset of rel.assets || []) {
                const m = ASSET_RE.exec(asset.name || "");
                if (!m) continue;
                out.push({
                    tag: m[1],
                    name: asset.name,
                    url: asset.browser_download_url,
                    size: asset.size || 0,
                    sha256: asset.digest ? String(asset.digest).replace(/^sha256:/, "") : null,
                    publishedAt: rel.published_at || null
                });
            }
        }
        out.sort((a, b) => parseInt(b.tag.slice(1), 10) - parseInt(a.tag.slice(1), 10));
        state.serverReleases = out.slice(0, 20);
        state.serverReleasesAt = now;
        return { ok: true, releases: state.serverReleases };
    }

    async function installServer(payload) {
        const rel = payload || {};
        if (!rel.url || !/^https:\/\//i.test(rel.url)) return { ok: false, error: "BAD_URL" };
        const tag = String(rel.tag || fileFromUrl(rel.url).replace(/^llama-/, "").replace(/-bin-.*$/, ""));
        ensureDir(DOWNLOADS);
        ensureDir(STAGING_ROOT);
        const tar = path.join(DOWNLOADS, "llama-" + tag + ".tar.gz");

        const task = newTask({
            kind: "server",
            modelId: null,
            url: rel.url,
            file: path.basename(tar),
            part: tar + ".part",
            sha256: rel.sha256 || "",
            totalBytes: rel.size || 0
        });

        if (!task.totalBytes) task.totalBytes = await probeSize(rel.url);
        const res = await runTransfer(task);
        if (!res.ok) {
            task.status = "error";
            task.error = res.error || "DOWNLOAD_FAILED";
            broadcastTasks(true);
            return { ok: false, error: task.error };
        }
        task.status = "verifying";
        broadcastTasks(true);

        try { fs.renameSync(task.part, tar); } catch (e) {
            task.status = "error"; task.error = "INSTALL_FAILED"; broadcastTasks(true);
            return { ok: false, error: "INSTALL_FAILED" };
        }

        // gzip magic, then the digest GitHub publishes with the asset.
        try {
            const fh = await fs.promises.open(tar, "r");
            const head = Buffer.alloc(2);
            try { await fh.read(head, 0, 2, 0); } finally { await fh.close(); }
            if (head[0] !== 0x1f || head[1] !== 0x8b) throw new Error("NOT_GZIP");
        } catch (e) {
            task.status = "error"; task.error = "NOT_GZIP"; broadcastTasks(true);
            try { fs.unlinkSync(tar); } catch (e2) {}
            return { ok: false, error: "NOT_GZIP" };
        }
        if (rel.sha256) {
            const actual = await hashFile(tar);
            if (!actual || actual.toLowerCase() !== String(rel.sha256).toLowerCase()) {
                task.status = "error"; task.error = "SHA256_MISMATCH"; broadcastTasks(true);
                try { fs.unlinkSync(tar); } catch (e) {}
                return { ok: false, error: "SHA256_MISMATCH" };
            }
        }

        task.status = "extracting";
        broadcastTasks(true);
        const staging = path.join(STAGING_ROOT, tag + "-" + Date.now());
        ensureDir(staging);
        const untar = await runSpawn("tar", ["-xzf", tar, "-C", staging, "--strip-components=1"], 180000);
        if (!untar.ok) {
            try { await fs.promises.rm(staging, { recursive: true, force: true }); } catch (e) {}
            task.status = "error"; task.error = "EXTRACT_FAILED"; broadcastTasks(true);
            return { ok: false, error: "EXTRACT_FAILED" };
        }

        // Never swap in a binary that cannot start.
        const smoke = await runSpawn(path.join(staging, "llama-server"), ["--version"], 20000, { LD_LIBRARY_PATH: staging });
        if (!smoke.ok) {
            try { await fs.promises.rm(staging, { recursive: true, force: true }); } catch (e) {}
            task.status = "error"; task.error = "SMOKE_FAILED"; broadcastTasks(true);
            return { ok: false, error: "SMOKE_FAILED", log: String(smoke.output || "").slice(-2000) };
        }

        await swapBinaryDir(staging, tag, rel.sha256 || null);
        try { fs.unlinkSync(tar); } catch (e) {}

        patchSettings(s => {
            s.llm = Object.assign({}, s.llm || {}, { serverVersion: tag });
        });
        broadcast("settings:changed", readSettingsFull());

        task.status = "done";
        task.percent = 100;
        broadcastTasks(true);
        logLine("[llama-server installed] " + tag);

        // Re-apply the active model on the new binary if one is running.
        if (state.proc) {
            const cur = readLlm().modelId;
            stopServer(8000).then(() => applyModel(cur)).catch(() => {});
        }
        broadcastStatus();
        return { ok: true, version: tag };
    }

    async function swapBinaryDir(staging, tag, sha) {
        await fs.promises.rm(BIN_PREV, { recursive: true, force: true }).catch(() => {});
        if (fs.existsSync(BIN_DIR)) {
            try { await fs.promises.rename(BIN_DIR, BIN_PREV); } catch (e) {}
        }
        await fs.promises.rename(staging, BIN_DIR);
        try {
            fs.writeFileSync(path.join(BIN_DIR, "version.json"), JSON.stringify({
                version: tag,
                asset: "llama-" + tag + "-bin-ubuntu-x64.tar.gz",
                sha256: sha || null,
                installedAt: Date.now()
            }, "", 4));
        } catch (e) {}
    }

    async function selectServer(version) {
        const v = String(version || "bundled");
        if (v !== "bundled" && !fs.existsSync(path.join(BIN_DIR, "llama-server"))) {
            return { ok: false, error: "BIN_MISSING" };
        }
        const fresh = patchSettings(s => {
            s.llm = Object.assign({}, s.llm || {}, { serverVersion: v });
        });
        broadcast("settings:changed", fresh);
        if (state.proc) {
            const cur = readLlm().modelId;
            stopServer(8000).then(() => applyModel(cur)).catch(() => {});
        }
        broadcastStatus();
        return { ok: true, version: v };
    }

    async function rollbackServer() {
        if (!fs.existsSync(BIN_PREV)) return { ok: false, error: "NO_PREVIOUS" };
        await fs.promises.rm(BIN_DIR, { recursive: true, force: true }).catch(() => {});
        await fs.promises.rename(BIN_PREV, BIN_DIR);
        const ver = readBinVersionFile(BIN_DIR) || "bundled";
        const fresh = patchSettings(s => {
            s.llm = Object.assign({}, s.llm || {}, { serverVersion: ver });
        });
        broadcast("settings:changed", fresh);
        if (state.proc) {
            const cur = readLlm().modelId;
            stopServer(8000).then(() => applyModel(cur)).catch(() => {});
        }
        broadcastStatus();
        return { ok: true, version: ver };
    }

    // ---------------------------------------------------------------------
    // HuggingFace helpers
    // ---------------------------------------------------------------------

    // Accepts a direct .gguf resolve URL or a repo page. Repo pages come back
    // as MULTIPLE_FILES with the GGUF list so the renderer can let the user pick.
    async function resolveCustomUrl(rawUrl) {
        const u = String(rawUrl || "").trim();
        if (!/^https?:\/\//i.test(u)) return { ok: false, error: "BAD_URL" };
        if (/\/resolve\//i.test(u) || /\.gguf(\?|#|$)/i.test(u)) {
            return { ok: true, url: u, file: fileFromUrl(u) };
        }
        const m = /^https?:\/\/(?:www\.)?(?:huggingface\.co|hf-mirror\.com)\/([^/]+)\/([^/?#]+)\/?$/i.exec(u);
        if (!m) return { ok: true, url: u, file: fileFromUrl(u) };
        const repo = m[1] + "/" + m[2];
        const api = "https://huggingface.co/api/models/" + repo + "/tree/main?recursive=1";
        const res = await jsonGet(api);
        if (res.error) return { ok: false, error: "REPO_LOOKUP_FAILED", detail: res.error };
        const files = (res.json || [])
            .filter(f => f && f.type === "file" && /\.gguf$/i.test(f.path || ""))
            .map(f => ({
                name: f.path,
                size: (f.lfs && f.lfs.size) || f.size || 0,
                sha256: (f.lfs && f.lfs.oid) || null,
                url: "https://huggingface.co/" + repo + "/resolve/main/" + f.path.split("/").map(encodeURIComponent).join("/")
            }));
        if (!files.length) return { ok: false, error: "NO_GGUF" };
        if (files.length === 1) {
            return { ok: true, url: files[0].url, file: path.basename(files[0].name), sha256: files[0].sha256, sizeBytes: files[0].size };
        }
        files.sort((a, b) => a.size - b.size);
        return { ok: false, error: "MULTIPLE_FILES", files: files.slice(0, 12) };
    }

    // ---------------------------------------------------------------------
    // IPC
    // ---------------------------------------------------------------------

    function registerIpc() {
        ipcMain.handle("llm:status", () => status());
        ipcMain.handle("llm:start", () => startServer());
        ipcMain.handle("llm:stop", () => stopServer(8000));
        ipcMain.handle("llm:set-enabled", (e, payload) => {
            return payload && payload.enabled ? startServer().then(r => ({ ok: !!r.ok })) : stopServer(8000).then(() => ({ ok: true }));
        });

        ipcMain.handle("llm:hardware", () => hardware());
        ipcMain.handle("llm:catalog", () => catalogView());
        ipcMain.handle("llm:models", () => {
            const reg = loadRegistry();
            const b = bundledRecord();
            return { ok: true, models: Object.values(reg.models), bundled: b };
        });
        ipcMain.handle("llm:tasks", () => ({ ok: true, tasks: taskSnapshot() }));

        ipcMain.handle("llm:download", async (e, payload) => {
            const p = payload || {};
            if (p.url) {
                const resolved = await resolveCustomUrl(p.url);
                if (!resolved.ok) return resolved;
                return downloadModel({
                    modelId: p.modelId || null,
                    url: resolved.url,
                    fileName: p.fileName || resolved.file,
                    sha256: p.sha256 || resolved.sha256 || "",
                    sizeBytes: p.sizeBytes || resolved.sizeBytes || 0
                });
            }
            if (!p.modelId) return { ok: false, error: "BAD_REQUEST" };
            return downloadModel({ modelId: p.modelId });
        });
        ipcMain.handle("llm:download-pause", (e, p) => pauseTask(p && p.taskId));
        ipcMain.handle("llm:download-resume", (e, p) => resumeTask(p && p.taskId));
        ipcMain.handle("llm:download-cancel", (e, p) => cancelTask(p && p.taskId));

        ipcMain.handle("llm:import", e => importModel(e.sender));
        ipcMain.handle("llm:apply", (e, p) => applyModel(p && p.modelId));
        ipcMain.handle("llm:delete", (e, p) => deleteModel(p && p.modelId));
        ipcMain.handle("llm:sync-claude", (e, p) => syncClaude(p));

        ipcMain.handle("llm:server-list", (e, p) => listServerReleases(!!(p && p.force)));
        ipcMain.handle("llm:server-install", (e, p) => installServer(p));
        ipcMain.handle("llm:server-select", (e, p) => selectServer(p && p.version));
        ipcMain.handle("llm:server-rollback", () => rollbackServer());

        signale.info("Local LLM manager ready at " + ROOT);
    }

    function shutdown() {
        const proc = state.proc;
        if (proc) {
            try { proc.kill("SIGTERM"); } catch (e) {}
        }
        for (const t of state.tasks.values()) {
            if (t.proc) {
                try { t.proc.kill("SIGCONT"); } catch (e) {}
                try { t.proc.kill("SIGKILL"); } catch (e) {}
            }
            stopWatching(t);
        }
        state.proc = null;
        global.llmProc = null;
    }

    return {
        paths: () => ({ root: ROOT, modelsDir: MODELS, downloadsDir: DOWNLOADS, binDir: BIN_DIR, registryFile: REGISTRY }),
        activeModel,
        activeAlias,
        resolveModel,
        resolveCtx,
        resolveThreads,
        resolveBinary,
        hardware,
        catalogView,
        status,
        health: healthCheck,
        start: startServer,
        stop: () => stopServer(8000),
        waitReady,
        applyModel,
        deleteModel,
        importModel,
        downloadModel,
        syncClaude,
        listServerReleases,
        installServer,
        selectServer,
        rollbackServer,
        registerIpc,
        shutdown,
        _state: () => ({ ...state, tasks: taskSnapshot(), proc: !!state.proc })
    };
};

// Exported for unit-style checks without booting Electron.
module.exports._helpers = { slugify, isGgufMagic, fmtBytes };
