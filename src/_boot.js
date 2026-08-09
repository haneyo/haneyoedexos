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
const cursorsDir = path.join(electron.app.getPath("userData"), "cursors");
const innerCursorsDir = path.join(__dirname, "assets/cursors");

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
        screenOffIdle: 1800,                 // seconds without input → blank the display (software screen-off); never below screensaverIdle
        screensaverStyle: "code",
        lockCode: "0000",
        lockOnIdle: true,
        lockIdleTimeout: 30,               // seconds without input while locked → back to the screensaver
        showKeyboard: false,
        appSort: "name-asc",                 // app-monitor list order: name|install|freq + asc|desc
        bootAnimAfterUnlock: true,           // play the boot animation after a matrix lock/screensaver unlock
        terminalScrollSensitivity: 1,        // terminal scroll speed multiplier (mouse/trackpad wheel)
        terminalScrollDirection: "normal",   // "normal" | "reversed"
        cursorAutoHide: true,                // hide the cursor after cursorAutoHideDelay s of inactivity
        cursorAutoHideDelay: 10,             // seconds without mouse movement before the cursor hides
        cursorStyle: "lightech",             // pointer look: "lightech" (bundled WP7 .ani set) | "scifi" (theme chevron)
        cursorSize: 28,                      // LightechRE pointer size in px (16-64)
        mouseWheelSpeed: 1,                  // global wheel scroll multiplier (0.25x-4x; 1 = default)
        cursorSpeed: 1,                      // pointer speed multiplier (0.25x-4x) — applied to the device, not the preview
        batteryAlways: false,                // show a simulated battery readout on machines without one (desktops/mac mini)
        performanceMode: "",                 // CPU governor to apply at boot: "powersave" | "schedutil" | "performance" ("" = leave as-is)
        claude: {
            enabled: false,
            provider: "",
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
try {
    fs.mkdirSync(cursorsDir);
} catch(e) {
    // Folder already exists
}
fs.readdirSync(innerCursorsDir).forEach(e => {
    fs.writeFileSync(path.join(cursorsDir, e), fs.readFileSync(path.join(innerCursorsDir, e)));
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

// CPU governor helpers (module scope — used by the power:governor IPC handler
// AND re-applied on boot when settings.performanceMode is saved).
const readSys = f => { try { return fs.readFileSync(f, "utf8").trim(); } catch (e) { return null; } };
const applyGovernor = governor => {
    const online = readSys("/sys/devices/system/cpu/online") || "0";
    const cpus = [];
    for (const part of online.split(",")) {
        const m = /^(\d+)-(\d+)$/.exec(part);
        if (m) { for (let i = +m[1]; i <= +m[2]; i++) cpus.push(i); }
        else if (/^\d+$/.test(part)) cpus.push(+part);
    }
    const { exec } = require("child_process");
    cpus.forEach(n => {
        const f = "/sys/devices/system/cpu/cpu" + n + "/cpufreq/scaling_governor";
        exec("echo " + governor + " | sudo -n tee " + f + " >/dev/null 2>&1");
    });
};

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
    // Show only once the first frame is painted. win.show() right after loadURL
    // exposes a blank canvas before the renderer installs its themed cursor and
    // dark background — the white-flash + native-arrow moment seen on real
    // hardware between lightdm and the eDEX lock screen. backgroundColor is
    // black and ui.html paints dark from the first byte, so ready-to-show (first
    // render) appears already dark. A safety timer force-shows if the renderer
    // stalls before first paint, so a slow first boot never sits on black forever.
    const showWindow = () => {
        if (win && !win.isDestroyed()) win.show();
    };
    win.once("ready-to-show", showWindow);
    setTimeout(showWindow, 4000);
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
            EDEX_APPMONITOR_APP_FILTER: am.appFilter || "",
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
            x: sw - 128, y: 14,   /* top-right corner of the screen */
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
    ipc.handle("appmonitor:status", () => {
        const am = global.appMonitor;
        return am ? apiGet(am.httpPort, "/api/monitors/status") : { ok: false, monitors: {} };
    });
    ipc.handle("appmonitor:close", (e, { appId }) => {
        const am = global.appMonitor;
        return am ? apiPost(am.httpPort, "/api/apps/close", { appId }) : { ok: false, error: "disabled" };
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

    // ---- Offline voice input (sherpa-onnx + a streaming Chinese model) ----
    // The renderer captures the mic (16 kHz mono Float32), streams chunks here
    // for recognition, and inserts the final text into the focused terminal.
    let voiceRecognizer = null;
    let voiceStream = null;
    const voiceModelDirs = () => {
        const candidates = [
            path.join(__dirname, "..", "..", "models", "sherpa-onnx-streaming-zipformer-multi-zh-hans-2023-12-12"),
            "/opt/edex/models/sherpa-onnx-streaming-zipformer-multi-zh-hans-2023-12-12",
            path.join(electron.app.getPath("userData"), "models", "sherpa-onnx-streaming-zipformer-multi-zh-hans-2023-12-12")
        ];
        return candidates.find(p => fs.existsSync(path.join(p, "tokens.txt"))) || null;
    };
    ipc.handle("voice:init", () => {
        try {
            if (voiceRecognizer) return { ok: true };
            const sherpa = require("sherpa-onnx-node");
            const dir = voiceModelDirs();
            if (!dir) return { ok: false, error: "voice model not found" };
            const pick = (k) => fs.readdirSync(dir).find(f => f.includes(k) && f.endsWith(".onnx"));
            const encoder = pick("encoder"), decoder = pick("decoder"), joiner = pick("joiner");
            if (!encoder || !decoder || !joiner) return { ok: false, error: "model files missing" };
            voiceRecognizer = new sherpa.OnlineRecognizer({
                featConfig: { sampleRate: 16000, featureDim: 80 },
                modelConfig: {
                    transducer: {
                        encoder: path.join(dir, encoder),
                        decoder: path.join(dir, decoder),
                        joiner: path.join(dir, joiner)
                    },
                    tokens: path.join(dir, "tokens.txt"),
                    numThreads: 2,
                    provider: "cpu",
                    debug: 0
                },
                decodingMethod: "greedy_search"
            });
            signale.success("Voice recognizer ready (offline ASR)");
            return { ok: true };
        } catch (e) {
            return { ok: false, error: String((e && e.message) || e) };
        }
    });
    ipc.handle("voice:start", () => {
        if (!voiceRecognizer) return { ok: false, error: "not initialized" };
        voiceStream = voiceRecognizer.createStream();
        return { ok: true };
    });
    ipc.handle("voice:chunk", (e, samples) => {
        if (!voiceRecognizer || !voiceStream || !samples) return { ok: false };
        try {
            voiceStream.acceptWaveform({ samples: new Float32Array(samples), sampleRate: 16000 });
            while (voiceRecognizer.isReady(voiceStream)) voiceRecognizer.decode(voiceStream);
            const r = voiceRecognizer.getResult(voiceStream);
            if (r && r.text) {
                try { win.webContents.send("voice:partial", r.text); } catch (e2) {}
            }
            return { ok: true };
        } catch (e) {
            return { ok: false, error: String((e && e.message) || e) };
        }
    });
    ipc.handle("voice:stop", () => {
        if (!voiceRecognizer || !voiceStream) return { ok: true, text: "" };
        try {
            voiceStream.inputFinished();
            while (voiceRecognizer.isReady(voiceStream)) voiceRecognizer.decode(voiceStream);
            const r = voiceRecognizer.getResult(voiceStream);
            const text = (r && r.text) || "";
            voiceStream = null;
            return { ok: true, text };
        } catch (e) {
            voiceStream = null;
            return { ok: false, error: String((e && e.message) || e) };
        }
    });

    // ---- WiFi (NetworkManager) — the simple-connect panel ----
    const execFile = require("child_process").execFile;
    // Demo Wi-Fi dataset used on non-Linux so the settings UI is previewable.
    const mockWifiNetworks = [
        { ssid: "EDEX-DEMO-5G", signal: 88, security: "WPA2" },
        { ssid: "EDEX-DEMO-GUEST", signal: 62, security: "" },
        { ssid: "Cafe_WiFi", signal: 45, security: "WPA2" },
        { ssid: "Starbucks", signal: 18, security: "WPA3" },
    ];
    const mockWifiSaved = [
        { name: "EDEX-DEMO-5G", autoconnect: true },
        { name: "EDEX-DEMO-GUEST", autoconnect: false },
    ];
    ipc.handle("wifi:list", () => new Promise(resolve => {
        if (process.platform !== "linux") return resolve({ ok: true, networks: mockWifiNetworks });
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
        if (process.platform !== "linux") return resolve({ ok: true, connected: true, ssid: "EDEX-DEMO-5G" });
        execFile("nmcli", ["-t", "-f", "ACTIVE,SSID", "dev", "wifi"], { timeout: 10000 }, (err, stdout) => {
            if (err) return resolve({ ok: false });
            const line = (stdout || "").split("\n").find(l => l.startsWith("yes:"));
            resolve({ ok: true, connected: !!line, ssid: line ? line.split(":")[1] : "" });
        });
    }));
    // Saved (known) WiFi networks and their autoconnect flag.
    ipc.handle("wifi:saved", () => new Promise(resolve => {
        if (process.platform !== "linux") return resolve({ ok: true, saved: mockWifiSaved });
        execFile("nmcli", ["-t", "-f", "NAME,TYPE,AUTOCONNECT", "connection", "show"], { timeout: 10000 },
            (err, stdout) => {
                if (err) return resolve({ ok: false, error: (err.stderr || err.message).trim() });
                const saved = (stdout || "").split("\n").filter(Boolean)
                    .map(line => line.split(":"))
                    .filter(p => p[1] === "802-11-wireless")
                    .map(p => ({ name: p[0], autoconnect: p[2] === "yes" }));
                resolve({ ok: true, saved });
            });
    }));
    // Forget a saved network: nmcli connection delete <name>.
    ipc.handle("wifi:forget", (e, { name }) => new Promise(resolve => {
        if (process.platform !== "linux") return resolve({ ok: false, error: "linux only" });
        execFile("nmcli", ["connection", "delete", String(name)], { timeout: 15000 },
            (err, stdout, stderr) => resolve(err ? { ok: false, error: (stderr || err.message).trim() } : { ok: true }));
    }));
    // Disconnect the active WiFi interface (nmcli device disconnect <dev>).
    ipc.handle("wifi:disconnect", () => new Promise(resolve => {
        if (process.platform !== "linux") return resolve({ ok: true });
        execFile("nmcli", ["-t", "-f", "DEVICE,TYPE,STATE", "dev"], { timeout: 10000 }, (err, stdout) => {
            if (err) return resolve({ ok: false, error: (err.stderr || err.message).trim() });
            const dev = (stdout || "").split("\n").filter(Boolean)
                .map(line => line.split(":"))
                .find(p => p[1] === "wifi" && (p[2] === "connected" || p[2] === "connecting"));
            if (!dev) return resolve({ ok: false, error: "no active wifi" });
            execFile("nmcli", ["device", "disconnect", dev[0]], { timeout: 15000 },
                (err2, so, se) => resolve(err2 ? { ok: false, error: (se || err2.message).trim() } : { ok: true }));
        });
    }));
    // WiFi radio on/off (rfkill via NetworkManager): nmcli radio wifi on|off.
    ipc.handle("wifi:radio", (e, on) => new Promise(resolve => {
        if (process.platform !== "linux") return resolve(on == null ? { ok: true, enabled: true } : { ok: true, enabled: !!on });
        if (on == null) {
            execFile("nmcli", ["radio", "wifi"], { timeout: 8000 }, (err, stdout) =>
                resolve(err ? { ok: false, error: (err.stderr || err.message).trim() }
                           : { ok: true, enabled: (stdout || "").trim() === "enabled" }));
            return;
        }
        execFile("nmcli", ["radio", "wifi", on ? "on" : "off"], { timeout: 10000 }, (err, stdout, stderr) =>
            resolve(err ? { ok: false, error: (stderr || err.message).trim() } : { ok: true, enabled: !!on }));
    }));
    // Current connection details (IP / gateway / mask / DNS), macOS-style info card.
    ipc.handle("wifi:detail", () => new Promise(resolve => {
        if (process.platform !== "linux") return resolve({ ok: true, connected: true, ssid: "EDEX-DEMO", ip: "192.168.1.42", gateway: "192.168.1.1", mask: "255.255.255.0", dns: ["192.168.1.1", "223.5.5.5"] });
        const activeWifi = () => new Promise(res2 => {
            execFile("nmcli", ["-t", "-f", "DEVICE,TYPE,STATE", "dev"], { timeout: 8000 }, (err, stdout) => {
                if (err) return res2(null);
                const dev = (stdout || "").split("\n").filter(Boolean).map(l => l.split(":"))
                    .find(p => p[1] === "wifi" && p[2] === "connected");
                res2(dev ? dev[0] : null);
            });
        });
        activeWifi().then(dev => {
            if (!dev) return resolve({ ok: true, connected: false });
            execFile("nmcli", ["-t", "-f", "IP4.ADDRESS,IP4.GATEWAY,IP4.DNS", "device", "show", dev], { timeout: 10000 },
                (err, stdout) => {
                    if (err) return resolve({ ok: true, connected: true, ssid: dev });
                    const ipM = /^IP4\.ADDRESS\[1\]:([^\n]*)$/m.exec(stdout);
                    const gwM = /^IP4\.GATEWAY:([^\n]*)$/m.exec(stdout);
                    const dns = (stdout.match(/^IP4\.DNS\[\d+\]:([^\n]*)$/gm) || []).map(l => l.split(":")[1].trim());
                    const ip = ipM ? ipM[1].trim().split("/")[0] : "";
                    const mask = ipM ? ipM[1].trim().split("/")[1] || "" : "";
                    const gw = gwM ? gwM[1].trim() : "";
                    const maskIp = mask === "24" ? "255.255.255.0" : mask === "16" ? "255.255.0.0" : mask === "8" ? "255.0.0.0" : mask;
                    resolve({ ok: true, connected: true, ssid: dev, ip, gateway: gw, mask: maskIp, dns });
                });
        });
    }));
    // Per-saved-network auto-join: nmcli connection modify <name> connection.autoconnect.
    ipc.handle("wifi:set-autoconnect", (e, { name, auto }) => new Promise(resolve => {
        if (process.platform !== "linux") return resolve({ ok: true });
        execFile("nmcli", ["connection", "modify", String(name), "connection.autoconnect", auto ? "yes" : "no"],
            { timeout: 10000 }, (err, stdout, stderr) => resolve(err ? { ok: false, error: (stderr || err.message).trim() } : { ok: true }));
    }));
    // Proxy config of the active WiFi connection (auto / none / manual).
    ipc.handle("wifi:proxy", (e, cfg) => new Promise(resolve => {
        if (process.platform !== "linux") return resolve({ ok: true, method: "auto", http: "", https: "" });
        const activeConn = () => new Promise(res2 => {
            execFile("nmcli", ["-t", "-f", "NAME,DEVICE,TYPE", "connection", "show", "--active"], { timeout: 8000 }, (err, stdout) => {
                if (err) return res2("");
                const c = (stdout || "").split("\n").filter(Boolean).map(l => l.split(":"))
                    .find(p => p[2] === "802-11-wireless");
                res2(c ? c[0] : "");
            });
        });
        activeConn().then(name => {
            if (!name) return resolve({ ok: true, connected: false });
            if (cfg) {
                const args = ["connection", "modify", name,
                    "proxy.method", cfg.method || "auto",
                    "proxy.http", cfg.http || "",
                    "proxy.https", cfg.https || ""];
                execFile("nmcli", args, { timeout: 10000 }, (err, stdout, stderr) =>
                    resolve(err ? { ok: false, error: (stderr || err.message).trim() } : { ok: true }));
                return;
            }
            execFile("nmcli", ["-t", "-f", "proxy.method,proxy.http,proxy.https", "connection", "show", name],
                { timeout: 8000 }, (err, stdout) => {
                    if (err) return resolve({ ok: true, connected: true });
                    const parts = (stdout || "").split("\n").filter(Boolean).map(l => l.split(":")[1]).join(",");
                    const pm = (stdout.match(/^proxy\.method:([^\n]*)$/m) || [])[1] || "auto";
                    const ph = (stdout.match(/^proxy\.http:([^\n]*)$/m) || [])[1] || "";
                    const ps = (stdout.match(/^proxy\.https:([^\n]*)$/m) || [])[1] || "";
                    resolve({ ok: true, connected: true, method: pm.trim(), http: ph.trim(), https: ps.trim() });
                });
        });
    }));
    // Let the renderer open the WiFi panel (floating button / hotkey).
    ipc.on("open-wifi-panel", () => { if (win && !win.isDestroyed()) win.webContents.send("open-wifi-panel"); });

    // ---- Bluetooth (bluez via bluetoothctl). Preview on macOS returns mock data
    // ---- so the settings UI can be exercised without a Bluetooth adapter.
    // Device cache used by the macOS mock path so a "scan" grows the list.
    let mockBtDevices = [
        { address: "A4:83:E7:12:34:56", name: "Xiaomi Buds 4", paired: true, connected: false },
        { address: "E4:8D:8C:AB:CD:EF", name: "Logitech MX Keys", paired: true, connected: true },
    ];
    let mockBtScanned = false;
    const btMock = payload => ({ ok: true, ...payload });
    const bt = (args, timeout, cb) => {
        execFile("bluetoothctl", args, { timeout }, (err, stdout, stderr) =>
            cb(err ? { ok: false, error: (stderr || err.message).trim() } : { ok: true, out: stdout || "" }));
    };
    const parseBtDevices = out => {
        const lines = (out || "").split("\n").filter(Boolean);
        return lines.map(l => {
            const parts = l.split(/\s+/);
            // "Device AA:BB:CC:DD:EE:FF Name here"
            return { address: (parts[1] || "").toUpperCase(), name: parts.slice(2).join(" ") || parts[1] || "" };
        }).filter(d => d.address);
    };
    ipc.handle("bluetooth:status", () => new Promise(resolve => {
        if (process.platform !== "linux") return resolve(btMock({ powered: true, discoverable: false, name: "Mock Controller", address: "00:11:22:33:44:55" }));
        bt(["show"], 8000, r => {
            if (!r.ok) return resolve(r);
            const nameM = /^\s*Name:\s*(.+)$/m.exec(r.out);
            resolve({ ok: true, name: nameM ? nameM[1].trim() : "Controller",
                      powered: /^\s*Powered:\s*yes$/m.test(r.out), discoverable: /^\s*Discoverable:\s*yes$/m.test(r.out) });
        });
    }));
    ipc.handle("bluetooth:set-power", (e, on) => new Promise(resolve => {
        if (process.platform !== "linux") return resolve(btMock({ powered: !!on }));
        bt(["power", on ? "on" : "off"], 8000, r => resolve(r.ok ? { ok: true, powered: on } : r));
    }));
    // Devices cache: all / connected / paired device rows merged (Linux).
    ipc.handle("bluetooth:devices", () => new Promise(resolve => {
        if (process.platform !== "linux") {
            // Mock: after a scan, drop in two freshly discovered (unpaired) devices.
            if (mockBtScanned && !mockBtDevices.some(d => d.address === "F8:1A:67:00:11:22")) {
                mockBtScanned = false; // inject once per scan
                mockBtDevices = mockBtDevices.concat([
                    { address: "F8:1A:67:00:11:22", name: "Sony WH-1000XM5", paired: false, connected: false },
                    { address: "18:9E:FC:88:77:66", name: "Razer Mouse", paired: false, connected: false },
                ]);
            }
            return resolve({ ok: true, devices: mockBtDevices });
        }
        execFile("bluetoothctl", ["devices"], { timeout: 8000 }, (err, allOut) => {
            if (err) return resolve({ ok: false, error: (err.stderr || err.message).trim() });
            execFile("bluetoothctl", ["devices", "Connected"], { timeout: 8000 }, (err2, connOut) => {
                execFile("bluetoothctl", ["devices", "Paired"], { timeout: 8000 }, (err3, pairOut) => {
                    const all = parseBtDevices(allOut);
                    const connected = new Set(parseBtDevices(connOut).map(d => d.address));
                    const paired = new Set(parseBtDevices(pairOut).map(d => d.address));
                    resolve({ ok: true, devices: all.map(d => ({ ...d, connected: connected.has(d.address), paired: paired.has(d.address) })) });
                });
            });
        });
    }));
    // Scan for new devices. bluetoothctl scan stays active; run it under a timeout
    // so a single call discovers for N seconds then returns (UI polls devices).
    ipc.handle("bluetooth:scan", (e, sec) => new Promise(resolve => {
        const s = Math.max(2, Math.min(15, parseInt(sec) || 8));
        if (process.platform !== "linux") { mockBtScanned = true; return resolve(btMock({ scanning: true })); }
        execFile("timeout", [String(s), "bluetoothctl", "scan", "on"], { timeout: (s + 5) * 1000 }, () => {});
        resolve({ ok: true, scanning: true });
    }));
    ipc.handle("bluetooth:pair", (e, { address }) => new Promise(resolve => {
        if (process.platform !== "linux") return resolve(btMock({}));
        bt(["pair", String(address)], 30000, r => resolve(r.ok ? { ok: true } : r));
    }));
    ipc.handle("bluetooth:trust", (e, { address }) => new Promise(resolve => {
        if (process.platform !== "linux") return resolve(btMock({}));
        bt(["trust", String(address)], 10000, r => resolve(r.ok ? { ok: true } : r));
    }));
    ipc.handle("bluetooth:connect", (e, { address }) => new Promise(resolve => {
        if (process.platform !== "linux") return resolve(btMock({}));
        bt(["connect", String(address)], 30000, r => resolve(r.ok ? { ok: true } : r));
    }));
    ipc.handle("bluetooth:disconnect", (e, { address }) => new Promise(resolve => {
        if (process.platform !== "linux") return resolve(btMock({}));
        bt(["disconnect", String(address)], 15000, r => resolve(r.ok ? { ok: true } : r));
    }));
    ipc.handle("bluetooth:forget", (e, { address }) => new Promise(resolve => {
        if (process.platform !== "linux") return resolve(btMock({}));
        bt(["remove", String(address)], 15000, r => resolve(r.ok ? { ok: true } : r));
    }));

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

    // Tell the renderer whether eDEX is running from an AppImage (eDEX-OS
    // install). The GitHub self-update is only meaningful in that mode — when
    // running from src/ during development there is no file to replace.
    ipc.handle("app:env", () => ({ isAppImage: !!process.env.APPIMAGE }));

    // Laptop battery for the clock's battery readout. Desktops (no battery)
    // report present:false and the renderer hides the indicator.
    //
    // Read the battery out of a kernel power_supply tree. Extracted so it can be
    // unit-tested against a fake tree (a Mac cannot exercise the Linux path).
    // Devices are matched on the `type` file (must read "Battery") rather than on
    // a name pattern like /^BAT[0-9]+$/: only the type file is guaranteed across
    // hardware (BAT0, BAT1, CMB0, BATC, ...), and this also ignores AC/Mains
    // pseudo-devices. Returns null when no battery is readable.
    function readSysfsBattery(baseDir) {
        try {
            const fs = require("fs");
            for (const name of fs.readdirSync(baseDir)) {
                const dir = baseDir + "/" + name;
                let type;
                try {
                    type = fs.readFileSync(dir + "/type", "utf8").trim();
                } catch (err) { continue; }
                if (type !== "Battery") continue;
                let capacity;
                try {
                    capacity = parseInt(fs.readFileSync(dir + "/capacity", "utf8"), 10);
                } catch (err) {
                    // Some batteries only expose energy_now/energy_full.
                    try {
                        const now = parseInt(fs.readFileSync(dir + "/energy_now", "utf8"), 10);
                        const full = parseInt(fs.readFileSync(dir + "/energy_full", "utf8"), 10);
                        if (full > 0) capacity = Math.round(100 * now / full);
                    } catch (err2) {}
                }
                if (isNaN(capacity)) continue;
                let status = "";
                try { status = fs.readFileSync(dir + "/status", "utf8").trim(); } catch (err) {}
                return {
                    present: true,
                    level: Math.max(0, Math.min(100, capacity)) / 100,
                    charging: status === "Charging" || status === "Full"
                };
            }
        } catch (err) {
            // No readable power_supply tree — genuinely not a laptop.
        }
        return null;
    }

    ipc.handle("battery:level", () => {
        // Primary: Electron's powerMonitor (on Linux it reads the UPower D-Bus
        // daemon, package "upower"). The server-minimal base can lack that
        // daemon, and powerMonitor may then report -1 or even throw — neither
        // may prevent the sysfs fallback, so each probe is guarded separately.
        let level = null;
        try {
            const pm = require("electron").powerMonitor;
            if (typeof pm.getSystemBatteryLevel === "function") {
                const v = pm.getSystemBatteryLevel();
                if (typeof v === "number" && v >= 0) level = v;
            }
        } catch (err) {
            // UPower D-Bus unavailable — fall through to sysfs below.
        }
        if (level !== null) {
            let charging = false;
            try {
                if (typeof pm.getBatteryState === "function") {
                    const st = pm.getBatteryState();
                    charging = st === "charging" || st === "full";
                }
            } catch (err) {}
            return { present: true, level, charging };
        }
        if (process.platform === "linux") {
            const sys = readSysfsBattery("/sys/class/power_supply");
            if (sys) return sys;
        }
        return { present: false, level: -1, charging: false };
    });

    // Pointer speed (settings.cursorSpeed, 0.25x-4x). Applied at the OS level
    // on the eDEX-OS device via xinput (X11) — the same trick the governors
    // use — so a faster/slower mouse actually sticks across apps. On macOS the
    // preview just stores the value (the OS owns pointer acceleration there).
    ipc.handle("mouse:speed", async (e, mult) => {
        const m = Number(mult);
        if (!isFinite(m) || m <= 0) return { applied: false };
        if (process.platform !== "linux") return { applied: false };
        try {
            const { execSync } = require("child_process");
            const devices = execSync("xinput list --id-only 2>/dev/null").toString().trim().split("\n");
            let applied = 0;
            for (const id of devices) {
                if (!id) continue;
                try {
                    // libinput: AccelSpeed in [-1,1]; xinput legacy: "libinput Accel Speed".
                    // Map 0.25x-4x onto [-1,1]: 1x → 0, 4x → 1, 0.25x → -1.
                    const accel = Math.max(-1, Math.min(1, Math.log2(m)));
                    execSync(`xinput set-prop ${id} "libinput Accel Speed" ${accel.toFixed(3)} 2>/dev/null`);
                    applied++;
                } catch (err) {}
            }
            return { applied, count: devices.length };
        } catch (err) {
            return { applied: false };
        }
    });

    // Laptop lid close (suspend) and wake: on resume the renderer must tear down
    // any stale full-screen overlay (a screensaver canvas or lock block left in
    // place after suspend swallows every click — the lid-open "can't click"
    // bug) and re-lock when a passcode is configured.
    try {
        const pm = require("electron").powerMonitor;
        pm.on("suspend", () => {
            // Lid closing / system suspending: paint the lock BEFORE the screen
            // freezes, so the frame buffer that survives the sleep is the lock,
            // not the live desktop — otherwise the lid-open frame shows a flash
            // of the real UI before the renderer catches up and re-locks.
            if (win && !win.isDestroyed()) win.webContents.send("pm:suspend");
        });
        pm.on("resume", () => {
            if (win && !win.isDestroyed()) {
                win.webContents.send("pm:resume");
                // After lid-open the window can come back without keyboard focus,
                // which reads as a dead keyboard while the touchpad still moves.
                // Re-assert focus + visibility so key events reach the lock.
                win.show();
                win.focus();
                if (win.webContents) win.webContents.focus();
            }
        });
    } catch (e) {}

    // Embedded performance controller: read/write the CPU scaling governor so
    // the user can trade a little throughput for a quiet fan on laptops
    // (powersave/schedutil vs performance). Applied to every online CPU.
    ipc.handle("power:governor", async (e, payload) => {
        const base = "/sys/devices/system/cpu/cpu0/cpufreq";
        const want = payload && payload.governor ? String(payload.governor) : "";
        if (want) applyGovernor(want);
        const available = readSys(path.join(base, "scaling_available_governors"));
        const current = readSys(path.join(base, "scaling_governor"));
        const freq = readSys(path.join(base, "scaling_cur_freq"));
        return {
            ok: true,
            available: available ? available.split(/\s+/) : [],
            current: current || "",
            freqMHz: freq ? Math.round(Number(freq) / 1000) : null
        };
    });

    // Brightness control (settings slider) — same helper script the Fn keys use,
    // so both paths behave identically.
    const backlightFile = () => {
        try {
            for (const d of fs.readdirSync("/sys/class/backlight")) {
                const b = "/sys/class/backlight/" + d + "/brightness";
                if (fs.existsSync(b)) return b;
            }
        } catch (e) {}
        return null;
    };
    ipc.handle("power:brightness", async (e, payload) => {
        const { exec } = require("child_process");
        const run = cmd => new Promise(res => exec(cmd, err => res(!err)));
        const want = payload && payload.set != null ? Math.min(100, Math.max(0, Number(payload.set))) : null;
        if (want != null) await run("/usr/local/sbin/edex-brightness.sh set " + want);
        const b = backlightFile();
        let max = 100, cur = 0;
        if (b) {
            try { max = Number(fs.readFileSync(b.replace(/\/brightness$/, "/max_brightness"), "utf8").trim()) || max; } catch (e) {}
            try { cur = Number(fs.readFileSync(b, "utf8").trim()) || 0; } catch (e) {}
        }
        return { ok: true, percent: max ? Math.round(cur / max * 100) : 0 };
    });

    // System volume control (settings slider) — pactl with an amixer fallback.
    ipc.handle("power:volume", async (e, payload) => {
        const { exec } = require("child_process");
        const run = cmd => new Promise(res => exec(cmd, err => res(!err)));
        const want = payload && payload.set != null ? Math.min(100, Math.max(0, Number(payload.set))) : null;
        if (want != null) await run("/usr/local/sbin/edex-volume.sh set " + want);
        const get = () => new Promise(res => {
            exec("pactl get-sink-volume @DEFAULT_SINK@ 2>/dev/null", (e, so) => {
                if (!e) {
                    const m = /(\d{1,3})%/.exec(so || "");
                    if (m) return res(Number(m[1]));
                }
                exec("amixer sget Master 2>/dev/null", (e2, so2) => {
                    const m2 = /\[(\d{1,3})%\]/.exec(so2 || "");
                    res(m2 ? Number(m2[1]) : 0);
                });
            });
        });
        return { ok: true, percent: await get() };
    });

    // Keyboard backlight (settings dropdown). ThinkPads expose tpacpi::kbd_backlight
    // as an LED with brightness 0..max (usually 2); the session script turns it on
    // at boot, this lets the user change it live. The autologin user is in the
    // `video` group, so the direct sysfs write works (same as the screen backlight);
    // fall back to passwordless sudo only if a device is group-restricted.
    const kbdBacklightFile = () => {
        try {
            for (const d of fs.readdirSync("/sys/class/leds")) {
                if (String(d).toLowerCase().indexOf("kbd") >= 0) {
                    const b = "/sys/class/leds/" + d + "/brightness";
                    if (fs.existsSync(b)) return b;
                }
            }
        } catch (e) {}
        return null;
    };
    ipc.handle("kbd:backlight", async (e, payload) => {
        const { exec } = require("child_process");
        const run = cmd => new Promise(res => exec(cmd, err => res(!err)));
        const f = kbdBacklightFile();
        if (!f) return { ok: false, level: null }; // no keyboard LED (desktop/preview)
        const want = payload && payload.set != null ? Math.max(0, Math.min(3, Number(payload.set))) : null;
        if (want != null) {
            let ok = await run(`sh -c 'echo ${want} > "${f}"' 2>/dev/null`);
            if (!ok) await run(`sudo sh -c 'echo ${want} > "${f}"' 2>/dev/null`);
        }
        let max = 2, cur = 0;
        try { max = Number(fs.readFileSync(f.replace(/\/brightness$/, "/max_brightness"), "utf8").trim()) || max; } catch (e) {}
        try { cur = Number(fs.readFileSync(f, "utf8").trim()) || 0; } catch (e) {}
        return { ok: true, level: Math.min(max, cur) };
    });

    // Touchpad tap-to-click toggle (settings dropdown). libinput exposes tapping
    // as the "libinput Tapping Enabled" property on every pointer device — same
    // xinput approach as the pointer-speed slider, applied device-wide.
    ipc.handle("touchpad:tap", async (e, payload) => {
        if (process.platform !== "linux") return { ok: false, level: null };
        const { execSync } = require("child_process");
        const set = payload && payload.set != null ? (payload.set ? "1" : "0") : null;
        try {
            const ids = execSync("xinput list --id-only 2>/dev/null").toString().trim().split("\n");
            for (const id of ids) {
                if (!id) continue;
                try {
                    execSync(`xinput set-prop ${id} "libinput Tapping Enabled" ${set || "1"} 2>/dev/null`);
                } catch (err) {}
            }
        } catch (err) {}
        // Read the current tapping state back from the first device that exposes it.
        let level = null;
        try {
            const first = execSync("xinput list --id-only 2>/dev/null").toString().trim().split("\n")[0];
            const out = execSync(`xinput list-props ${first} 2>/dev/null`).toString();
            const m = /libinput Tapping Enabled \(\d+\):[\s]*(\d)/.exec(out);
            if (m) level = Number(m[1]);
        } catch (err) {}
        return { ok: true, level };
    });

    // System clock readout + manual time / NTP (settings → Time & Date, #14).
    // `timedatectl` does the whole job on eDEX-OS; the autologin user has
    // passwordless sudo, so the set operations fall back to it. On non-Linux
    // (the macOS preview) the read side still works via plain JS so the UI
    // renders, but set operations report failure.
    const parseTimedatectl = out => {
        const m = {};
        for (const line of String(out || "").split("\n")) {
            const mm = /^\s*([^:]+):\s*(.*)$/.exec(line);
            if (mm) m[mm[1].trim()] = mm[2].trim();
        }
        return m;
    };
    const runSudo = cmd => new Promise(res => {
        const { exec } = require("child_process");
        exec(cmd + " 2>/dev/null", err => {
            if (!err) return res(true);
            exec("sudo -n " + cmd + " 2>/dev/null", err2 => res(!err2));
        });
    });
    ipc.handle("time:get", async () => {
        if (process.platform !== "linux") {
            const d = new Date();
            const p = n => String(n).padStart(2, "0");
            return {
                ok: true,
                local: d.toString(),
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
                date: d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()),
                clock: p(d.getHours()) + ":" + p(d.getMinutes()),
                ntp: null
            };
        }
        try {
            const { execSync } = require("child_process");
            const out = execSync("timedatectl 2>/dev/null", { timeout: 3000 }).toString();
            const info = parseTimedatectl(out);
            const ntpM = /^\s*NTP service:\s+(\S+)/m.exec(out);
            const ntpVal = ntpM ? ntpM[1].toLowerCase() : "";
            const dt = /(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}):\d{2}/.exec(info["Local time"] || "");
            return {
                ok: true,
                local: info["Local time"] || "",
                timezone: info["Time zone"] || "",
                date: dt ? dt[1] : "",
                clock: dt ? dt[2] : "",
                ntp: ntpVal === "active" || ntpVal === "yes" || ntpVal === "enabled"
            };
        } catch (e) {
            return { ok: false };
        }
    });
    ipc.handle("time:set", async (e, payload) => {
        if (process.platform !== "linux") return { ok: false };
        if (payload && payload.ntp != null) {
            return { ok: await runSudo("timedatectl set-ntp " + (payload.ntp ? "true" : "false")) };
        }
        if (payload && payload.date && payload.time) {
            // timedatectl refuses set-time while NTP is active; stop syncing,
            // set the clock, and leave NTP off so the manual time sticks.
            if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.date) || !/^\d{2}:\d{2}(:\d{2})?$/.test(payload.time)) {
                return { ok: false };
            }
            await runSudo("timedatectl set-ntp false");
            return { ok: await runSudo('timedatectl set-time "' + payload.date + " " + payload.time + '"') };
        }
        return { ok: false };
    });

    // eDEX-UI self-update (GitHub release asset). Only works on the eDEX-OS
    // install: when running from an AppImage, download the new .AppImage, verify
    // its sha256 (a sibling release asset), atomically replace the running
    // AppImage via sudo (the autologin user has passwordless sudo), then the
    // renderer relaunches. Everywhere else it refuses cleanly.
    ipc.handle("system:edex-update", (e, payload) => new Promise(resolve => {
        const { url, sha256Url } = payload || {};
        const APPIMAGE = process.env.APPIMAGE;
        const send = line => { if (win && !win.isDestroyed()) win.webContents.send("edex-update-output", line); };
        if (!APPIMAGE) return resolve({ ok: false, error: "NOT_APPIMAGE" });
        if (!url) return resolve({ ok: false, error: "NO_URL" });
        const { spawn } = require("child_process");
        const crypto = require("crypto");
        const tmp = path.join(electron.app.getPath("temp"), `edex-update-${Date.now()}.AppImage`);
        const cleanup = () => { try { fs.unlinkSync(tmp); } catch (_) {} };
        const fail = error => { cleanup(); resolve({ ok: false, error }); };

        send("Downloading " + APPIMAGE + " → update…");

        // 1) Expected sha256: a `.AppImage.sha256` sibling uploaded by the
        //    release workflow. curl follows GitHub's asset redirects.
        const fetchSha = () => new Promise(res2 => {
            if (!sha256Url) return res2("");
            const curl = spawn("curl", ["-fsSL", "--connect-timeout", "15", sha256Url]);
            let out = "";
            curl.stdout.on("data", d => { out += String(d); });
            curl.on("close", () => {
                const m = /([0-9a-fA-F]{64})/.exec(out);
                res2(m ? m[1] : "");
            });
        });

        // 2) Download the AppImage asset.
        fetchSha().then(sha => {
            const dl = spawn("curl", ["-fL", "--connect-timeout", "15", "--retry", "2", "-o", tmp, url]);
            dl.on("error", e => fail(e.message));
            dl.on("close", code => {
                if (code !== 0) return fail("download failed (curl exit " + code + ")");
                const done = () => {
                    // 4) Same-filesystem copy into place, then an atomic rename.
                    //    /opt/edex is root-owned on the eDEX-OS install, so a
                    //    plain install fails with EACCES and we escalate to sudo
                    //    (the autologin user has passwordless sudo).
                    send("Checksum OK — replacing AppImage…");
                    const newPath = APPIMAGE + ".new";
                    const trySwap = sudo => {
                        const cmd = sudo
                            ? `install -m 755 -o root -g root '${tmp}' '${newPath}' && mv -f '${newPath}' '${APPIMAGE}'`
                            : `install -m 755 '${tmp}' '${newPath}' && mv -f '${newPath}' '${APPIMAGE}'`;
                        // `-n`: never prompt for a password — if the passwordless
                        // sudo from install-edex.sh isn't in place, fail fast
                        // instead of hanging on a password prompt.
                        const p = spawn(sudo ? "sudo" : "bash", sudo ? ["-n", "bash", "-c", cmd] : ["-c", cmd]);
                        p.stderr.on("data", d => send(String(d).trim()));
                        p.on("close", code => {
                            if (code !== 0) {
                                if (!sudo) return trySwap(true);
                                cleanup();
                                return resolve({ ok: false, error: "replace failed (sudo exit " + code + ")" });
                            }
                            cleanup();
                            resolve({ ok: true });
                        });
                    };
                    trySwap(false);
                };
                // 3) Verify sha256 when the release provided one.
                if (sha) {
                    const hash = crypto.createHash("sha256");
                    const rs = fs.createReadStream(tmp);
                    rs.on("error", e => fail(e.message));
                    rs.on("data", d => { hash.update(d); });
                    rs.on("end", () => {
                        const actual = hash.digest("hex");
                        if (actual.toLowerCase() !== String(sha).toLowerCase()) {
                            return fail("SHA256_MISMATCH");
                        }
                        done();
                    });
                } else {
                    send("No checksum asset on this release — skipping verification.");
                    done();
                }
            });
        });
    }));

    startAppMonitor(settings, cleanEnv);

    // Re-apply the saved CPU performance mode (governor) on every boot.
    if (settings.performanceMode) {
        try { applyGovernor(String(settings.performanceMode)); } catch (e) {}
    }

    createWindow(settings);

    // Power button → POWER menu. On the eDEX-OS device logind ignores the ACPI
    // power key (HandlePowerKey=ignore), so openbox receives it as an
    // XF86PowerOff keypress and runs /usr/local/sbin/edex-power-menu.sh, which
    // hits this loopback endpoint; the renderer then opens the same power modal
    // the clock opens. Loopback-only, fixed port, no auth needed — it can only
    // be reached by processes on this machine.
    try {
        const powerServer = http.createServer((req, res) => {
            res.setHeader("Content-Type", "text/plain");
            res.end("ok");
            if (win && !win.isDestroyed()) {
                try { win.webContents.send("show-power-menu"); } catch (e) {}
            }
        });
        powerServer.listen(17322, "127.0.0.1");
    } catch (e) {
        signale.warn("Could not start power-menu listener: " + (e && e.message));
    }

    // Exit native fullscreen: global hotkey (backup) + the corner button's IPC.
    try {
        electron.globalShortcut.register("CommandOrControl+Shift+Q", () => {
            if (global.__edexLocked) return;
            exitFullscreenViaMain();
        });
    } catch (e) { signale.warn("Could not register exit-fullscreen hotkey: " + (e && e.message)); }
    ipc.on("edex-exit-fullscreen", exitFullscreenViaMain);
    // The renderer pushes its lock / first-run state so these OS-level hotkeys
    // (which fire outside DOM keydown — a lock screen cannot intercept them)
    // stay inert while the screen is locked or the first-boot setup is up.
    ipc.on("edex-lock-state", (e, locked) => { global.__edexLocked = !!locked; });

    // Open the WiFi connect panel.
    try {
        electron.globalShortcut.register("CommandOrControl+Shift+W", () => {
            if (global.__edexLocked) return;
            if (win && !win.isDestroyed()) win.webContents.send("open-wifi-panel");
        });
    } catch (e) { signale.warn("Could not register wifi-panel hotkey: " + (e && e.message)); }

    // Lock the screen (Ctrl+Shift+O).
    try {
        electron.globalShortcut.register("CommandOrControl+Shift+O", () => {
            if (global.__edexLocked) return;
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

    // Download directory: configurable via the settings "Downloads" category
    // (#45). Persisted in settings.json as `downloadDir`; falls back to the OS
    // Downloads folder. Lazily cached so it stays cheap per download.
    let _dlDir = null;
    const getDlDir = () => {
        if (_dlDir) return _dlDir;
        try {
            const s = JSON.parse(fs.readFileSync(settingsFile, "utf8"));
            _dlDir = (s && s.downloadDir) || electron.app.getPath("downloads");
        } catch (err) { _dlDir = electron.app.getPath("downloads"); }
        return _dlDir;
    };

    // Download manager: intercept downloads from the embedded browser AND the
    // virtual-monitor webviews (tabs 4/5), save them to the configured download
    // directory (settings → Downloads) and tell the renderer to show a toast
    // when each finishes.
    const wireDownloads = partition => {
        electron.session.fromPartition(partition).on("will-download", (event, item, webContents) => {
            const file = path.join(getDlDir(), item.getFilename());
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

    // Settings → Downloads category: read / update the download directory.
    ipc.handle("dl:getDir", () => Promise.resolve({ ok: true, dir: getDlDir() }));
    ipc.handle("dl:setDir", (e, { dir } = {}) => new Promise(resolve => {
        if (!dir || typeof dir !== "string" || !dir.trim()) return resolve({ ok: false, error: "bad dir" });
        dir = dir.trim();
        try {
            const s = JSON.parse(fs.readFileSync(settingsFile, "utf8")) || {};
            s.downloadDir = dir;
            fs.writeFileSync(settingsFile, JSON.stringify(s, "", 4));
            _dlDir = dir;
            try { fs.mkdirSync(dir, { recursive: true }); } catch (err) {}
            resolve({ ok: true, dir });
        } catch (err) { resolve({ ok: false, error: err.message }); }
    }));

    // ---- System sources (apt mirrors) (#130) ----
    // Built-in presets for Ubuntu 24.04 (noble). CN mirrors serve every suite
    // from one root; only the official source splits archive/security hosts.
    const SRC_MIRRORS = {
        official: { archive: "http://archive.ubuntu.com/ubuntu/", security: "http://security.ubuntu.com/ubuntu/" },
        aliyun:   { archive: "http://mirrors.aliyun.com/ubuntu/", security: "" },
        tuna:     { archive: "http://mirrors.tuna.tsinghua.edu.cn/ubuntu/", security: "" },
        ustc:     { archive: "http://mirrors.ustc.edu.cn/ubuntu/", security: "" },
        "163":    { archive: "http://mirrors.163.com/ubuntu/", security: "" },
    };
    // Ubuntu 24.04 installs use deb822 (/etc/apt/sources.list.d/ubuntu.sources);
    // legacy images may still carry the deb-format sources.list. Detect the
    // first readable one and remember its format so a switch rewrites in kind.
    const detectAptMirror = () => {
        const cands = ["/etc/apt/sources.list.d/ubuntu.sources", "/etc/apt/sources.list"];
        for (const p of cands) {
            let txt;
            try { txt = fs.readFileSync(p, "utf8"); } catch (e) { continue; }
            if (!txt || !txt.trim()) continue;
            const uris = [...new Set((txt.match(/https?:\/\/[^\s"]+/g) || []).map(u => u.replace(/\/+$/, "")))];
            for (const [id, m] of Object.entries(SRC_MIRRORS)) {
                const base = m.archive.replace(/\/+$/, "");
                if (uris.some(u => u === base || u.startsWith(base + "/"))) {
                    return { mirror: id, custom: "", format: p.includes("ubuntu.sources") ? "deb822" : "deb", path: p };
                }
            }
            return { mirror: "custom", custom: uris[0] || "", format: p.includes("ubuntu.sources") ? "deb822" : "deb", path: p };
        }
        return { mirror: "custom", custom: "", format: "deb822", path: "/etc/apt/sources.list.d/ubuntu.sources" };
    };
    const buildAptSources = (mirror, custom) => {
        const m = mirror === "custom" ? { archive: (custom || "").replace(/\/+$/, "") + "/", security: "" } : SRC_MIRRORS[mirror];
        const base = m.archive.replace(/\/+$/, "");
        const sec = (m.security || "").replace(/\/+$/, "") || base; // CN mirrors reuse the main host
        const comp = "main restricted universe multiverse";
        const deb822 =
            `Types: deb\nURIs: ${base}/\nSuites: noble noble-updates noble-backports\nComponents: ${comp}\nSigned-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n\n` +
            `Types: deb\nURIs: ${sec}/\nSuites: noble-security\nComponents: ${comp}\nSigned-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n`;
        const deb =
            `deb ${base}/ noble ${comp}\n` +
            `deb ${base}/ noble-updates ${comp}\n` +
            `deb ${base}/ noble-backports ${comp}\n` +
            `deb ${sec}/ noble-security ${comp}\n`;
        return { deb822, deb };
    };
    ipc.handle("apt:getMirror", () => {
        if (process.platform !== "linux") return Promise.resolve({ ok: false, error: "not-linux" });
        return Promise.resolve(Object.assign({ ok: true }, detectAptMirror()));
    });
    ipc.handle("apt:setMirror", (e, { mirror, custom } = {}) => new Promise(resolve => {
        if (process.platform !== "linux") return resolve({ ok: false, error: "not-linux" });
        if (mirror !== "custom" && !SRC_MIRRORS[mirror]) return resolve({ ok: false, error: "bad mirror" });
        if (mirror === "custom" && (!custom || !/^https?:\/\//i.test(custom))) return resolve({ ok: false, error: "bad url" });
        const cur = detectAptMirror();
        const { deb822, deb } = buildAptSources(mirror, (custom || "").trim());
        const content = cur.format === "deb822" ? deb822 : deb;
        const tmp = path.join(electron.app.getPath("temp"), "edex-sources-" + Date.now() + ".list");
        try { fs.writeFileSync(tmp, content); } catch (err) { return resolve({ ok: false, error: err.message }); }
        const { exec } = require("child_process");
        exec(`sudo -n cp "${cur.path}" "${cur.path}.bak" 2>/dev/null; sudo -n cp "${tmp}" "${cur.path}"`, (err, so, se) => {
            try { fs.unlinkSync(tmp); } catch (e) {}
            if (err) return resolve({ ok: false, error: (se && se.trim()) || err.message });
            // Refresh the package list in the background (best-effort: needs
            // network; a bad mirror surfaces later via apt / the update checker).
            const { spawn } = require("child_process");
            const upd = spawn("bash", ["-c", "sudo -n apt-get update -y"], { env: Object.assign({}, process.env, { DEBIAN_FRONTEND: "noninteractive" }) });
            upd.on("error", () => {});
            resolve({ ok: true, path: cur.path, format: cur.format });
        });
    }));

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
