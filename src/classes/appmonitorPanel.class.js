// AppMonitorPanel — the GUI-app "virtual display" entry (terminal tab 5, only
// when settings.appMonitor.showGui is on). Displays an installed app inside the
// sci-fi frame, selected from a dropdown on the tab label (the same interaction
// the webapp panel used). Tab 5's fullscreen triangle calls fullscreenButton().
//
//   kind "native" → the <webview> loads the themed noVNC client page, which
//                    streams a nested X display running the app (mock RFB on
//                    dev machines, Xvfb + x11vnc on the Linux distro).
//   kind "web"    → the <webview> loads the app URL directly.
//
// The dropdown reuses the .webapp_menu styling, is keyboard-navigable
// (↑/↓ + Enter + Esc, see memory ui-keyboard-operable), and offers ADD APP to
// register an AppImage path / command / web URL.

// ADD APP icon-picker callback (see _openAddModal): writes the chosen icon id
// into the hidden field and reflects it on the picker button. Kept as a window
// helper so the modal's inline onclick stays short.
window._ampPickIcon = (id) => {
    const h = document.getElementById("appmonitor_add_icon");
    if (h) h.value = id || "";
    const b = document.getElementById("appmonitor_add_icon_btn");
    if (b) b.textContent = id ? ("已选: " + id) : "Choose icon…";
};

class AppMonitorPanel {
    _dbg(msg) {
        try { require("electron").ipcRenderer.send("log", "warn", "[am" + this.monitorId + "] " + msg); } catch (e) {}
    }

    constructor(opts) {
        this.container = typeof opts.parentId === "string" ? document.getElementById(opts.parentId) : opts.parentId;
        this.monitorId = opts.monitorId;                 // "a" | "b"
        this.labelEl = opts.labelId ? document.getElementById(opts.labelId) : null;
        this.selected = null;
        this.webview = null;                 // native client webview (streams the X display)
        this._webviews = {};                 // web apps kept running in the background: id -> webview
        this.apps = [];
        this.config = null;
        this.menuFocusIdx = -1;
        this.runningApps = new Set();          // app ids currently running (dot marker / close button)
        this.runningStates = new Map();        // appId -> "running" | "starting" | "exited"
        this._statusTimer = null;
        // Launch-count tracking (persisted) for the "运行频度" sort mode.
        this._launchCounts = {};
        try { this._launchCounts = JSON.parse(localStorage.getItem("edex_app_launches") || "{}"); } catch (e) {}

        this.menu = document.createElement("div");
        this.menu.className = "webapp_menu appmonitor_menu";
        this.menu.id = "appmonitor_menu_" + this.monitorId;
        this.menu.style.display = "none";
        this.menu.setAttribute("tabindex", "-1");
        document.body.appendChild(this.menu);

        this._bindOutsideClose();
        this._bindMenuKeys();

        this.init();
    }

    /* Fetch backend config (with retry — the backend is spawned right before
       the window, so it may still be coming up), then the app list, then show
       the saved / first app. */
    async init() {
        this.config = await this._getConfig();
        try {
            const res = await window.appmonitorApi.nativeList();
            (res && res.apps || []).forEach(n => this.apps.push(Object.assign({}, n, { kind: "native" })));
        } catch (e) {}
        try {
            const web = await window.webapps.list();
            (web || []).forEach(w => {
                if (!this.apps.some(a => a.name === w.name)) this.apps.push(Object.assign({}, w, { kind: "web" }));
            });
        } catch (e) {}

        let saved = null;
        try { saved = localStorage.getItem("edex_monitor_" + this.monitorId + "_app"); } catch (e) {}
        // No saved app → prefer a native app so the monitor shows its app-display
        // capability immediately; fall back to the first app in the list.
        const start = (saved && this.apps.find(a => a.name === saved))
            || this.apps.find(a => a.kind === "native")
            || this.apps[0];
        if (this.labelEl && !start) {
            this.labelEl.textContent = (window.cover && window.cover.isActive())
                ? window.cover.fakeMonitorLabel(this.monitorId)
                : "GUI APPS";
        }
        if (start) this.select(start);
        await this._fetchStatus();
        this._sortApps();
        if (!this._statusTimer) this._statusTimer = setInterval(() => this._fetchStatus(), 3000);
        this._renderMenu();
    }

