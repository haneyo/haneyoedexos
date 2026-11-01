#!/usr/bin/env node
// Dev-only helper: regenerate src/assets/llm/catalog.json from the Hugging Face
// tree API so that `sizeBytes` and `sha256` are never typed by hand.
//
//   node scripts/gen-llm-catalog.js            # write the catalog
//   node scripts/gen-llm-catalog.js --dry-run  # print it only
//
// The output is a build input (packed into the asar), but this script is not.
// Every number in it comes from the API; if a repo or file is gone the entry is
// reported and skipped instead of being filled in with a guess.

const fs = require("fs");
const path = require("path");
const https = require("https");

const OUT = path.join(__dirname, "..", "src", "assets", "llm", "catalog.json");
const CACHE_DIR = path.join(__dirname, ".cache");
const UA = "eDEX-UI catalog generator";

// Quantized KV cache (llama.cpp q8_0): 32 elements -> 32 bytes + 2 byte scale.
const Q8_0_BYTES_PER_ELEMENT = 34 / 32;

// layers / kvHeads / headDim come from each model's config.json and are used
// only to derive kvBytesPerToken. Re-check them if a repo is swapped.
const CANDIDATES = [
    {
        id: "qwen2.5-0.5b-instruct-q4_k_m",
        repo: "Qwen/Qwen2.5-0.5B-Instruct-GGUF",
        want: "qwen2.5-0.5b-instruct-q4_k_m.gguf",
        family: "Qwen2.5",
        paramsB: 0.5,
        quant: "Q4_K_M",
        layers: 24, kvHeads: 2, headDim: 64,
        nativeCtx: 32768,
        languages: ["zh", "en", "multilingual"],
        license: "Apache-2.0",
        bundled: true,
        name: { zh: "Qwen2.5 0.5B 指令（内置）", en: "Qwen2.5 0.5B Instruct (bundled)" },
        notes: {
            zh: "随 ISO 内置、不可删除的兜底模型。任何机器都能跑，但知识面窄、长文能力弱。",
            en: "Ships inside the ISO and cannot be deleted. Runs anywhere, but shallow knowledge and weak on long inputs."
        }
    },
    {
        id: "llama-3.2-1b-instruct-q4_k_m",
        repo: "bartowski/Llama-3.2-1B-Instruct-GGUF",
        want: "Llama-3.2-1B-Instruct-Q4_K_M.gguf",
        family: "Llama 3.2",
        paramsB: 1.2,
        quant: "Q4_K_M",
        layers: 16, kvHeads: 8, headDim: 64,
        nativeCtx: 131072,
        languages: ["en", "de", "fr", "it", "pt", "hi", "es", "th"],
        license: "Llama 3.2 Community",
        name: { zh: "Llama 3.2 1B 指令", en: "Llama 3.2 1B Instruct" },
        notes: {
            zh: "Meta 的小模型，八种语言（不含中文）。速度最快的一档。",
            en: "Meta's small model, eight languages (no Chinese). The fastest tier."
        }
    },
    {
        id: "gemma-3-1b-it-q4_k_m",
        repo: "ggml-org/gemma-3-1b-it-GGUF",
        want: "gemma-3-1b-it-Q4_K_M.gguf",
        family: "Gemma 3",
        paramsB: 1.0,
        quant: "Q4_K_M",
        layers: 26, kvHeads: 1, headDim: 256,
        nativeCtx: 32768,
        languages: ["en", "multilingual"],
        license: "Gemma Terms of Use",
        name: { zh: "Gemma 3 1B 指令", en: "Gemma 3 1B Instruct" },
        notes: {
            zh: "Google 的 1B 模型，KV 缓存极小（多查询注意力），长上下文最省内存。",
            en: "Google's 1B model; tiny KV cache (multi-query attention), the cheapest long context here."
        }
    },
    {
        id: "qwen3-1.7b-q4_k_m",
        repo: "unsloth/Qwen3-1.7B-GGUF",
        want: "Qwen3-1.7B-Q4_K_M.gguf",
        family: "Qwen3",
        paramsB: 1.7,
        quant: "Q4_K_M",
        layers: 28, kvHeads: 8, headDim: 128,
        nativeCtx: 40960,
        languages: ["zh", "en", "multilingual"],
        license: "Apache-2.0",
        name: { zh: "Qwen3 1.7B", en: "Qwen3 1.7B" },
        notes: {
            zh: "中文明显强于 0.5B，弱机上最平衡的一档。带思考模式，回答前会先推理。",
            en: "Clearly better Chinese than 0.5B, the best balance on weak hardware. Has a thinking mode."
        }
    },
    {
        id: "gemma-3-4b-it-q4_k_m",
        repo: "ggml-org/gemma-3-4b-it-GGUF",
        want: "gemma-3-4b-it-Q4_K_M.gguf",
        family: "Gemma 3",
        paramsB: 4.0,
        quant: "Q4_K_M",
        layers: 34, kvHeads: 4, headDim: 256,
        nativeCtx: 131072,
        languages: ["en", "multilingual"],
        license: "Gemma Terms of Use",
        name: { zh: "Gemma 3 4B 指令", en: "Gemma 3 4B Instruct" },
        notes: {
            zh: "多语言质量好、长上下文便宜的 4B。预填充比同尺寸 Qwen3 略慢。",
            en: "A 4B with good multilingual quality and cheap long context. Prefill is a bit slower than Qwen3 4B."
        }
    },
    {
        id: "phi-4-mini-instruct-q4_k_m",
        repo: "unsloth/Phi-4-mini-instruct-GGUF",
        want: "Phi-4-mini-instruct-Q4_K_M.gguf",
        family: "Phi-4",
        paramsB: 3.8,
        quant: "Q4_K_M",
        layers: 32, kvHeads: 8, headDim: 128,
        nativeCtx: 131072,
        languages: ["en", "multilingual"],
        license: "MIT",
        name: { zh: "Phi-4-mini 指令", en: "Phi-4-mini Instruct" },
        notes: {
            zh: "微软的小模型，英文推理/代码不错，中文一般。",
            en: "Microsoft's small model; solid English reasoning and code, average Chinese."
        }
    },
    {
        id: "qwen3-4b-instruct-2507-q4_k_m",
        repo: "unsloth/Qwen3-4B-Instruct-2507-GGUF",
        want: "Qwen3-4B-Instruct-2507-Q4_K_M.gguf",
        family: "Qwen3",
        paramsB: 4.0,
        quant: "Q4_K_M",
        layers: 36, kvHeads: 8, headDim: 128,
        nativeCtx: 262144,
        languages: ["zh", "en", "multilingual"],
        license: "Apache-2.0",
        name: { zh: "Qwen3 4B 指令 2507", en: "Qwen3 4B Instruct 2507" },
        notes: {
            zh: "不上思考模式的 Qwen3 4B，中文与指令跟随都不错；KV 缓存偏大，32k 上下文要 2.5GB 内存。",
            en: "Non-thinking Qwen3 4B with good Chinese and instruction following. Its KV cache is large: 32k context costs about 2.5 GB."
        }
    },
    {
        id: "mistral-7b-instruct-v0.3-q4_k_m",
        repo: "bartowski/Mistral-7B-Instruct-v0.3-GGUF",
        want: "Mistral-7B-Instruct-v0.3-Q4_K_M.gguf",
        family: "Mistral",
        paramsB: 7.2,
        quant: "Q4_K_M",
        layers: 32, kvHeads: 8, headDim: 128,
        nativeCtx: 32768,
        languages: ["en", "fr", "de", "es", "it", "pt", "nl", "multilingual"],
        license: "Apache-2.0",
        name: { zh: "Mistral 7B 指令 v0.3", en: "Mistral 7B Instruct v0.3" },
        notes: {
            zh: "老牌 7B，多语言稳。4 线程机上首轮预填充要十几分钟，日常问答会明显等。",
            en: "The classic 7B, solid multilingual. On 4 threads the first prefill takes many minutes, so expect a long wait."
        }
    },
    {
        id: "llama-3.1-8b-instruct-q4_k_m",
        repo: "bartowski/Meta-Llama-3.1-8B-Instruct-GGUF",
        want: "Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf",
        family: "Llama 3.1",
        paramsB: 8.0,
        quant: "Q4_K_M",
        layers: 32, kvHeads: 8, headDim: 128,
        nativeCtx: 131072,
        languages: ["en", "de", "fr", "it", "pt", "hi", "es", "th"],
        license: "Llama 3.1 Community",
        name: { zh: "Llama 3.1 8B 指令", en: "Llama 3.1 8B Instruct" },
        notes: {
            zh: "这一档里最强的通用英文模型，也是内存和时间压力最大的。不适合弱机日常使用。",
            en: "The strongest general English model here, and the heaviest on both RAM and time. Not for everyday use on weak hardware."
        }
    }
];

