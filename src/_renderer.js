// Disable eval()
window.eval = global.eval = function () {
    throw new Error("eval() is disabled for security reasons.");
};
// Security helper :)
window._escapeHtml = text => {
    let map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => {return map[m];});
};
window._encodePathURI = uri => {
    return encodeURI(uri).replace(/#/g, "%23");
};
window._purifyCSS = str => {
    if (typeof str === "undefined") return "";
    if (typeof str !== "string") {
        str = str.toString();
    }
    return str.replace(/[<]/g, "");
};
window._delay = ms => {
    return new Promise((resolve, reject) => {
        setTimeout(resolve, ms);
    });
};
// Detect a hot reload (dev shortcut / theme switch). `performance.navigation` was
// removed in modern Chromium, so fall back to the Navigation Timing API.
window._isHotReload = () => {
    try {
        if (window.performance && typeof window.performance.getEntriesByType === "function") {
            let nav = window.performance.getEntriesByType("navigation")[0];
            if (nav) return nav.type === "reload";
        }
        if (window.performance && window.performance.navigation) {
            return window.performance.navigation.type === 1;
        }
    } catch (e) {}
    return false;
};

// ---- Cover mode ----
// While the screensaver or the lock screen is up, eDEX presents itself as a
// strategic nuclear launch terminal: terminal tab labels, the file browser,
// the public IP and the process list all show fabricated data; everything else
// stays real. `window.cover` is the single switch every consumer checks. All
// DOM access happens at call time (set()), never at module load.
window.cover = (() => {
    const FAKE_TABS = { 0: "MAIN - LAUNCHCTRL", 1: "#2 - GUIDANCE", 2: "KEYHOLDER", 3: "WARHEAD A", 4: "WARHEAD B" };
    const FALLBACK_TABS = { 0: "MAIN SHELL", 1: "EMPTY", 2: "CLAUDE", 3: "MONITOR A", 4: "MONITOR B" };
    const FAKE_PROCS = ["launch_seq", "targeting_core", "guidance_fuse", "key_custodian",
        "threat_eval", "silo_monitor", "telemetry_relay", "auth_gate",
        "warhead_diag", "perim_alarm"];
    const R = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo));
    const j = (dir, name) => (dir + "/" + name).replace(/\/+/g, "/");

    let active = false;
    // Real process names seen by the terminal tabs while NOT covered, so they
    // can be restored verbatim when the cover is released.
    const realProc = { 0: null, 1: null };
    let prevFsDir = null; // directory the file browser showed before covering

    // ---- fake filesystem ----
    const fakeFile = (dir, name, maxSize) => ({
        name, type: "file",
        size: R(512, (maxSize || (1 << 20))),
        lastAccessed: Date.now() - R(60000, 60 * 86400000),
        path: j(dir, name)
    });
    const fakeFolder = (dir, name) => ({
        name, type: "dir", size: 4096,
        lastAccessed: Date.now() - R(60000, 90 * 86400000),
        path: j(dir, name)
    });
    const fakeDir = dir => {
        dir = String(dir || "/").replace(/\/+$/, "") || "/";
        const out = [];
        if (dir === "/") {
            ["bin", "launch", "warheads", "targets", "keys", "logs", "telemetry", "systems"]
                .forEach(n => out.push(fakeFolder("/", n)));
            out.push(fakeFile("/", "launch_auth.sig"));
            out.push(fakeFile("/", "boot_checksum.bin", 1 << 10));
        } else if (dir === "/bin") {
            ["diag", "redundancy"].forEach(n => out.push(fakeFolder("/bin", n)));
            ["bootstrap.elf", "watchdog"].forEach(n => out.push(fakeFile("/bin", n, 1 << 16)));
        } else if (dir === "/launch") {
            ["sequence.dat", "arm_switch.ctl", "auth_checksum.sig", "two_person_rule.log"]
                .forEach(n => out.push(fakeFile("/launch", n)));
        } else if (dir === "/warheads") {
            for (let i = 1; i <= 6; i++) out.push(fakeFolder("/warheads", "warhead_0" + i));
        } else if (/^\/warheads\/warhead_\d+$/.test(dir)) {
            ["state.bin", "yield.cfg", "arming_cert.sig"].forEach(n => out.push(fakeFile(dir, n)));
        } else if (dir === "/targets") {
            ["target_list.enc", "coordinates.bin", "reentry_schedule.dat", "priority_matrix.cfg"]
                .forEach(n => out.push(fakeFile("/targets", n)));
        } else if (dir === "/keys") {
            out.push(fakeFile("/keys", "launch_keys.enc"));
            out.push(fakeFolder("/keys", "key_fragments"));
        } else if (dir === "/keys/key_fragments") {
            for (let i = 1; i <= 4; i++) out.push(fakeFile("/keys/key_fragments", "frag_0" + i + ".key", 1 << 8));
        } else if (dir === "/logs") {
            ["access_audit.log", "telemetry.log", "handshake_trail.log"].forEach(n => out.push(fakeFile("/logs", n)));
        } else if (dir === "/telemetry") {
            ["downlink_stream.buf", "silo_state.snapshot"].forEach(n => out.push(fakeFile("/telemetry", n)));
        } else if (dir === "/systems") {
            ["integrity_scan.cfg", "failover.ctl", "mesh_topology.json"].forEach(n => out.push(fakeFile("/systems", n)));
        } else {
            // Fallback for any path the cover didn't plan: sparse generic dir.
            out.push(fakeFile(dir, "state.bin"));
            out.push(fakeFolder(dir, "subsystem"));
        }
        return out;
    };
    // Map a real path to a plausible fake display path (safety net for real
    // reads that were already in flight when the cover turned on).
    const fakePath = dir => {
        dir = String(dir || "/");
        if (dir === "/" || dir.startsWith("/launch") || dir.startsWith("/warheads") ||
            dir.startsWith("/targets") || dir.startsWith("/keys") || dir.startsWith("/logs") ||
            dir.startsWith("/telemetry") || dir.startsWith("/systems") || dir.startsWith("/bin")) return dir;
        return "/operations";
    };

    const fakeProcesses = () => {
        const names = FAKE_PROCS.slice().sort(() => Math.random() - 0.5).slice(0, 5);
        return names.map(name => ({ pid: R(1024, 4096), name, cpu: R(0, 90), mem: R(1, 38) }));
    };

    const fakeMonitorLabel = monitorId => monitorId === "a" ? "WARHEAD A" : "WARHEAD B";

    // ---- tab labels ----
    const tabEl = num => document.getElementById("shell_tab" + num);
    // Real app-monitor labels (tabs 3/4) captured when the cover turns on, so
    // they can be restored verbatim instead of reverting to the placeholder.
    const realMonitor = { 3: null, 4: null };
    const tabLabel = (num, realP) => {
        if (active) return FAKE_TABS[num] != null ? FAKE_TABS[num] : "";
        if (num === 0) return realP ? "MAIN - " + realP : FALLBACK_TABS[num];
        if (num === 1) return realP ? "#2 - " + realP : FALLBACK_TABS[num];
        if (num === 3 || num === 4) return realMonitor[num] || FALLBACK_TABS[num];
        return FALLBACK_TABS[num] != null ? FALLBACK_TABS[num] : "";
    };
    const renderTab = num => {
        if (num <= 2) {
            const t = tabEl(num);
            if (t) t.innerHTML = `<p>${tabLabel(num, realProc[num])}</p>`;
        } else {
            const s = document.getElementById("shell_tab" + num + "_label");
            if (s) s.textContent = tabLabel(num, null);
        }
    };
    const rememberProc = (num, p) => {
        if (num === 0 || num === 1) realProc[num] = p;
    };

    // A path is "fake" if it belongs to the fabricated tree; we must never
    // treat one as the real directory to restore after the cover lifts.
    const isFakePath = p => {
        p = String(p || "");
        return p === "/" || p === "/operations" || p.startsWith("/launch") || p.startsWith("/warheads")
            || p.startsWith("/targets") || p.startsWith("/keys") || p.startsWith("/logs")
            || p.startsWith("/telemetry") || p.startsWith("/systems") || p.startsWith("/bin");
    };

    const set = on => {
        on = !!on;
        if (on === active) return;
        active = on;
        try {
            if (on) {
                // Remember the real directory the file browser was showing so it
                // can be restored on release. Guard against capturing a stale
                // fake path (e.g. when dismiss→lock re-engages cover before the
                // previous real read has finished navigating back).
                if (window.fsDisp && window.fsDisp.dirpath && !isFakePath(window.fsDisp.dirpath)) {
                    prevFsDir = window.fsDisp.dirpath;
                }
                // Remember the real app-monitor tab labels before overwriting.
                [3, 4].forEach(n => {
                    const s = document.getElementById("shell_tab" + n + "_label");
                    if (s && s.textContent) realMonitor[n] = s.textContent;
                });
                for (let n = 0; n <= 4; n++) renderTab(n);
                if (window.fsDisp && typeof window.fsDisp.readFS === "function") window.fsDisp.readFS("/");
                if (window.mods && window.mods.toplist) window.mods.toplist.updateList();
                if (window.mods && window.mods.netstat) window.mods.netstat.updateInfo();
            } else {
                for (let n = 0; n <= 4; n++) renderTab(n);
                if (window.fsDisp && typeof window.fsDisp.readFS === "function") {
                    window.fsDisp.readFS(prevFsDir || (window.settings && window.settings.cwd) || "/");
                }
                if (window.mods && window.mods.toplist) window.mods.toplist.updateList();
                if (window.mods && window.mods.netstat) window.mods.netstat.updateInfo();
            }
        } catch (e) {}
    };

    return {
        isActive: () => active,
        set,
        rememberProc,
        tabLabel,
        fakeDir,
        fakePath,
        fakeProcesses,
        fakeMonitorLabel
    };
})();

// Initiate basic error handling
window.onerror = (msg, path, line, col, error) => {
    document.getElementById("boot_screen").innerHTML += `${error} :  ${msg}<br/>==> at ${path}  ${line}:${col}`;
};

const path = require("path");
const fs = require("fs");
const electron = require("electron");
const remote = require("@electron/remote");
const ipc = electron.ipcRenderer;

const settingsDir = remote.app.getPath("userData");
const themesDir = path.join(settingsDir, "themes");
const keyboardsDir = path.join(settingsDir, "keyboards");
const fontsDir = path.join(settingsDir, "fonts");
const settingsFile = path.join(settingsDir, "settings.json");
const shortcutsFile = path.join(settingsDir, "shortcuts.json");
const lastWindowStateFile = path.join(settingsDir, "lastWindowState.json");

// Load config
window.settings = require(settingsFile);
window.shortcuts = require(shortcutsFile);
window.lastWindowState = require(lastWindowStateFile);

// Load CLI parameters
if (remote.process.argv.includes("--nointro")) {
    window.settings.nointroOverride = true;
} else {
    window.settings.nointroOverride = false;
}
if (remote.process.argv.includes("--nocursor")) {
    window.settings.nocursorOverride = true;
} else {
    window.settings.nocursorOverride = false;
}

// Retrieve theme override (hotswitch)
ipc.once("getThemeOverride", (e, theme) => {
    if (theme !== null) {
        window.settings.theme = theme;
        window.settings.nointroOverride = true;
        _loadTheme(require(path.join(themesDir, window.settings.theme+".json")));
    } else {
        _loadTheme(require(path.join(themesDir, window.settings.theme+".json")));
    }
});
ipc.send("getThemeOverride");
// Same for keyboard override/hotswitch
ipc.once("getKbOverride", (e, layout) => {
    if (layout !== null) {
        window.settings.keyboard = layout;
        window.settings.nointroOverride = true;
    }
});
ipc.send("getKbOverride");

// Load UI theme
window._loadTheme = theme => {

    if (document.querySelector("style.theming")) {
        document.querySelector("style.theming").remove();
    }

    // Load fonts
    let mainFont = new FontFace(theme.cssvars.font_main, `url("${path.join(fontsDir, theme.cssvars.font_main.toLowerCase().replace(/ /g, '_')+'.woff2').replace(/\\/g, '/')}")`);
    let lightFont = new FontFace(theme.cssvars.font_main_light, `url("${path.join(fontsDir, theme.cssvars.font_main_light.toLowerCase().replace(/ /g, '_')+'.woff2').replace(/\\/g, '/')}")`);
    let termFont = new FontFace(theme.terminal.fontFamily, `url("${path.join(fontsDir, theme.terminal.fontFamily.toLowerCase().replace(/ /g, '_')+'.woff2').replace(/\\/g, '/')}")`);

    document.fonts.add(mainFont);
    document.fonts.load("12px "+theme.cssvars.font_main);
    document.fonts.add(lightFont);
    document.fonts.load("12px "+theme.cssvars.font_main_light);
    document.fonts.add(termFont);
    document.fonts.load("12px "+theme.terminal.fontFamily);

    document.querySelector("head").innerHTML += `<style class="theming">
    :root {
        --font_main: "${window._purifyCSS(theme.cssvars.font_main)}";
        --font_main_light: "${window._purifyCSS(theme.cssvars.font_main_light)}";
        --font_mono: "${window._purifyCSS(theme.terminal.fontFamily)}";
        --color_r: ${window._purifyCSS(theme.colors.r)};
        --color_g: ${window._purifyCSS(theme.colors.g)};
        --color_b: ${window._purifyCSS(theme.colors.b)};
        --color_black: ${window._purifyCSS(theme.colors.black)};
        --color_light_black: ${window._purifyCSS(theme.colors.light_black)};
        --color_grey: ${window._purifyCSS(theme.colors.grey)};

        /* Used for error and warning modals */
        --color_red: ${window._purifyCSS(theme.colors.red) || "red"};
        --color_yellow: ${window._purifyCSS(theme.colors.yellow) || "yellow"};
    }

    body {
        font-family: var(--font_main), sans-serif;
        cursor: ${(window.settings.nocursorOverride || window.settings.nocursor) ? "none" : "default"} !important;
    }

    * {
   	   ${(window.settings.nocursorOverride || window.settings.nocursor) ? "cursor: none !important;" : ""}
	}

    ${window._purifyCSS(theme.injectCSS || "")}
    </style>`;

    window.theme = theme;
    window.theme.r = theme.colors.r;
    window.theme.g = theme.colors.g;
    window.theme.b = theme.colors.b;
};

