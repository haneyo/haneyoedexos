// Tab 4 webapp panel - a single <webview> that shows whichever installed Chrome
// webapp the user has selected, switched from a dropdown on the shell tab 3
// label. Uses its own persistent partition so logins survive restarts while
// staying isolated from the external Chrome.

class WebappPanel {
    constructor(opts) {
        this.container = typeof opts.parentId === "string" ? document.getElementById(opts.parentId) : opts.parentId;
        this.webapps = opts.webapps || window.webapps;
        this.labelEl = opts.labelId ? document.getElementById(opts.labelId) : null;
        this.selected = null;
        this.webview = null;
        this.apps = [];

        this.menu = document.createElement("div");
        this.menu.className = "webapp_menu";
        this.menu.id = "webapp_menu";
        this.menu.style.display = "none";
        document.body.appendChild(this.menu);

        this._bindOutsideClose();

        // Discovery is async - load the list, then pick the saved/first webapp.
        this.webapps.list().then(list => {
            this.apps = list;
            let start = null;
            try {
                const saved = localStorage.getItem("edex_webapp");
                start = list.find(a => a.name === saved) || list[0];
            } catch (e) { start = list[0]; }
            if (start) this.select(start);
            this._renderMenu();
        });
    }

    select(app) {
        if (!app) return;
        this.selected = app;
        if (this.labelEl) this.labelEl.textContent = app.name;
        try { localStorage.setItem("edex_webapp", app.name); } catch (e) {}
        if (!this.webview) this._buildWebview();
        if (this.webview) this.webview.setAttribute("src", app.url);
        this._renderMenu();
    }

    _buildWebview() {
        this.container.innerHTML = "";
        const wv = document.createElement("webview");
        wv.className = "webapp_webview";
        wv.setAttribute("partition", "persist:edex-webapp");
        wv.setAttribute("webpreferences", "contextIsolation=yes, nodeIntegration=no, sandbox=yes");
        wv.setAttribute("allowpopups", "");
        wv.setAttribute("src", this.selected ? this.selected.url : "about:blank");
        // Popups from a webapp open in the system browser. This is routed via
        // the main process (webview-window-open IPC, see _boot.js) - the
        // <webview> element has no setWindowOpenHandler in modern Electron.
        this.container.appendChild(wv);
        this.webview = wv;

        // Floating fullscreen toggle for the webapp view (true fullscreen via
        // window.webViewFullscreen).
        const btn = document.createElement("button");
        btn.className = "webapp_fullscreen_btn";
        btn.title = "Fullscreen";
        btn.innerHTML = Icons.maximize;
        btn.onclick = () => {
            if (!this.selected || !this.selected.url) return;
            if (window.webViewFullscreen.el) { window.webViewFullscreen.exit(); return; }
            window.webViewFullscreen.enter(this.selected.url, "persist:edex-webapp");
        };
        this.container.appendChild(btn);
    }

    /* Focus entry points used by the shell (via the tab 3 shim). */
    activate() {
        if (this.webview) this.webview.focus();
        else if (this.selected) { this._buildWebview(); this.webview.setAttribute("src", this.selected.url); }
    }

    focus() {
        if (this.webview) this.webview.focus();
    }

    fit() {}

    toggleDevTools() {
        if (!this.webview) return;
        try {
            if (this.webview.isDevToolsOpened()) this.webview.closeDevTools();
            else this.webview.openDevTools({ mode: "detach" });
        } catch (e) {}
    }

    // Re-pull the webapp list (e.g. after the user added one from the browser).
    refresh() {
        this.webapps.list().then(list => {
            this.apps = list;
            if (this.selected && !list.some(a => a.url === this.selected.url)) {
                const first = list[0];
                if (first) this.select(first);
            }
            this._renderMenu();
        });
    }

    /* Dropdown menu on the shell tab 3 label. */
    toggleMenu(ev) {
        if (ev) ev.stopPropagation();
        if (!this.menu) return;
        if (this.menu.style.display === "none") {
            const anchor = ev && ev.currentTarget;
            if (anchor) {
                const r = anchor.getBoundingClientRect();
                this.menu.style.left = Math.max(4, r.left - 20) + "px";
                this.menu.style.top = (r.bottom + 6) + "px";
            }
            this.menu.style.display = "block";
        } else {
            this.menu.style.display = "none";
        }
    }

    closeMenu() {
        if (this.menu) this.menu.style.display = "none";
    }

    _renderMenu() {
        if (!this.menu) return;
        this.menu.innerHTML = "";
        if (!this.apps.length) {
            const empty = document.createElement("div");
            empty.className = "webapp_menu_opt";
            empty.textContent = "No Chrome webapps found";
            this.menu.appendChild(empty);
            return;
        }
        this.apps.forEach(app => {
            const opt = document.createElement("div");
            opt.className = "webapp_menu_opt" + (this.selected && this.selected.name === app.name ? " active" : "");
            if (app.icon) {
                const img = document.createElement("img");
                img.src = app.icon;
                opt.appendChild(img);
            }
            const span = document.createElement("span");
            span.textContent = app.name;
            opt.appendChild(span);
            // Remove button (hover to reveal): custom webapps are truly deleted,
            // Chrome-installed PWAs are hidden from this list.
            const del = document.createElement("button");
            del.className = "webapp_menu_del";
            del.textContent = "×";
            del.title = "Remove from webapps";
            del.onclick = ev => {
                ev.stopPropagation();
                if (window.webapps) window.webapps.removeApp(app);
                this.refresh();
                this._notify("Removed \"" + app.name + "\" from webapps");
            };
            opt.appendChild(del);
            opt.onclick = ev => {
                ev.stopPropagation();
                this.select(app);
                this.closeMenu();
            };
            this.menu.appendChild(opt);
        });
    }

    // Lightweight toast, shared with the browser's (same #edex_toast element).
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
                e.target.closest("#webapp_menu") || e.target.closest(".webapp_chevron"));
            if (!inside) this.closeMenu();
        });
    }
}

module.exports = {
    WebappPanel
};
