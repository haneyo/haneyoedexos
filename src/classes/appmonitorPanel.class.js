// AppMonitorPanel — a "virtual monitor" (terminal tab 4 / 5) that displays an
// installed app inside the sci-fi frame, selected from a dropdown on the tab
// label (the same interaction the webapp panel used).
//
//   kind "native" → the <webview> loads the themed noVNC client page, which
//                    streams a nested X display running the app (mock RFB on
//                    dev machines, Xvfb + x11vnc on the Linux distro).
//   kind "web"    → the <webview> loads the app URL directly.
//
// The dropdown reuses the .webapp_menu styling, is keyboard-navigable
// (↑/↓ + Enter + Esc, see memory ui-keyboard-operable), and offers ADD APP to
// register an AppImage path / command / web URL.

class AppMonitorPanel {
    _dbg(msg) {
        try { require("electron").ipcRenderer.send("log", "warn", "[am" + this.monitorId + "] " + msg); } catch (e) {}
    }

    constructor(opts) {
        this.container = typeof opts.parentId === "string" ? document.getElementById(opts.parentId) : opts.parentId;
        this.monitorId = opts.monitorId;                 // "a" | "b"
        this.labelEl = opts.labelId ? document.getElementById(opts.labelId) : null;
        this.selected = null;
        this.webview = null;
        this.apps = [];
        this.config = null;
        this.menuFocusIdx = -1;

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
        if (this.apps.length) this.apps.sort((a, b) => a.name.localeCompare(b.name));

        let saved = null;
        try { saved = localStorage.getItem("edex_monitor_" + this.monitorId + "_app"); } catch (e) {}
        // No saved app → prefer a native app so the monitor shows its app-display
        // capability immediately; fall back to the first app in the list.
        const start = (saved && this.apps.find(a => a.name === saved))
            || this.apps.find(a => a.kind === "native")
            || this.apps[0];
        if (this.labelEl && !start) this.labelEl.textContent = this.monitorId === "a" ? "MONITOR A" : "MONITOR B";
        if (start) this.select(start);
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
        if (this.labelEl) this.labelEl.textContent = app.name;
        try { localStorage.setItem("edex_monitor_" + this.monitorId + "_app", app.name); } catch (e) {}
        if (!this.webview) this._buildWebview();
        if (app.kind === "native") {
            window.appmonitorApi.launch(this.monitorId, app.id);   // starts/kills on the real backend; switches the mock scene
            this.webview.setAttribute("src", this._clientUrl(app));
        } else {
            this.webview.setAttribute("src", app.url);
        }
        this._renderMenu();
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

    _buildWebview() {
        this.container.innerHTML = "";
        const wv = document.createElement("webview");
        wv.className = "appmonitor_webview";
        wv.setAttribute("partition", "persist:edex-monitor-" + this.monitorId);
        wv.setAttribute("webpreferences", "contextIsolation=yes, nodeIntegration=no, sandbox=yes");
        wv.setAttribute("allowpopups", "");
        wv.setAttribute("src", this.selected ? (this.selected.kind === "web" ? this.selected.url : this._clientUrl(this.selected)) : "about:blank");
        this.container.appendChild(wv);
        this.webview = wv;

        const btn = document.createElement("button");
        btn.className = "webapp_fullscreen_btn";
        btn.title = "Fullscreen";
        btn.innerHTML = Icons.maximize;
        btn.onclick = () => {
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
        };
        this.container.appendChild(btn);
    }

    /* ---- Focus entry points used by the shell (via the term shim) ---- */
    activate() { if (this.webview) this.webview.focus(); else if (this.selected) { this._buildWebview(); } }
    focus() { if (this.webview) this.webview.focus(); }
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
            opt.className = "webapp_menu_opt appmonitor_opt" + (this.selected && this.selected.name === app.name ? " active" : "");
            if (app.icon) {
                const img = document.createElement("img");
                img.src = app.icon;
                opt.appendChild(img);
            } else {
                const badge = document.createElement("span");
                badge.className = "appmonitor_badge";
                badge.textContent = app.kind === "web" ? "WEB" : "APP";
                opt.appendChild(badge);
            }
            const span = document.createElement("span");
            span.textContent = app.name;
            opt.appendChild(span);
            if (app.custom || (app.kind === "web" && app.custom)) {
                const del = document.createElement("button");
                del.className = "webapp_menu_del";
                del.textContent = "×";
                del.title = "Remove";
                del.onclick = ev => {
                    ev.stopPropagation();
                    this._removeApp(app);
                };
                opt.appendChild(del);
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

    _removeApp(app) {
        if (app.kind === "web" && window.webapps) { window.webapps.removeApp(app); this._notify("Removed \"" + app.name + "\""); }
        else { window.appmonitorApi.removeNative(app.id); this._notify("Removed \"" + app.name + "\""); }
        this.refresh();
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
        if (this.apps.length) this.apps.sort((a, b) => a.name.localeCompare(b.name));
        if (this.selected && !this.apps.some(a => a.name === this.selected.name)) {
            const first = this.apps[0];
            if (first) this.select(first);
        }
        this._renderMenu();
    }

    /* ---- ADD APP ---- */
    addApp() {
        this.closeMenu();
        this._openAddModal();
    }

    _openAddModal() {
        new Modal({
            type: "custom",
            title: "ADD APP — MONITOR " + this.monitorId.toUpperCase(),
            html: `
                <div class="appmonitor_add">
                    <label>TYPE</label>
                    <select id="appmonitor_add_type"><option>native</option><option>web</option></select>
                    <label>NAME</label>
                    <input type="text" id="appmonitor_add_name" placeholder="App name">
                    <label>VALUE</label>
                    <input type="text" id="appmonitor_add_value"
                           placeholder="AppImage path / command / https:// URL">
                </div>`,
            buttons: [{ label: "Add", action: `window.appmonitor${this.monitorId === "a" ? "A" : "B"}.submitAdd()` }]
        });
    }

    submitAdd() {
        const name = document.getElementById("appmonitor_add_name");
        const value = document.getElementById("appmonitor_add_value");
        const type = document.getElementById("appmonitor_add_type");
        if (!name || !value || !name.value.trim() || !value.value.trim()) {
            this._notify("Name and value are required");
            return;
        }
        const n = name.value.trim(), v = value.value.trim();
        if (type && type.value === "web" && /^https?:\/\//i.test(v)) {
            if (window.webapps) { window.webapps.addCustom(n, v); }
        } else {
            window.appmonitorApi.addNative({ name: n, value: v }).then(r => {
                if (!r || !r.ok) { this._notify("Could not add \"" + n + "\""); return; }
                this._notify("Added \"" + n + "\"");
            });
        }
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