function initGraphicalErrorHandling() {
    window.edexErrorsModals = [];
    window.onerror = (msg, path, line, col, error) => {
        let errorModal = new Modal({
            type: "error",
            title: error,
            message: `${msg}<br/>        at ${path}  ${line}:${col}`
        });
        window.edexErrorsModals.push(errorModal);

        ipc.send("log", "error", `${error}: ${msg}`);
        ipc.send("log", "debug", `at ${path} ${line}:${col}`);
    };
}

function waitForFonts() {
    return new Promise(resolve => {
        if (document.readyState !== "complete" || document.fonts.status !== "loaded") {
            document.addEventListener("readystatechange", () => {
                if (document.readyState === "complete") {
                    if (document.fonts.status === "loaded") {
                        resolve();
                    } else {
                        document.fonts.onloadingdone = () => {
                            if (document.fonts.status === "loaded") resolve();
                        };
                    }
                }
            });
        } else {
            resolve();
        }
    });
}

// A proxy function used to add multithreading to systeminformation calls - see backend process manager @ _multithread.js
function initSystemInformationProxy() {
    const { nanoid } = require("nanoid/non-secure");

    window.si = new Proxy({}, {
        apply: () => {throw new Error("Cannot use sysinfo proxy directly as a function")},
        set: () => {throw new Error("Cannot set a property on the sysinfo proxy")},
        get: (target, prop, receiver) => {
            return function(...args) {
                let callback = (typeof args[args.length - 1] === "function") ? true : false;

                return new Promise((resolve, reject) => {
                    let id = nanoid();
                    ipc.once("systeminformation-reply-"+id, (e, res) => {
                        if (callback) {
                            args[args.length - 1](res);
                        }
                        resolve(res);
                    });
                    ipc.send("systeminformation-call", prop, id, ...args);
                });
            };
        }
    });
}

// Init audio
window.audioManager = new AudioManager();

// See #223
remote.app.focus();

let i = 0;
if (window.settings.nointro || window.settings.nointroOverride) {
    initGraphicalErrorHandling();
    initSystemInformationProxy();
    document.getElementById("boot_screen").remove();
    document.body.setAttribute("class", "");
    waitForFonts().then(initUI);
} else {
    displayLine();
}

// Startup boot log
function displayLine() {
    let bootScreen = document.getElementById("boot_screen");
    let log = fs.readFileSync(path.join(__dirname, "assets", "misc", "boot_log.txt")).toString().split('\n');

    function isArchUser() {
        return require("os").platform() === "linux"
                && fs.existsSync("/etc/os-release")
                && fs.readFileSync("/etc/os-release").toString().includes("arch");
    }

    if (typeof log[i] === "undefined") {
        setTimeout(displayTitleScreen, 300);
        return;
    }

    if (log[i] === "Boot Complete") {
        window.audioManager.granted.play();
    } else {
        window.audioManager.stdout.play();
    }
    bootScreen.innerHTML += log[i]+"<br/>";
    i++;

    switch(true) {
        case i === 2:
            bootScreen.innerHTML += `eDEX-UI Kernel version ${remote.app.getVersion()} boot at ${Date().toString()}; root:xnu-1699.22.73~1/RELEASE_X86_64`;
        case i === 4:
            setTimeout(displayLine, 500);
            break;
        case i > 4 && i < 25:
            setTimeout(displayLine, 30);
            break;
        case i === 25:
            setTimeout(displayLine, 400);
            break;
        case i === 42:
            setTimeout(displayLine, 300);
            break;
        case i > 42 && i < 82:
            setTimeout(displayLine, 25);
            break;
        case i === 83:
            if (isArchUser())
                bootScreen.innerHTML += "btw i use arch<br/>";
            setTimeout(displayLine, 25);
            break;
        case i >= log.length-2 && i < log.length:
            setTimeout(displayLine, 300);
            break;
        default:
            setTimeout(displayLine, Math.pow(1 - (i/1000), 3)*25);
    }
}

// Show "logo" and background grid
async function displayTitleScreen() {
    let bootScreen = document.getElementById("boot_screen");
    if (bootScreen === null) {
        bootScreen = document.createElement("section");
        bootScreen.setAttribute("id", "boot_screen");
        bootScreen.setAttribute("style", "z-index: 9999999");
        document.body.appendChild(bootScreen);
    }
    bootScreen.innerHTML = "";
    window.audioManager.theme.play();

    await _delay(400);

    document.body.setAttribute("class", "");
    bootScreen.setAttribute("class", "center");
    bootScreen.innerHTML = "<h1>eDEX-UI</h1>";
    let title = document.querySelector("section > h1");

    await _delay(200);

    document.body.setAttribute("class", "solidBackground");

    await _delay(100);

    title.setAttribute("style", `background-color: rgb(${window.theme.r}, ${window.theme.g}, ${window.theme.b});border-bottom: 5px solid rgb(${window.theme.r}, ${window.theme.g}, ${window.theme.b});`);

    await _delay(300);

    title.setAttribute("style", `border: 5px solid rgb(${window.theme.r}, ${window.theme.g}, ${window.theme.b});`);

    await _delay(100);

    title.setAttribute("style", "");
    title.setAttribute("class", "glitch");

    await _delay(500);

    document.body.setAttribute("class", "");
    title.setAttribute("class", "");
    title.setAttribute("style", `border: 5px solid rgb(${window.theme.r}, ${window.theme.g}, ${window.theme.b});`);

    await _delay(1000);
    if (window.term) {
        bootScreen.remove();
        // Matrix-screensaver wake: after the boot animation, re-run the panel
        // entrance so the UI "loads" like a fresh start (terminals + file
        // browser are left untouched).
        if (window._replayUI) reRevealUI();
        return true;
    }
    initGraphicalErrorHandling();
    initSystemInformationProxy();
    waitForFonts().then(() => {
        bootScreen.remove();
        initUI();
    });
}

// Returns the user's desired display name
async function getDisplayName() {
    let user = settings.username || null;
    if (user)
        return user;

    try {
        user = await require("username")();
    } catch (e) {}

    return user;
}