    async _getConfig() {
        for (let i = 0; i < 20; i++) {
            try {
                const c = await window.appmonitorApi.config();
                if (c && c.ok) return c;
            } catch (e) {}
            await new Promise(r => setTimeout(r, 250));
        }
        return null;
    }

    select(app) {
        if (!app) return;
        this.selected = app;
        if (this.labelEl) {
            this.labelEl.textContent = (window.cover && window.cover.isActive())
                ? window.cover.fakeMonitorLabel(this.monitorId)
                : app.name;
        }
        try { localStorage.setItem("edex_monitor_" + this.monitorId + "_app", app.name); } catch (e) {}
        this._trackLaunch(app);
        if (app.kind === "native") this._showNativeWebview(app);
        else this._showWebWebview(app);
        this._renderMenu();
    }

    // Show the monitor's native client webview (streams the nested X display)
    // and launch the app on the backend. Hides any open web-app webviews.
    _showNativeWebview(app) {
        Object.keys(this._webviews).forEach(id => {
            if (this._webviews[id]) this._webviews[id].style.display = "none";
        });
        if (!this.webview || !this.webview.isConnected) {
            this.webview = document.createElement("webview");
            this.webview.className = "appmonitor_webview";
            this.webview.setAttribute("partition", "persist:edex-monitor-" + this.monitorId);
            this.webview.setAttribute("webpreferences", "contextIsolation=yes, nodeIntegration=no, sandbox=yes");
            this.webview.setAttribute("allowpopups", "");
            this.container.appendChild(this.webview);
        }
        this.webview.style.display = "";
        this.webview.setAttribute("src", app ? this._clientUrl(app) : "about:blank");
        if (app) window.appmonitorApi.launch(this.monitorId, app.id);
    }

    // Show (or create, on first open) this web app's own persistent webview.
    // The others — native client and other web apps — stay hidden but keep
    // running, so switching back shows the same loaded page (no reload).
    _showWebWebview(app) {
        if (this.webview) this.webview.style.display = "none";
        Object.keys(this._webviews).forEach(id => {
            if (id !== app.id && this._webviews[id]) this._webviews[id].style.display = "none";
        });
        let wv = this._webviews[app.id];
        if (!wv || !wv.isConnected) {
            wv = document.createElement("webview");
            wv.className = "appmonitor_webview";
            wv.setAttribute("partition", "persist:edex-monitor-" + this.monitorId);
            wv.setAttribute("webpreferences", "contextIsolation=yes, nodeIntegration=no, sandbox=yes");
            wv.setAttribute("allowpopups", "");
            wv.setAttribute("src", app.url);
            this.container.appendChild(wv);
            this._webviews[app.id] = wv;
        } else {
            wv.style.display = "";
        }
    }

    _clientUrl(app) {
        if (!this.config) return "about:blank";
        const m = this.config.monitors[this.monitorId];
        if (!m) return "about:blank";
        const q = new URLSearchParams({
            wsUrl: m.wsUrl,
            autoconnect: "1",
            r: window.theme.r,
            g: window.theme.g,
            b: window.theme.b,
            font: window.theme.cssvars.font_main_light,
            name: app.name
        });
        return "http://127.0.0.1:" + this.config.httpPort + "/client.html?" + q.toString();
    }

    /* Enter fullscreen from the tab's top-left triangle button. */
    fullscreenButton() {
        if (!this.selected) return;
        // Native apps: run COMPLETELY natively on the real display (the
        // shell gets covered; a corner button / global hotkey returns).
        if (this.selected.kind === "native") {
            window.appmonitorApi.fullscreen(this.monitorId, this.selected.id).then(r => {
                if (r && !r.ok) {
                    this._notify((r.error === "mock mode has no real display")
                        ? "Native fullscreen requires the Linux system"
                        : (r.error || "Fullscreen unavailable"));
                }
            });
            return;
        }
        // Web apps: fullscreen the streamed/embedded webview.
        const src = this.selected.url;
        if (!src) return;
        if (window.webViewFullscreen.el) { window.webViewFullscreen.exit(); return; }
        window.webViewFullscreen.enter(src, "persist:edex-monitor-" + this.monitorId);
    }

