// CliPanel — "APP / CLI APPS" (terminal tabs 4 & 5) run CLI apps with a TUI.
//
// Instead of the retired virtual-display app monitor (AppMonitorPanel), these
// tabs launch command-line apps that have their own user interface (claude,
// browsh, aerc, btop) inside a real terminal session. Each entry is
// started by asking the main process for a new pty via
// `ipcRenderer.send("ttyspawn", { cli: [cmd, ...args] })`; the main process
// replies with a port and this side attaches a client-side Terminal to it.
//
// By default both tab 4 and tab 5 are CliPanel and read "APP". When the
// experimental GUI-app mode (settings.appMonitor.showGui) is on, tab 5 becomes
// an AppMonitorPanel and this panel (tab 4) reads "CLI APPS".
//
// Origin: packaging/patch-appimage.sh (CLI_PANEL_CLASS). Behavior is kept
// byte-equivalent so the patch-injected copy and this source stay
// interchangeable. The AppMonitorPanel-style menu (chevron on the tab label)
// is reused: arrow keys + Enter to launch, Esc to close. Entry icons come from
// the shared window.iconLibrary set (see iconLibrary.class.js).
const _cliIpc = require("electron").ipcRenderer;

// Entry icons come from window.iconLibrary (shared set, see iconLibrary.class.js).
// Custom entries store an icon id; unknown / missing ids fall back to "terminal".

// The app list is just {icon, name, launch cmd} per entry, so every entry —
// including the built-ins — is user-editable. User edits live in localStorage
// `edex_cli_apps`, where an entry whose id matches a built-in id OVERRIDES that
// built-in, { _deleted: true } hides it, and any other entry is a custom app.
const _CLI_BUILTIN = [
    { id: "claude", name: "Claude", cmd: ["claude"], icon: "ai" },
    // Browser = browsh (TUI over headless Firefox) — #162 reverses #58. The
    // startup URL is a POSITIONAL argument (browsh has NO --startup-url flag;
    // the pre-#58 entry used that non-existent flag, which pflag rejects and
    // killed the browser on launch). Firefox is baked at /opt/firefox by
    // build-iso.sh (browsh renders through it; the GUI app launcher also offers
    // it fullscreen). #136: start page = local dark search page (search bar +
    // switchable engine), deployed next to the AppImage at /opt/edex/cli-start.html.
    { id: "browsh", name: "browsh", cmd: ["browsh", "file:///opt/edex/cli-start.html"], icon: "browser" },
    { id: "aerc", name: "aerc", cmd: ["aerc"], icon: "mail" },
    { id: "btop", name: "BTOP", cmd: ["btop"], icon: "monitor" }
];

// (re)build the live app list: built-ins in order (overrides / tombstones
// applied), then custom apps in add order. Called at load and after every
// add / edit / delete.
function _cliRebuildList() {
    let _u = [];
    try { _u = JSON.parse(localStorage.getItem("edex_cli_apps") || "[]"); } catch (e) {}
    if (!Array.isArray(_u)) _u = [];
    const _out = [];
    _CLI_BUILTIN.forEach(_b => {
        const _e = _u.find(_x => _x && _x.id === _b.id);
        if (_e && _e._deleted) return;                  // tombstone → hidden
        if (_e && _e.cmd && _e.cmd[0])                   // override → replaces built-in
            _out.push({ id: _b.id, name: _e.name || _b.name, cmd: _e.cmd, icon: _e.icon || null });
        else _out.push(Object.assign({}, _b));
    });
    _u.forEach(_e => {                                   // custom apps, in add order
        if (!_e || _e._deleted || !_e.cmd || !_e.cmd[0]) return;
        if (_CLI_BUILTIN.some(_b => _b.id === _e.id)) return;
        _out.push({ id: _e.id, name: _e.name || _e.cmd[0], cmd: _e.cmd, icon: _e.icon || null });
    });
    return _out;
}
window.cliApps = _cliRebuildList();

// Row-action icons (theme-stroked inline SVG, same visual language as
// iconLibrary) + a tiny HTML-attribute escaper for the edit modal.
const _IC_EDIT = '<svg class="appmonitor_act_ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>';
const _IC_DEL = '<svg class="appmonitor_act_ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>';
const _esc = s => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ADD APP icon-picker callback: writes the chosen id into the hidden field and
// reflects it on the picker button. Kept as a window helper so the modal's
// inline onclick stays short (no nested-quote escaping).
window._cliPickIcon = (id) => {
    const h = document.getElementById("cli_add_icon");
    if (h) h.value = id || "";
    const b = document.getElementById("cli_add_icon_btn");
    if (b) b.textContent = id ? ("已选: " + id) : "选择图标…";
};