// Create the UI's html structure and initialize the terminal client and the keyboard
async function initUI() {
    document.body.innerHTML += `<section class="mod_column" id="mod_column_left">
        <h3 class="title"><p>PANEL</p><p>SYSTEM</p></h3>
    </section>
    <section id="main_shell" style="height:0%;width:0%;opacity:0;margin-bottom:30vh;" augmented-ui="bl-clip tr-clip exe">
        <h3 class="title" style="opacity:0;"><p>TERMINAL</p><p>MAIN SHELL</p></h3>
        <h1 id="main_shell_greeting"></h1>
    </section>
    <section class="mod_column" id="mod_column_right">
        <h3 class="title"><p>PANEL</p><p>NETWORK</p></h3>
    </section>`;

    await _delay(10);

    window.audioManager.expand.play();
    document.getElementById("main_shell").setAttribute("style", "height:0%;margin-bottom:30vh;");

    await _delay(500);

    document.getElementById("main_shell").setAttribute("style", "margin-bottom: 30vh;");
    document.querySelector("#main_shell > h3.title").setAttribute("style", "");

    await _delay(700);

    document.getElementById("main_shell").setAttribute("style", "opacity: 0;");
    document.body.innerHTML += `
    <div id="bottom_row">
        <section id="filesystem" style="width: 0px;" class="${window.settings.hideDotfiles ? "hideDotfiles" : ""} ${window.settings.fsListView ? "list-view" : ""}">
        </section>
        <section id="cyber_panel" style="opacity:0;" augmented-ui="bl-clip tr-clip exe">
        </section>
    </div>`;
    window.cyberPanel = new CyberPanel({
        container: "cyber_panel"
    });

    // Virtual keyboard (settings.showKeyboard, or forced during the code-mode
    // lock screen): overlay the ORIGINAL eDEX keyboard, scaled to fit the DATA
    // box; the waveform/data stays visible in the leftover space.
    window.ensureKeyboard = () => {
        if (document.getElementById("keyboard_layer")) return window.keyboard;
        let cyberPanel = document.getElementById("cyber_panel");
        if (!cyberPanel) return null;
        let kbLayer = document.createElement("div");
        kbLayer.id = "keyboard_layer";
        cyberPanel.appendChild(kbLayer);
        let kbEl = document.createElement("section");
        kbEl.id = "keyboard";
        kbLayer.appendChild(kbEl);
        try {
            window.keyboard = new Keyboard({
                layout: path.join(keyboardsDir, (window.settings.keyboard || "en-US") + ".json"),
                container: "keyboard"
            });
            window.keyboard.attach();
        } catch (e) {
            require("electron").ipcRenderer.send("log", "error", "Keyboard init failed: " + (e && e.message));
        }
        const fitKeyboard = () => {
            const kb = document.getElementById("keyboard");
            if (!kb) return;
            const lr = kbLayer.getBoundingClientRect();
            if (!lr.width || !lr.height) return;
            kb.style.zoom = "1";
            void kb.offsetWidth;
            const nw = kb.getBoundingClientRect().width;
            const nh = kb.getBoundingClientRect().height;
            if (!nw || !nh) return;
            kb.style.zoom = 0.99 * Math.min(lr.width / nw, lr.height / nh);
        };
        setTimeout(fitKeyboard, 200);
        setTimeout(fitKeyboard, 2600);
        const fitRO = window.ResizeObserver ? new ResizeObserver(fitKeyboard) : null;
        if (fitRO) fitRO.observe(cyberPanel);
        window.addEventListener("resize", fitKeyboard);
        return window.keyboard;
    };
    window.destroyKeyboard = () => {
        const layer = document.getElementById("keyboard_layer");
        if (layer) layer.remove();
        window.keyboard = null;
    };
    if (window.settings.showKeyboard) window.ensureKeyboard();

    await _delay(10);

    document.getElementById("main_shell").setAttribute("style", "");

    await _delay(270);

    let greeter = document.getElementById("main_shell_greeting");

    getDisplayName().then(user => {
        if (user) {
            greeter.innerHTML += `Welcome back, <em>${user}</em>`;
        } else {
            greeter.innerHTML += "Welcome back";
        }
    });

    greeter.setAttribute("style", "opacity: 1;");

    document.getElementById("filesystem").setAttribute("style", "");
    // cyber_panel stays hidden (opacity:0) during the boot welcome - its
    // frame/background must not pop out early. cyberEntrance() reveals it
    // after the greeting is gone.

    await _delay(1000);

    greeter.setAttribute("style", "opacity: 0;");

    await _delay(100);

    await _delay(400);

    greeter.remove();

    // Initialize modules
    window.mods = {};

    // Left column
    window.mods.clock = new Clock("mod_column_left");
    window.mods.sysinfo = new Sysinfo("mod_column_left");
    window.mods.hardwareInspector = new HardwareInspector("mod_column_left");
    window.mods.cpuinfo = new Cpuinfo("mod_column_left");
    window.mods.ramwatcher = new RAMwatcher("mod_column_left");
    window.mods.toplist = new Toplist("mod_column_left");

    // Right column
    window.mods.netstat = new Netstat("mod_column_right");
    window.mods.globe = new LocationGlobe("mod_column_right");
    window.mods.conninfo = new Conninfo("mod_column_right");

    // Fade-in animations
    document.querySelectorAll(".mod_column").forEach(e => {
        e.setAttribute("class", "mod_column activated");
    });
    let i = 0;
    let left = document.querySelectorAll("#mod_column_left > div");
    let right = document.querySelectorAll("#mod_column_right > div");
    let x = setInterval(() => {
        if (!left[i] && !right[i]) {
            clearInterval(x);
        } else {
            window.audioManager.panels.play();
            if (left[i]) {
                left[i].setAttribute("style", "animation-play-state: running;");
            }
            if (right[i]) {
                right[i].setAttribute("style", "animation-play-state: running;");
            }
            i++;
        }
    }, 500);

    // Reveal the DATA STREAM panel + radar elements one by one
    setTimeout(cyberEntrance, 800);

    await _delay(100);

    // Initialize the terminal
    let shellContainer = document.getElementById("main_shell");
    shellContainer.innerHTML += `
        <div class="shell_outline"></div>
        <ul id="main_shell_tabs">
            <li id="shell_tab0" onclick="window.focusShellTab(0);" class="active"><p>MAIN SHELL</p></li>
            <li id="shell_tab1" onclick="window.focusShellTab(1);"><p>EMPTY</p></li>
            <li id="shell_tab2" onclick="window.focusShellTab(2);"><p>CLAUDE</p></li>
            <li id="shell_tab3" onclick="window.focusShellTab(3);"><button class="appmonitor_fs_tab" title="Fullscreen" onclick="event.stopPropagation();window.appmonitorA.fullscreenButton()"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M1 1h22L1 23z"/></svg></button><p><span id="shell_tab3_label">MONITOR A</span> <span class="webapp_chevron" title="Switch app" onclick="event.stopPropagation();window.appmonitorA.toggleMenu(event);">${Icons.chevronDown}</span></p></li>
            <li id="shell_tab4" onclick="window.focusShellTab(4);"><button class="appmonitor_fs_tab" title="Fullscreen" onclick="event.stopPropagation();window.appmonitorB.fullscreenButton()"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M1 1h22L1 23z"/></svg></button><p><span id="shell_tab4_label">MONITOR B</span> <span class="webapp_chevron" title="Switch app" onclick="event.stopPropagation();window.appmonitorB.toggleMenu(event);">${Icons.chevronDown}</span></p></li>
        </ul>
        <div id="main_shell_innercontainer">
            <pre id="terminal0" class="active"></pre>
            <pre id="terminal1"></pre>
            <pre id="terminal2"></pre>
            <div id="appmonitor_a_slot" class="shell_slot"></div>
            <div id="appmonitor_b_slot" class="shell_slot"></div>
        </div>`;
    window.term = {
        0: new Terminal({
            role: "client",
            parentId: "terminal0",
            port: window.settings.port || 3000
        })
    };
    window.currentTerm = 0;
    // Slot kinds: 0-2 are terminals, 3/4 are the two virtual app monitors
    // (MONITOR A / MONITOR B). Everything below that reads window.term[] is
    // made safe for slots 3/4 via a terminal-shaped shim.
    window.shellSlotKinds = { 0: "term", 1: "term", 2: "term", 3: "appmonitor", 4: "appmonitor" };

    // Global IME (Chinese input / Rime) toggle button pinned to the shell's
    // bottom-right corner — visible on every tab (terminals, Claude, monitors).
    window.edexIME = {
        refresh() {
            try {
                require("child_process").exec("fcitx5-remote -n 2>/dev/null", (err, stdout) => {
                    const name = String(stdout || "").trim().toLowerCase();
                    const btn = document.getElementById("edex_ime_btn");
                    if (btn) btn.textContent = /rime|pinyin|chinese/.test(name) ? "中" : "EN";
                });
            } catch (e) {}
        },
        toggle() {
            try {
                require("child_process").exec("fcitx5-remote -t 2>/dev/null");
                setTimeout(() => this.refresh(), 350);
            } catch (e) {}
        }
    };
    const imeBtn = document.createElement("button");
    imeBtn.id = "edex_ime_btn";
    imeBtn.className = "appmonitor_ime_btn";
    imeBtn.textContent = "EN";
    imeBtn.title = "Toggle input method (中/EN)";
    imeBtn.onclick = e => { e.stopPropagation(); window.edexIME.toggle(); };

    // ---- Offline voice input (mic → sherpa-onnx → text into the terminal) ----
    window.voiceInput = {
        _stream: null, _ctx: null, _source: null, _processor: null, _recording: false,
        async init() {
            try {
                const r = await ipc.invoke("voice:init");
                this._ready = !!(r && r.ok);
            } catch (e) { this._ready = false; }
            const b = document.getElementById("edex_voice_btn");
            if (b) b.classList.toggle("voice_disabled", !this._ready);
            return this._ready;
        },
        _resample(input, from, to) {
            if (from === to) return new Float32Array(input);
            const ratio = to / from;
            const out = new Float32Array(Math.round(input.length * ratio));
            for (let i = 0; i < out.length; i++) {
                const idx = i / ratio;
                const i0 = Math.floor(idx), i1 = Math.min(i0 + 1, input.length - 1);
                const f = idx - i0;
                out[i] = input[i0] * (1 - f) + input[i1] * f;
            }
            return out;
        },
        async start() {
            if (this._recording) return;
            if (!this._ready && !(await this.init())) return;
            try {
                if (!this._stream) {
                    this._stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                    const Ctx = window.AudioContext || window.webkitAudioContext;
                    this._ctx = new Ctx({ sampleRate: 16000 });
                    this._source = this._ctx.createMediaStreamSource(this._stream);
                    this._processor = this._ctx.createScriptProcessor(4096, 1, 1);
                    this._source.connect(this._processor);
                    this._processor.connect(this._ctx.destination);
                    this._processor.onaudioprocess = e => {
                        if (!this._recording) return;
                        const ch = e.inputBuffer.getChannelData(0);
                        ipc.send("voice:chunk", this._resample(ch, this._ctx.sampleRate, 16000));
                    };
                }
                await this._ctx.resume();
                this._recording = true;
                await ipc.invoke("voice:start");
            } catch (e) { console.warn("voice start failed:", e && e.message); }
            this._setUi(true);
        },
        async stop() {
            if (!this._recording) return;
            this._recording = false;
            this._setUi(false);
            try {
                const r = await ipc.invoke("voice:stop");
                const text = String((r && r.text) || "").trim();
                if (text) this._insert(text);
                return text;
            } catch (e) { return ""; }
        },
        _insert(text) {
            // write the recognized text into the focused terminal (term shim for
            // the app-monitor tabs is a no-op, so this targets the real terminals)
            try {
                const t = window.term[window.currentTerm];
                if (t && typeof t.write === "function") t.write(text);
            } catch (e) {}
        },
        _setUi(recording) {
            const b = document.getElementById("edex_voice_btn");
            if (!b) return;
            b.classList.toggle("voice_recording", recording);
            b.title = recording ? "Listening… (click to stop)" : "Voice input (click to talk)";
        },
        toggle() {
            if (this._recording) this.stop();
            else this.start();
        }
    };
    const micBtn = document.createElement("button");
    micBtn.id = "edex_voice_btn";
    micBtn.className = "appmonitor_ime_btn appmonitor_voice_btn";
    micBtn.innerHTML = '<svg class="voice_icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg><span class="voice_eq"><i></i><i></i><i></i><i></i><i></i></span>';
    micBtn.title = "Voice input (click to talk, or hold F9)";
    micBtn.addEventListener("click", e => { e.stopPropagation(); window.voiceInput.toggle(); });

    // Corner button stack pinned flush to the terminal/content area's bottom-right.
    const corner = document.createElement("div");
    corner.id = "edex_corner_btns";
    corner.appendChild(micBtn);
    corner.appendChild(imeBtn);
    document.getElementById("main_shell_innercontainer").appendChild(corner);
    window.edexIME.refresh();
    setInterval(() => window.edexIME.refresh(), 5000);

    // F9 (hold) = voice input, mirroring the mic button. Only when a real
    // terminal is focused (not a browser/app monitor), and the key is swallowed
    // so it never reaches the terminal's app or a webview (F5 would clash with
    // browser refresh, so the less-used F9 was chosen).
    const termFocused = () => (window.shellSlotKinds[window.currentTerm] === "term");
    document.addEventListener("keydown", e => {
        if (e.key === "F9" && !e.repeat && termFocused()) {
            e.preventDefault(); e.stopPropagation();
            window.voiceInput.start();
        }
    });
    document.addEventListener("keyup", e => {
        if (e.key === "F9" && termFocused()) {
            e.preventDefault(); e.stopPropagation();
            window.voiceInput.stop();
        }
    });

    // ---- Module click → detail/action modals (all CLI-backed) ----
    window.sysCmd = {
        run(cmd) {
            return new Promise(resolve => {
                require("child_process").exec(cmd, { timeout: 30000, maxBuffer: 8 * 1024 * 1024 }, (e, so, se) => resolve({ out: so || "", err: se || "", ok: !e }));
            });
        },
        // Run a one-shot command and close the open modal (restart / shutdown / mkfs).
        act(cmd) {
            this.run(cmd);
            const ks = Object.keys(window.modals);
            if (ks.length) { try { window.modals[ks[ks.length - 1]].close(); } catch (e) {} }
        },
        // Open a modal that runs a command and shows its output; Refresh re-runs it.
        open(title, cmd) {
            const id = "mod_" + require("nanoid").nanoid().slice(0, 6);
            this._last = { id, cmd };
            new Modal({
                type: "custom", title,
                html: `<pre class="mod_cmd_out" id="mco_${id}">LOADING…</pre>`,
                // Only the Refresh button: the Modal class appends its own Close
                // button, so including one here produced two "Close" buttons.
                buttons: [
                    { label: "Refresh", action: `window.sysCmd.refresh('${id}')` }
                ]
            });
            this._render(id, cmd);
        },
        _render(id, cmd) {
            const el = document.getElementById("mco_" + id);
            if (el) el.textContent = "RUNNING…";
            this.run(cmd).then(r => {
                const e2 = document.getElementById("mco_" + id);
                if (e2) e2.textContent = (r.out || r.err || "(no output)").trim();
            });
        },
        refresh(id) { if (this._last && this._last.id === id) this._render(id, this._last.cmd); },
        _closeTop() { const ks = Object.keys(window.modals); if (ks.length) { try { window.modals[ks[ks.length - 1]].close(); } catch (e) {} } },
        // Toggle 12/24-hour in place on the existing clock — re-creating the
        // module would re-parse the whole left column and break every other
        // module's DOM/instance references.
        setClockFormat(hours) {
            window.settings.clockHours = hours;
            const c = window.mods.clock;
            if (c) {
                c.twelveHours = (hours === 12);
                const el = document.getElementById("mod_clock");
                if (el) el.className = (hours === 12) ? "mod_clock_twelve" : "";
                c.updateClock();
            }
            this._closeTop();
        },
        formatDialog() {
            new Modal({
                type: "custom", title: "FORMAT DISK",
                html: `<p class="mod_cmd_warn">⚠ Destroys ALL data on the device!</p>
                       <p style="margin:0 0 0.4vh">Device</p>
                       <input id="sysfmt_dev" placeholder="/dev/sdb">
                       <p style="margin:0.6vh 0 0.4vh">Filesystem</p>
                       <select id="sysfmt_fs"><option>vfat</option><option>ext4</option><option>ntfs</option></select>`,
                buttons: [
                    { label: "Format", action: "window.sysCmd.doFormat()" }
                    // Close is auto-appended by the Modal class (an explicit
                    // Cancel here produced two close-behaving buttons).
                ]
            });
        },
        doFormat() {
            const dev = ((document.getElementById("sysfmt_dev") || {}).value || "").trim();
            const fs = ((document.getElementById("sysfmt_fs") || {}).value || "vfat");
            if (!/^\/dev\/(sd|vd|nvme|mmcblk)/.test(dev)) return;
            this.act("sudo mkfs." + fs + " " + dev);
        }
    };

    // One delegated click handler for all modules (their DOM is rebuilt by later
    // modules, so direct listeners would be lost). The weather's location editor
    // is handled separately in netstat.class.js.
    document.addEventListener("click", e => {
        const t = e.target;
        if (!t || !t.closest) return;
        if (t.closest("button") || t.closest("#keyboard_layer")) return; // interactive children

        if (t.closest("#mod_clock")) {
            new Modal({ type: "custom", title: "CLOCK & POWER",
                html: `<div class="mod_menu">
                    <button onclick="window.sysCmd.setClockFormat(0)">24-hour clock</button>
                    <button onclick="window.sysCmd.setClockFormat(12)">12-hour clock</button>
                    <button onclick="window.sysCmd.act('sudo systemctl reboot')">Restart</button>
                    <button onclick="window.lockScreen && window.lockScreen.show()">Lock Screen</button>
                    <button onclick="window.sysCmd.act('sudo systemctl suspend')">Suspend</button>
                    <button class="mod_menu_danger" onclick="window.sysCmd.act('sudo poweroff')">Shutdown</button>
                </div>`, closeLabel: "Close" });
        } else if (t.closest("#mod_cpuinfo")) {
            window.sysCmd.open("CPU INFO", "lscpu 2>/dev/null | head -25; echo; echo '--- LOAD ---'; uptime");
        } else if (t.closest("#mod_ramwatcher_inner")) {
            window.sysCmd.open("MEMORY", "free -h; echo; echo '--- SWAP ---'; swapon --show 2>/dev/null; echo; echo '--- VMSTAT ---'; vmstat 1 2 | tail -2");
        } else if (t.closest("#cyber_panel")) {
            new Modal({ type: "custom", title: "DISK MANAGEMENT",
                html: `<div class="mod_menu">
                    <button onclick="window.sysCmd.open('Disks', 'lsblk -o NAME,SIZE,TYPE,MOUNTPOINT,FSTYPE')">List Disks</button>
                    <button onclick="window.sysCmd.open('Disk Space', 'df -h')">Disk Space</button>
                    <button onclick="window.sysCmd.open('Mount', 'lsblk -o NAME,SIZE,MOUNTPOINT,FSTYPE; echo; echo Use: udisksctl mount -b /dev/XXX')">Mount / Unmount</button>
                    <button class="mod_menu_danger" onclick="window.sysCmd.formatDialog()">Format USB / Disk…</button>
                </div>`, closeLabel: "Close" });
        } else if (t.closest("#cyber_radar")) {
            window.sysCmd.open("PROCESSES", "ps -eo pid,comm,%cpu,%mem --sort=-%cpu | head -20");
        } else if (t.closest("#mod_globe")) {
            window.sysCmd.open("NETWORK CONNECTIONS", "ss -tunp 2>/dev/null | head -20");
        } else if (t.closest("#mod_netstat_netfooter")) {
            new Modal({ type: "custom", title: "NETWORK",
                html: `<div class="mod_menu">
                    <button onclick="window.sysCmd.open('Interfaces', 'ip -brief addr')">Interfaces</button>
                    <button onclick="window.sysCmd.open('WiFi', 'nmcli -t -f IN-USE,SSID,SIGNAL device wifi list 2>/dev/null | head -15')">WiFi</button>
                    <button onclick="window.sysCmd.open('Routing / Ping', 'ip route; echo; echo ---; ping -c 2 1.1.1.1 2>&1 | tail -3')">Routing / Ping</button>
                </div>`, closeLabel: "Close" });
        } else if (t.closest("#mod_conninfo")) {
            // Network traffic charts (below the globe) → per-interface traffic
            window.sysCmd.open("NETWORK TRAFFIC", "echo '--- Interface stats ---'; awk 'NR>2 {print $1, \"RX:\"$2\"B  TX:\"$10\"B\"}' /proc/net/dev 2>/dev/null; echo; echo '--- Connection summary ---'; ss -s 2>/dev/null | head -6");
        } else if (t.closest("#mod_hardwareInspector_inner")) {
            // The MODEL panel → full machine info
            window.sysCmd.open("MACHINE INFO", "hostnamectl 2>/dev/null; echo; lscpu 2>/dev/null | head -15; echo; free -h 2>/dev/null | head -2");
        }
    });

    window.term[0].onprocesschange = p => {
        if (window.cover) window.cover.rememberProc(0, p);
        document.getElementById("shell_tab0").innerHTML = `<p>${window.cover ? window.cover.tabLabel(0, p) : "MAIN - " + p}</p>`;
    };
    // Keep hardware keyboard focus on the terminal, but never steal it back
    // from things that need their own keyboard focus: the embedded browser's
    // chrome (address bar, tab strip, webapp dropdown), modal dialogs (settings
    // inputs etc.), or any text field. Clicks inside a webview never reach this
    // document anyway.
    window.onmouseup = e => {
        if (!window.keyboard || window.keyboard.linkedToTerm) {
            if (e.target && e.target.closest) {
                if (e.target.closest(".browser_chrome, .webapp_menu, .modal_popup, input, textarea, select, [contenteditable]")) return;
            }
            if (window.term[window.currentTerm]) window.term[window.currentTerm].term.focus();
        }
    };
    window.term[0].term.writeln("\033[1m"+`Welcome to eDEX-UI v${remote.app.getVersion()} - Electron v${process.versions.electron}`+"\033[0m");

    await _delay(100);

    window.fsDisp = new FilesystemDisplay({
        parentId: "filesystem"
    });

    await _delay(200);

    document.getElementById("filesystem").setAttribute("style", "opacity: 1;");

    // Resend terminal CWD to fsDisp if we're hot reloading
    if (window._isHotReload()) {
        window.term[window.currentTerm].resendCWD();
    }

    await _delay(200);

    // Compact system-music controller (bottom-right of the DATA window).
    // Created only after the boot welcome + entrance animations are over so it
    // doesn't pop up before the welcome. Appended via createElement/appendChild
    // - `innerHTML +=` would rebuild <body> and destroy the panel canvases.
    let miniAudioEl = document.createElement("div");
    miniAudioEl.id = "mini_audio";
    document.body.appendChild(miniAudioEl);
    window.miniAudio = new MiniAudio({
        container: miniAudioEl
    });

    // Virtual app monitors (tabs 4 & 5): each shows an installed app — native
    // Linux app streamed through a nested X display via noVNC, or a web app
    // loaded directly. Webapps discovery stays for the web-app section of the
    // app list; the old multi-tab browser / webapp panel are retired.
    window.webapps = new Webapps();
    window.appmonitorApi = {
        config: () => ipc.invoke("appmonitor:config"),
        nativeList: () => ipc.invoke("appmonitor:native-list"),
        launch: (monitorId, appId) => ipc.invoke("appmonitor:launch", { monitorId, appId }),
        kill: (monitorId) => ipc.invoke("appmonitor:kill", { monitorId }),
        status: () => ipc.invoke("appmonitor:status"),
        close: (appId) => ipc.invoke("appmonitor:close", { appId }),
        addNative: (entry) => ipc.invoke("appmonitor:add-native", entry),
        removeNative: (id) => ipc.invoke("appmonitor:remove-native", id),
        fullscreen: (monitorId, appId) => ipc.invoke("appmonitor:fullscreen", { monitorId, appId }),
        exitFullscreen: () => ipc.invoke("appmonitor:exit-fullscreen")
    };
    window.appmonitorA = new AppMonitorPanel({ parentId: "appmonitor_a_slot", monitorId: "a", labelId: "shell_tab3_label" });
    window.appmonitorB = new AppMonitorPanel({ parentId: "appmonitor_b_slot", monitorId: "b", labelId: "shell_tab4_label" });

    // WiFi connect panel (Linux + NetworkManager via nmcli).
    window.wifiApi = {
        list: () => ipc.invoke("wifi:list"),
        connect: (ssid, password) => ipc.invoke("wifi:connect", { ssid, password }),
        status: () => ipc.invoke("wifi:status")
    };
    window.wifiPanel = new WifiPanel();
    window.lockScreen = new LockScreen();
    ipc.on("open-wifi-panel", () => { if (window.wifiPanel) window.wifiPanel.open(); });
    ipc.on("lock-screen", () => { if (window.lockScreen) window.lockScreen.show(); });
    ipc.on("edex-download-done", (e, d) => {
        if (window.wifiPanel) window.wifiPanel._notify((d && d.ok ? "Saved to Downloads: " : "Download failed: ") + ((d && d.name) || ""));
    });

    // Floating WiFi quick-connect button (bottom-right corner).
    const wifiBtn = document.createElement("button");
    wifiBtn.className = "wifi_btn";
    wifiBtn.title = "WiFi";
    wifiBtn.innerHTML = "WIFI";
    wifiBtn.onclick = () => { if (window.wifiPanel) window.wifiPanel.open(); };
    document.body.appendChild(wifiBtn);

    // System update modal (sudo apt update + full-upgrade, streamed).
    window.systemUpdate = {
        modal: null,
        open() {
            if (this.modal) return;
            this.modal = new Modal({
                type: "custom",
                title: "SYSTEM UPDATE",
                html: `<pre class="sysup_out" id="sysup_out">Needs network + passwordless sudo.\nPress Start to check for & install updates…</pre>`,
                buttons: [
                    { label: "Start", action: "window.systemUpdate.start()" }
                    // Close is auto-appended by the Modal class (the explicit
                    // one used to double the Close button).
                ]
            }, () => { this.modal = null; });
        },
        close() { if (this.modal) this.modal.close(); },
        start() {
            const pre = document.getElementById("sysup_out");
            if (!pre || pre.dataset.running === "1") return;
            pre.dataset.running = "1";
            pre.textContent = "Running apt update + full-upgrade…\n";
            ipc.invoke("system:update").then(r => {
                pre.textContent += r.ok
                    ? "\n✓ Update complete. Reboot if the kernel changed."
                    : "\n✗ Update failed" + (r.error ? ": " + r.error : "") + ".";
                delete pre.dataset.running;
            });
        }
    };
    ipc.on("system-update-output", (e, line) => {
        const pre = document.getElementById("sysup_out");
        if (pre && line) pre.textContent += line + "\n";
    });

    // GitHub self-update of the eDEX-UI AppImage (eDEX-OS install). Downloads
    // the new AppImage from a release asset, verifies its sha256 and atomically
    // replaces /opt/edex/eDEX-UI.AppImage in the main process, then relaunches.
    // Only meaningful when running from an AppImage — from src/ during dev it
    // falls back to opening the release page in the browser.
    window.edexUpdate = {
        isAppImage: false,
        modal: null,
        init() {
            ipc.invoke("app:env").then(env => {
                if (env) this.isAppImage = !!env.isAppImage;
            }).catch(() => {});
        },
        start(url, sha256Url, releaseUrl) {
            if (!this.isAppImage) {
                require("electron").shell.openExternal(releaseUrl || url);
                return;
            }
            if (this.modal) return;
            this.modal = new Modal({
                type: "custom",
                title: "UPDATE",
                html: `<pre id="edexup_out" style="max-height:55vh;overflow:auto;white-space:pre-wrap">Preparing update…</pre>`,
                buttons: []
                // Close is auto-appended; success auto-restarts below.
            }, () => { this.modal = null; });
            const pre = document.getElementById("edexup_out");
            ipc.invoke("system:edex-update", { url, sha256Url }).then(r => {
                if (!pre) return;
                if (r && r.ok) {
                    pre.textContent += "\n✓ Update ready. Restarting eDEX…";
                    setTimeout(() => { remote.app.relaunch(); remote.app.quit(); }, 600);
                } else {
                    let msg = (r && r.error) || "unknown error";
                    if (msg === "NOT_APPIMAGE") msg = "not running from an AppImage — open the release page instead.";
                    if (msg === "SHA256_MISMATCH") msg = "checksum mismatch — the download is corrupt. Try again.";
                    pre.textContent += "\n✗ Update failed: " + msg + ".";
                }
            });
        }
    };
    window.edexUpdate.init();
    ipc.on("edex-update-output", (e, line) => {
        const pre = document.getElementById("edexup_out");
        if (pre && line) pre.textContent += line + "\n";
    });

    // True-fullscreen overlay for a webview: a body-level fixed layer hosting a
    // fresh <webview> for the same URL/partition, so the page can fill the whole
    // screen without touching the in-frame webview. Exit via the floating button
    // (the fullscreen guest swallows keyboard input, so Esc can't reach us).
    window.webViewFullscreen = {
        el: null,
        enter(url, partition) {
            if (!url || this.el) return;
            const el = document.createElement("div");
            el.className = "web_fullscreen";
            const btn = document.createElement("button");
            btn.className = "web_fullscreen_exit";
            btn.title = "Exit fullscreen";
            btn.innerHTML = Icons.close;
            btn.onclick = () => this.exit();
            const wv = document.createElement("webview");
            wv.setAttribute("partition", partition || "persist:edex-browser");
            wv.setAttribute("webpreferences", "contextIsolation=yes, nodeIntegration=no, sandbox=yes");
            wv.setAttribute("allowpopups", "");
            wv.setAttribute("src", url);
            el.appendChild(btn);
            el.appendChild(wv);
            document.body.appendChild(el);
            this.el = el;
        },
        exit() {
            if (!this.el) return;
            this.el.remove();
            this.el = null;
        }
    };

    // Slots 3/4 are not terminals, but a lot of code calls
    // `window.term[currentTerm].fit()/.term.focus()/.write()/...` blindly. A
    // terminal-shaped shim keeps all of that safe: fit/resendCWD/write/
    // clipboard are no-ops, and .term.focus() forwards to the actual webview.
    const makePanelShim = getPanel => ({
        isBrowserTab: true,
        fit() {},
        resendCWD() {},
        write() {},
        writelr() {},
        clipboard: { copy() {}, paste() {}, didCopy: false },
        term: {
            focus() { const p = getPanel(); if (p && p.focus) p.focus(); },
            write() {}, reset() {}, resize() {},
            rows: 24, cols: 80,
            element: null
        },
        onprocesschange: null,
        onclose: null
    });
    window.term[3] = makePanelShim(() => window.appmonitorA);
    window.term[4] = makePanelShim(() => window.appmonitorB);

    // In-browser shortcuts (Ctrl+T/W/L), forwarded from the main process via
    // before-input-event while a BROWSER webview has focus.
    ipc.on("browser-shortcut", (e, key) => {
        if (!window.browser || window.shellSlotKinds[window.currentTerm] !== "browser") return;
        if (key === "t") window.browser.newTab(window.browser.startUrl);
        else if (key === "w") window.browser.closeTab(window.browser.activeId);
        else if (key === "l") window.browser.focusAddressBar();
        else if (key === "f") window.browser.openFind();
        else if (key === "g") window.browser.findNext(false);
        else if (key === "p") window.browser.printPage();
    });

    // window.open / target=_blank from a webview (routed from the main process):
    // browser tabs open a new browser-internal tab, everything else goes external.
    ipc.on("webview-window-open", (e, { url, browser }) => {
        const external = () => { try { require("electron").shell.openExternal(url); } catch (err) {} };
        if (browser && window.browser && /^https?:/i.test(url)) window.browser.newTab(url);
        else external();
    });

    window.updateCheck = new UpdateChecker();

    // First launch: ask for the UI language once, once the interface is up.
    if (!window.settings.language) setTimeout(() => window.showLanguagePicker(), 800);
}