    /* ---- Focus entry points used by the shell (via the term shim) ---- */
    activate() {
        if (!this.selected) return;
        if (this.selected.kind === "web") {
            let wv = this._webviews[this.selected.id];
            if (!wv || !wv.isConnected) this._showWebWebview(this.selected);
            wv = this._webviews[this.selected.id];
            if (wv) wv.focus();
        } else {
            if (this.webview) this.webview.focus();
            else this._showNativeWebview(this.selected);
        }
    }
    focus() {
        if (this.selected && this.selected.kind === "web") {
            const wv = this._webviews[this.selected.id];
            if (wv) wv.focus();
        } else if (this.webview) this.webview.focus();
    }
    fit() {}

    toggleDevTools() {
        if (!this.webview) return;
        try {
            if (this.webview.isDevToolsOpened()) this.webview.closeDevTools();
            else this.webview.openDevTools({ mode: "detach" });
        } catch (e) {}
    }

    /* ---- Dropdown menu on the tab label ---- */
    toggleMenu(ev) {
        if (ev) ev.stopPropagation();
        if (!this.menu) return;
        if (this.menu.style.display === "none") {
            if (ev && ev.currentTarget) {
                const r = ev.currentTarget.getBoundingClientRect();
                this.menu.style.left = Math.max(4, r.left - 20) + "px";
                this.menu.style.top = (r.bottom + 6) + "px";
            }
            this.menu.style.display = "block";
            // Re-scan the app list (e.g. a new AppImage just dropped into
            // ~/Applications) so it shows up without restarting eDEX.
            this.refresh();
            // Focus the menu (tabindex=-1) so the ↑/↓/Enter/Esc keydown handler
            // actually fires; _focusMenu + scrollIntoView then scrolls a long
            // list with the arrow keys (the wheel scrolls via overflow-y:auto).
            this.menu.focus();
            this._focusMenu(0);
        } else {
            this.closeMenu();
        }
    }

    closeMenu() {
        if (this.menu) this.menu.style.display = "none";
        this.menuFocusIdx = -1;
    }

    _focusMenu(idx) {
        const opts = this.menu.querySelectorAll(".appmonitor_opt");
        if (!opts.length) return;
        this.menuFocusIdx = Math.max(0, Math.min(idx, opts.length - 1));
        opts.forEach((o, i) => {
            o.classList.toggle("active", i === this.menuFocusIdx);
            if (i === this.menuFocusIdx) o.scrollIntoView({ block: "nearest" });
        });
    }

    _bindMenuKeys() {
        this.menu.addEventListener("keydown", e => {
            const opts = this.menu.querySelectorAll(".appmonitor_opt");
            if (!opts.length) return;
            e.stopPropagation();
            if (e.key === "ArrowDown" || e.key === "ArrowRight") { e.preventDefault(); this._focusMenu(this.menuFocusIdx + 1); }
            else if (e.key === "ArrowUp" || e.key === "ArrowLeft") { e.preventDefault(); this._focusMenu(this.menuFocusIdx - 1); }
            else if (e.key === "Enter") { e.preventDefault(); const o = opts[this.menuFocusIdx]; if (o) o.click(); }
            else if (e.key === "Escape") { e.preventDefault(); this.closeMenu(); if (this.webview) this.webview.focus(); }
        });
    }

