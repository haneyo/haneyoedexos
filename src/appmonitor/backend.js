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
    const running = {};                   // monitorId -> appId currently shown
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
            running[monitorId] = appId;
            if (app) setDemo(scene, app.demo);
            else setDemo(scene, "terminal");     // a custom native app has no real binary here
            return Promise.resolve({ ok: true });
        },
        kill(monitorId) {
            const scene = scenes[monitorId];
            if (scene) setDemo(scene, "terminal");
            delete running[monitorId];
            return Promise.resolve({ ok: true });
        },
        status() {
            const monitorState = {};
            for (const id of ["a", "b"]) {
                monitorState[id] = running[id] ? { id: running[id], state: "running" } : null;
            }
            return Promise.resolve({ ok: true, monitors: monitorState });
        },
        // Close a specific app wherever it is running (no uninstall).
        closeApp(appId) {
            for (const id of Object.keys(running)) {
                if (running[id] === appId) {
                    const scene = scenes[id];
                    if (scene) setDemo(scene, "terminal");
                    delete running[id];
                }
            }
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
    const { spawn, spawnSync } = require("child_process");
    const fs = require("fs");
    const os = require("os");
    const path = require("path");
    const monitors = deps.monitors;       // [{id, display, rfbPort, wsPath}]
    const opts = deps.opts;               // { userData, appImageDirs }
    const running = {};                   // id -> {appPid, appId, children:[]}
    let fullscreenPid = null;             // app running natively on DISPLAY=:0

    // Virtual-monitor geometry: the shell slot is ~2:1 (measured in the running
    // UI — 832×416 at a 1280×720 window; the aspect holds at any resolution since
    // the shell is vw/vh-sized). Match the framebuffer to that aspect so noVNC's
    // scaleViewport fills the tab edge-to-edge with no letterbox, and auto-maximise
    // every window (undecorated) so the app itself fills the desktop — no black
    // desktop, just the app at terminal size. See docs/ubuntu-side-changes.md.
    const SCREEN = "1600x800x24";          // 2:1, matches the monitor-slot aspect
    const MONITOR_RC = path.join(os.tmpdir(), "edex-monitor-openbox.xml");
    function ensureMonitorConfig() {
        if (fs.existsSync(MONITOR_RC)) return;
        const rc = [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<openbox_config xmlns="http://openbox.org/3.4/rc" xmlns:xi="http://www.w3.org/2001/XInclude">',
            '  <resistance><strength>10</strength></resistance>',
            '  <focus><focusNew>yes</focusNew></focus>',
            '  <placement><policy>Smart</policy></placement>',
            '  <applications>',
            '    <application class="*">',
            '      <maximized>yes</maximized>',
            '      <decor>no</decor>',
            '    </application>',
            '  </applications>',
            '</openbox_config>',
            ''
        ].join("\n");
        try { fs.writeFileSync(MONITOR_RC, rc); } catch (e) { console.error("[appmonitor] write rc:", e.message); }
    }

    function startMonitor(m) {
        if (running[m.id]) return;
        const children = [];
        ensureMonitorConfig();
        const xvfb = spawn("Xvfb", [m.display, "-screen", "0", SCREEN, "-nolisten", "tcp", "-ac"],
            { stdio: "ignore" });
        const wm = spawn("openbox", ["--config", MONITOR_RC, "--sm-disable"],
            { stdio: "ignore", env: Object.assign({}, process.env, { DISPLAY: m.display }) });
        const vnc = spawn("x11vnc",
            ["-display", m.display, "-rfbport", String(m.rfbPort), "-shared", "-forever", "-nopw",
             "-listen", "127.0.0.1"],
            { stdio: "ignore" });
        children.push(xvfb, wm, vnc);
        // Fcitx5 + Rime (小狼毫) inside the virtual display so apps shown there
        // can type Chinese too. Best-effort — only when fcitx5 is installed.
        const fcitx = spawn("fcitx5", ["-d", "--replace"], {
            stdio: "ignore",
            env: Object.assign({}, process.env, {
                DISPLAY: m.display,
                GTK_IM_MODULE: "fcitx", QT_IM_MODULE: "fcitx", XMODIFIERS: "@im=fcitx"
            })
        });
        children.push(fcitx);
        for (const c of children) c.on("error", e => console.error("[appmonitor] " + m.id + " spawn:", e.message));
        running[m.id] = { appPid: null, appId: null, children, exited: false };
        setTimeout(() => { if (running[m.id]) running[m.id].started = true; }, 800);
    }

    function killTree(monitorId) {
        const r = running[monitorId];
        if (!r) return;
        r.exited = false;               // an intentional close clears any crash state
        if (r.appPid) {
            try { process.kill(r.appPid, "SIGTERM"); } catch (e) {}
            setTimeout(() => { try { process.kill(r.appPid, "SIGKILL"); } catch (e) {} }, 2000);
            r.appPid = null;
        }
        r.appId = null;
    }

    // Chromium-based apps (Chrome/Chromium/Brave/Edge/Opera/Electron/AppImage)
    // cannot use their SUID/userns sandbox inside a nested X display — they
    // need --no-sandbox to start there (and in native fullscreen via openbox).
    function isChromium(cmd) {
        return /(chrome|chromium|brave|vivaldi|edge|opera|electron|\.appimage)/i.test(cmd);
    }

    // Firefox (the system distro build) also refuses to run its content sandbox
    // inside a nested X display; it takes an env var, not --no-sandbox.
    function isFirefox(cmd) {
        return /(firefox|iceweasel|librewolf|waterfox)/i.test(cmd);
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
            if (running[m.id]) running[m.id].appId = appId;
            const env = Object.assign({}, process.env, {
                DISPLAY: m.display,
                // Fcitx5 input-method hooks so the app can type Chinese
                GTK_IM_MODULE: "fcitx",
                QT_IM_MODULE: "fcitx",
                XMODIFIERS: "@im=fcitx"
            });
            if (isChromium(cmd.cmd)) {
                env.ELECTRON_DISABLE_SANDBOX = "1";
            }
            if (isFirefox(cmd.cmd)) {
                env.MOZ_DISABLE_CONTENT_SANDBOX = "1";
                env.MOZ_DISABLE_GMP_SANDBOX = "1";
            }
            // Give the display a moment to be ready before spawning the app.
            const doSpawn = () => {
                const child = spawn(cmd.cmd, cmd.args, { env, stdio: "ignore" });
                child.on("error", e => console.error("[appmonitor] app spawn:", e.message));
                // Mark the app as exited/crashed if its process dies on its own
                // (an intentional kill goes through killTree, which clears appPid
                // first, so that exit is not mistaken for a crash).
                child.on("exit", () => {
                    if (running[m.id] && running[m.id].appPid === child.pid) {
                        running[m.id].exited = true;
                        running[m.id].appPid = null;
                    }
                });
                if (running[m.id]) running[m.id].appPid = child.pid;
            };
            const r = running[m.id];
            if (r && r.started) doSpawn();
            else setTimeout(doSpawn, 1200);
            return Promise.resolve({ ok: true, app: app.name });
        },
        kill(monitorId) { killTree(monitorId); return Promise.resolve({ ok: true }); },
        status() {
            const monitorState = {};
            for (const m of monitors) {
                const r = running[m.id];
                if (r && r.appId) {
                    monitorState[m.id] = {
                        id: r.appId,
                        // exited = the process died on its own (crash / closed by
                        // the app); running = a live process; starting = launched
                        // but the process has not spawned yet.
                        state: r.exited ? "exited" : (r.appPid ? "running" : "starting")
                    };
                } else {
                    monitorState[m.id] = null;
                }
            }
            return Promise.resolve({ ok: true, monitors: monitorState });
        },
        // Close a specific app wherever it is running (no uninstall).
        closeApp(appId) {
            for (const m of monitors) {
                if (running[m.id] && running[m.id].appId === appId) killTree(m.id);
            }
            return Promise.resolve({ ok: true });
        },
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
            const env = Object.assign({}, process.env, { DISPLAY: ":0", XCURSOR_THEME: "edex" });
            if (isChromium(cmd.cmd)) env.ELECTRON_DISABLE_SANDBOX = "1";
            if (isFirefox(cmd.cmd)) {
                env.MOZ_DISABLE_CONTENT_SANDBOX = "1";
                env.MOZ_DISABLE_GMP_SANDBOX = "1";
            }
            const child = spawn(cmd.cmd, cmd.args, { env, stdio: "ignore" });
            child.on("error", e => console.error("[appmonitor] fullscreen spawn:", e.message));
            fullscreenPid = child.pid;
            // Fullscreen the app's OWN window. wmctrl -r :ACTIVE: is useless here —
            // eDEX keeps keyboard focus, so :ACTIVE: is eDEX, and the launched app
            // stays behind it. Find the app's window by _NET_WM_PID (wmctrl -l -p)
            // and target it by id (wmctrl -i -a/-r). Poll: cold starts (Firefox)
            // can take seconds to map a window; give up if the launch was
            // superseded or exited (fullscreenPid cleared).
            let attempts = 0;
            const raiseAppWindow = () => {
                if (!fullscreenPid || fullscreenPid !== child.pid) return;
                attempts++;
                let winId = null;
                try {
                    const out = spawnSync("wmctrl", ["-l", "-p"], { env, encoding: "utf8" }).stdout || "";
                    out.split("\n").some(line => {
                        const f = line.trim().split(/\s+/);
                        if (f.length >= 4 && f[2] === String(child.pid)) { winId = f[0]; return true; }
                        return false;
                    });
                } catch (e) {}
                if (winId) {
                    try { spawn("wmctrl", ["-i", "-a", winId], { env, stdio: "ignore" }); } catch (e) {}
                    try { spawn("wmctrl", ["-i", "-r", winId, "-b", "add,fullscreen"], { env, stdio: "ignore" }); } catch (e) {}
                    try { spawn("wmctrl", ["-i", "-r", winId, "-b", "add,above"], { env, stdio: "ignore" }); } catch (e) {}
                } else if (attempts < 40) {
                    setTimeout(raiseAppWindow, 500);
                }
            };
            setTimeout(raiseAppWindow, 800);
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