window.themeChanger = theme => {
    ipc.send("setThemeOverride", theme);
    setTimeout(() => {
        window.location.reload(true);
    }, 100);
};

// The on-screen keyboard was replaced by the Cyber Panel - keep this callback
// harmless for any code that still triggers it (e.g. opening a layout file).
window.remakeKeyboard = layout => {
    require("electron").ipcRenderer.send("log", "note", "Keyboard layout is disabled (Cyber Panel is active).");
};

window.focusShellTab = number => {
    window.audioManager.folder.play();
    const kind = window.shellSlotKinds[number] || "term";

    // Toggle the tab-strip <li> active classes.
    document.querySelectorAll(`ul#main_shell_tabs > li:not(:nth-child(${number+1}))`).forEach(e => {
        e.setAttribute("class", "");
    });
    document.getElementById("shell_tab"+number).setAttribute("class", "active");

    // Toggle the content pane active class. The generic child selector covers
    // both the <pre> terminals and the <div> browser/webapp slots.
    document.querySelectorAll(`div#main_shell_innercontainer > *:not(:nth-child(${number+1}))`).forEach(e => {
        e.classList.remove("active");
    });
    const pane = document.querySelector(`div#main_shell_innercontainer > :nth-child(${number+1})`);
    if (pane) pane.classList.add("active");

    if (number === window.currentTerm) {
        // Re-clicking the active tab just re-focuses the panel.
        if (kind === "appmonitor") {
            const p = number === 3 ? window.appmonitorA : window.appmonitorB;
            if (p) p.activate();
        } else if (window.term[number]) window.term[number].term.focus();
        return;
    }

    window.currentTerm = number;

    if (kind === "appmonitor") {
        const p = number === 3 ? window.appmonitorA : window.appmonitorB;
        if (p) p.activate();
    } else if (window.term[number]) {
        window.term[number].fit();
        window.term[number].term.focus();
        window.term[number].resendCWD();

        window.fsDisp.followTab();
    } else if (number > 0 && number <= 4 && window.term[number] !== null && typeof window.term[number] !== "object") {
        window.term[number] = null;

        // Tab 2 is the dedicated Claude Code tab (see the _boot.js ttyspawn handler).
        const isClaudeTab = (number === 2);
        document.getElementById("shell_tab"+number).innerHTML = `<p>${isClaudeTab ? "LAUNCHING" : "LOADING"}...</p>`;
        ipc.send("ttyspawn", isClaudeTab ? "claude" : "term");
        ipc.once("ttyspawn-reply", (e, r) => {
            if (r.startsWith("ERROR")) {
                document.getElementById("shell_tab"+number).innerHTML = "<p>ERROR</p>";
            } else if (r.startsWith("SUCCESS")) {
                let port = Number(r.substr(9));

                window.term[number] = new Terminal({
                    role: "client",
                    parentId: "terminal"+number,
                    port
                });

                window.term[number].onclose = e => {
                    delete window.term[number].onprocesschange;
                    document.getElementById("shell_tab"+number).innerHTML = "<p>" + ((number === 2) ? "CLAUDE" : "EMPTY") + "</p>";
                    document.getElementById("terminal"+number).innerHTML = "";
                    window.term[number].term.dispose();
                    delete window.term[number];
                    window.useAppShortcut("PREVIOUS_TAB");
                };

                window.term[number].onprocesschange = p => {
                    if (window.cover) window.cover.rememberProc(number, p);
                    document.getElementById("shell_tab"+number).innerHTML = `<p>${window.cover ? window.cover.tabLabel(number, p) : `#${number+1} - ${p}`}</p>`;
                };

                document.getElementById("shell_tab"+number).innerHTML = `<p>::${port}</p>`;
                setTimeout(() => {
                    window.focusShellTab(number);
                }, 500);
            }
        });
    }
};

