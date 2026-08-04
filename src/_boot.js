const signale = require("signale");
const {app, BrowserWindow, dialog, shell} = require("electron");

// Allow audio/video to start without a user gesture so media opened from the
// file browser autoplays (and the play/pause button state stays in sync).
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

process.on("uncaughtException", e => {
    signale.fatal(e);
    dialog.showErrorBox("eDEX-UI crashed", e.message || "Cannot retrieve error message.");
    if (tty) {
        tty.close();
    }
    if (extraTtys) {
        Object.keys(extraTtys).forEach(key => {
            if (extraTtys[key] !== null) {
                extraTtys[key].close();
            }
        });
    }
    process.exit(1);
});

signale.start(`Starting eDEX-UI v${app.getVersion()}`);
signale.info(`With Node ${process.versions.node} and Electron ${process.versions.electron}`);
signale.info(`Renderer is Chrome ${process.versions.chrome}`);

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
    signale.fatal("Error: Another instance of eDEX is already running. Cannot proceed.");
    app.exit(1);
}

signale.time("Startup");

const electron = require("electron");
require('@electron/remote/main').initialize()
const ipc = electron.ipcMain;
const path = require("path");
const url = require("url");
const fs = require("fs");
const which = require("which");
const Terminal = require("./classes/terminal.class.js").Terminal;

ipc.on("log", (e, type, content) => {
    signale[type](content);
});

var win, tty, extraTtys;
const settingsFile = path.join(electron.app.getPath("userData"), "settings.json");
const shortcutsFile = path.join(electron.app.getPath("userData"), "shortcuts.json");
const lastWindowStateFile = path.join(electron.app.getPath("userData"), "lastWindowState.json");
const themesDir = path.join(electron.app.getPath("userData"), "themes");
const innerThemesDir = path.join(__dirname, "assets/themes");
const kblayoutsDir = path.join(electron.app.getPath("userData"), "keyboards");
const innerKblayoutsDir = path.join(__dirname, "assets/kb_layouts");
const fontsDir = path.join(electron.app.getPath("userData"), "fonts");
const innerFontsDir = path.join(__dirname, "assets/fonts");

// Unset proxy env variables to avoid connection problems on the internal websockets
// See #222
if (process.env.http_proxy) delete process.env.http_proxy;
if (process.env.https_proxy) delete process.env.https_proxy;

// Bypass GPU acceleration blocklist, trading a bit of stability for a great deal of performance, mostly on Linux
app.commandLine.appendSwitch("ignore-gpu-blocklist");
app.commandLine.appendSwitch("enable-gpu-rasterization");
app.commandLine.appendSwitch("enable-video-decode");

