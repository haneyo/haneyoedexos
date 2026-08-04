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

    // Virtual keyboard (touch screens): replaces the bottom DATA panel with the
    // on-screen keyboard; the radar stays. Toggled via settings.showKeyboard.
    if (window.settings.showKeyboard) {
        let cyberInner = document.getElementById("cyber_panel_inner");
        if (cyberInner) cyberInner.style.display = "none";
        let keyEl = document.createElement("section");
        keyEl.id = "keyboard";
        keyEl.style.cssText = "width:82.9vw;margin:0 auto;";
        document.getElementById("bottom_row").appendChild(keyEl);
        try {
            window.keyboard = new Keyboard({
                layout: path.join(keyboardsDir, (window.settings.keyboard || "en-US") + ".json"),
                container: "keyboard"
            });
            window.keyboard.attach();
        } catch (e) {
            require("electron").ipcRenderer.send("log", "error", "Keyboard init failed: " + (e && e.message));
        }
    }

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
            <li id="shell_tab3" onclick="window.focusShellTab(3);"><p><span id="shell_tab3_label">MONITOR A</span> <span class="webapp_chevron" title="Switch app" onclick="event.stopPropagation();window.appmonitorA.toggleMenu(event);">${Icons.chevronDown}</span></p></li>
            <li id="shell_tab4" onclick="window.focusShellTab(4);"><p><span id="shell_tab4_label">MONITOR B</span> <span class="webapp_chevron" title="Switch app" onclick="event.stopPropagation();window.appmonitorB.toggleMenu(event);">${Icons.chevronDown}</span></p></li>
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
    window.term[0].onprocesschange = p => {
        document.getElementById("shell_tab0").innerHTML = `<p>MAIN - ${p}</p>`;
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
                    { label: "Start", action: "window.systemUpdate.start()" },
                    { label: "Close", action: "window.systemUpdate.close()" }
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
                    document.getElementById("shell_tab"+number).innerHTML = `<p>#${number+1} - ${p}</p>`;
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

    // Build lists of available themes, monitors, ifaces
    let themes, monitors, ifaces;
    fs.readdirSync(themesDir).forEach(th => {
        if (!th.endsWith(".json")) return;
        th = th.replace(".json", "");
        if (th === window.settings.theme) return;
        themes += `<option>${th}</option>`;
    });
    for (let i = 0; i < remote.screen.getAllDisplays().length; i++) {
        if (i !== window.settings.monitor) monitors += `<option>${i}</option>`;
    }
    let nets = await window.si.networkInterfaces();
    nets.forEach(net => {
        if (net.iface !== window.mods.netstat.iface) ifaces += `<option>${net.iface}</option>`;
    });

    new Modal({
        type: "custom",
        closeLabel: "关闭", // the settings menu stays in Chinese
        title: `设置 <i>(v${remote.app.getVersion()})</i>`,
        html: `<table id="settingsEditor">
                    <tr>
                        <th>项目</th>
                        <th>说明</th>
                        <th>值</th>
                    </tr>
                    <tr>
                        <td>Shell 程序</td>
                        <td>作为终端模拟器运行的程序</td>
                        <td><input type="text" id="settingsEditor-shell" value="${window.settings.shell}"></td>
                    </tr>
                    <tr>
                        <td>Shell 参数</td>
                        <td>传递给 shell 的命令行参数</td>
                        <td><input type="text" id="settingsEditor-shellArgs" value="${window.settings.shellArgs || ''}"></td>
                    </tr>
                    <tr>
                        <td>工作目录</td>
                        <td>启动时所在的初始工作目录</td>
                        <td><input type="text" id="settingsEditor-cwd" value="${window.settings.cwd}"></td>
                    </tr>
                    <tr>
                        <td>环境变量</td>
                        <td>自定义 shell 环境变量覆盖</td>
                        <td><input type="text" id="settingsEditor-env" value="${window.settings.env}"></td>
                    </tr>
                    <tr>
                        <td>用户名</td>
                        <td>启动时显示的自定义用户名</td>
                        <td><input type="text" id="settingsEditor-username" value="${window.settings.username}"></td>
                    </tr>
                    <tr>
                        <td>主题</td>
                        <td>要加载的主题名称</td>
                        <td><select id="settingsEditor-theme">
                            <option>${window.settings.theme}</option>
                            ${themes}
                        </select></td>
                    </tr>
                    <tr>
                        <td>终端字号</td>
                        <td>终端文字的像素大小</td>
                        <td><input type="text" id="settingsEditor-termFontSize" value="${window.settings.termFontSize}"></td>
                    </tr>
                    <tr>
                        <td>音效</td>
                        <td>启用界面音效</td>
                        <td><select id="settingsEditor-audio">
                            <option>${window.settings.audio}</option>
                            <option>${!window.settings.audio}</option>
                        </select></td>
                    </tr>
                    <tr>
                        <td>音量</td>
                        <td>音效的默认音量（0.0 - 1.0）</td>
                        <td><input type="text" id="settingsEditor-audioVolume" value="${window.settings.audioVolume || '1.0'}"></td>
                    </tr>
                    <tr>
                        <td>关闭反馈音效</td>
                        <td>关闭循环反馈音效（主要为输入/输出提示音）</td>
                        <td><select id="settingsEditor-disableFeedbackAudio">
                            <option>${window.settings.disableFeedbackAudio}</option>
                            <option>${!window.settings.disableFeedbackAudio}</option>
                        </select></td>
                    </tr>
                    <tr>
                        <td>端口</td>
                        <td>UI 与 shell 连接所使用的本地端口</td>
                        <td><input type="text" id="settingsEditor-port" value="${window.settings.port}"></td>
                    </tr>
                    <tr>
                        <td>Ping 地址</td>
                        <td>用于测试互联网连通性的 IPv4 地址</td>
                        <td><input type="text" id="settingsEditor-pingAddr" value="${window.settings.pingAddr || "223.5.5.5"}"></td>
                    </tr>
                    <tr>
                        <td>时钟制式</td>
                        <td>时钟格式（12 / 24 小时）</td>
                        <td><select id="settingsEditor-clockHours">
                            <option>${(window.settings.clockHours === 12) ? "12" : "24"}</option>
                            <option>${(window.settings.clockHours === 12) ? "24" : "12"}</option>
                        </select></td>
                    <tr>
                        <td>显示器</td>
                        <td>在此显示器上生成 UI（默认为主显示器）</td>
                        <td><select id="settingsEditor-monitor">
                            ${(typeof window.settings.monitor !== "undefined") ? "<option>"+window.settings.monitor+"</option>" : ""}
                            ${monitors}
                        </select></td>
                    </tr>
                    <tr>
                        <td>跳过启动动画</td>
                        <td>跳过启动日志与 Logo 动画${(window.settings.nointroOverride) ? "（当前已被命令行参数覆盖）" : ""}</td>
                        <td><select id="settingsEditor-nointro">
                            <option>${window.settings.nointro}</option>
                            <option>${!window.settings.nointro}</option>
                        </select></td>
                    </tr>
                    <tr>
                        <td>隐藏鼠标</td>
                        <td>隐藏鼠标光标${(window.settings.nocursorOverride) ? "（当前已被命令行参数覆盖）" : ""}</td>
                        <td><select id="settingsEditor-nocursor">
                            <option>${window.settings.nocursor}</option>
                            <option>${!window.settings.nocursor}</option>
                        </select></td>
                    </tr>
                    <tr>
                        <td>网络接口</td>
                        <td>覆盖用于网络监控的网卡接口</td>
                        <td><select id="settingsEditor-iface">
                            <option>${window.mods.netstat.iface}</option>
                            ${ifaces}
                        </select></td>
                    </tr>
                    <tr>
                        <td>允许窗口化</td>
                        <td>允许按 F11 键将界面切换到窗口模式</td>
                        <td><select id="settingsEditor-allowWindowed">
                            <option>${window.settings.allowWindowed}</option>
                            <option>${!window.settings.allowWindowed}</option>
                        </select></td>
                    </tr>
                    <tr>
                        <td>保持宽高比</td>
                        <td>窗口模式下尽量保持 16:9 的宽高比</td>
                        <td><select id="settingsEditor-keepGeometry">
                            <option>${(window.settings.keepGeometry === false) ? 'false' : 'true'}</option>
                            <option>${(window.settings.keepGeometry === false) ? 'true' : 'false'}</option>
                        </select></td>
                    </tr>
                    <tr>
                        <td>合并进程线程</td>
                        <td>在进程列表中合并同名的线程</td>
                        <td><select id="settingsEditor-excludeThreadsFromToplist">
                            <option>${window.settings.excludeThreadsFromToplist}</option>
                            <option>${!window.settings.excludeThreadsFromToplist}</option>
                        </select></td>
                    </tr>
                    <tr>
                        <td>隐藏点文件</td>
                        <td>在文件显示中隐藏以点（.）开头的文件与目录</td>
                        <td><select id="settingsEditor-hideDotfiles">
                            <option>${window.settings.hideDotfiles}</option>
                            <option>${!window.settings.hideDotfiles}</option>
                        </select></td>
                    </tr>
                    <tr>
                        <td>列表视图</td>
                        <td>以更详细的列表而非图标网格来显示文件</td>
                        <td><select id="settingsEditor-fsListView">
                            <option>${window.settings.fsListView}</option>
                            <option>${!window.settings.fsListView}</option>
                        </select></td>
                    </tr>
                    <tr>
                        <td>地球实验功能</td>
                        <td>切换网络地球的实验性功能</td>
                        <td><select id="settingsEditor-experimentalGlobeFeatures">
                            <option>${window.settings.experimentalGlobeFeatures}</option>
                            <option>${!window.settings.experimentalGlobeFeatures}</option>
                        </select></td>
                    </tr>
                    <tr>
                        <td>实验功能</td>
                        <td>开启 Chrome 的实验性网页功能（危险！）</td>
                        <td><select id="settingsEditor-experimentalFeatures">
                            <option>${window.settings.experimentalFeatures}</option>
                            <option>${!window.settings.experimentalFeatures}</option>
                        </select></td>
                    </tr>
                    <tr>
                        <td>屏保</td>
                        <td>空闲一段时间后显示黑客风格屏保，移动鼠标或按键返回</td>
                        <td><select id="settingsEditor-screensaverEnabled">
                            <option>${window.settings.screensaverEnabled}</option>
                            <option>${!window.settings.screensaverEnabled}</option>
                        </select></td>
                    </tr>
                    <tr>
                        <td>屏保启动时间</td>
                        <td>无操作多少秒后启动屏保</td>
                        <td><input type="text" id="settingsEditor-screensaverIdle" value="${window.settings.screensaverIdle || 300}"></td>
                    </tr>
                    <tr>
                        <td>屏保风格</td>
                        <td>代码（终端内滚动代码）或黑客帝国（全屏字符雨）</td>
                        <td><select id="settingsEditor-screensaverStyle">
                            <option>${window.settings.screensaverStyle || "code"}</option>
                            <option>${(window.settings.screensaverStyle === "matrix") ? "code" : "matrix"}</option>
                        </select></td>
                    </tr>
                    <tr><td colspan="3" class="settingsEditor_section">锁屏</td></tr>
                    <tr>
                        <td>锁屏密码</td>
                        <td>全屏锁屏的解锁密码（演示用密码，非系统密码）</td>
                        <td><input type="text" id="settingsEditor-lockCode" value="${window.settings.lockCode || '0000'}"></td>
                    </tr>
                    <tr>
                        <td>空闲自动锁定</td>
                        <td>空闲达到屏保时间后直接进入锁屏（而不是普通屏保）</td>
                        <td><select id="settingsEditor-lockOnIdle">
                            <option>${window.settings.lockOnIdle !== false}</option>
                            <option>${window.settings.lockOnIdle === false}</option>
                        </select></td>
                    </tr>
                    <tr>
                        <td>虚拟键盘</td>
                        <td>触屏用。开启后底部 DATA 框变为虚拟键盘（雷达保留），重启 eDEX 生效</td>
                        <td><select id="settingsEditor-showKeyboard">
                            <option>${window.settings.showKeyboard === true}</option>
                            <option>${window.settings.showKeyboard !== true}</option>
                        </select></td>
                    </tr>
                    <tr><td colspan="3" class="settingsEditor_section">Claude Code</td></tr>
                    <tr>
                        <td>启用 Claude 配置</td>
                        <td>将下列 AI 服务配置注入终端环境变量（ANTHROPIC_*），重启 eDEX 后生效</td>
                        <td><select id="settingsEditor-claude-enabled">
                            <option>${(window.settings.claude || {}).enabled}</option>
                            <option>${!(window.settings.claude || {}).enabled}</option>
                        </select></td>
                    </tr>
                    <tr>
                        <td>AI 服务地址</td>
                        <td>API Base URL；留空使用 Anthropic 官方，可填代理 / 网关</td>
                        <td><input type="text" id="settingsEditor-claude-baseUrl" value="${(window.settings.claude || {}).baseUrl || ''}"></td>
                    </tr>
                    <tr>
                        <td>API Key</td>
                        <td>ANTHROPIC_API_KEY（明文存于 settings.json）</td>
                        <td><input type="password" id="settingsEditor-claude-apiKey" value="${(window.settings.claude || {}).apiKey || ''}"></td>
                    </tr>
                    <tr>
                        <td>模型</td>
                        <td>ANTHROPIC_MODEL，留空使用默认</td>
                        <td><input type="text" id="settingsEditor-claude-model" value="${(window.settings.claude || {}).model || ''}"></td>
                    </tr>
                    <tr>
                        <td>快速小模型</td>
                        <td>ANTHROPIC_DEFAULT_HAIKU_MODEL（背景 / 快速任务），留空使用默认</td>
                        <td><input type="text" id="settingsEditor-claude-haikuModel" value="${(window.settings.claude || {}).haikuModel || ''}"></td>
                    </tr>
                    <tr><td colspan="3" class="settingsEditor_section">第 3 个终端标签为 Claude 专用标签；claude 由官方独立更新（claude update），不影响 eDEX</td></tr>
                    <tr><td colspan="3" class="settingsEditor_section">应用监视器（终端标签 4 / 5）</td></tr>
                    <tr>
                        <td>启用监视器</td>
                        <td>标签 4/5 作为虚拟显示器显示已安装应用</td>
                        <td><select id="settingsEditor-appMonitor-enabled">
                            <option>${(window.settings.appMonitor || {}).enabled !== false}</option>
                            <option>${(window.settings.appMonitor || {}).enabled === false}</option>
                        </select></td>
                    </tr>
                    <tr>
                        <td>Mock 后端</td>
                        <td>Mock=内置演示画面（无需真实应用）；真实=Linux 上的 Xvfb 应用；自动=macOS 用 Mock / Linux 用真实</td>
                        <td><select id="settingsEditor-appMonitor-mock">
                            <option value="auto" ${(window.settings.appMonitor || {}).mock == null ? "selected" : ""}>自动</option>
                            <option value="true" ${(window.settings.appMonitor || {}).mock === true ? "selected" : ""}>Mock</option>
                            <option value="false" ${(window.settings.appMonitor || {}).mock === false ? "selected" : ""}>真实</option>
                        </select></td>
                    </tr>
                    <tr>
                        <td>AppImage 目录</td>
                        <td>逗号分隔，扫描 .AppImage（如 ~/Applications,~/AppImages）</td>
                        <td><input type="text" id="settingsEditor-appMonitor-appImageDirs" value="${(window.settings.appMonitor || {}).appImageDirs || ''}"></td>
                    </tr>
                </table>
                <h6 id="settingsEditorStatus">已从内存加载当前设置</h6>
                <br>`,
        buttons: [
            {label: "用外部编辑器打开", action:`electron.shell.openPath('${settingsFile}');electronWin.minimize();`},
            {label: "保存到磁盘", action: "window.writeSettingsFile()"},
            {label: "快捷键", action: "window.openShortcutsHelp()"},
            {label: "WiFi", action: "window.wifiPanel.open()"},
            {label: "锁屏", action: "window.lockScreen.show()"},
            {label: "系统更新", action: "window.systemUpdate.open()"},
            {label: "启动屏保", action: "window.modals[Object.keys(window.modals).pop()].close(); setTimeout(() => window.screensaver.show(), 150);"},
            {label: "重载界面", action: "window.location.reload(true);"},
            {label: "重启 eDEX", action: "remote.app.relaunch();remote.app.quit();"}
        ]
    }, () => {
        // Focus back on the term
        window.term[window.currentTerm].term.focus();
    });

    // Native <select> popups do not render well in this fullscreen HUD, so swap
    // them for theme-styled custom dropdowns once the modal is in the DOM.
    setTimeout(window.setupSettingsDropdowns, 50);
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
        let options = Array.from(sel.options).map(o => o.text);
        let isBool = options.length === 2 && options.includes("true") && options.includes("false");
        let label = v => (isBool ? (v === "true" ? "TRUE" : "FALSE") : v);
        let value = sel.value;

        let render = () => {
            btn.textContent = label(value);
            list.innerHTML = "";
            options.forEach(opt => {
                let d = document.createElement("div");
                d.className = "mod_loc_opt" + (opt === value ? " mod_loc_opt_active" : "");
                d.dataset.value = opt;
                d.textContent = label(opt);
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
    window.settings = {
        shell: document.getElementById("settingsEditor-shell").value,
        shellArgs: document.getElementById("settingsEditor-shellArgs").value,
        cwd: document.getElementById("settingsEditor-cwd").value,
        env: document.getElementById("settingsEditor-env").value,
        username: document.getElementById("settingsEditor-username").value,
        theme: document.getElementById("settingsEditor-theme").value,
        termFontSize: Number(document.getElementById("settingsEditor-termFontSize").value),
        audio: (document.getElementById("settingsEditor-audio").value === "true"),
        audioVolume: Number(document.getElementById("settingsEditor-audioVolume").value),
        disableFeedbackAudio: (document.getElementById("settingsEditor-disableFeedbackAudio").value === "true"),
        pingAddr: document.getElementById("settingsEditor-pingAddr").value,
        clockHours: Number(document.getElementById("settingsEditor-clockHours").value),
        port: Number(document.getElementById("settingsEditor-port").value),
        monitor: Number(document.getElementById("settingsEditor-monitor").value),
        nointro: (document.getElementById("settingsEditor-nointro").value === "true"),
        nocursor: (document.getElementById("settingsEditor-nocursor").value === "true"),
        iface: document.getElementById("settingsEditor-iface").value,
        allowWindowed: (document.getElementById("settingsEditor-allowWindowed").value === "true"),
        forceFullscreen: window.settings.forceFullscreen,
        keepGeometry: (document.getElementById("settingsEditor-keepGeometry").value === "true"),
        excludeThreadsFromToplist: (document.getElementById("settingsEditor-excludeThreadsFromToplist").value === "true"),
        hideDotfiles: (document.getElementById("settingsEditor-hideDotfiles").value === "true"),
        fsListView: (document.getElementById("settingsEditor-fsListView").value === "true"),
        experimentalGlobeFeatures: (document.getElementById("settingsEditor-experimentalGlobeFeatures").value === "true"),
        experimentalFeatures: (document.getElementById("settingsEditor-experimentalFeatures").value === "true"),
        screensaverEnabled: (document.getElementById("settingsEditor-screensaverEnabled").value === "true"),
        screensaverIdle: Number(document.getElementById("settingsEditor-screensaverIdle").value),
        screensaverStyle: document.getElementById("settingsEditor-screensaverStyle").value,
        lockCode: document.getElementById("settingsEditor-lockCode").value,
        lockOnIdle: (document.getElementById("settingsEditor-lockOnIdle").value === "true"),
        showKeyboard: (document.getElementById("settingsEditor-showKeyboard").value === "true"),
        claude: {
            enabled: (document.getElementById("settingsEditor-claude-enabled").value === "true"),
            baseUrl: document.getElementById("settingsEditor-claude-baseUrl").value,
            apiKey: document.getElementById("settingsEditor-claude-apiKey").value,
            model: document.getElementById("settingsEditor-claude-model").value,
            haikuModel: document.getElementById("settingsEditor-claude-haikuModel").value
        },
        appMonitor: {
            enabled: (document.getElementById("settingsEditor-appMonitor-enabled").value === "true"),
            mock: document.getElementById("settingsEditor-appMonitor-mock").value === "auto"
                ? null
                : (document.getElementById("settingsEditor-appMonitor-mock").value === "true"),
            appImageDirs: document.getElementById("settingsEditor-appMonitor-appImageDirs").value
        }
    };

    Object.keys(window.settings).forEach(key => {
        if (window.settings[key] === "undefined") {
            delete window.settings[key];
        }
    });

    fs.writeFileSync(settingsFile, JSON.stringify(window.settings, "", 4));
    document.getElementById("settingsEditorStatus").innerText = "设置已写入 settings.json 文件，时间："+new Date().toTimeString();
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
        "COPY": "从终端复制选中的缓冲区内容。",
        "PASTE": "将系统剪贴板粘贴到终端。",
        "NEXT_TAB": "切换到下一个已打开的终端标签页（从左到右）。",
        "PREVIOUS_TAB": "切换到上一个已打开的终端标签页（从右到左）。",
        "TAB_X": "切换到终端标签页 <strong>X</strong>，若尚未打开则创建它。",
        "SETTINGS": "打开设置编辑器。",
        "SHORTCUTS": "列出并编辑可用的键盘快捷键。",
        "FUZZY_SEARCH": "在当前工作目录中搜索条目。",
        "FS_LIST_VIEW": "在文件浏览器的列表视图与网格视图之间切换。",
        "FS_DOTFILES": "切换文件浏览器中隐藏文件与目录的显示。",
        "DEV_DEBUG": "打开 Chromium 开发者工具，用于调试。",
        "DEV_RELOAD": "触发前端热重载。"
    };

    let appList = "";
    window.shortcuts.filter(e => e.type === "app").forEach(cut => {
        let action = (cut.action.startsWith("TAB_")) ? "TAB_X" : cut.action;

        appList += `<tr>
                        <td>${(cut.enabled) ? '是' : '否'}</td>
                        <td><input disabled type="text" maxlength=25 value="${cut.trigger}"></td>
                        <td>${shortcutsDefinition[action]}</td>
                    </tr>`;
    });

    let customList = "";
    window.shortcuts.filter(e => e.type === "shell").forEach(cut => {
        customList += `<tr>
                            <td>${(cut.enabled) ? '是' : '否'}</td>
                            <td><input disabled type="text" maxlength=25 value="${cut.trigger}"></td>
                            <td>
                                <input disabled type="text" placeholder="运行终端命令..." value="${cut.action}">
                                <input disabled type="checkbox" name="shortcutsHelpNew_Enter" ${(cut.linebreak) ? 'checked' : ''}>
                                <label for="shortcutsHelpNew_Enter">Enter</label>
                            </td>
                        </tr>`;
    });

    new Modal({
        type: "custom",
        title: `键盘快捷键 <i>(v${remote.app.getVersion()})</i>`,
        html: `<h5>您可以使用以下快捷键：</h5>
                <details open id="shortcutsHelpAccordeon1">
                    <summary>模拟器快捷键</summary>
                    <table class="shortcutsHelp">
                        <tr>
                            <th>启用</th>
                            <th>快捷键</th>
                            <th>操作</th>
                        </tr>
                        ${appList}
                    </table>
                </details>
                <br>
                <details id="shortcutsHelpAccordeon2">
                    <summary>自定义命令快捷键</summary>
                    <table class="shortcutsHelp">
                        <tr>
                            <th>启用</th>
                            <th>快捷键</th>
                            <th>命令</th>
                        <tr>
                       ${customList}
                    </table>
                </details>
                <br>`,
        buttons: [
            {label: "打开快捷键文件", action:`electron.shell.openPath('${shortcutsFile}');electronWin.minimize();`},
            {label: "重载界面", action: "window.location.reload(true);"},
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
    const SCENARIOS = {
        ballistic: {
            file: "strategic_sim.cpp", note: "three-stage ballistic trajectory and yield model",
            funcs: ["compute_apogee", "estimate_reentry_angle", "integrate_trajectory", "compute_overpressure", "predict_impact_point", "assess_blast_damage", "trace_fallout_field"],
            vars: ["velocity", "reentry_angle", "apogee", "warhead_yield", "detonation_alt", "impact_point", "range_m", "mach", "thrust", "guidance", "azimuth", "elevation", "fuse_time", "blast_radius", "overpressure", "payload_mass", "state_vector"],
            exprs: ["0.5 * AIR_DENSITY * mach * mach * C_D * reference_area", "atan2(state.vel.z, sqrt(state.vel.x * state.vel.x + state.vel.y * state.vel.y))", "state.pos + state.vel * dt + 0.5 * state.accel * dt * dt", "yield_kilotons * pow(10.0, 2.0 / 3.0) * 0.6 * exposure_factor", "GRAVITY * (t - launch_time) * (t - launch_time) / 2.0", "mach * SPEED_OF_SOUND * (1.0 + 0.2 * mach * mach)", "sqrt(2.0 * kinetic_energy / payload_mass)", "cbrt(warhead_yield / 1.0e6) * BLAST_SCALE", "state.accel + GRAVITY * (1.0 - drag_coeff * mach * mach) - thrust / payload_mass", "range_m * sin(elevation) / tan(azimuth) + apogee * cos(reentry_angle) / 2.0"],
            comments: ["Integrate the reentry vehicle under atmospheric drag using an RK4 integrator with a fixed 0.5 ms timestep and temperature-corrected density.", "Overpressure at the target scales with the cube root of the yield, attenuated by the terrain shadow factor and the local wind field.", "Predict the impact point from the current state vector, the trim condition and the residual ballistic coefficient of the reentry body.", "Detonation altitude must clear the fireball radius before ground contact in order to maximize the overpressure band at the aimpoint.", "The blast yield is bounded by the warhead maximum compression ratio at the moment of detonation, not the nominal yield.", "Trace the fallout field downwind using the transport model with a ten-metre gridded terrain mesh."],
            consts: [["GRAVITY", "9.80665"], ["AIR_DENSITY", "1.225"], ["SPEED_OF_SOUND", "343.0"], ["BLAST_SCALE", "4.5e-4"], ["N_SAMPLES", "4096"]]
        },
        radar: {
            file: "track_filter.cpp", note: "phased-array tracking and CFAR detection",
            funcs: ["init_track_table", "update_kalman_track", "compute_doppler_shift", "cfar_detect_target", "fuse_beamformer_output", "coast_lost_track", "handoff_track_to_guidance"],
            vars: ["azimuth", "elevation", "range_rate", "doppler", "signal_power", "noise_floor", "clutter", "track_id", "update_rate", "cross_section", "lock_status", "beam_width"],
            exprs: ["2.0 * CARRIER_FREQ * range_rate / C", "C * round_trip_time / 2.0", "kalman_update(measurement, state, Q, R)", "pow(10.0, snr_db / 20.0)", "gain * (measurement - predicted_state)", "signal_power / noise_floor", "coherence * doppler_bin_width", "sqrt(beam_width * beam_width + pulse_width * pulse_width)", "2.0 * CARRIER_FREQ * range_rate / C * pow(10.0, snr_db / 20.0)", "sqrt(pow(signal_power, 2.0) + pow(noise_floor, 2.0)) * coherence"],
            comments: ["Update the Kalman track with the latest radar measurement and its covariance matrix, gating on the innovation residual.", "Reject returns below the CFAR threshold as clutter and keep the false-alarm rate bounded across the scan volume.", "Coast the track when the target is lost for more than N consecutive frames before declaring the track invalid.", "Fuse the in-phase and quadrature channels to recover the Doppler offset of the target at the beam centre.", "Hand the confirmed track to the guidance loop together with the filter covariance and the residual history.", "Recompute the beam steering vector from the updated target state at each scan update."],
            consts: [["CARRIER_FREQ", "9.4e9"], ["C", "2.99792458e8"], ["CFAR_THRESHOLD", "13.0"], ["MAX_TRACKS", "512"], ["UPDATE_RATE", "20.0"]]
        },
        emp: {
            file: "hardening_scan.cpp", note: "HEMP coupling and circuit hardening",
            funcs: ["compute_field_coupling", "estimate_induced_surge", "assess_shield_attenuation", "model_cable_resonance", "verify_circuit_hardening", "sweep_rise_time"],
            vars: ["field_strength", "pulse", "rise_time", "shield", "cable", "induction", "circuit", "hardening", "surge", "current", "impedance", "skin_depth"],
            exprs: ["1.0e4 * pow(distance, -1.5) * polarisation_factor", "dPhi / dt", "voltage / impedance", "20.0 * log10(1.0 + thickness / SKIN_DEPTH)", "rise_time * BANDWIDTH", "flux_linkage * AREA", "peak * exp(-t / DECAY)", "induced_current * cable_length / loop_area", "2.0 * PEAK_E * sin(rise_time * BANDWIDTH) * exp(-t / DECAY)", "voltage / impedance * (1.0 - exp(-rise_time * BANDWIDTH))"],
            comments: ["Compute the induced surge from the HEMP pulse coupling into the long cable run between the shelter and the mast.", "Attenuation rises with shield thickness relative to the skin depth at the dominant frequency of the incident field.", "A hardened circuit clamps the transient before it reaches the semiconductor gate and the downstream logic.", "The fast rise time couples into longer conductors far more efficiently than a slow ramp, so treat it as the worst case.", "Verify the clamp voltage against the worst-case transient produced by the coupling model at the shelter boundary.", "Sweep the rise time from the nominal HEMP spec down to the fast-coupling bound to bracket the response."],
            consts: [["PEAK_E", "5.0e4"], ["RISE_TIME", "2.5e-9"], ["SKIN_DEPTH", "8.6e-6"], ["CLAMP_VOLTAGE", "2.2"], ["DECAY", "1.0e-7"]]
        },
        winter: {
            file: "climate_transport.cpp", note: "stratospheric aerosol transport and forcing",
            funcs: ["inject_soot_mass", "evolve_optical_depth", "compute_radiative_forcing", "transport_aerosol", "project_temperature_drop", "estimate_settling_rate"],
            vars: ["aerosol", "optical_depth", "insolation", "temperature_drop", "dispersal", "settling", "stratosphere", "soot", "albedo", "tau"],
            exprs: ["optical_depth * (1.0 - transmittance)", "-alpha * insolation * optical_depth", "soot_mass * settling_rate / scale_height", "albedo * (1.0 + delta)", "insolation * exp(-tau)", "forcing * response_time", "deposition / residence", "soot_emission * scavenging_fraction", "insolation * exp(-tau) * (1.0 - albedo * optical_depth)", "soot_mass * settling_rate / scale_height * exp(-residence / tau)"],
            comments: ["Soot injected into the stratosphere reduces the surface insolation across the hemisphere, driving a surface cooling anomaly.", "Optical depth drives the temperature drop through the radiative forcing of the aerosol layer above the tropopause.", "Settling timescales govern how long the cooling anomaly persists after the source emission stops.", "High-albedo aerosols scatter more incoming shortwave radiation back into space, amplifying the forcing.", "Project the temperature anomaly over the response time of the coupled ocean and atmosphere model grid.", "Advect the aerosol column with the stratospheric wind field at each time step."],
            consts: [["SUN_CONSTANT", "1361.0"], ["FORCING_COEF", "0.042"], ["RESIDENCE", "2.1e7"], ["SOOT_RATE", "5.0e6"], ["TAU_REF", "0.35"]]
        }
    };
    let S = SCENARIOS.ballistic;
    const v = () => pick(S.vars) + (Math.random() < 0.4 ? "_" + R(0, 100) : "");
    const E = () => pick(S.exprs);
    const SIGS = [
        "const SimConfig& cfg, const StateVector& s, double dt, int mode",
        "const TrackState& t, const Measurement& m, const Matrix& Q, const Matrix& R",
        "double target_range, double target_velocity, double elevation, int mode, bool strict",
        "const Config& cfg, const array<double, 6>& state, double t0, double t1, double eps"
    ];
    const OP = ["<", ">", "<=", ">=", "=="];

    const buildFunction = (name) => {
        const lines = [];
        lines.push(pad(0) + pick(["double ", "static double ", "float ", "double "]) + name + "(" + pick(SIGS) + ") {");
        lines.push(pad(1) + "double result = " + E() + " + " + E() + ";");
        const locals = [];
        for (let i = 0, n = R(2, 4); i < n; i++) {
            const lv = v();
            locals.push(lv);
            lines.push(pad(1) + "const double " + lv + " = " + E() + " + " + E() + ";");
        }
        const use = () => pick(locals);
        for (let i = 0, n = R(8, 12); i < n; i++) {
            const t = Math.random();
            if (t < 0.26) lines.push(pad(1) + "result += " + use() + " * " + E() + " + " + E() + ";");
            else if (t < 0.46) lines.push(pad(1) + "// " + pick(S.comments));
            else if (t < 0.60) {
                lines.push(pad(1) + "if (" + use() + " " + pick(OP) + " " + E() + " + " + E() + ") {");
                lines.push(pad(2) + "result += " + use() + " * " + E() + ";");
                lines.push(pad(1) + "}");
            } else if (t < 0.74) lines.push(pad(1) + "result = fmax(result, " + use() + " * " + E() + " + " + E() + ");");
            else if (t < 0.86) lines.push(pad(1) + "samples.push_back(" + use() + " * " + E() + " + " + E() + ");");
            else lines.push(pad(1) + "const char* wgs84 = \"a=6378137.0, f=1/298.257223563, omega=7.292115e-5, GM=3.986004418e14\";");
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
            S.funcs.forEach(fn => lines.push(...buildFunction(fn)));
        }
        lines.push(pad(0) + "int main(int argc, char** argv) {");
        lines.push(pad(1) + "auto cfg = load_config(argv[1]);");
        lines.push(pad(1) + "double r0 = " + S.funcs[0] + "(cfg, 0.0, 1.0);");
        lines.push(pad(1) + "double r1 = " + S.funcs[1] + "(cfg, 1.0, 2.0);");
        lines.push(pad(1) + "fprintf(stderr, \"simulation complete: %.6f %.6f\\n\", r0, r1);");
        lines.push(pad(1) + "return 0;");
        lines.push(pad(0) + "}");
        lines.push("");
        return lines;
    };

    const headerLines = () => {
        const lines = [];
        lines.push("\r\nroot@kali:~# g++ -O3 -march=native " + S.file + " -lm -o sim");
        lines.push("");
        lines.push("/* " + S.file + " - " + S.note + " */");
        lines.push("/* " + pick(["no warranty - research use only", "declassified reference model", "internal audit build"]) + " */");
        lines.push("#include <cmath>");
        lines.push("#include <vector>");
        lines.push("#include <array>");
        lines.push("#include <iostream>");
        lines.push("using namespace std;");
        lines.push("");
        S.consts.forEach(c => lines.push("constexpr double " + c[0] + " = " + c[1] + ";"));
        lines.push("");
        return lines;
    };

    // The whole file (header + program) streams one line per tick: no bursts,
    // so the code never visibly "jumps" to something unrelated.
    let pendingLines = [];
    const nextLine = () => {
        if (!pendingLines.length) {
            S = pick(["ballistic", "radar", "emp", "winter"].map(k => SCENARIOS[k]));
            pendingLines = headerLines().concat(buildProgram());
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
            if (active) return;
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
        },
        hide() {
            if (!active) return;
            active = false;
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
    if (window.screensaver.isActive()) window.screensaver.hide();
};
["mousemove", "mousedown", "keydown", "wheel", "touchstart", "click"].forEach(ev =>
    window.addEventListener(ev, bumpActivity, { passive: true })
);
setInterval(() => {
    if (window.screensaver.isActive()) return;
    if (Object.keys(window.modals).length > 0) return; // keep modals (settings etc.) usable
    if (!window.settings.screensaverEnabled) return;
    let idle = (Number(window.settings.screensaverIdle) || 300) * 1000;
    if (Date.now() - lastActivity > idle) {
        // Idle: lock (fullscreen code + passcode) when lockOnIdle is on,
        // otherwise fall back to the plain screensaver.
        if (window.settings.lockOnIdle !== false && window.lockScreen) window.lockScreen.show();
        else window.screensaver.show();
    }
}, 1000);