// Settings editor
window.openSettings = async () => {
    if (document.getElementById("settingsEditor")) return;

    // Build the list of available themes (the only remaining dropdown that needs
    // a dynamic option list; monitor/iface rows were removed in the cleanup).
    let themes;
    fs.readdirSync(themesDir).forEach(th => {
        if (!th.endsWith(".json")) return;
        th = th.replace(".json", "");
        if (th === window.settings.theme) return;
        themes += `<option>${th}</option>`;
    });

    // A settings row: label + optional "i" info button (with a hidden help
    // popover) on the left, control on the right. The verbose descriptions used
    // to take a full table column; they are now hidden behind the "i" button.
    const settingsRow = (labelKey, controlHtml, helpKey) => `
        <div class="settings_row">
            <div class="settings_row_label">
                <span>${t(labelKey)}</span>
                ${helpKey ? `<button type="button" class="settings_info_btn" title="${t(helpKey)}">i</button>
                <div class="settings_info_pop">${t(helpKey)}</div>` : ""}
            </div>
            <div class="settings_row_ctl">${controlHtml}</div>
        </div>`;
    const section = key => `<div class="settingsEditor_section">${t(key)}</div>`;

    // Two-pane categories. Every control lives in the DOM at all times (hidden
    // panes are display:none), so setupSettingsDropdowns converts all <select>s
    // exactly once and writeSettingsFile can read every field regardless of
    // which category is visible.
    const CATS = [
        { id: "general", titleKey: "settings.cat.general", html: () => [
            settingsRow("settings.lang.label", `<select id="settingsEditor-language">
                <option value="zh" ${window.settings.language === "zh" ? "selected" : ""}>中文</option>
                <option value="en" ${window.settings.language !== "zh" ? "selected" : ""}>English</option>
            </select>`, "settings.lang.help"),
            settingsRow("settings.username", `<input type="text" id="settingsEditor-username" value="${window.settings.username}">`, "settings.username.help"),
            settingsRow("settings.theme", `<select id="settingsEditor-theme">
                <option>${window.settings.theme}</option>
                ${themes}
            </select>`, "settings.theme.help"),
            settingsRow("settings.termFontSize", `<input type="text" id="settingsEditor-termFontSize" value="${window.settings.termFontSize}">`, "settings.termFontSize.help"),
            settingsRow("settings.clockHours", `<select id="settingsEditor-clockHours">
                <option>${(window.settings.clockHours === 12) ? "12" : "24"}</option>
                <option>${(window.settings.clockHours === 12) ? "24" : "12"}</option>
            </select>`, "settings.clockHours.help"),
            settingsRow("settings.showKeyboard", `<select id="settingsEditor-showKeyboard">
                <option>${window.settings.showKeyboard === true}</option>
                <option>${window.settings.showKeyboard !== true}</option>
            </select>`, "settings.showKeyboard.help"),
        ].join("") },
        { id: "terminal", titleKey: "settings.cat.terminal", html: () => [
            settingsRow("settings.shell", `<input type="text" id="settingsEditor-shell" value="${window.settings.shell}">`, "settings.shell.help"),
        ].join("") },
        { id: "sound", titleKey: "settings.cat.sound", html: () => [
            settingsRow("settings.audio", `<select id="settingsEditor-audio">
                <option>${window.settings.audio}</option>
                <option>${!window.settings.audio}</option>
            </select>`, "settings.audio.help"),
            settingsRow("settings.audioVolume", `<input type="text" id="settingsEditor-audioVolume" value="${window.settings.audioVolume || '1.0'}">`, "settings.audioVolume.help"),
            settingsRow("settings.disableFeedbackAudio", `<select id="settingsEditor-disableFeedbackAudio">
                <option>${window.settings.disableFeedbackAudio}</option>
                <option>${!window.settings.disableFeedbackAudio}</option>
            </select>`, "settings.disableFeedbackAudio.help"),
        ].join("") },
        { id: "display", titleKey: "settings.cat.display", html: () => [
            settingsRow("settings.allowWindowed", `<select id="settingsEditor-allowWindowed">
                <option>${window.settings.allowWindowed}</option>
                <option>${!window.settings.allowWindowed}</option>
            </select>`, "settings.allowWindowed.help"),
            settingsRow("settings.nointro", `<select id="settingsEditor-nointro">
                <option>${window.settings.nointro}</option>
                <option>${!window.settings.nointro}</option>
            </select>`, "settings.nointro.help" + (window.settings.nointroOverride ? t("settings.overridden") : "")),
            settingsRow("settings.nocursor", `<select id="settingsEditor-nocursor">
                <option>${window.settings.nocursor}</option>
                <option>${!window.settings.nocursor}</option>
            </select>`, "settings.nocursor.help" + (window.settings.nocursorOverride ? t("settings.overridden") : "")),
        ].join("") },
        { id: "lock", titleKey: "settings.cat.lock", html: () => [
            settingsRow("settings.screensaverEnabled", `<select id="settingsEditor-screensaverEnabled">
                <option>${window.settings.screensaverEnabled}</option>
                <option>${!window.settings.screensaverEnabled}</option>
            </select>`, "settings.screensaverEnabled.help"),
            settingsRow("settings.screensaverIdle", `<input type="text" id="settingsEditor-screensaverIdle" value="${window.settings.screensaverIdle || 300}">`, "settings.screensaverIdle.help"),
            settingsRow("settings.screensaverStyle", `<select id="settingsEditor-screensaverStyle">
                <option>${window.settings.screensaverStyle || "code"}</option>
                <option>${(window.settings.screensaverStyle === "matrix") ? "code" : "matrix"}</option>
            </select>`, "settings.screensaverStyle.help"),
            section("settings.section.lock"),
            settingsRow("settings.lockCode", `<input type="password" id="settingsEditor-lockCode" autocomplete="off" value="${window.settings.lockCode || '0000'}">`, "settings.lockCode.help"),
            settingsRow("settings.lockOnIdle", `<select id="settingsEditor-lockOnIdle">
                <option>${window.settings.lockOnIdle !== false}</option>
                <option>${window.settings.lockOnIdle === false}</option>
            </select>`, "settings.lockOnIdle.help"),
            settingsRow("settings.bootAnimAfterUnlock", `<select id="settingsEditor-bootAnimAfterUnlock">
                <option>${window.settings.bootAnimAfterUnlock !== false}</option>
                <option>${window.settings.bootAnimAfterUnlock === false}</option>
            </select>`, "settings.bootAnimAfterUnlock.help"),
        ].join("") },
        { id: "apps", titleKey: "settings.cat.apps", html: () => [
            settingsRow("settings.appSort", `<select id="settingsEditor-appSort">
                <option value="name-asc" ${window.settings.appSort === "name-asc" ? "selected" : ""}>${t("settings.appSort.nameAsc")}</option>
                <option value="name-desc" ${window.settings.appSort === "name-desc" ? "selected" : ""}>${t("settings.appSort.nameDesc")}</option>
                <option value="install-asc" ${window.settings.appSort === "install-asc" ? "selected" : ""}>${t("settings.appSort.installAsc")}</option>
                <option value="install-desc" ${window.settings.appSort === "install-desc" ? "selected" : ""}>${t("settings.appSort.installDesc")}</option>
                <option value="freq-asc" ${window.settings.appSort === "freq-asc" ? "selected" : ""}>${t("settings.appSort.freqAsc")}</option>
                <option value="freq-desc" ${window.settings.appSort === "freq-desc" ? "selected" : ""}>${t("settings.appSort.freqDesc")}</option>
            </select>`, "settings.appSort.help"),
            settingsRow("settings.hideDotfiles", `<select id="settingsEditor-hideDotfiles">
                <option>${window.settings.hideDotfiles}</option>
                <option>${!window.settings.hideDotfiles}</option>
            </select>`, "settings.hideDotfiles.help"),
            settingsRow("settings.fsListView", `<select id="settingsEditor-fsListView">
                <option>${window.settings.fsListView}</option>
                <option>${!window.settings.fsListView}</option>
            </select>`, "settings.fsListView.help"),
            section("settings.section.appMonitor"),
            settingsRow("settings.appMonitor.enabled", `<select id="settingsEditor-appMonitor-enabled">
                <option>${(window.settings.appMonitor || {}).enabled !== false}</option>
                <option>${(window.settings.appMonitor || {}).enabled === false}</option>
            </select>`, "settings.appMonitor.enabled.help"),
            settingsRow("settings.appMonitor.mock", `<select id="settingsEditor-appMonitor-mock">
                <option value="auto" ${(window.settings.appMonitor || {}).mock == null ? "selected" : ""}>${t("settings.appMonitor.mock.auto")}</option>
                <option value="true" ${(window.settings.appMonitor || {}).mock === true ? "selected" : ""}>${t("settings.appMonitor.mock.mock")}</option>
                <option value="false" ${(window.settings.appMonitor || {}).mock === false ? "selected" : ""}>${t("settings.appMonitor.mock.real")}</option>
            </select>`, "settings.appMonitor.mock.help"),
            settingsRow("settings.appMonitor.appImageDirs", `<input type="text" id="settingsEditor-appMonitor-appImageDirs" value="${(window.settings.appMonitor || {}).appImageDirs || ''}">`, "settings.appMonitor.appImageDirs.help"),
        ].join("") },
        { id: "claude", titleKey: "settings.cat.claude", html: () => [
            section("settings.section.claude"),
            settingsRow("settings.claude.enabled", `<select id="settingsEditor-claude-enabled">
                <option>${(window.settings.claude || {}).enabled}</option>
                <option>${!(window.settings.claude || {}).enabled}</option>
            </select>`, "settings.claude.enabled.help"),
            settingsRow("settings.claude.baseUrl", `<input type="text" id="settingsEditor-claude-baseUrl" value="${(window.settings.claude || {}).baseUrl || ''}">`, "settings.claude.baseUrl.help"),
            settingsRow("settings.claude.apiKey", `<input type="password" id="settingsEditor-claude-apiKey" autocomplete="off" value="${(window.settings.claude || {}).apiKey || ''}">`, "settings.claude.apiKey.help"),
            settingsRow("settings.claude.model", `<input type="text" id="settingsEditor-claude-model" value="${(window.settings.claude || {}).model || ''}">`, "settings.claude.model.help"),
            settingsRow("settings.claude.haikuModel", `<input type="text" id="settingsEditor-claude-haikuModel" value="${(window.settings.claude || {}).haikuModel || ''}">`, "settings.claude.haikuModel.help"),
            section("settings.section.claudeNote"),
        ].join("") },
    ];

    // Remember the language the editor was opened in, so a change can re-open
    // the dialog in the new language (see writeSettingsFile). Note: `new Modal`
    // returns the Modal INSTANCE (class constructors ignore `return this.id`),
    // so keep the instance and address window.modals via its `.id`.
    window._settingsOpenLang = window.settings.language;
    const settingsModal = new Modal({
        type: "custom",
        closeLabel: t("settings.close"),
        title: `${t("settings.title")} <i>(v${remote.app.getVersion()})</i>`,
        html: `<div id="settingsBody">
                    <div id="settingsSide">
                        ${CATS.map((c, i) => `<button type="button" class="settings_cat_btn${i === 0 ? " active" : ""}" data-cat="${c.id}">${t(c.titleKey)}</button>`).join("")}
                    </div>
                    <div id="settingsEditor">
                        ${CATS.map((c, i) => `<div class="settings_cat${i === 0 ? " active" : ""}" data-cat="${c.id}">${c.html()}</div>`).join("")}
                    </div>
                </div>
                <h6 id="settingsEditorStatus">${t("settings.loadedStatus")}</h6>`,
        buttons: [
            {label: t("settings.btn.openExternal"), action:`electron.shell.openPath('${settingsFile}');electronWin.minimize();`},
            {label: t("settings.btn.save"), action: "window.writeSettingsFile()"},
            {label: t("settings.btn.shortcuts"), action: "window.openShortcutsHelp()"},
            {label: t("settings.btn.wifi"), action: "window.wifiPanel.open()"},
            {label: t("settings.btn.lock"), action: "window.lockScreen.show()"},
            {label: t("settings.btn.update"), action: "window.systemUpdate.open()"},
            {label: t("settings.btn.screensaver"), action: "window.modals[Object.keys(window.modals).pop()].close(); setTimeout(() => window.screensaver.show(), 150);"},
            {label: t("settings.btn.reload"), action: "window.location.reload(true);"},
            {label: t("settings.btn.restart"), action: "remote.app.relaunch();remote.app.quit();"}
        ]
    }, () => {
        // Modal closed: drop the key listener, then focus back on the term.
        if (window._settingsKeyHandler) {
            document.removeEventListener("keydown", window._settingsKeyHandler);
            window._settingsKeyHandler = null;
        }
        window.term[window.currentTerm].term.focus();
    });
    window._settingsModal = settingsModal;

    // Sidebar category switching: clicking a button shows its pane and hides the
    // others (the panes themselves stay in the DOM, see the CATS comment above).
    const activateCategory = btn => {
        const cat = btn.dataset.cat;
        document.querySelectorAll("#settingsSide .settings_cat_btn").forEach(b => b.classList.toggle("active", b === btn));
        document.querySelectorAll("#settingsEditor .settings_cat").forEach(p => p.classList.toggle("active", p.dataset.cat === cat));
    };
    document.querySelectorAll("#settingsSide .settings_cat_btn").forEach(btn => {
        btn.addEventListener("click", () => activateCategory(btn));
    });

    // "i" info buttons toggle their sibling help popover (bound once per page).
    if (!window._settingsInfoBound) {
        window._settingsInfoBound = true;
        document.addEventListener("click", e => {
            const btn = e.target.closest ? e.target.closest(".settings_info_btn") : null;
            if (btn) {
                const pop = btn.parentElement.querySelector(".settings_info_pop");
                if (pop) pop.classList.toggle("open");
            } else if (!(e.target.closest && e.target.closest(".settings_info_pop"))) {
                document.querySelectorAll("#settingsEditor .settings_info_pop.open").forEach(p => p.classList.remove("open"));
            }
        });
    }

    // The Modal class has no built-in Esc handling, so add our own keydown
    // listener (removed in the close callback above). ↑/↓ move the category
    // highlight, Enter opens it, Esc closes the dialog — but never hijack
    // arrows while an input/dropdown has focus.
    window._settingsKeyHandler = e => {
        const m = window._settingsModal;
        if (!m || !m.id || !window.modals[m.id]) return;
        if (e.key === "Escape") { e.preventDefault(); window.modals[m.id].close(); return; }
        const ae = document.activeElement;
        const editable = ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.tagName === "SELECT"
            || (ae.closest && ae.closest(".mod_loc_dd, .settings_dd")));
        if (editable && (e.key === "ArrowUp" || e.key === "ArrowDown")) return;
        if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            const btns = Array.from(document.querySelectorAll("#settingsSide .settings_cat_btn"));
            if (!btns.length) return;
            const cur = btns.indexOf(document.activeElement);
            const next = e.key === "ArrowDown"
                ? (cur < 0 ? 0 : (cur + 1) % btns.length)
                : (cur < 0 ? btns.length - 1 : (cur - 1 + btns.length) % btns.length);
            btns[next].focus();
        } else if (e.key === "Enter") {
            const btn = ae && ae.closest ? ae.closest(".settings_cat_btn") : null;
            if (btn) { e.preventDefault(); activateCategory(btn); }
        }
    };
    document.addEventListener("keydown", window._settingsKeyHandler);

    // Native <select> popups do not render well in this fullscreen HUD, so swap
    // them for theme-styled custom dropdowns once the modal is in the DOM. Focus
    // the active category button so the keyboard can drive the sidebar.
    setTimeout(() => {
        window.setupSettingsDropdowns();
        const active = document.querySelector("#settingsSide .settings_cat_btn.active");
        if (active) active.focus();
    }, 50);
};

