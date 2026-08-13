// CliPanel — "MONITOR A / B" (terminal tabs 4 & 5) run CLI apps with a TUI.
//
// Instead of the retired virtual-display app monitor (AppMonitorPanel), these
// tabs launch command-line apps that have their own user interface (claude,
// browsh, aerc, htop, btop) inside a real terminal session. Each entry is
// started by asking the main process for a new pty via
// `ipcRenderer.send("ttyspawn", { cli: [cmd, ...args] })`; the main process
// replies with a port and this side attaches a client-side Terminal to it.
//
// Origin: packaging/patch-appimage.sh (CLI_PANEL_CLASS). Behavior is kept
// byte-equivalent so the patch-injected copy and this source stay
// interchangeable. The AppMonitorPanel-style menu (chevron on the tab label)
// is reused: arrow keys + Enter to launch, Esc to close.
const _cliIpc = require("electron").ipcRenderer;

const _cliIcons = {
    ai: '<svg class="appmonitor_icon_ph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>',
    browser: '<svg class="appmonitor_icon_ph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
    monitor: '<svg class="appmonitor_icon_ph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>',
    mail: '<svg class="appmonitor_icon_ph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>',
    terminal: '<svg class="appmonitor_icon_ph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>'
};

window.cliApps = [
    { id: "claude", name: "Claude", cmd: ["claude"], icon: "ai" },
    { id: "browsh", name: "browsh", cmd: ["browsh", "--startup-url", "https://lite.duckduckgo.com/lite"], icon: "browser" },
    { id: "aerc", name: "aerc", cmd: ["aerc"], icon: "mail" },
    { id: "htop", name: "htop", cmd: ["htop"], icon: "monitor" },
    { id: "btop", name: "BTOP", cmd: ["btop"], icon: "monitor" }
];

// Merge custom apps the user added via the "+ ADD APP" dialog.
try {
    const _u = JSON.parse(localStorage.getItem("edex_cli_apps") || "[]");
    if (Array.isArray(_u)) _u.forEach(_a => {
        if (_a && _a.cmd && _a.cmd[0] && !window.cliApps.some(_x => _x.id === _a.id))
            window.cliApps.push({ id: _a.id, name: _a.name || _a.cmd[0], cmd: _a.cmd });
    });
} catch (e) {}

(function () {
    try {
        const s = document.createElement("style");
        s.id = "edex_cli_css";
        s.textContent = ".cli_session{position:absolute;inset:0;display:none;overflow:hidden}.cli_session.active{display:block}";
        document.head.appendChild(s);
    } catch (e) {}
})();

class CliPanel {
    constructor(o) {
        this.container = document.getElementById(o.parentId);
        this.monitorId = o.monitorId;
        this.labelEl = document.getElementById(o.labelId);
        this.selected = null;
        this.sessions = {};
        this._spawning = false;
        this.menuFocusIdx = -1;
        this.menu = document.createElement("div");
        this.menu.className = "webapp_menu appmonitor_menu";
        this.menu.id = "appmonitor_menu_" + this.monitorId;
        this.menu.style.display = "none";
        this.menu.setAttribute("tabindex", "-1");
        document.body.appendChild(this.menu);
        const _t = this;
        document.addEventListener("click", e => {
            if (!_t.menu || _t.menu.style.display === "none") return;
            const _i = e.target && e.target.closest && (e.target.closest("#appmonitor_menu_" + _t.monitorId) || e.target.closest(".webapp_chevron"));
            if (!_i) _t.closeMenu();
        });
        this.menu.addEventListener("keydown", e => {
            const _o = _t.menu.querySelectorAll(".appmonitor_opt");
            if (!_o.length) return;
            e.stopPropagation();
            if (e.key === "ArrowDown" || e.key === "ArrowRight") { e.preventDefault(); _t._focusMenu(_t.menuFocusIdx + 1); }
            else if (e.key === "ArrowUp" || e.key === "ArrowLeft") { e.preventDefault(); _t._focusMenu(_t.menuFocusIdx - 1); }
            else if (e.key === "Enter") { e.preventDefault(); const _x = _o[_t.menuFocusIdx]; if (_x) _x.click(); }
            else if (e.key === "Escape") { e.preventDefault(); _t.closeMenu(); }
        });
        if (this.labelEl) this.labelEl.textContent = "a" === this.monitorId ? "MONITOR A" : "MONITOR B";
    }