function get(url) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, { timeout: 20000, headers: { "User-Agent": UA, Accept: "application/json" } }, res => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                res.resume();
                return get(new URL(res.headers.location, url).toString()).then(resolve, reject);
            }
            let d = "";
            res.setEncoding("utf8");
            res.on("data", c => { d += c; });
            res.on("end", () => {
                if (res.statusCode !== 200) return reject(new Error("HTTP " + res.statusCode + " for " + url));
                try {
                    resolve(JSON.parse(d));
                } catch (e) {
                    reject(new Error("bad JSON from " + url));
                }
            });
        });
        req.on("error", reject);
        req.on("timeout", () => { req.destroy(new Error("timeout " + url)); });
    });
}

function cachePath(repo) {
    return path.join(CACHE_DIR, repo.replace(/\//g, "__") + ".json");
}

async function tree(repo) {
    try {
        fs.mkdirSync(CACHE_DIR, { recursive: true });
        const cp = cachePath(repo);
        if (fs.existsSync(cp) && Date.now() - fs.statSync(cp).mtimeMs < 6 * 3600 * 1000) {
            return JSON.parse(fs.readFileSync(cp, "utf8"));
        }
        const data = await get("https://huggingface.co/api/models/" + repo + "/tree/main?recursive=1");
        fs.writeFileSync(cp, JSON.stringify(data));
        return data;
    } catch (e) {
        return { error: e.message };
    }
}

function pick(treeList, want) {
    const files = treeList.filter(f => f && f.type === "file" && /\.gguf$/i.test(f.path || ""));
    const base = p => p.split("/").pop().toLowerCase();
    let hit = files.find(f => base(f.path) === want.toLowerCase());
    if (!hit) hit = files.find(f => f.path.toLowerCase().endsWith("/" + want.toLowerCase()) || f.path.toLowerCase() === want.toLowerCase());
    return hit || null;
}

async function main() {
    const dry = process.argv.includes("--dry-run");
    const models = [];
    const problems = [];

    for (const c of CANDIDATES) {
        const t = await tree(c.repo);
        if (t.error) {
            problems.push(c.id + ": " + t.error);
            continue;
        }
        const f = pick(t, c.want);
        if (!f) {
            const names = t.filter(x => /\.gguf$/i.test(x.path || "")).map(x => x.path).join(", ");
            problems.push(c.id + ": file not found in " + c.repo + " (has: " + (names || "none") + ")");
            continue;
        }
        const size = (f.lfs && f.lfs.size) || f.size || 0;
        const sha = (f.lfs && f.lfs.oid) || null;
        if (!size || !sha) {
            problems.push(c.id + ": missing size/sha for " + f.path);
            continue;
        }
        const kv = Math.round(2 * c.layers * c.kvHeads * c.headDim * Q8_0_BYTES_PER_ELEMENT);
        models.push({
            id: c.id,
            file: f.path.split("/").pop(),
            name: c.name,
            family: c.family,
            paramsB: c.paramsB,
            quant: c.quant,
            languages: c.languages,
            sizeBytes: size,
            sha256: sha,
            url: "https://huggingface.co/" + c.repo + "/resolve/main/" + f.path.split("/").map(encodeURIComponent).join("/"),
            hfRepo: c.repo,
            hfPath: f.path,
            kvBytesPerToken: kv,
            nativeCtx: c.nativeCtx,
            license: c.license,
            notes: c.notes,
            bundled: !!c.bundled
        });
        console.log(
            "ok  " + c.id.padEnd(38) +
            String((size / 1073741824).toFixed(2)).padStart(6) + " GB  kv " +
            String(Math.round(kv / 1024)).padStart(3) + " KiB/tok  " + f.path
        );
    }

    if (problems.length) {
        console.error("\nskipped:");
        for (const p of problems) console.error("  - " + p);
    }

    const out = {
        version: 1,
        generatedAt: new Date().toISOString(),
        note: "Generated by scripts/gen-llm-catalog.js from the Hugging Face tree API. sizeBytes and sha256 are taken from the LFS metadata; kvBytesPerToken is derived from each model's layer/kv-head/head-dim config at q8_0.",
        models
    };
    if (dry) {
        console.log(JSON.stringify(out, null, 4));
    } else {
        fs.mkdirSync(path.dirname(OUT), { recursive: true });
        fs.writeFileSync(OUT, JSON.stringify(out, null, 4) + "\n");
        console.log("\nwrote " + path.relative(process.cwd(), OUT) + " (" + models.length + " models)");
    }
    if (problems.length) process.exitCode = 1;
}

main().catch(e => {
    console.error(e.stack || e.message);
    process.exit(1);
});
