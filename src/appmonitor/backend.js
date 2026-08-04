// Backend abstraction for the app monitors.
//
//   mock : drives the RFB demo framebuffers (see mock-rfb.js). Used on macOS /
//          any machine without a real X server — validates the entire
//          webview → noVNC → input chain with zero native apps.
//
//   real : drives a real nested X session per monitor:
//          Xvfb :N + optional openbox WM + x11vnc (native WebSocket), and
//          launches actual .desktop / AppImage apps inside DISPLAY=:N.

"use strict";
const { listNativeApps, addNativeApp, removeNativeApp, tokenizeExec } = require("./native-apps.js");
const { setDemo } = require("./mock-rfb.js");

const DEMO_APPS = [
    { id: "demo:terminal", name: "DEMO TERMINAL", demo: "terminal" },
    { id: "demo:matrix",   name: "DEMO MATRIX",   demo: "matrix" },
    { id: "demo:radar",    name: "DEMO RADAR",    demo: "radar" }
];

function createBackend(mode, deps) {
    if (mode === "real") return realBackend(deps);
    return mockBackend(deps);
}

/* ---- mock ---------------------------------------------------------------- */
function mockBackend(deps) {
    const scenes = deps.scenes;           // { a: scene, b: scene }
    const opts = deps.opts;               // { userData, appImageDirs }
    return {
        mode: "mock",
        listNativeApps() {
            const demo = DEMO_APPS.map(a => Object.assign({}, a, { kind: "demo" }));
            const custom = listNativeApps(opts).filter(a => a.custom);
            return Promise.resolve(demo.concat(custom));
        },
        launch(monitorId, appId) {
            const app = DEMO_APPS.find(a => a.id === appId);
            const scene = scenes[monitorId];
            if (!scene) return Promise.resolve({ ok: false, error: "bad monitor" });
            if (app) setDemo(scene, app.demo);
            else setDemo(scene, "terminal");     // a custom native app has no real binary here
            return Promise.resolve({ ok: true });
        },
        kill(monitorId) {
            const scene = scenes[monitorId];
            if (scene) setDemo(scene, "terminal");
            return Promise.resolve({ ok: true });
        },
        fullscreen() {
            // No real display in mock mode — native fullscreen is a Linux-only
            // feature. The UI shows a toast instead of erroring.
            return Promise.resolve({ ok: false, error: "mock mode has no real display" });
        },
        exitFullscreen() { return Promise.resolve({ ok: true }); },
        addNativeApp(entry) { return Promise.resolve(addNativeApp(opts, entry)); },
        removeNativeApp(id) {
            const name = String(id || "").replace(/^custom:/, "");
            removeNativeApp(opts, name);
            return Promise.resolve({ ok: true });
        },
        shutdown() {}
    };
}