    focus() {
        if (this.selected && this.sessions[this.selected.id]) {
            const _s = this.sessions[this.selected.id];
            Object.keys(this.sessions).forEach(_k => {
                const _e = this.sessions[_k].el;
                if (_e) _e.classList.toggle("active", _k === this.selected.id);
            });
            if (_s.term && _s.term.term && _s.term.term.focus) _s.term.term.focus();
        }
    }

    activate() {
        this.focus();
    }

    toggleMenu(ev) {
        if (ev) ev.stopPropagation();
        if (!this.menu) return;
        if (this.menu.style.display === "none") {
            if (ev && ev.currentTarget) {
                const _r = ev.currentTarget.getBoundingClientRect();
                this.menu.style.left = Math.max(4, _r.left - 20) + "px";
                this.menu.style.top = (_r.bottom + 6) + "px";
            }
            this.menu.style.display = "block";
            this.menu.focus();
            this._renderMenu();
            this._focusMenu(0);
        } else this.closeMenu();
    }

    closeMenu() {
        if (this.menu) this.menu.style.display = "none";
        this.menuFocusIdx = -1;
    }

    _focusMenu(i) {
        const _o = this.menu.querySelectorAll(".appmonitor_opt");
        if (!_o.length) return;
        this.menuFocusIdx = Math.max(0, Math.min(i, _o.length - 1));
        _o.forEach((x, j) => {
            x.classList.toggle("active", j === this.menuFocusIdx);
            if (j === this.menuFocusIdx) x.scrollIntoView({ block: "nearest" });
        });
    }

    _renderMenu() {
        if (!this.menu) return;
        this.menu.innerHTML = "";
        const _add = document.createElement("div");
        _add.className = "webapp_menu_opt appmonitor_opt appmonitor_menu_add";
        _add.textContent = "+ ADD APP";
        _add.onclick = e => { e.stopPropagation(); this._addApp(); };
        this.menu.appendChild(_add);
        window.cliApps.forEach(_a => {
            const _opt = document.createElement("div");
            const _run = this.sessions[_a.id];
            _opt.className = "webapp_menu_opt appmonitor_opt" + (this.selected && this.selected.id === _a.id ? " active" : "");
            const _dot = document.createElement("span");
            _dot.className = "appmonitor_dot_slot";
            if (_run && (_run.starting || _run.term)) {
                const _d = document.createElement("span");
                _d.className = "appmonitor_dot appmonitor_dot_" + (_run.starting ? "starting" : "running");
                _dot.appendChild(_d);
            }
            _opt.appendChild(_dot);
            const _ic = document.createElement("span");
            _ic.className = "appmonitor_icon_slot";
            _ic.innerHTML = _cliIcons[_a.icon] || _cliIcons.terminal;
            _opt.appendChild(_ic);
            const _nm = document.createElement("span");
            _nm.className = "appmonitor_name";
            _nm.textContent = _a.name;
            _opt.appendChild(_nm);
            if (_run && _run.term) {
                const _cl = document.createElement("button");
                _cl.className = "webapp_menu_del";
                _cl.textContent = "×";
                _cl.title = "关闭会话";
                _cl.onclick = e => { e.stopPropagation(); this._closeSession(_a.id); };
                _opt.appendChild(_cl);
            }
            _opt.onclick = e => { e.stopPropagation(); this.select(_a); this.closeMenu(); };
            this.menu.appendChild(_opt);
        });
        if (!window.cliApps.length) {
            const _em = document.createElement("div");
            _em.className = "webapp_menu_opt";
            _em.textContent = "No apps";
            this.menu.appendChild(_em);
        }
    }

    select(_a) {
        if (!_a) return;
        this.selected = _a;
        if (this.labelEl) this.labelEl.textContent = _a.name;
        this._renderMenu();
        if (this.sessions[_a.id]) { this.focus(); return; }
        if (this._spawning) return;
        this._startSession(_a);
    }