// Convert every native <select> in the settings editor into a theme-styled
// custom dropdown. A hidden <input> keeps the original id and current value, so
// the save code that reads `document.getElementById("settingsEditor-X").value`
// keeps working unchanged.
window.setupSettingsDropdowns = () => {
    document.querySelectorAll("#settingsEditor select").forEach(sel => {
        let wrap = document.createElement("div");
        wrap.className = "mod_loc_dd settings_dd";
        wrap.innerHTML = `
            <button type="button" class="mod_loc_btn"></button>
            <div class="mod_loc_list"></div>
            <input type="hidden" id="${sel.id}" value="">`;

        let input = wrap.querySelector("input");
        let btn = wrap.querySelector("button");
        let list = wrap.querySelector(".mod_loc_list");
        // Each option keeps its VALUE (the persisted string) and displays its
        // TEXT. Value-attribute selects (language, appSort, appMonitor-mock)
        // must persist the `value`, not the visible label — e.g. the language
        // dropdown shows "中文" but saves "zh".
        let options = Array.from(sel.options).map(o => ({ value: o.value, text: o.text }));
        let isBool = options.length === 2 && options.every(o => o.value === "true" || o.value === "false");
        let label = v => (isBool ? (v === "true" ? "TRUE" : "FALSE") : v);
        let show = o => (isBool ? label(o.value) : o.text);
        let value = sel.value;

        let render = () => {
            let cur = options.find(o => o.value === value) || { value, text: value };
            btn.textContent = show(cur);
            list.innerHTML = "";
            options.forEach(o => {
                let d = document.createElement("div");
                d.className = "mod_loc_opt" + (o.value === value ? " mod_loc_opt_active" : "");
                d.dataset.value = o.value;
                d.textContent = show(o);
                list.appendChild(d);
            });
        };
        let setValue = v => { value = v; input.value = v; render(); };

        btn.addEventListener("click", e => {
            e.stopPropagation();
            let isOpen = !list.classList.contains("mod_loc_open");
            document.querySelectorAll("#settingsEditor .mod_loc_list.mod_loc_open").forEach(l => l.classList.remove("mod_loc_open"));
            list.classList.toggle("mod_loc_open", isOpen);
            if (isOpen) {
                let active = list.querySelector(".mod_loc_opt_active");
                if (active) active.scrollIntoView({ block: "nearest" });
            }
        });
        list.addEventListener("click", e => {
            let opt = e.target.closest(".mod_loc_opt");
            if (!opt) return;
            e.stopPropagation();
            setValue(opt.dataset.value);
            list.classList.remove("mod_loc_open");
        });

        setValue(sel.value);
        sel.replaceWith(wrap);
    });

    // Close any open settings dropdown when clicking outside them (bound once)
    if (!window._settingsDropdownCloseBound) {
        window._settingsDropdownCloseBound = true;
        document.addEventListener("click", e => {
            if (e.target.closest && e.target.closest(".settings_dd")) return;
            document.querySelectorAll("#settingsEditor .mod_loc_list.mod_loc_open").forEach(l => l.classList.remove("mod_loc_open"));
        });
    }
};

window.writeFile = (path) => {
    fs.writeFile(path, document.getElementById("fileEdit").value, "utf-8", () => {
        document.getElementById("fedit-status").innerHTML = "<i>File saved.</i>";
    });
};

window.writeSettingsFile = () => {
    // MERGE into the in-memory settings instead of rebuilding them from the form:
    // rebuilding used to silently drop every key without a form control (webapps,
    // weatherLocation, and the settings removed from the UI: port, pingAddr,
    // iface, monitor, keepGeometry, …). Those are still editable via the "open
    // in external editor" button, so they must survive a save.
    const s = Object.assign({}, window.settings);
    s.shell = document.getElementById("settingsEditor-shell").value;
    s.username = document.getElementById("settingsEditor-username").value;
    s.theme = document.getElementById("settingsEditor-theme").value;
    s.termFontSize = Number(document.getElementById("settingsEditor-termFontSize").value);
    s.audio = (document.getElementById("settingsEditor-audio").value === "true");
    s.audioVolume = Number(document.getElementById("settingsEditor-audioVolume").value);
    s.disableFeedbackAudio = (document.getElementById("settingsEditor-disableFeedbackAudio").value === "true");
    s.clockHours = Number(document.getElementById("settingsEditor-clockHours").value);
    s.nointro = (document.getElementById("settingsEditor-nointro").value === "true");
    s.nocursor = (document.getElementById("settingsEditor-nocursor").value === "true");
    s.allowWindowed = (document.getElementById("settingsEditor-allowWindowed").value === "true");
    s.hideDotfiles = (document.getElementById("settingsEditor-hideDotfiles").value === "true");
    s.fsListView = (document.getElementById("settingsEditor-fsListView").value === "true");
    s.screensaverEnabled = (document.getElementById("settingsEditor-screensaverEnabled").value === "true");
    s.screensaverIdle = Number(document.getElementById("settingsEditor-screensaverIdle").value);
    s.screensaverStyle = document.getElementById("settingsEditor-screensaverStyle").value;
    s.lockCode = document.getElementById("settingsEditor-lockCode").value;
    s.lockOnIdle = (document.getElementById("settingsEditor-lockOnIdle").value === "true");
    s.showKeyboard = (document.getElementById("settingsEditor-showKeyboard").value === "true");
    s.bootAnimAfterUnlock = (document.getElementById("settingsEditor-bootAnimAfterUnlock").value === "true");
    s.appSort = document.getElementById("settingsEditor-appSort").value;
    s.language = document.getElementById("settingsEditor-language").value;
    s.claude = {
        enabled: (document.getElementById("settingsEditor-claude-enabled").value === "true"),
        baseUrl: document.getElementById("settingsEditor-claude-baseUrl").value,
        apiKey: document.getElementById("settingsEditor-claude-apiKey").value,
        model: document.getElementById("settingsEditor-claude-model").value,
        haikuModel: document.getElementById("settingsEditor-claude-haikuModel").value
    };
    s.appMonitor = {
        enabled: (document.getElementById("settingsEditor-appMonitor-enabled").value === "true"),
        mock: document.getElementById("settingsEditor-appMonitor-mock").value === "auto"
            ? null
            : (document.getElementById("settingsEditor-appMonitor-mock").value === "true"),
        appImageDirs: document.getElementById("settingsEditor-appMonitor-appImageDirs").value
    };

    Object.keys(s).forEach(key => {
        if (s[key] === "undefined") {
            delete s[key];
        }
    });

    window.settings = s;
    fs.writeFileSync(settingsFile, JSON.stringify(s, "", 4));
    document.getElementById("settingsEditorStatus").innerText = t("settings.savedStatus")+new Date().toTimeString();

    // A language change re-opens the dialog in the new language (no full reload,
    // so the boot animation does not replay).
    if (window._settingsOpenLang && window._settingsOpenLang !== window.settings.language) {
        const m = window._settingsModal;
        if (m && m.id && window.modals[m.id]) {
            window.modals[m.id].close();
            setTimeout(() => window.openSettings(), 160);
        }
    }
};

// First-launch language choice (also reachable from the language dropdown's
// English/中文 values). Persists to settings.json; the rest of the UI stays
// English, so no page reload is needed — just close the bilingual picker.
window.setLanguage = lang => {
    if (lang !== "zh" && lang !== "en") return;
    window.settings.language = lang;
    fs.writeFileSync(settingsFile, JSON.stringify(window.settings, "", 4));
    if (window._langPicker && window._langPicker.id && window.modals[window._langPicker.id]) {
        window.modals[window._langPicker.id].close();
        window._langPicker = null;
    }
};

window.showLanguagePicker = () => {
    if (window.settings.language) return;
    if (window._langPicker && window._langPicker.id && window.modals[window._langPicker.id]) return;
    window._langPicker = new Modal({
        type: "custom",
        title: "Select language / 选择语言",
        closeLabel: "Close / 关闭",
        html: `<p style="margin:0 0 1.2vh">The interface stays English — this picks the language of the settings menu.<br>其余界面保持英文——此处选择设置菜单的语言。</p>`,
        buttons: [
            {label: "中文", action: "window.setLanguage('zh')"},
            {label: "English", action: "window.setLanguage('en')"}
        ]
    });
};

window.toggleFullScreen = () => {
    let useFullscreen = (electronWin.isFullScreen() ? false : true);
    electronWin.setFullScreen(useFullscreen);

    //Update settings
    window.lastWindowState["useFullscreen"] = useFullscreen;

    fs.writeFileSync(lastWindowStateFile, JSON.stringify(window.lastWindowState, "", 4));
};

// Display available keyboard shortcuts and custom shortcuts helper
window.openShortcutsHelp = () => {
    // Avoid duplicate shortcuts modals (may stack on top of the settings editor)
    if (document.getElementById("shortcutsHelpAccordeon1")) return;

    const shortcutsDefinition = {
        "COPY": t("shortcuts.copy"),
        "PASTE": t("shortcuts.paste"),
        "NEXT_TAB": t("shortcuts.nextTab"),
        "PREVIOUS_TAB": t("shortcuts.prevTab"),
        "TAB_X": t("shortcuts.tabX"),
        "SETTINGS": t("shortcuts.settings"),
        "SHORTCUTS": t("shortcuts.shortcuts"),
        "FUZZY_SEARCH": t("shortcuts.fuzzySearch"),
        "FS_LIST_VIEW": t("shortcuts.fsListView"),
        "FS_DOTFILES": t("shortcuts.fsDotfiles"),
        "DEV_DEBUG": t("shortcuts.devDebug"),
        "DEV_RELOAD": t("shortcuts.devReload")
    };

    let appList = "";
    window.shortcuts.filter(e => e.type === "app").forEach(cut => {
        let action = (cut.action.startsWith("TAB_")) ? "TAB_X" : cut.action;

        appList += `<tr>
                        <td>${(cut.enabled) ? t("shortcuts.yes") : t("shortcuts.no")}</td>
                        <td><input disabled type="text" maxlength=25 value="${cut.trigger}"></td>
                        <td>${shortcutsDefinition[action]}</td>
                    </tr>`;
    });

    let customList = "";
    window.shortcuts.filter(e => e.type === "shell").forEach(cut => {
        customList += `<tr>
                            <td>${(cut.enabled) ? t("shortcuts.yes") : t("shortcuts.no")}</td>
                            <td><input disabled type="text" maxlength=25 value="${cut.trigger}"></td>
                            <td>
                                <input disabled type="text" placeholder="${t("shortcuts.cmdPlaceholder")}" value="${cut.action}">
                                <input disabled type="checkbox" name="shortcutsHelpNew_Enter" ${(cut.linebreak) ? 'checked' : ''}>
                                <label for="shortcutsHelpNew_Enter">Enter</label>
                            </td>
                        </tr>`;
    });

    new Modal({
        type: "custom",
        title: `${t("shortcuts.title")} <i>(v${remote.app.getVersion()})</i>`,
        html: `<h5>${t("shortcuts.intro")}</h5>
                <details open id="shortcutsHelpAccordeon1">
                    <summary>${t("shortcuts.simulator")}</summary>
                    <table class="shortcutsHelp">
                        <tr>
                            <th>${t("shortcuts.th.enabled")}</th>
                            <th>${t("shortcuts.th.shortcut")}</th>
                            <th>${t("shortcuts.th.action")}</th>
                        </tr>
                        ${appList}
                    </table>
                </details>
                <br>
                <details id="shortcutsHelpAccordeon2">
                    <summary>${t("shortcuts.custom")}</summary>
                    <table class="shortcutsHelp">
                        <tr>
                            <th>${t("shortcuts.th.enabled")}</th>
                            <th>${t("shortcuts.th.shortcut")}</th>
                            <th>${t("shortcuts.th.command")}</th>
                        <tr>
                       ${customList}
                    </table>
                </details>
                <br>`,
        buttons: [
            {label: t("shortcuts.btn.openFile"), action:`electron.shell.openPath('${shortcutsFile}');electronWin.minimize();`},
            {label: t("shortcuts.btn.reload"), action: "window.location.reload(true);"},
        ]
    }, () => {
        window.term[window.currentTerm].term.focus();
    });

    let wrap1 = document.getElementById('shortcutsHelpAccordeon1');
    let wrap2 = document.getElementById('shortcutsHelpAccordeon2');

    wrap1.addEventListener('toggle', e => {
        wrap2.open = !wrap1.open;
    });

    wrap2.addEventListener('toggle', e => {
        wrap1.open = !wrap2.open;
    });
};