// Fix userData folder not setup on Windows
try {
    fs.mkdirSync(electron.app.getPath("userData"));
    signale.info(`Created config dir at ${electron.app.getPath("userData")}`);
} catch(e) {
    signale.info(`Base config dir is ${electron.app.getPath("userData")}`);
}
// Create default settings file
if (!fs.existsSync(settingsFile)) {
    fs.writeFileSync(settingsFile, JSON.stringify({
        shell: (process.platform === "win32") ? "powershell.exe" : "bash",
        shellArgs: '',
        cwd: electron.app.getPath("home"), // start in the home dir like a normal terminal
        keyboard: "en-US",
        theme: "tron",
        termFontSize: 14,
        audio: true,
        audioVolume: 1.0,
        disableFeedbackAudio: false,
        clockHours: 24,
        pingAddr: "223.5.5.5",
        port: 3000,
        nointro: false,
        nocursor: false,
        forceFullscreen: true,
        allowWindowed: false,
        excludeThreadsFromToplist: true,
        hideDotfiles: false,
        fsListView: false,
        experimentalGlobeFeatures: false,
        experimentalFeatures: false,
        weatherLocation: null,
        fsQuickLinks: null,
        screensaverEnabled: true,
        screensaverIdle: 300,
        screensaverStyle: "code",
        lockCode: "0000",
        lockOnIdle: true,
        claude: {
            enabled: false,
            baseUrl: "",
            apiKey: "",
            model: "",
            haikuModel: ""
        },
        appMonitor: {
            enabled: true,
            mock: null,                       // null = auto: mock on darwin, real on linux
            httpPort: 6080,
            wsPort: 6081,
            appImageDirs: "~/Applications,~/AppImages"
        }
    }, "", 4));
    signale.info(`Default settings written to ${settingsFile}`);
}
// Create default shortcuts file
if (!fs.existsSync(shortcutsFile)) {
    fs.writeFileSync(shortcutsFile, JSON.stringify([
        { type: "app", trigger: "Ctrl+Shift+C", action: "COPY", enabled: true },
        { type: "app", trigger: "Ctrl+Shift+V", action: "PASTE", enabled: true },
        { type: "app", trigger: "Ctrl+Tab", action: "NEXT_TAB", enabled: true },
        { type: "app", trigger: "Ctrl+Shift+Tab", action: "PREVIOUS_TAB", enabled: true },
        { type: "app", trigger: "Ctrl+X", action: "TAB_X", enabled: true },
        { type: "app", trigger: "Ctrl+Shift+S", action: "SETTINGS", enabled: true },
        { type: "app", trigger: "Ctrl+Shift+K", action: "SHORTCUTS", enabled: true },
        { type: "app", trigger: "Ctrl+Shift+F", action: "FUZZY_SEARCH", enabled: true },
        { type: "app", trigger: "Ctrl+Shift+L", action: "FS_LIST_VIEW", enabled: true },
        { type: "app", trigger: "Ctrl+Shift+H", action: "FS_DOTFILES", enabled: true },
        { type: "app", trigger: "Ctrl+Shift+P", action: "KB_PASSMODE", enabled: true },
        { type: "app", trigger: "Ctrl+Shift+I", action: "DEV_DEBUG", enabled: false },
        { type: "app", trigger: "Ctrl+Shift+F5", action: "DEV_RELOAD", enabled: true },
        { type: "shell", trigger: "Ctrl+Shift+Alt+Space", action: "neofetch", linebreak: true, enabled: false }
    ], "", 4));
    signale.info(`Default keymap written to ${shortcutsFile}`);
}
//Create default window state file
if(!fs.existsSync(lastWindowStateFile)) {
    fs.writeFileSync(lastWindowStateFile, JSON.stringify({
        useFullscreen: true
    }, "", 4));
    signale.info(`Default last window state written to ${lastWindowStateFile}`);
}

// Copy default themes & keyboard layouts & fonts
signale.pending("Mirroring internal assets...");
try {
    fs.mkdirSync(themesDir);
} catch(e) {
    // Folder already exists
}
fs.readdirSync(innerThemesDir).forEach(e => {
    fs.writeFileSync(path.join(themesDir, e), fs.readFileSync(path.join(innerThemesDir, e), {encoding:"utf-8"}));
});
try {
    fs.mkdirSync(kblayoutsDir);
} catch(e) {
    // Folder already exists
}
fs.readdirSync(innerKblayoutsDir).forEach(e => {
    fs.writeFileSync(path.join(kblayoutsDir, e), fs.readFileSync(path.join(innerKblayoutsDir, e), {encoding:"utf-8"}));
});
try {
    fs.mkdirSync(fontsDir);
} catch(e) {
    // Folder already exists
}
fs.readdirSync(innerFontsDir).forEach(e => {
    fs.writeFileSync(path.join(fontsDir, e), fs.readFileSync(path.join(innerFontsDir, e)));
});

// Version history logging
const versionHistoryPath = path.join(electron.app.getPath("userData"), "versions_log.json");
var versionHistory = fs.existsSync(versionHistoryPath) ? require(versionHistoryPath) : {};
var version = app.getVersion();
if (typeof versionHistory[version] === "undefined") {
	versionHistory[version] = {
		firstSeen: Date.now(),
		lastSeen: Date.now()
	};
} else {
	versionHistory[version].lastSeen = Date.now();
}
fs.writeFileSync(versionHistoryPath, JSON.stringify(versionHistory, 0, 2), {encoding:"utf-8"});