    _renderMenu() {
        if (!this.menu) return;
        this.menu.innerHTML = "";

        const add = document.createElement("div");
        add.className = "webapp_menu_opt appmonitor_opt appmonitor_menu_add";
        add.textContent = "+ ADD APP";
        add.onclick = ev => { ev.stopPropagation(); this.addApp(); };
        this.menu.appendChild(add);

        this.apps.forEach(app => {
            const opt = document.createElement("div");
            const isRunning = this.runningApps.has(app.id);
            opt.className = "webapp_menu_opt appmonitor_opt" + (this.selected && this.selected.name === app.name ? " active" : "");
            // Leftmost column: the reserved running-dot slot (fixed width so
            // the rest never shifts when a dot appears or disappears).
            const dotSlot = document.createElement("span");
            dotSlot.className = "appmonitor_dot_slot";
            if (isRunning) {
                const state = (this.runningStates && this.runningStates.get(app.id)) || "running";
                const dot = document.createElement("span");
                dot.className = "appmonitor_dot appmonitor_dot_" + state;
                dot.title = state === "exited"
                    ? "App exited / crashed"
                    : (state === "starting" ? "Starting…" : "Running in background");
                dotSlot.appendChild(dot);
            }
            opt.appendChild(dotSlot);
            // Icon column (fixed width so names line up). Resolution order:
            // shared icon-library id → inline SVG; otherwise a .desktop icon
            // path → <img>; otherwise a generic placeholder glyph.
            const iconSlot = document.createElement("span");
            iconSlot.className = "appmonitor_icon_slot";
            const libIcon = window.iconLibrary && window.iconLibrary.get(app.icon);
            if (libIcon) {
                iconSlot.innerHTML = libIcon;
            } else if (app.icon) {
                const img = document.createElement("img");
                img.src = app.icon;
                iconSlot.appendChild(img);
            } else {
                iconSlot.innerHTML = '<svg class="appmonitor_icon_ph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><rect x="3.5" y="3.5" width="17" height="17" rx="3"/><circle cx="12" cy="12" r="3.5"/></svg>';
            }
            opt.appendChild(iconSlot);
            const span = document.createElement("span");
            span.className = "appmonitor_name";
            span.textContent = app.name;
            opt.appendChild(span);
            // Running apps get a close (×) button — it stops the app (native:
            // kill the process; web: drop the background webview). It does NOT
            // uninstall anything (uninstall happens via the command line or the
            // file manager).
            if (isRunning) {
                const close = document.createElement("button");
                close.className = "webapp_menu_del";
                close.textContent = "×";
                close.title = "Close app";
                close.onclick = ev => {
                    ev.stopPropagation();
                    this._closeApp(app);
                };
                opt.appendChild(close);
            }
            opt.onclick = ev => {
                ev.stopPropagation();
                this.select(app);
                this.closeMenu();
            };
            this.menu.appendChild(opt);
        });

        if (!this.apps.length) {
            const empty = document.createElement("div");
            empty.className = "webapp_menu_opt";
            empty.textContent = "No apps found";
            this.menu.appendChild(empty);
        }
    }

    // Close a running app. Native: stop its process on the backend. Web: drop
    // its background webview. Uninstalling is NOT done here — remove the
    // AppImage / package via the command line or the file manager.
    _closeApp(app) {
        if (app.kind === "web") {
            const wv = this._webviews[app.id];
            if (wv) { try { wv.remove(); } catch (e) {} }
            delete this._webviews[app.id];
            if (this.selected === app) {
                // the closed app was on screen — fall back to the native view
                this.selected = null;
                this._showNativeWebview(this.apps.find(a => a.kind === "native"));
            }
            this._fetchStatus();
            this._renderMenu();
            return;
        }
        window.appmonitorApi.close(app.id).then(() => {
            this._notify("Closed \"" + app.name + "\"");
            this._fetchStatus();
            this._renderMenu();
        });
    }

    async refresh() {
        this.apps = [];
        try {
            const res = await window.appmonitorApi.nativeList();
            (res && res.apps || []).forEach(n => this.apps.push(Object.assign({}, n, { kind: "native" })));
        } catch (e) {}
        try {
            const web = await window.webapps.list();
            (web || []).forEach(w => {
                if (!this.apps.some(a => a.name === w.name)) this.apps.push(Object.assign({}, w, { kind: "web" }));
            });
        } catch (e) {}
        if (this.selected && !this.apps.some(a => a.name === this.selected.name)) {
            const first = this.apps[0];
            if (first) this.select(first);
        }
        await this._fetchStatus();
        this._sortApps();
        this._renderMenu();
    }

    /* Fetch which apps are currently running (per monitor) so the dropdown can
       mark them with a state dot (green running / amber starting / red exited)
       and offer a close (×) button. */
    async _fetchStatus() {
        try {
            const res = await window.appmonitorApi.status();
            const monitors = (res && res.monitors) || {};
            const ids = new Set();
            const states = new Map();           // appId -> "running" | "starting" | "exited"
            for (const m of Object.keys(monitors)) {
                const entry = monitors[m];
                if (entry && entry.id) {
                    ids.add(entry.id);
                    states.set(entry.id, entry.state || "running");
                }
            }
            // Web apps run in their own persistent webview (not via the backend),
            // so every web app currently open on EITHER monitor counts as running
            // for the green dot.
            const sibling = (this.monitorId === "a") ? window.appmonitorB : window.appmonitorA;
            [this, sibling].forEach(p => {
                if (!p) return;
                Object.keys(p._webviews || {}).forEach(id => {
                    ids.add(id);
                    states.set(id, "running");
                });
            });
            const changed = ids.size !== this.runningApps.size
                || [...ids].some(id => !this.runningApps.has(id));
            this.runningApps = ids;
            this.runningStates = states;
            // Live-update an open menu so the dots/× track apps starting/closing
            // and running apps move to the top.
            if (changed && this.menu && this.menu.style.display !== "none") {
                this._sortApps();
                this._renderMenu();
                if (this.menuFocusIdx >= 0) this._focusMenu(this.menuFocusIdx);
            }
        } catch (e) {}
    }