window.useAppShortcut = action => {
    switch(action) {
        case "COPY":
            window.term[window.currentTerm].clipboard.copy();
            return true;
        case "PASTE":
            window.term[window.currentTerm].clipboard.paste();
            return true;
        case "NEXT_TAB":
                if (window.term[window.currentTerm+1]) {
                    window.focusShellTab(window.currentTerm+1);
                } else if (window.term[window.currentTerm+2]) {
                    window.focusShellTab(window.currentTerm+2);
                } else if (window.term[window.currentTerm+3]) {
                    window.focusShellTab(window.currentTerm+3);
                } else if (window.term[window.currentTerm+4]) {
                    window.focusShellTab(window.currentTerm+4);
                } else {
                    window.focusShellTab(0);
                }
            return true;
        case "PREVIOUS_TAB":
                let i = window.currentTerm || 4;
                if (window.term[i] && i !== window.currentTerm) {
                    window.focusShellTab(i);
                } else if (window.term[i-1]) {
                    window.focusShellTab(i-1);
                } else if (window.term[i-2]) {
                    window.focusShellTab(i-2);
                } else if (window.term[i-3]) {
                    window.focusShellTab(i-3);
                } else if (window.term[i-4]) {
                    window.focusShellTab(i-4);
                }
            return true;
        case "TAB_1":
            window.focusShellTab(0);
            return true;
        case "TAB_2":
            window.focusShellTab(1);
            return true;
        case "TAB_3":
            window.focusShellTab(2);
            return true;
        case "TAB_4":
            window.focusShellTab(3);
            return true;
        case "TAB_5":
            window.focusShellTab(4);
            return true;
        case "SETTINGS":
            window.openSettings();
            return true;
        case "SHORTCUTS":
            window.openShortcutsHelp();
            return true;
        case "FUZZY_SEARCH":
            window.activeFuzzyFinder = new FuzzyFinder();
            return true;
        case "FS_LIST_VIEW":
            window.fsDisp.toggleListview();
            return true;
        case "FS_DOTFILES":
            window.fsDisp.toggleHidedotfiles();
            return true;
        case "DEV_DEBUG":
            if (window.shellSlotKinds[window.currentTerm] === "appmonitor") {
                const p = window.currentTerm === 3 ? window.appmonitorA : window.appmonitorB;
                if (p) p.toggleDevTools();
            } else remote.getCurrentWindow().webContents.toggleDevTools();
            return true;
        case "DEV_RELOAD":
            window.location.reload(true);
            return true;
        default:
            console.warn(`Unknown "${action}" app shortcut action`);
            return false;
    }
};

// Global keyboard shortcuts
const globalShortcut = remote.globalShortcut;
globalShortcut.unregisterAll();

window.registerKeyboardShortcuts = () => {
    window.shortcuts.forEach(cut => {
        if (!cut.enabled) return;

        if (cut.type === "app") {
            if (cut.action === "TAB_X") {
                for (let i = 1; i <= 5; i++) {
                    let trigger = cut.trigger.replace("X", i);
                    let dfn = () => { window.useAppShortcut(`TAB_${i}`) };
                    globalShortcut.register(trigger, dfn);
                }
            } else {
                globalShortcut.register(cut.trigger, () => {
                    window.useAppShortcut(cut.action);
                });
            }
        } else if (cut.type === "shell") {
            globalShortcut.register(cut.trigger, () => {
                let fn = (cut.linebreak) ? "writelr" : "write";
                window.term[window.currentTerm][fn](cut.action);
            });
        } else {
            console.warn(`${cut.trigger} has unknown type`);
        }
    });
};
window.registerKeyboardShortcuts();

// See #361
window.addEventListener("focus", () => {
    window.registerKeyboardShortcuts();
});

window.addEventListener("blur", () => {
    globalShortcut.unregisterAll();
});

// Prevent showing menu, exiting fullscreen or app with keyboard shortcuts
document.addEventListener("keydown", e => {
    if (e.key === "Alt") {
        e.preventDefault();
    }
    if (e.code.startsWith("Alt") && e.ctrlKey && e.shiftKey) {
        e.preventDefault();
    }
    if (e.key === "F11" && !settings.allowWindowed) {
        e.preventDefault();
    }
    // Let Ctrl+A / Ctrl+D behave normally while the browser's address bar (or
    // any input) is focused - select-all and bookmark shortcuts belong there.
    const isInputFocused = document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
    if (e.code === "KeyD" && e.ctrlKey && !isInputFocused) {
        e.preventDefault();
    }
    if (e.code === "KeyA" && e.ctrlKey && !isInputFocused) {
        e.preventDefault();
    }
});

// Fix #265
window.addEventListener("keyup", e => {
    if (require("os").platform() === "win32" && e.key === "F4" && e.altKey === true) {
        remote.app.quit();
    }
});

// Fix double-tap zoom on touchscreens
electron.webFrame.setVisualZoomLevelLimits(1, 1);

// Resize terminal with window
window.onresize = () => {
    if (typeof window.currentTerm !== "undefined") {
        if (typeof window.term[window.currentTerm] !== "undefined") {
            window.term[window.currentTerm].fit();
        }
    }
};

// See #413
window.resizeTimeout = null;
let electronWin = remote.getCurrentWindow();
electronWin.on("resize", () => {
    if (settings.keepGeometry === false) return;
    clearTimeout(window.resizeTimeout);
    window.resizeTimeout = setTimeout(() => {
        let win = remote.getCurrentWindow();
        if (win.isFullScreen()) return false;
        if (win.isMaximized()) {
            win.unmaximize();
            win.setFullScreen(true);
            return false;
        }

        let size = win.getSize();

        if (size[0] >= size[1]) {
            win.setSize(size[0], parseInt(size[0] * 9 / 16));
        } else {
            win.setSize(size[1], parseInt(size[1] * 9 / 16));
        }
    }, 100);
});

electronWin.on("leave-full-screen", () => {
    remote.getCurrentWindow().setSize(960, 540);
});

// Replay the eDEX startup animation (boot log + logo) from a black screen,
// used when waking the Matrix screensaver - feels like relaunching the app.
function replayBoot() {
    let bootScreen = document.getElementById("boot_screen");
    if (!bootScreen) {
        bootScreen = document.createElement("section");
        bootScreen.setAttribute("id", "boot_screen");
        document.body.appendChild(bootScreen);
    }
    bootScreen.setAttribute("style", "z-index: 9999999; background: #05080d;");
    bootScreen.setAttribute("class", "");
    bootScreen.innerHTML = "";
    document.body.setAttribute("class", "solidBackground");
    i = 0;
    window._replayUI = true; // after the logo, re-run the panel entrance
    displayLine();
}

// Re-run the module entrance animation so the panels "load" like a fresh boot,
// WITHOUT recreating anything - terminals keep running and the file browser
// keeps its current directory.
function reRevealUI() {
    window._replayUI = false;
    // hide everything, then re-run the entrances
    document.querySelectorAll(".mod_column > div").forEach(d => {
        d.style.animation = "none";
        d.style.opacity = "0";
    });
    void (document.getElementById("mod_column_left") || document.body).offsetWidth; // reflow
    let divs = [...document.querySelectorAll(".mod_column > div")];
    divs.forEach(d => { d.style.animation = ""; d.style.opacity = ""; });
    let idx = 0;
    let x = setInterval(() => {
        if (idx >= divs.length) { clearInterval(x); return; }
        if (divs[idx]) divs[idx].style.animationPlayState = "running";
        idx++;
    }, 400);
    cyberEntrance();
}

// Reveal the cyber panel (DATA STREAM) + radar elements one by one, then the
// outer frame (border) fades in last.
function cyberEntrance() {
    // Both the panel and the (sibling) radar were kept at opacity:0 during the
    // boot welcome so their frames did not pop out prematurely - reveal them
    // now that the greeting is over, then stage the inner elements one by one.
    let cp = document.getElementById("cyber_panel");
    if (cp) cp.setAttribute("style", "");
    let rr = document.getElementById("cyber_radar");
    if (rr) rr.style.opacity = "1";
    let items = document.querySelectorAll(
        "#cyber_wave_wrap, #cyber_bars, #cyber_extra, #cyber_log, #cyber_radar_canvas_wrap, #cyber_radar_data"
    );
    items.forEach(el => { el.style.opacity = "0"; el.style.animationPlayState = "paused"; });
    let list = [...items];
    let n = 0;
    let t = setInterval(() => {
        if (n >= list.length) {
            clearInterval(t);
            // all content is in - now show the outer frame
            ["cyber_panel", "cyber_radar"].forEach(id => {
                let el = document.getElementById(id);
                if (el) el.style.setProperty("--aug-border-opacity", "0.35");
            });
            return;
        }
        let el = list[n];
        if (el) { el.style.opacity = ""; el.style.animationPlayState = "running"; }
        n++;
    }, 250);
}