function createWindow(settings) {
    signale.info("Creating window...");

    let display;
    if (!isNaN(settings.monitor)) {
        display = electron.screen.getAllDisplays()[settings.monitor] || electron.screen.getPrimaryDisplay();
    } else {
        display = electron.screen.getPrimaryDisplay();
    }
    let {x, y, width, height} = display.bounds;
    width++; height++;
    win = new BrowserWindow({
        title: "eDEX-UI",
        x,
        y,
        width,
        height,
        show: false,
        resizable: true,
        movable: settings.allowWindowed || false,
        fullscreen: settings.forceFullscreen || false,
        autoHideMenuBar: true,
        frame: settings.allowWindowed || false,
        backgroundColor: '#000000',
        webPreferences: {
            devTools: true,
            contextIsolation: false,
            // Throttle timers/rAF in the renderer when the window is occluded or
            // minimized. Previously false, which kept every UI animation running
            // at full rate forever even in the background - the main cause of
            // "edex becomes very laggy after running for a long time" (constant
            // CPU/GPU load + GC pressure). The UI still animates at full speed
            // whenever the window is actually visible.
            backgroundThrottling: true,
            webSecurity: true,
            nodeIntegration: true,
            nodeIntegrationInSubFrames: false,
            allowRunningInsecureContent: false,
            // Enable the <webview> tag so the embedded browser (tab 5) and the
            // webapp panel (tab 4) can run a full Chromium guest.
            webviewTag: true,
            // The renderer relies on full Node access (require("fs"), require("https"), ...).
            // Since Electron 20+ sandboxes renderers by default, it must be disabled explicitly.
            sandbox: false
        }
    });

    // Enable @electron/remote for this window (modern replacement for the removed remote module)
    require("@electron/remote/main").enable(win.webContents);

    // Forward renderer console errors & process failures to the terminal log
    win.webContents.on("console-message", (event) => {
        // Modern Electron passes a WebContentsConsoleMessageEventParams object
        if (event.level >= 2) {
            signale.debug(`[renderer:${event.level}] ${event.message} (${event.sourceId}:${event.lineNumber})`);
        }
    });
    win.webContents.on("render-process-gone", (event, details) => {
        signale.fatal(`Renderer process gone: reason=${details.reason} exitCode=${details.exitCode}`);
    });
    win.webContents.on("unresponsive", () => {
        signale.warn("Renderer unresponsive");
    });

    // Open external links in the default browser instead of new Electron windows
    win.webContents.setWindowOpenHandler(({url}) => {
        shell.openExternal(url);
        return {action: "deny"};
    });

    win.loadURL(url.format({
        pathname: path.join(__dirname, 'ui.html'),
        protocol: 'file:',
        slashes: true
    }));

    signale.complete("Frontend window created!");
    win.show();
    if (!settings.allowWindowed) {
        win.setResizable(false);
    } else if (!require(lastWindowStateFile)["useFullscreen"]) {
        win.setFullScreen(false);
    }

    signale.watch("Waiting for frontend connection...");
}

// ---- App monitors (terminal tabs 4 & 5): backend process + IPC bridge ----
// The backend (src/appmonitor/server.js) runs as a plain Node process
// (ELECTRON_RUN_AS_NODE=1, same pattern as the claude-launcher) and serves the
// noVNC client page + REST API on 127.0.0.1. The renderer never talks to it
// over http:// (ui.html CSP would block it) — every call goes through the IPC
// handlers below, which proxy to the backend over localhost HTTP.
const http = require("http");

function apiRequest(port, method, pathname, body) {
    return new Promise(resolve => {
        const payload = body ? Buffer.from(JSON.stringify(body)) : null;
        const req = http.request({
            host: "127.0.0.1", port, method, path: pathname,
            headers: payload ? { "Content-Type": "application/json", "Content-Length": payload.length } : {}
        }, res => {
            let data = "";
            res.on("data", c => { data += c; });
            res.on("end", () => {
                try { resolve(JSON.parse(data || "null")); } catch (e) { resolve(null); }
            });
        });
        req.on("error", () => resolve(null));
        req.setTimeout(5000, () => { req.destroy(); resolve(null); });
        if (payload) req.write(payload);
        req.end();
    });
}
const apiGet = (port, p) => apiRequest(port, "GET", p);
const apiPost = (port, p, body) => apiRequest(port, "POST", p, body);
const apiDelete = (port, p) => apiRequest(port, "DELETE", p);

function nextFreePort(base) {
    return new Promise(resolve => {
        const net = require("net");
        const tryPort = n => {
            const srv = net.createServer();
            srv.once("error", () => { srv.close(); tryPort(n + 1); });
            srv.listen(n, "127.0.0.1", () => { const p = srv.address().port; srv.close(() => resolve(p)); });
        };
        tryPort(base);
    });
}