(function () {
    try {
        const s = document.createElement("style");
        s.id = "edex_cli_css";
        // Hide the xterm viewport scrollbar gutter too — otherwise it eats ~15px
        // on the right and the browser renders with black bars on both sides (#75).
        // Bleed past the shell's padding so the terminal fills the whole frame
        // (the browser rectangle otherwise stops short and leaves black bars on
        // the left/bottom, #86), then clip the bottom-left corner to match the
        // frame's bl notch — same approach as .appmonitor_webview.
        s.textContent = ".cli_session{position:absolute;inset:0 calc(-1 * var(--shell-pad, 0.74vh)) calc(-1 * var(--shell-pad, 0.74vh)) calc(-1 * var(--shell-pad, 0.74vh));display:none;overflow:hidden;clip-path:polygon(0 0,100% 0,100% 100%,15px 100%,0 calc(100% - 15px))}.cli_session.active{display:block}"
            + ".xterm .xterm-viewport{overflow-y:hidden!important;scrollbar-width:none!important}"
            + ".xterm .xterm-viewport::-webkit-scrollbar{width:0!important;height:0!important;display:none!important}";
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
            // A real button (edit / delete / close-session) holds focus after
            // Tab: let Enter/Space fire it natively; keep Escape closing.
            if (e.target && e.target.closest && e.target.closest("button")) {
                if (e.key === "Escape") { e.preventDefault(); _t.closeMenu(); }
                return;
            }
            const _o = _t.menu.querySelectorAll(".appmonitor_opt");
            if (!_o.length) return;
            e.stopPropagation();
            if (e.key === "ArrowDown" || e.key === "ArrowRight") { e.preventDefault(); _t._focusMenu(_t.menuFocusIdx + 1); }
            else if (e.key === "ArrowUp" || e.key === "ArrowLeft") { e.preventDefault(); _t._focusMenu(_t.menuFocusIdx - 1); }
            else if (e.key === "Enter") { e.preventDefault(); const _x = _o[_t.menuFocusIdx]; if (_x) _x.click(); }
            else if (e.key === "Escape") { e.preventDefault(); _t.closeMenu(); }
        });
        if (this.labelEl) this.labelEl.textContent = this._label();
    }

    // Tab label: "APP" by default (both tabs are CLI apps); when the
    // experimental GUI-app mode is on, this panel (tab 4) reads "CLI APPS" so
    // it stays distinguishable from tab 5's AppMonitorPanel.
    _label() {
        return (window.settings.appMonitor || {}).showGui ? "CLI APPS" : "APP";
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
            _ic.innerHTML = (window.iconLibrary && (window.iconLibrary.get(_a.icon) || window.iconLibrary.get("terminal"))) || "";
            _opt.appendChild(_ic);
            const _nm = document.createElement("span");
            _nm.className = "appmonitor_name";
            _nm.textContent = _a.name;
            _opt.appendChild(_nm);
            // Row actions, right-aligned: close session (running only), edit,
            // delete. stopPropagation so they never launch the app.
            const _acts = document.createElement("span");
            _acts.className = "appmonitor_acts";
            if (_run && _run.term) {
                const _cl = document.createElement("button");
                _cl.className = "webapp_menu_del";
                _cl.textContent = "×";
                _cl.title = "关闭会话";
                _cl.onclick = e => { e.stopPropagation(); this._closeSession(_a.id); };
                _acts.appendChild(_cl);
            }
            const _ed = document.createElement("button");
            _ed.className = "appmonitor_act";
            _ed.title = "编辑 " + _a.name;
            _ed.innerHTML = _IC_EDIT;
            _ed.onclick = e => { e.stopPropagation(); this._openEditor(_a); };
            _acts.appendChild(_ed);
            const _dl = document.createElement("button");
            _dl.className = "appmonitor_act appmonitor_act_del";
            _dl.title = "删除 " + _a.name;
            _dl.innerHTML = _IC_DEL;
            _dl.onclick = e => { e.stopPropagation(); this._askDelete(_a); };
            _acts.appendChild(_dl);
            _opt.appendChild(_acts);
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
                if (_t.selected && _t.selected.id === _a.id && _t.labelEl) _t.labelEl.textContent = _t._label();
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
        if (this.labelEl) this.labelEl.textContent = this._label();
        this._renderMenu();
    }

    _closeSession(_id) {
        const _s = this.sessions[_id];
        if (!_s) return;
        if (_s.term) {
            try {
                if (_s.term.onclose) _s.term.onclose = null;
                // Closing the websocket makes the backend's ondisconnected fire,
                // which kills the whole process group (shell + children). Without
                // this the browser keeps running and audio lingers after close (#74).
                if (_s.term.socket && _s.term.socket.close) _s.term.socket.close();
                if (_s.term.term && _s.term.term.dispose) _s.term.term.dispose();
            } catch (_e) {}
        }
        if (_s.el && _s.el.parentNode) _s.el.parentNode.removeChild(_s.el);
        delete this.sessions[_id];
        if (this.selected && this.selected.id === _id && this.labelEl) this.labelEl.textContent = this._label();
        this._renderMenu();
    }

    // Shared add / edit modal. app == null → add mode (empty fields, id derived
    // from the command); else edit mode with name / command / icon pre-filled.
    _openEditor(app) {
        this.closeMenu();
        this._editingApp = app || null;
        try { if (window.cliAddModal && window.cliAddModal.close) window.cliAddModal.close(); } catch (_e) {}
        const _pn = "a" === this.monitorId ? "A" : "B";
        const _editing = !!app;
        window.cliAddModal = new Modal({
            type: "custom",
            title: _editing ? "EDIT: " + _esc(app.name) : "ADD APP",
            html: '<div class="appmonitor_add">'
                + '<label>名称</label><input type="text" id="cli_add_name" placeholder="如 ncmpcpp" value="' + _esc(app && app.name) + '" style="width:100%">'
                + '<label>启动命令</label><input type="text" id="cli_add_cmd" placeholder="如 btop 或 ncmpcpp" value="' + _esc(app && app.cmd.join(" ")) + '" style="width:100%">'
                + '<label>图标</label><button type="button" id="cli_add_icon_btn" class="settings_net_btn" onclick="window.iconLibrary&&window.iconLibrary.pickerModal(window._cliPickIcon)">' + (app && app.icon ? "已选: " + _esc(app.icon) : "选择图标…") + '</button>'
                + '<input type="hidden" id="cli_add_icon" value="' + _esc(app && app.icon) + '">'
                + '</div>',
            buttons: [{ label: _editing ? "Save" : "Add", action: "window.cliAddModal&&window.cliAddModal.close();window.appmonitor" + _pn + ".submitCliAdd()" }]
        });
    }

    _addApp() {
        this._openEditor(null);
    }

    submitCliAdd() {
        const _nm = document.getElementById("cli_add_name");
        const _in = document.getElementById("cli_add_cmd");
        const _icn = document.getElementById("cli_add_icon");
        if (!_in || !_in.value || !_in.value.trim()) { this._notify("请输入启动命令"); return; }
        const _c = _in.value.trim().split(/\s+/);
        const _name = (_nm && _nm.value && _nm.value.trim()) ? _nm.value.trim() : _c[0];
        const _icon = (_icn && _icn.value) ? _icn.value : null;
        const _editing = this._editingApp || null;
        const _id = _editing ? _editing.id : "cli_" + _c[0].replace(/[^a-zA-Z0-9_-]/g, "");
        let _u = [];
        try { _u = JSON.parse(localStorage.getItem("edex_cli_apps") || "[]"); } catch (_e) {}
        if (!Array.isArray(_u)) _u = [];
        const _rec = { id: _id, name: _name, cmd: _c, icon: _icon };
        if (_editing) {
            // Editing: update the record (built-in override or custom), creating
            // it on first edit of a never-persisted built-in.
            const _hit = _u.find(_x => _x && _x.id === _id);
            if (_hit) Object.assign(_hit, _rec);
            else _u.push(_rec);
        } else {
            const _dup = _u.find(_x => _x && _x.id === _id);
            if (_dup && !_dup._deleted) { this._notify("该应用已存在"); return; }
            if (_dup) Object.assign(_dup, _rec, { _deleted: false });   // restore a deleted built-in
            else _u.push(_rec);
        }
        try { localStorage.setItem("edex_cli_apps", JSON.stringify(_u)); } catch (_e) {}
        this._editingApp = null;
        window.cliApps = _cliRebuildList();
        this._notify(_editing ? "已保存 " + _name : "已添加 " + _name);
        this._renderMenu();
    }

    // Confirm before removing an app from the list. Built-ins are tombstoned
    // (hidden) rather than hard-deleted, so re-adding the same command restores
    // them with their original identity.
    _askDelete(_a) {
        this.closeMenu();
        try { if (window.cliAddModal && window.cliAddModal.close) window.cliAddModal.close(); } catch (_e) {}
        const _pn = "a" === this.monitorId ? "A" : "B";
        const _isBuiltin = _CLI_BUILTIN.some(_b => _b.id === _a.id);
        window.cliAddModal = new Modal({
            type: "custom",
            title: "删除 " + _esc(_a.name),
            html: '<p style="margin:0 0 1vh;font-family:var(--font_main_light);font-size:1.2vh">'
                + (_isBuiltin ? "从列表中移除内置应用 <b>" + _esc(_a.name) + "</b>?" : "删除应用 <b>" + _esc(_a.name) + "</b>?")
                + "</p>",
            buttons: [{ label: "删除", action: "window.cliAddModal&&window.cliAddModal.close();window.appmonitor" + _pn + ".confirmDelete('" + _a.id + "')" }],
            closeLabel: "取消"
        });
    }

    confirmDelete(_id) {
        const _a = window.cliApps.find(_x => _x && _x.id === _id);
        if (_a && this.sessions[_id]) this._closeSession(_id);
        let _u = [];
        try { _u = JSON.parse(localStorage.getItem("edex_cli_apps") || "[]"); } catch (_e) {}
        if (!Array.isArray(_u)) _u = [];
        if (_CLI_BUILTIN.some(_b => _b.id === _id)) {
            const _hit = _u.find(_x => _x && _x.id === _id);
            if (_hit) { Object.assign(_hit, { _deleted: true }); _hit.cmd = undefined; _hit.name = undefined; }
            else _u.push({ id: _id, _deleted: true });
        } else {
            _u = _u.filter(_x => _x && _x.id !== _id);
        }
        try { localStorage.setItem("edex_cli_apps", JSON.stringify(_u)); } catch (_e) {}
        window.cliApps = _cliRebuildList();
        if (this.selected && this.selected.id === _id && this.labelEl) this.labelEl.textContent = this._label();
        this._notify("已删除 " + (_a ? _a.name : _id));
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

    // ---- cover session (screensaver / lock share one inert pty) ----
    // The code screensaver streams fake code into a real terminal and the code
    // lock draws its passcode box in one, so they borrow a dedicated __cover__
    // session on this panel: a `cat` pty that echoes nothing, wrapped in a
    // muted Terminal. Owned by window.screensaver; destroyed when the cover
    // lifts. It never appears in the app menu (__cover__ is not in cliApps)
    // and never touches this._spawning (a user app may be mid-launch).
    beginCoverSession() {
        if (this._coverSession || this.sessions.__cover__) return this._coverSession || this.sessions.__cover__;
        const _t = this;
        const _sid = "__cover__";
        if (!this._coverRestoreSel) this._coverRestoreSel = this.selected || null;
        // During the cover, `selected` points at the cover session so focus()
        // keeps it the active div (and never reveals the user's app on screen).
        this.selected = { id: _sid, name: "AUTH GATE" };
        const _s = { id: _sid, sid: _sid, starting: true, term: null, el: null, cover: true };
        this.sessions[_sid] = _s;
        const _box = this.container;
        const _el = document.createElement("div");
        _el.className = "cli_session";
        _el.id = _sid;
        _box.appendChild(_el);
        _el.classList.add("active");
        Object.keys(this.sessions).forEach(_k => {
            if (_k !== _sid && this.sessions[_k].el) this.sessions[_k].el.classList.remove("active");
        });
        _cliIpc.send("ttyspawn", { cli: ["sh", "-c", "stty raw -echo; exec cat"] });
        _cliIpc.once("ttyspawn-reply", (e, r) => {
            if (String(r).startsWith("ERROR")) {
                _s.starting = false;
                if (_el.parentNode) _el.parentNode.removeChild(_el);
                delete _t.sessions[_sid];
                _t._coverSession = null;
                return;
            }
            const _port = Number(String(r).substr(9));
            let _term = null;
            try {
                _term = new Terminal({ role: "client", parentId: _sid, port: _port, muted: true });
            } catch (_e) {
                _s.starting = false;
                return;
            }
            _term.onclose = () => {
                try { if (_term.term && _term.term.dispose) _term.term.dispose(); } catch (_e) {}
                if (_el.parentNode) _el.parentNode.removeChild(_el);
                delete _t.sessions[_sid];
                _t._coverSession = null;
            };
            _s.starting = false;
            _s.term = _term;
            _t._coverSession = _s;
        });
        return _s;
    }

    coverTerm() {
        const _s = this._coverSession || this.sessions.__cover__ || null;
        return (_s && _s.term) ? _s.term : null;
    }

    endCoverSession() {
        const _s = this._coverSession || this.sessions.__cover__ || null;
        if (!_s) return;
        if (_s.term) {
            try {
                if (_s.term.onclose) _s.term.onclose = null;
                // The cat pty never exits on its own — close the socket to reap it.
                if (_s.term.socket && typeof _s.term.socket.close === "function") _s.term.socket.close();
                if (_s.term.term && _s.term.term.dispose) _s.term.term.dispose();
            } catch (_e) {}
        }
        if (_s.el && _s.el.parentNode) _s.el.parentNode.removeChild(_s.el);
        delete this.sessions.__cover__;
        this._coverSession = null;
        this.selected = this._coverRestoreSel || this.selected;
        if (this.selected && this.selected.id === "__cover__") this.selected = null;
        this._coverRestoreSel = null;
        if (this.labelEl) this.labelEl.textContent = this.selected ? this.selected.name : this._label();
        this._renderMenu();
    }

    // Shell / DEV_DEBUG entry points the AppMonitorPanel also exposed.
    fullscreenButton() {}
    toggleDevTools() {}
}