// ---- Hacker-style screensaver ----
// After `screensaverIdle` seconds without any input a screensaver plays in the
// terminal area (not the whole screen); any mouse/keyboard activity dismisses
// it. Two styles selectable in settings:
//   "code"   - scrolling fake "code" written to the xterm buffer (term.write(),
//              nothing sent to the shell - light on CPU)
//   "matrix" - Matrix-rain canvas, fullscreen
window.screensaver = (() => {
    let active = false;

    // ---- code style (hacktyper-style: streams procedurally generated source
    // code so it never visibly repeats - brace depth and indentation stay
    // coherent for a premium, "real code" look) ----
    let codeTimer = null;
    const pick = a => a[Math.floor(Math.random() * a.length)];
    const R = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo));
    // Appearance over rigour: generate the LOOK of a real scientific codebase -
    // long signatures, long physics formulas, long explanatory comments. Each
    // "file" is one whole program (related functions + a main() that calls
    // them), streamed line-by-line with no bursts, so the code never seems to
    // "jump" to something unrelated.
    const pad = n => "    ".repeat(Math.max(0, n));
    const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
    const GENWORDS = ["state", "vector", "matrix", "delta", "alpha", "beta", "gamma", "coef", "rate", "factor", "index", "buffer", "sample", "offset", "scale", "bound", "residual", "kernel"];
    const SCENARIOS = {
        ballistic: {
            nouns: ["apogee", "reentry", "trajectory", "overpressure", "impact", "fallout", "yield", "thrust", "azimuth", "elevation", "payload", "warhead"],
            verbs: ["compute", "predict", "integrate", "estimate", "assess", "trace", "solve", "model"],
            note: "three-stage ballistic trajectory and yield model"
        },
        radar: {
            nouns: ["track", "doppler", "beam", "clutter", "range_rate", "cross_section", "azimuth", "elevation", "signal", "noise_floor", "coherence"],
            verbs: ["update", "init", "detect", "fuse", "coast", "handoff", "filter", "gate"],
            note: "phased-array tracking and CFAR detection"
        },
        emp: {
            nouns: ["coupling", "surge", "attenuation", "resonance", "hardening", "induction", "shield", "cable", "impedance", "skin_depth"],
            verbs: ["compute", "estimate", "assess", "model", "verify", "sweep", "clamp", "measure"],
            note: "HEMP coupling and circuit hardening"
        },
        winter: {
            nouns: ["aerosol", "optical_depth", "insolation", "temperature_drop", "settling", "stratosphere", "soot", "albedo", "tau", "forcing"],
            verbs: ["inject", "evolve", "transport", "project", "compute", "estimate", "advect", "scatter"],
            note: "stratospheric aerosol transport and forcing"
        },
        uplink: {
            nouns: ["downlink", "carrier", "parity", "ack", "retransmit", "jitter", "sync", "throughput", "channel", "latency"],
            verbs: ["encrypt", "decode", "verify", "resync", "throttle", "buffer", "handshake", "route"],
            note: "deep-space uplink and forward error correction"
        },
        recon: {
            nouns: ["signature", "sweep", "footprint", "spectrum", "return", "masking", "baseline", "resolution", "aperture", "phase"],
            verbs: ["scan", "classify", "normalize", "correlate", "lock", "descope", "triangulate", "confirm"],
            note: "orbital reconnaissance and signature analysis"
        }
    };

    // Each file is generated fresh from the scenario word pools, so the stream
    // never visibly repeats: function names, constants, expressions and
    // comments are all assembled at file start.
    let cur = null; // { S, file, funcs, consts }
    const makeConst = () => {
        const name = varName().toUpperCase();
        const t = Math.floor(Math.random() * 4);
        const val = t === 0 ? R(1, 9) + "." + R(0, 9) + "e" + (Math.random() < 0.5 ? "+" : "-") + R(1, 9)
            : t === 1 ? (Math.random() * 1000).toFixed(3)
            : t === 2 ? String(R(10, 9999))
            : (Math.random() * 10).toFixed(1);
        return [name, val];
    };
    const beginFile = () => {
        const S = pick(Object.keys(SCENARIOS).map(k => SCENARIOS[k]));
        // Provisional entry so makeConst/varName (which read cur.S) can run
        // while the rest of the file is assembled; replaced below.
        cur = { S, file: "", funcs: [], consts: [] };
        const funcs = [];
        const seen = new Set();
        for (let n = R(6, 9); funcs.length < n;) {
            const f = pick(S.verbs) + "_" + pick(S.nouns);
            if (!seen.has(f)) { seen.add(f); funcs.push(f); }
        }
        const consts = [];
        for (let i = 0, n = R(4, 6); i < n; i++) consts.push(makeConst());
        const file = pick(S.verbs) + "_" + pick(S.nouns) + (Math.random() < 0.4 ? "_" + R(2, 9) : "") + ".cpp";
        cur = { S, file, funcs, consts };
    };
    const varName = () => pick(cur.S.nouns.concat(GENWORDS)) + (Math.random() < 0.4 ? "_" + R(0, 100) : "");
    const num = () => {
        const t = Math.floor(Math.random() * 4);
        if (t === 0) return String(R(1, 999));
        if (t === 1) return (Math.random() * 100).toFixed(2);
        if (t === 2) return R(1, 9) + "." + R(0, 9) + "e" + (Math.random() < 0.5 ? "+" : "-") + R(1, 8);
        return (Math.random() * 10).toFixed(1);
    };
    const E = () => {
        const a = varName(), b = varName();
        const t = Math.floor(Math.random() * 9);
        if (t === 0) return a + " * " + b + " + " + num();
        if (t === 1) return "(" + a + " + " + b + ") * " + num();
        if (t === 2) return a + " / (" + b + " + " + num() + ")";
        if (t === 3) return "sqrt(" + a + " * " + a + " + " + b + " * " + b + ")";
        if (t === 4) return a + " * " + b + " * " + num();
        if (t === 5) return "fmax(" + a + ", " + b + " * " + num() + ")";
        if (t === 6) return "pow(" + a + ", " + num() + ") + " + b;
        if (t === 7) return "sin(" + a + " * " + num() + ") * " + b;
        return a + " * " + num() + " - " + b;
    };
    const C = () => {
        const a = pick(cur.S.nouns), b = pick(cur.S.nouns), c = pick(cur.S.nouns);
        const t = Math.floor(Math.random() * 7);
        if (t === 0) return "Recompute the " + a + " from the current " + b + " state and the residual " + c + " history.";
        if (t === 1) return "Bound the " + a + " against the worst-case " + b + " transient seen at the " + c + " boundary.";
        if (t === 2) return "The " + a + " scales with the cube root of the " + b + ", attenuated by the " + c + " factor.";
        if (t === 3) return "Integrate the " + a + " with an RK4 step and the " + b + " fixed at the " + c + " timestep.";
        if (t === 4) return "Reject returns below the " + a + " threshold and keep the " + b + " rate bounded across the " + c + ".";
        if (t === 5) return "Cache the " + a + " across calls to avoid recomputing the " + b + " on every " + c + " update.";
        return "The " + a + " dominates once the " + b + " exceeds the " + c + " reference, so clamp early.";
    };
    const SIGS = [
        "const SimConfig& cfg, const StateVector& s, double dt, int mode",
        "const TrackState& t, const Measurement& m, const Matrix& Q, const Matrix& R",
        "double target_range, double target_velocity, double elevation, int mode, bool strict",
        "const Config& cfg, const array<double, 6>& state, double t0, double t1, double eps"
    ];
    const OP = ["<", ">", "<=", ">=", "=="];
    const EARTH_BLOB = [
        'const char* wgs84 = "a=6378137.0, f=1/298.257223563, omega=7.292115e-5, GM=3.986004418e14";',
        "const double T_REF = 288.15; // ISA sea-level static temperature, K",
        "constexpr size_t BUF_LEN = 1 << 20; // staging ring buffer",
        "const uint32_t MAGIC = 0x5a4f4e45; // little-endian frame marker"
    ];

    const buildFunction = (name) => {
        const lines = [];
        lines.push(pad(0) + pick(["double ", "static double ", "float ", "double "]) + name + "(" + pick(SIGS) + ") {");
        lines.push(pad(1) + "double result = " + E() + " + " + E() + ";");
        const locals = [];
        for (let i = 0, n = R(2, 4); i < n; i++) {
            const lv = varName();
            locals.push(lv);
            lines.push(pad(1) + "const double " + lv + " = " + E() + " + " + E() + ";");
        }
        const use = () => pick(locals);
        for (let i = 0, n = R(8, 12); i < n; i++) {
            const t = Math.random();
            if (t < 0.26) lines.push(pad(1) + "result += " + use() + " * " + E() + " + " + E() + ";");
            else if (t < 0.46) lines.push(pad(1) + "// " + C());
            else if (t < 0.60) {
                lines.push(pad(1) + "if (" + use() + " " + pick(OP) + " " + E() + " + " + E() + ") {");
                lines.push(pad(2) + "result += " + use() + " * " + E() + ";");
                lines.push(pad(1) + "}");
            } else if (t < 0.74) lines.push(pad(1) + "result = fmax(result, " + use() + " * " + E() + " + " + E() + ");");
            else if (t < 0.86) lines.push(pad(1) + "samples.push_back(" + use() + " * " + E() + " + " + E() + ");");
            else lines.push(pad(1) + pick(EARTH_BLOB));
        }
        lines.push(pad(1) + "return result;");
        lines.push(pad(0) + "}");
        lines.push("");
        return lines;
    };

    const buildProgram = () => {
        const lines = [];
        // two passes over the file's functions for one long, continuous file
        for (let pass = 0; pass < 2; pass++) {
            cur.funcs.forEach(fn => lines.push(...buildFunction(fn)));
        }
        lines.push(pad(0) + "int main(int argc, char** argv) {");
        lines.push(pad(1) + "auto cfg = load_config(argv[1]);");
        lines.push(pad(1) + "double r0 = " + cur.funcs[0] + "(cfg, 0.0, 1.0);");
        lines.push(pad(1) + "double r1 = " + cur.funcs[1] + "(cfg, 1.0, 2.0);");
        lines.push(pad(1) + "fprintf(stderr, \"simulation complete: %.6f %.6f\\n\", r0, r1);");
        lines.push(pad(1) + "return 0;");
        lines.push(pad(0) + "}");
        lines.push("");
        return lines;
    };

    const headerLines = () => {
        const lines = [];
        lines.push("\r\nroot@kali:~# g++ -O3 -march=native " + cur.file + " -lm -o sim");
        lines.push("");
        lines.push("/* " + cur.file + " - " + cur.S.note + " */");
        lines.push("/* " + pick(["no warranty - research use only", "declassified reference model", "internal audit build", "classified - export controlled"]) + " */");
        lines.push("#include <cmath>");
        lines.push("#include <vector>");
        lines.push("#include <array>");
        lines.push("#include <iostream>");
        lines.push("#include <random>");
        lines.push("using namespace std;");
        lines.push("");
        cur.consts.forEach(c => lines.push("constexpr double " + c[0] + " = " + c[1] + ";"));
        lines.push("");
        return lines;
    };

    // The whole file (header + program) streams one line per tick: no bursts,
    // so the code never visibly "jumps" to something unrelated. Every file is
    // generated fresh; when one finishes the terminal is reset so the buffer
    // never grows past a single file (no long-session scrollback lag).
    let pendingLines = [];
    let sessionFirstFile = true;
    const nextLine = () => {
        if (!pendingLines.length) {
            beginFile();
            pendingLines = headerLines().concat(buildProgram());
            if (!sessionFirstFile) {
                let t = window.term[window.currentTerm];
                if (t && t.term && typeof t.term.reset === "function") {
                    try { t.term.reset(); } catch (e) {}
                }
            }
            sessionFirstFile = false;
        }
        return pendingLines.shift();
    };

    const codeTick = () => {
        let t = window.term[window.currentTerm];
        if (!t || !t.term || typeof t.term.write !== "function") return;
        t.term.write(nextLine() + "\r\n");
    };


    // ---- matrix style (fullscreen) ----
    let canvas = null, ctx = null, cols = 0, drops = [], mTimer = null;
    let fading = false, fadeTail = 0;
    const GRID = 22;
    const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#$%&@アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホ";
    const mResize = () => {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        cols = Math.floor(canvas.width / GRID);
        drops = Array.from({ length: cols }, () => Math.floor(Math.random() * -canvas.height / GRID));
    };
    const mDraw = () => {
        ctx.fillStyle = "rgba(5, 8, 13, 0.08)";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.font = (GRID - 3) + "px 'Fira Mono', monospace";
        let remaining = 0;
        for (let i = 0; i < drops.length; i++) {
            // -99999 marks a drop that is gone for good; drops still start at
            // negative y (above the screen) and must keep falling into view
            if (drops[i] < -10000) continue;
            let ch = CHARS[Math.floor(Math.random() * CHARS.length)];
            ctx.fillStyle = "rgb(" + window.theme.r + "," + window.theme.g + "," + window.theme.b + ")";
            ctx.fillText(ch, i * GRID, drops[i] * GRID);
            if (drops[i] * GRID > canvas.height + 30) {
                // during wind-down, a drop that falls off stays off (rain drains);
                // normally it regenerates at the top
                if (fading) drops[i] = -99999;
                else if (Math.random() > 0.975) drops[i] = 0;
            } else {
                remaining++;
            }
            // wind-down: characters visibly thin out as some vanish each frame
            if (fading && Math.random() < 0.10) drops[i] = -99999;
            drops[i]++;
        }
        // wind-down: once every drop is gone, let the trailing fade settle, then
        // hide the canvas and play the eDEX boot animation
        if (fading && remaining === 0) { fading = false; fadeTail = 10; }
        if (fadeTail > 0 && --fadeTail === 0) {
            clearInterval(mTimer); mTimer = null;
            canvas.style.display = "none";
            if (typeof replayBoot === "function") replayBoot();
        }
    };

    return {
        show() {
            if (active) {
                // Already showing but the cover identity was lost — re-assert it.
                if (window.cover && !window.cover.isActive()) window.cover.set(true);
                return;
            }
            active = true;
            fading = false;
            fadeTail = 0;
            if (window.settings.screensaverStyle === "matrix") {
                if (!canvas) {
                    canvas = document.createElement("canvas");
                    canvas.id = "screensaver_canvas";
                    canvas.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;z-index:9999;background:#05080d;display:none;";
                    document.body.appendChild(canvas);
                    ctx = canvas.getContext("2d");
                    mResize();
                    window.addEventListener("resize", mResize);
                }
                canvas.style.display = "block";
                mTimer = setInterval(mDraw, 50);
            } else {
                codeTimer = setInterval(codeTick, 100);
            }
            // While the screensaver plays, eDEX wears its cover identity (fake
            // tabs / filesystem / IP / process list).
            if (window.cover) window.cover.set(true);
        },
        hide(immediate) {
            if (!active) return;
            active = false;
            // Leave cover mode: restore the real tabs / filesystem / IP / procs.
            if (window.cover) window.cover.set(false);
            if (immediate) {
                // Used when dismissing straight into the lock screen: stop
                // cleanly, no wind-down animation and no boot replay.
                if (codeTimer) { clearInterval(codeTimer); codeTimer = null; }
                if (mTimer) { clearInterval(mTimer); mTimer = null; }
                fading = false; fadeTail = 0;
                if (canvas) canvas.style.display = "none";
                return;
            }
            if (canvas) {
                // Matrix wind-down: stop generating new characters so the rain
                // drains out naturally; when the fade settles (in mDraw) the eDEX
                // boot animation plays. No flash and no instant cut.
                fading = true;
            }
            if (codeTimer) {
                clearInterval(codeTimer);
                codeTimer = null;
                // Natural wind-down for the code style: stop generating, write a
                // completion line, then scroll the code up one line at a time so
                // the visible code gradually decreases; once it's scrolled off,
                // reset the terminal to a fresh shell prompt.
                let t = window.term[window.currentTerm];
                if (t && t.term) {
                    if (typeof t.term.write === "function") {
                        t.term.write("\r\n[ OK ] all processes finished - exit code 0");
                        let rows = t.term.rows || 24;
                        let scrolled = 0;
                        let scroller = setInterval(() => {
                            if (typeof t.term.write === "function") t.term.write("\n");
                            scrolled++;
                            if (scrolled >= rows) {
                                clearInterval(scroller);
                                if (typeof t.term.reset === "function" && typeof t.writelr === "function") {
                                    t.term.reset();
                                    t.writelr("");
                                }
                            }
                        }, 45);
                    }
                }
            }
        },
        isActive() { return active; },
        // Expose the procedural code generator so the lock screen can stream
        // the same sci-fi C++ onto its own fullscreen canvas.
        getCodeLine() { return nextLine(); }
    };
})();

// Idle tracking: any input wakes the screensaver and re-arms the idle timer.
let lastActivity = Date.now();
const bumpActivity = () => {
    lastActivity = Date.now();
    if (window.screensaver.isActive()) {
        window.screensaver.hide(true);
        // Dismissing the screensaver leads into the lock screen when the
        // device has a password configured (lockOnIdle) and one was actually
        // set (a non-empty lockCode — the passcode chosen at install time).
        if (window.settings.lockOnIdle !== false
            && String(window.settings.lockCode || "").length > 0
            && window.lockScreen && !window.lockScreen.active) {
            window.lockScreen.show();
        }
    }
};
["mousemove", "mousedown", "keydown", "wheel", "touchstart", "click"].forEach(ev =>
    window.addEventListener(ev, bumpActivity, { passive: true })
);
setInterval(() => {
    if (window.screensaver.isActive()) return;
    if (window.lockScreen && window.lockScreen.active) return; // locked: stay locked
    if (Object.keys(window.modals).length > 0) return; // keep modals (settings etc.) usable
    if (!window.settings.screensaverEnabled) return;
    let idle = (Number(window.settings.screensaverIdle) || 300) * 1000;
    if (Date.now() - lastActivity > idle) {
        // Idle always plays the screensaver first; the lock screen appears on
        // dismiss (bumpActivity) when a passcode is configured.
        window.screensaver.show();
    }
}, 1000);