async function startAppMonitor(settings, cleanEnv) {
    const am = settings.appMonitor || {};
    if (am.enabled === false) { global.appMonitor = null; return; }
    const isMock = (typeof am.mock === "boolean") ? am.mock : (process.platform !== "linux");
    const httpPort = await nextFreePort(am.httpPort || 6080);
    const wsPort = await nextFreePort(am.wsPort || 6081);
    // Pull the active theme accent so the mock framebuffer matches eDEX.
    let tr = 170, tg = 207, tb = 209;
    try {
        const theme = JSON.parse(fs.readFileSync(path.join(innerThemesDir, settings.theme + ".json"), "utf8"));
        if (theme.colors) { tr = theme.colors.r; tg = theme.colors.g; tb = theme.colors.b; }
    } catch (e) {}
    const proc = require("child_process").spawn(process.execPath,
        [path.join(__dirname, "appmonitor", "server.js")],
        { env: Object.assign({}, cleanEnv, {
            ELECTRON_RUN_AS_NODE: "1",
            EDEX_APPMONITOR_BACKEND: isMock ? "mock" : "real",
            EDEX_APPMONITOR_HTTP_PORT: String(httpPort),
            EDEX_APPMONITOR_WS_PORT: String(wsPort),
            EDEX_APPMONITOR_USERDATA: electron.app.getPath("userData"),
            EDEX_APPMONITOR_APPIMAGE_DIRS: am.appImageDirs || "",
            EDEX_APPMONITOR_THEME_R: String(tr),
            EDEX_APPMONITOR_THEME_G: String(tg),
            EDEX_APPMONITOR_THEME_B: String(tb)
        }), stdio: ["ignore", "pipe", "pipe"] });
    proc.stdout.on("data", d => signale.debug("[appmonitor] " + String(d).trimEnd()));
    proc.stderr.on("data", d => signale.warn("[appmonitor] " + String(d).trimEnd()));
    proc.on("exit", () => { global.appMonitor = null; });
    global.appMonitor = { proc, httpPort, isMock };
    // Await readiness (the renderer retries too, so timing out here is not fatal).
    for (let i = 0; i < 20; i++) {
        const health = await apiGet(httpPort, "/api/health");
        if (health && health.ok) { signale.success("App monitor backend ready (mock=" + isMock + ")"); return; }
        await new Promise(r => setTimeout(r, 150));
    }
    signale.warn("App monitor backend did not become ready in time");
}

// Native-fullscreen exit affordances:
//  * a global hotkey (Ctrl+Shift+Q) — registered once eDEX is up;
//  * a tiny always-on-top corner window with an unobtrusive "◀ EDEX" button,
//    shown while a native app covers the shell (openbox keeps it above).
let fsExitWin = null;

function hideFsExitButton() {
    if (fsExitWin && !fsExitWin.isDestroyed()) { try { fsExitWin.hide(); } catch (e) {} }
}

function showFsExitButton() {
    try {
        if (fsExitWin && !fsExitWin.isDestroyed()) { fsExitWin.show(); fsExitWin.moveTop(); return; }
        const accent = "170,207,209";
        const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
            html,body{margin:0;height:100vh;overflow:hidden;background:transparent}
            #b{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;
               background:rgba(5,8,13,0.85);border:1px solid rgba(${accent},0.55);
               color:rgb(${accent});font-family:sans-serif;font-size:11px;letter-spacing:0.15em;
               cursor:pointer;user-select:none;box-sizing:border-box}
            #b:hover{background:rgba(20,40,52,0.9)}
        </style></head><body><div id="b" onclick="require('electron').ipcRenderer.send('edex-exit-fullscreen')">&#9664; EDEX</div></body></html>`;
        const display = electron.screen.getPrimaryDisplay();
        const { width: sw, height: sh } = display.workAreaSize;
        fsExitWin = new electron.BrowserWindow({
            width: 104, height: 34, frame: false, transparent: true, resizable: false,
            alwaysOnTop: true, skipTaskbar: true, hasShadow: false, focusable: true,
            x: sw - 128, y: sh - 52,
            webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false }
        });
        fsExitWin.setAlwaysOnTop(true, "screen-saver");
        fsExitWin.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
        fsExitWin.on("closed", () => { fsExitWin = null; });
    } catch (e) { signale.warn("Could not show exit-fullscreen button: " + (e && e.message)); }
}

function exitFullscreenViaMain() {
    hideFsExitButton();
    if (global.appMonitor) { try { apiPost(global.appMonitor.httpPort, "/api/fullscreen/exit"); } catch (e) {} }
    if (win && !win.isDestroyed()) { win.show(); win.focus(); }
}