    /* Record a launch (for the "运行频度" sort mode) and persist the counts. */
    _trackLaunch(app) {
        if (!app) return;
        const key = app.name;
        this._launchCounts[key] = (this._launchCounts[key] || 0) + 1;
        try { localStorage.setItem("edex_app_launches", JSON.stringify(this._launchCounts)); } catch (e) {}
    }

    /* Sort this.apps: running apps always first, then by the configured mode
       (name / install time / launch frequency × ascending / descending). */
    _sortApps() {
        const mode = (window.settings && window.settings.appSort) || "name-asc";
        const [field, dir] = String(mode).split("-");
        const sign = dir === "desc" ? -1 : 1;
        this.apps.sort((a, b) => {
            const ra = a.kind === "native" && this.runningApps.has(a.id) ? 0 : 1;
            const rb = b.kind === "native" && this.runningApps.has(b.id) ? 0 : 1;
            if (ra !== rb) return ra - rb;
            let cmp = 0;
            if (field === "install") cmp = (a.installed || 0) - (b.installed || 0);
            else if (field === "freq") cmp = (this._launchCounts[a.name] || 0) - (this._launchCounts[b.name] || 0);
            else cmp = a.name.localeCompare(b.name);
            cmp *= sign;
            return cmp || a.name.localeCompare(b.name);
        });
    }

    /* ---- ADD APP ---- */
    addApp() {
        this.closeMenu();
        this._openAddModal();
    }

    _openAddModal() {
        new Modal({
            type: "custom",
            title: "ADD APP",
            html: `
                <div class="appmonitor_add">
                    <label>NAME</label>
                    <input type="text" id="appmonitor_add_name" placeholder="App name">
                    <label>PATH / COMMAND</label>
                    <input type="text" id="appmonitor_add_value"
                           placeholder="AppImage path / command">
                    <label>ICON</label>
                    <button type="button" id="appmonitor_add_icon_btn" class="settings_net_btn" onclick="window.iconLibrary&&window.iconLibrary.pickerModal(window._ampPickIcon)">Choose icon…</button>
                    <input type="hidden" id="appmonitor_add_icon" value="">
                </div>`,
            buttons: [{ label: "Add", action: `window.appmonitor${this.monitorId === "a" ? "A" : "B"}.submitAdd()` }]
        });
    }

    submitAdd() {
        const name = document.getElementById("appmonitor_add_name");
        const value = document.getElementById("appmonitor_add_value");
        const iconEl = document.getElementById("appmonitor_add_icon");
        if (!name || !value || !name.value.trim() || !value.value.trim()) {
            this._notify("Name and value are required");
            return;
        }
        const n = name.value.trim(), v = value.value.trim();
        const icon = (iconEl && iconEl.value) ? iconEl.value : null;
        window.appmonitorApi.addNative({ name: n, value: v, icon: icon }).then(r => {
            if (!r || !r.ok) { this._notify("Could not add \"" + n + "\""); return; }
            this._notify("Added \"" + n + "\"");
        });
        this.refresh();
        this._closeModal("appmonitor_add");
    }

    _closeModal(id) {
        try { if (window.modals && window.modals[id]) window.modals[id].close(); } catch (e) {}
    }

    /* Lightweight toast, shared with the browser's (#edex_toast). */
    _notify(msg) {
        let t = document.getElementById("edex_toast");
        if (!t) {
            t = document.createElement("div");
            t.id = "edex_toast";
            t.className = "browser_toast";
            document.body.appendChild(t);
        }
        t.textContent = msg;
        t.classList.add("show");
        clearTimeout(this._notifyTimer);
        this._notifyTimer = setTimeout(() => t.classList.remove("show"), 2200);
    }

    _bindOutsideClose() {
        document.addEventListener("click", e => {
            if (!this.menu || this.menu.style.display === "none") return;
            const inside = e.target && e.target.closest && (
                e.target.closest("#appmonitor_menu_" + this.monitorId) ||
                e.target.closest(".webapp_chevron"));
            if (!inside) this.closeMenu();
        });
    }
}

module.exports = { AppMonitorPanel };