    _startSession(_a) {
        const _t = this, _sid = _a.id + "_" + Math.floor(1e6 * Math.random());
        const _s = { id: _a.id, sid: _sid, starting: true, term: null, el: null };
        this.sessions[_a.id] = _s;
        this._spawning = true;
        const _box = this.container;
        if (!_box) return this._abortSpawn(_a);
        const _el = document.createElement("div");
        _el.className = "cli_session";
        _el.id = _sid;
        _box.appendChild(_el);
        _s.el = _el;
        _el.classList.add("active");
        Object.keys(this.sessions).forEach(_k => {
            if (_k !== _a.id && this.sessions[_k].el) this.sessions[_k].el.classList.remove("active");
        });
        _cliIpc.send("ttyspawn", { cli: _a.cmd });
        _cliIpc.once("ttyspawn-reply", (e, r) => {
            this._spawning = false;
            if (String(r).startsWith("ERROR")) {
                _s.starting = false;
                if (_el.parentNode) _el.parentNode.removeChild(_el);
                delete _t.sessions[_a.id];
                _t._renderMenu();
                return;
            }
            const _port = Number(String(r).substr(9));
            let _term = null;
            try {
                _term = new Terminal({ role: "client", parentId: _sid, port: _port });
            } catch (_e) {
                _s.starting = false;
                _t._renderMenu();
                return;
            }
            _term.onclose = () => {
                try { if (_term.term && _term.term.dispose) _term.term.dispose(); } catch (_e) {}
                if (_el.parentNode) _el.parentNode.removeChild(_el);
                delete _t.sessions[_a.id];
                if (_t.selected && _t.selected.id === _a.id && _t.labelEl) _t.labelEl.textContent = "a" === _t.monitorId ? "MONITOR A" : "MONITOR B";
                _t._renderMenu();
            };
            _s.starting = false;
            _s.term = _term;
            _t._renderMenu();
        });
    }

    _abortSpawn(_a) {
        this._spawning = false;
        if (this.sessions[_a.id]) delete this.sessions[_a.id];
        if (this.labelEl) this.labelEl.textContent = "a" === this.monitorId ? "MONITOR A" : "MONITOR B";
        this._renderMenu();
    }

    _closeSession(_id) {
        const _s = this.sessions[_id];
        if (!_s) return;
        if (_s.term) {
            try {
                if (_s.term.onclose) _s.term.onclose = null;
                if (_s.term.term && _s.term.term.dispose) _s.term.term.dispose();
            } catch (_e) {}
        }
        if (_s.el && _s.el.parentNode) _s.el.parentNode.removeChild(_s.el);
        delete this.sessions[_id];
        if (this.selected && this.selected.id === _id && this.labelEl) this.labelEl.textContent = "a" === this.monitorId ? "MONITOR A" : "MONITOR B";
        this._renderMenu();
    }

    _addApp() {
        this.closeMenu();
        try { if (window.cliAddModal && window.cliAddModal.close) window.cliAddModal.close(); } catch (_e) {}
        const _pn = "a" === this.monitorId ? "A" : "B";
        window.cliAddModal = new Modal({
            type: "custom",
            title: "ADD APP",
            html: '<div class="appmonitor_add"><label>启动命令</label><input type="text" id="cli_add_cmd" placeholder="如 btop 或 ncmpcpp" style="width:100%"></div>',
            buttons: [{ label: "Add", action: "window.cliAddModal&&window.cliAddModal.close();window.appmonitor" + _pn + ".submitCliAdd()" }]
        });
    }

    submitCliAdd() {
        const _in = document.getElementById("cli_add_cmd");
        if (!_in || !_in.value || !_in.value.trim()) { this._notify("请输入启动命令"); return; }
        const _c = _in.value.trim().split(/\s+/), _id = "cli_" + _c[0].replace(/[^a-zA-Z0-9_-]/g, "");
        let _u = [];
        try { _u = JSON.parse(localStorage.getItem("edex_cli_apps") || "[]"); } catch (_e) {}
        if (!Array.isArray(_u)) _u = [];
        if (!_u.some(_x => _x.id === _id)) {
            _u.push({ id: _id, name: _c[0], cmd: _c });
            try { localStorage.setItem("edex_cli_apps", JSON.stringify(_u)); } catch (_e) {}
            window.cliApps.push({ id: _id, name: _c[0], cmd: _c });
        }
        this._notify("已添加 " + _c[0]);
        this._renderMenu();
    }

    _notify(m) {
        let _t = document.getElementById("edex_toast");
        if (!_t) {
            _t = document.createElement("div");
            _t.id = "edex_toast";
            _t.className = "browser_toast";
            document.body.appendChild(_t);
        }
        _t.textContent = m;
        _t.classList.add("show");
        clearTimeout(this._notifyTimer);
        this._notifyTimer = setTimeout(() => _t.classList.remove("show"), 2200);
    }

    // Shell / DEV_DEBUG entry points the AppMonitorPanel also exposed.
    fullscreenButton() {}
    toggleDevTools() {}
}