app.on('ready', async () => {
    signale.pending(`Loading settings file...`);
    let settings = require(settingsFile);
    signale.pending(`Resolving shell path...`);
    settings.shell = await which(settings.shell).catch(e => { throw(e) });
    signale.info(`Shell found at ${settings.shell}`);
    signale.success(`Settings loaded!`);

    if (!require("fs").existsSync(settings.cwd)) throw new Error("Configured cwd path does not exist.");

    // See #366
    let cleanEnv = await require("shell-env")(settings.shell).catch(e => { throw e; });

    // Claude Code integration: resolve the claude CLI against the login-shell
    // PATH so the dedicated tab works even when the Electron app is launched
    // with a minimal PATH (e.g. from Finder), and inject the configured AI
    // service / API into every terminal's environment.
    const claudeConf = settings.claude || {};
    const claudeShell = await which("claude", { path: cleanEnv.PATH }).catch(() => null);
    const claudeEnv = {};
    if (claudeConf.enabled) {
        if (claudeConf.baseUrl) claudeEnv.ANTHROPIC_BASE_URL = claudeConf.baseUrl;
        if (claudeConf.apiKey) claudeEnv.ANTHROPIC_API_KEY = claudeConf.apiKey;
        if (claudeConf.model) claudeEnv.ANTHROPIC_MODEL = claudeConf.model;
        if (claudeConf.haikuModel) claudeEnv.ANTHROPIC_DEFAULT_HAIKU_MODEL = claudeConf.haikuModel;
    }

    Object.assign(cleanEnv, {
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
        TERM_PROGRAM: "eDEX-UI",
        TERM_PROGRAM_VERSION: app.getVersion()
    }, claudeEnv, settings.env);

    signale.pending(`Creating new terminal process on port ${settings.port || '3000'}`);
    tty = new Terminal({
        role: "server",
        shell: settings.shell,
        params: settings.shellArgs || '',
        cwd: settings.cwd,
        env: cleanEnv,
        port: settings.port || 3000
    });
    signale.success(`Terminal back-end initialized!`);
    tty.onclosed = (code, signal) => {
        tty.ondisconnected = () => {};
        signale.complete("Terminal exited", code, signal);
        app.quit();
    };
    tty.onopened = () => {
        signale.success("Connected to frontend!");
        signale.timeEnd("Startup");
    };
    tty.onresized = (cols, rows) => {
        signale.info("Resized TTY to ", cols, rows);
    };
    tty.ondisconnected = () => {
        signale.error("Lost connection to frontend");
        signale.watch("Waiting for frontend connection...");
    };

    // Support for multithreaded systeminformation calls
    signale.pending("Starting multithreaded calls controller...");
    require("./_multithread.js");

    // App monitors (tabs 4/5): register the IPC bridge, then spawn the backend.
    ipc.handle("appmonitor:config", () => {
        const am = global.appMonitor;
        return am ? apiGet(am.httpPort, "/api/config") : { ok: false, error: "disabled" };
    });
    ipc.handle("appmonitor:native-list", () => {
        const am = global.appMonitor;
        return am ? apiGet(am.httpPort, "/api/native-apps") : { ok: false, apps: [] };
    });
    ipc.handle("appmonitor:launch", (e, { monitorId, appId }) => {
        const am = global.appMonitor;
        return am ? apiPost(am.httpPort, "/api/monitors/" + monitorId + "/launch", { appId }) : { ok: false, error: "disabled" };
    });
    ipc.handle("appmonitor:kill", (e, { monitorId }) => {
        const am = global.appMonitor;
        return am ? apiPost(am.httpPort, "/api/monitors/" + monitorId + "/kill") : { ok: false, error: "disabled" };
    });
    ipc.handle("appmonitor:add-native", (e, entry) => {
        const am = global.appMonitor;
        return am ? apiPost(am.httpPort, "/api/native-apps", entry) : { ok: false, error: "disabled" };
    });
    ipc.handle("appmonitor:remove-native", (e, id) => {
        const am = global.appMonitor;
        return am ? apiDelete(am.httpPort, "/api/native-apps/" + encodeURIComponent(id)) : { ok: false, error: "disabled" };
    });
    ipc.handle("appmonitor:fullscreen", async (e, { monitorId, appId }) => {
        const am = global.appMonitor;
        const r = am ? await apiPost(am.httpPort, "/api/monitors/" + monitorId + "/fullscreen", { appId }) : { ok: false, error: "disabled" };
        if (r && r.ok) showFsExitButton();        // app is now covering the shell: drop a return button
        return r;
    });
    ipc.handle("appmonitor:exit-fullscreen", async () => {
        const am = global.appMonitor;
        const r = am ? await apiPost(am.httpPort, "/api/fullscreen/exit") : { ok: true };
        hideFsExitButton();
        if (win && !win.isDestroyed()) { win.show(); win.focus(); }
        return r;
    });

    // ---- WiFi (NetworkManager) — the simple-connect panel ----
    const execFile = require("child_process").execFile;
    ipc.handle("wifi:list", () => new Promise(resolve => {
        if (process.platform !== "linux") return resolve({ ok: false, error: "linux only" });
        execFile("nmcli", ["-t", "-f", "SSID,SIGNAL,SECURITY", "dev", "wifi", "list", "--rescan", "yes"],
            { timeout: 25000 }, (err, stdout) => {
                if (err) return resolve({ ok: false, error: (err.stderr || err.message).trim() });
                const networks = stdout.split("\n").filter(Boolean).map(line => {
                    const [ssid, signal, security] = line.split(":");
                    return { ssid: ssid || "", signal: parseInt(signal) || 0, security: security || "" };
                }).filter(n => n.ssid);
                resolve({ ok: true, networks });
            });
    }));
    ipc.handle("wifi:connect", (e, { ssid, password }) => new Promise(resolve => {
        if (process.platform !== "linux") return resolve({ ok: false, error: "linux only" });
        const args = ["device", "wifi", "connect", ssid];
        if (password) args.push("password", password);
        execFile("nmcli", args, { timeout: 30000 }, (err, stdout, stderr) => {
            resolve(err ? { ok: false, error: (stderr || err.message).trim() } : { ok: true, ssid });
        });
    }));
    ipc.handle("wifi:status", () => new Promise(resolve => {
        if (process.platform !== "linux") return resolve({ ok: false });
        execFile("nmcli", ["-t", "-f", "ACTIVE,SSID", "dev", "wifi"], { timeout: 10000 }, (err, stdout) => {
            if (err) return resolve({ ok: false });
            const line = (stdout || "").split("\n").find(l => l.startsWith("yes:"));
            resolve({ ok: true, connected: !!line, ssid: line ? line.split(":")[1] : "" });
        });
    }));
    // Let the renderer open the WiFi panel (floating button / hotkey).
    ipc.on("open-wifi-panel", () => { if (win && !win.isDestroyed()) win.webContents.send("open-wifi-panel"); });

    // System update: sudo apt update && full-upgrade, streaming output to the
    // renderer (needs passwordless sudo + network — both set up at install).
    ipc.handle("system:update", () => new Promise(resolve => {
        const { spawn } = require("child_process");
        const cmd = "sudo apt-get update -y && sudo apt-get full-upgrade -y " +
                    "-o Dpkg::Options::=--force-confold -o Dpkg::Options::=--force-confdef";
        const proc = spawn("bash", ["-c", cmd], { env: Object.assign({}, process.env, { DEBIAN_FRONTEND: "noninteractive" }) });
        const send = line => { if (win && !win.isDestroyed()) win.webContents.send("system-update-output", line); };
        proc.stdout.on("data", d => String(d).split("\n").forEach(l => l.trim() && send(l.trim())));
        proc.stderr.on("data", d => String(d).split("\n").forEach(l => l.trim() && send(l.trim())));
        proc.on("close", code => resolve({ ok: code === 0, code }));
        proc.on("error", e => resolve({ ok: false, error: e.message }));
    }));

    startAppMonitor(settings, cleanEnv);

    createWindow(settings);

    // Exit native fullscreen: global hotkey (backup) + the corner button's IPC.
    try {
        electron.globalShortcut.register("CommandOrControl+Shift+Q", exitFullscreenViaMain);
    } catch (e) { signale.warn("Could not register exit-fullscreen hotkey: " + (e && e.message)); }
    ipc.on("edex-exit-fullscreen", exitFullscreenViaMain);

    // Open the WiFi connect panel.
    try {
        electron.globalShortcut.register("CommandOrControl+Shift+W", () => {
            if (win && !win.isDestroyed()) win.webContents.send("open-wifi-panel");
        });
    } catch (e) { signale.warn("Could not register wifi-panel hotkey: " + (e && e.message)); }

    // Lock the screen (Ctrl+Shift+O).
    try {
        electron.globalShortcut.register("CommandOrControl+Shift+O", () => {
            if (win && !win.isDestroyed()) win.webContents.send("lock-screen");
        });
    } catch (e) { signale.warn("Could not register lock hotkey: " + (e && e.message)); }

    // Support for more terminals, used for creating tabs (currently limited to 4 extra terms)
    extraTtys = {};
    let basePort = settings.port || 3000;
    basePort = Number(basePort) + 2;

    for (let i = 0; i < 4; i++) {
        extraTtys[basePort+i] = null;
    }

    ipc.on("ttyspawn", (e, arg) => {
        let port = null;
        Object.keys(extraTtys).forEach(key => {
            if (extraTtys[key] === null && port === null) {
                extraTtys[key] = {};
                port = key;
            }
        });

        if (port === null) {
            signale.error("TTY spawn denied (Reason: exceeded max TTYs number)");
            e.sender.send("ttyspawn-reply", "ERROR: max number of ttys reached");
        } else {
            signale.pending(`Creating new TTY process on port ${port}`);
            // The 3rd tab is the dedicated Claude Code tab: the renderer asks
            // for it with arg "claude". Fall back to the normal shell if the
            // claude CLI is not installed.
            const useClaude = (arg === "claude" && claudeShell);
            let shell = settings.shell;
            let params = settings.shellArgs || '';
            let login = true;
            let env = cleanEnv;
            if (useClaude) {
                // Launch the sci-fi workspace picker instead of claude directly:
                // the user picks a working directory, then the picker spawns
                // claude (CLAUDE_BIN) there with this terminal inherited.
                shell = process.execPath;
                params = [path.join(__dirname, "assets", "misc", "claude-launcher.js")];
                env = Object.assign({}, cleanEnv, {
                    ELECTRON_RUN_AS_NODE: "1",
                    CLAUDE_BIN: claudeShell,
                    START_DIR: tty.tty._cwd || settings.cwd
                });
                login = false;
            }
            let term = new Terminal({
                role: "server",
                shell,
                params,
                login,
                cwd: tty.tty._cwd || settings.cwd,
                env,
                port: port
            });
            signale.success(`New terminal back-end initialized at ${port}`);
            term.onclosed = (code, signal) => {
                term.ondisconnected = () => {};
                term.wss.close();
                signale.complete(`TTY exited at ${port}`, code, signal);
                extraTtys[term.port] = null;
                term = null;
            };
            term.onopened = pid => {
                signale.success(`TTY ${port} connected to frontend (process PID ${pid})`);
            };
            term.onresized = () => {};
            term.ondisconnected = () => {
                term.onclosed = () => {};
                term.close();
                term.wss.close();
                extraTtys[term.port] = null;
                term = null;
            };

            extraTtys[port] = term;
            e.sender.send("ttyspawn-reply", "SUCCESS: "+port);
        }
    });

    // Backend support for theme and keyboard hotswitch
    let themeOverride = null;
    let kbOverride = null;
    ipc.on("getThemeOverride", (e, arg) => {
        e.sender.send("getThemeOverride", themeOverride);
    });
    ipc.on("getKbOverride", (e, arg) => {
        e.sender.send("getKbOverride", kbOverride);
    });
    ipc.on("setThemeOverride", (e, arg) => {
        themeOverride = arg;
    });
    ipc.on("setKbOverride", (e, arg) => {
        kbOverride = arg;
    });

    // Clear the embedded browser's persisted session data (Privacy settings).
    // "cache" clears the HTTP cache; "storage" clears cookies + site storage.
    ipc.on("browser-clear-data", (e, what) => {
        const ses = electron.session.fromPartition("persist:edex-browser");
        if (what === "cache") {
            ses.clearCache();
        } else if (what === "storage") {
            ses.clearStorageData();
        }
    });

    // Download manager: intercept downloads from the embedded browser AND the
    // virtual-monitor webviews (tabs 4/5), save them to the OS Downloads folder
    // and tell the renderer to show a toast when each finishes.
    const wireDownloads = partition => {
        electron.session.fromPartition(partition).on("will-download", (event, item, webContents) => {
            const file = path.join(electron.app.getPath("downloads"), item.getFilename());
            try { item.setSavePath(file); } catch (err) {}
            item.on("done", (e, state) => {
                const host = webContents && webContents.hostWebContents;
                if (host && !host.isDestroyed()) {
                    host.send("edex-download-done", {
                        name: item.getFilename(),
                        path: file,
                        ok: state === "completed"
                    });
                }
            });
        });
    };
    for (const p of ["persist:edex-browser", "persist:edex-monitor-a", "persist:edex-monitor-b"]) wireDownloads(p);

    // ---- Ad-blocking for the embedded browser (tab 5), default ON ----
    // @cliqz/adblocker (EasyList + EasyPrivacy + uBlock filters) wired into the
    // browser session via Electron's webRequest. The compiled engine is cached
    // in userData so startup works offline after the first successful fetch.
    let adBlocker = null;
    let adBlockEnabled = true;

    async function initAdBlocker() {
        try {
            const { ElectronBlocker } = require('@cliqz/adblocker-electron');
            const cacheFile = path.join(electron.app.getPath("userData"), "adblock-cache.bin");
            const lists = [
                "https://easylist.to/easylist/easylist.txt",
                "https://easylist.to/easylist/easyprivacy.txt",
                "https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/filters.txt"
            ];
            let blocker = null;
            try {
                const cached = fs.readFileSync(cacheFile);
                blocker = await ElectronBlocker.fromCache(globalThis.fetch, cached);
            } catch (err) {}
            if (!blocker) {
                blocker = await ElectronBlocker.fromLists(globalThis.fetch, lists);
                try { fs.writeFileSync(cacheFile, blocker.serialize()); } catch (err) {}
            }
            adBlocker = blocker;
            if (adBlockEnabled) blocker.enableBlockingInSession(electron.session.fromPartition("persist:edex-browser"));
            signale.success("Ad blocker ready" + (adBlockEnabled ? " (enabled)" : " (disabled)"));
        } catch (err) {
            signale.warn("Ad blocker failed to initialize: " + (err && err.message));
        }
    }

    ipc.on("set-adblock", (e, enabled) => {
        adBlockEnabled = !!enabled;
        if (!adBlocker) return;
        const ses = electron.session.fromPartition("persist:edex-browser");
        try {
            if (adBlockEnabled) adBlocker.enableBlockingInSession(ses);
            else adBlocker.disableBlockingInSession(ses);
        } catch (err) {}
    });

    initAdBlocker();
});