/* ---- real (Linux only) ---------------------------------------------------- */
function realBackend(deps) {
    const { spawn } = require("child_process");
    const monitors = deps.monitors;       // [{id, display, rfbPort, wsPath}]
    const opts = deps.opts;               // { userData, appImageDirs }
    const running = {};                   // id -> {appPid, children:[]}
    let fullscreenPid = null;             // app running natively on DISPLAY=:0

    function startMonitor(m) {
        if (running[m.id]) return;
        const children = [];
        const xvfb = spawn("Xvfb", [m.display, "-screen", "0", "800x600x24", "-nolisten", "tcp", "-ac"],
            { stdio: "ignore" });
        const wm = spawn("openbox", ["--sm-disable"], { stdio: "ignore", env: Object.assign({}, process.env, { DISPLAY: m.display }) });
        const vnc = spawn("x11vnc",
            ["-display", m.display, "-rfbport", String(m.rfbPort), "-shared", "-forever", "-nopw",
             "-listen", "127.0.0.1"],
            { stdio: "ignore" });
        children.push(xvfb, wm, vnc);
        for (const c of children) c.on("error", e => console.error("[appmonitor] " + m.id + " spawn:", e.message));
        running[m.id] = { appPid: null, children };
        setTimeout(() => { if (running[m.id]) running[m.id].started = true; }, 800);
    }

    function killTree(monitorId) {
        const r = running[monitorId];
        if (!r) return;
        if (r.appPid) {
            try { process.kill(r.appPid, "SIGTERM"); } catch (e) {}
            setTimeout(() => { try { process.kill(r.appPid, "SIGKILL"); } catch (e) {} }, 2000);
            r.appPid = null;
        }
    }

    // Chromium-based apps (Chrome/Chromium/Brave/Edge/Opera/Electron/AppImage)
    // cannot use their SUID/userns sandbox inside a nested X display — they
    // need --no-sandbox to start there (and in native fullscreen via openbox).
    function isChromium(cmd) {
        return /(chrome|chromium|brave|vivaldi|edge|opera|electron|\.appimage)/i.test(cmd);
    }

    function buildCommand(app) {
        if (app.exec) {
            const t = tokenizeExec(app.exec);
            if (!t.length) return null;
            const args = t.slice(1);
            if (isChromium(t[0])) args.push("--no-sandbox");
            return { cmd: t[0], args };
        }
        if (app.path) return { cmd: app.path, args: ["--no-sandbox"] };
        return null;
    }

    function exitFullscreenApp() {
        if (fullscreenPid) {
            const pid = fullscreenPid;
            fullscreenPid = null;
            try { process.kill(pid, "SIGTERM"); } catch (e) {}
            setTimeout(() => { try { process.kill(pid, "SIGKILL"); } catch (e) {} }, 2000);
        }
    }

    return {
        mode: "real",
        listNativeApps() {
            return Promise.resolve(listNativeApps(opts));
        },
        launch(monitorId, appId) {
            const m = monitors.find(x => x.id === monitorId);
            if (!m) return Promise.resolve({ ok: false, error: "bad monitor" });
            startMonitor(m);
            const app = listNativeApps(opts).find(a => a.id === appId);
            if (!app) return Promise.resolve({ ok: false, error: "app not found" });
            const cmd = buildCommand(app);
            if (!cmd) return Promise.resolve({ ok: false, error: "cannot build command" });
            killTree(monitorId);
            const env = Object.assign({}, process.env, { DISPLAY: m.display });
            if (isChromium(cmd.cmd)) {
                env.ELECTRON_DISABLE_SANDBOX = "1";
            }
            // Give the display a moment to be ready before spawning the app.
            const doSpawn = () => {
                const child = spawn(cmd.cmd, cmd.args, { env, stdio: "ignore" });
                child.on("error", e => console.error("[appmonitor] app spawn:", e.message));
                if (running[m.id]) running[m.id].appPid = child.pid;
            };
            const r = running[m.id];
            if (r && r.started) doSpawn();
            else setTimeout(doSpawn, 1200);
            return Promise.resolve({ ok: true, app: app.name });
        },
        kill(monitorId) { killTree(monitorId); return Promise.resolve({ ok: true }); },
        // Native fullscreen: stop the nested-display preview and launch the app
        // directly on the real display (:0), where openbox (the WM on :0) can
        // raise/fullscreen it. This is the "the app runs completely natively"
        // mode. Best-effort fullscreen via wmctrl (needs the app to be active).
        fullscreen(monitorId, appId) {
            const m = monitors.find(x => x.id === monitorId);
            if (!m) return Promise.resolve({ ok: false, error: "bad monitor" });
            const app = listNativeApps(opts).find(a => a.id === appId);
            if (!app) return Promise.resolve({ ok: false, error: "app not found" });
            const cmd = buildCommand(app);
            if (!cmd) return Promise.resolve({ ok: false, error: "cannot build command" });
            killTree(monitorId);           // stop the streamed preview instance
            exitFullscreenApp();           // clear any previous fullscreen app
            const env = Object.assign({}, process.env, { DISPLAY: ":0" });
            if (isChromium(cmd.cmd)) env.ELECTRON_DISABLE_SANDBOX = "1";
            const child = spawn(cmd.cmd, cmd.args, { env, stdio: "ignore" });
            child.on("error", e => console.error("[appmonitor] fullscreen spawn:", e.message));
            fullscreenPid = child.pid;
            setTimeout(() => {
                try { spawn("wmctrl", ["-r", ":ACTIVE:", "-b", "add,fullscreen"], { env, stdio: "ignore" }); } catch (e) {}
            }, 1500);
            return Promise.resolve({ ok: true, app: app.name, native: true });
        },
        exitFullscreen() { exitFullscreenApp(); return Promise.resolve({ ok: true }); },
        addNativeApp(entry) { return Promise.resolve(addNativeApp(opts, entry)); },
        removeNativeApp(id) {
            const name = String(id || "").replace(/^custom:/, "");
            removeNativeApp(opts, name);
            return Promise.resolve({ ok: true });
        },
        shutdown() {
            exitFullscreen();
            for (const id of Object.keys(running)) {
                killTree(id);
                for (const c of running[id].children) { try { c.kill("SIGTERM"); } catch (e) {} }
            }
        }
    };
}

module.exports = { createBackend, DEMO_APPS };