app.on('web-contents-created', (e, contents) => {
    if (contents.getType() === 'webview') {
        // The embedded browser (tab 5) and webapp panel (tab 4) navigate freely -
        // the will-navigate lock below applies to the main UI only.

        // Route window.open / target=_blank from webviews to the renderer, which
        // turns browser-tab popups into new browser tabs and opens webapp-panel
        // popups externally. (The <webview> element itself has no
        // setWindowOpenHandler in modern Electron - this is the supported path.)
        try {
            const isBrowserSession = (contents.session === electron.session.fromPartition('persist:edex-browser'));
            contents.setWindowOpenHandler(({ url }) => {
                if (contents.hostWebContents) {
                    contents.hostWebContents.send('webview-window-open', { url, browser: isBrowserSession });
                }
                return { action: 'deny' };
            });
        } catch (err) {}

        // Route in-browser shortcuts (Ctrl+T/W/L) to the renderer while a
        // BROWSER webview is focused. These must NOT be OS-global shortcuts:
        // globalShortcut would fire in every other app too. The guest page
        // swallows key events, so the only reliable hook is before-input-event
        // here in the main process (which only fires when this webContents has
        // input focus).
        try {
            if (contents.session === electron.session.fromPartition('persist:edex-browser')) {
                contents.on('before-input-event', (event, input) => {
                    if (!input.control || input.type !== 'keyDown') return;
                    const k = String(input.key || '').toLowerCase();
                    if (k === 't' || k === 'w' || k === 'l' || k === 'f' || k === 'g' || k === 'p') {
                        if (contents.hostWebContents) contents.hostWebContents.send('browser-shortcut', k);
                        event.preventDefault();
                    }
                });
            }
        } catch (err) {}
        return;
    }
    // Prevent loading something else than the UI
    contents.on('will-navigate', (e, url) => {
        if (url !== contents.getURL()) e.preventDefault();
    });
});

app.on('window-all-closed', () => {
    signale.info("All windows closed");
    app.quit();
});

app.on('before-quit', () => {
    tty.close();
    Object.keys(extraTtys).forEach(key => {
        if (extraTtys[key] !== null) {
            extraTtys[key].close();
        }
    });
    if (global.appMonitor && global.appMonitor.proc) {
        try { global.appMonitor.proc.kill("SIGTERM"); } catch (e) {}
    }
    if (fsExitWin && !fsExitWin.isDestroyed()) { try { fsExitWin.close(); } catch (e) {} }
    try { electron.globalShortcut.unregisterAll(); } catch (e) {}
    signale.complete("Shutting down...");
});
