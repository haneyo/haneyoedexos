// WifiPanel — a simple, intuitive WiFi connect UI for the Linux system.
// Backed by NetworkManager via `nmcli` (IPC: wifi:list / wifi:connect /
// wifi:status in _boot.js). Opened from the floating WiFi button, the gear
// settings menu, or Ctrl+Shift+W.
//
// The panel itself is a eDEX-styled modal: current status on top, a list of
// nearby networks (click or ↑/↓ + Enter to select/connect), a password field
// for secured networks, and Connect / Refresh actions.
//
// The currently-connected network (from wifi:status) is highlighted in the
// list with a CONNECTED tag so the user always sees what they're on. Connect
// gives strong feedback: the button disables and shows "Connecting…", the
// status line reports progress/success/failure, success flashes the connected
// state before closing, and failure keeps the panel open so the password can
// be corrected and retried.

class WifiPanel {
    constructor() {
        this.modal = null;
        this.networks = [];
        this.selected = null;
        this.connectedSsid = null;
        this.connecting = false;
        this._keyHandler = null;
        this._notifyTimer = null;
    }

    open() {
        if (this.modal) return;                       // already open
        this.networks = [];
        this.selected = null;
        this.connectedSsid = null;
        this.connecting = false;
        this.modal = new Modal({
            type: "custom",
            title: "WIFI",
            html: `
                <div class="wifi_panel">
                    <div class="wifi_status" id="wifi_status">Scanning…</div>
                    <div class="wifi_list" id="wifi_list"></div>
                    <div class="wifi_pw" id="wifi_pw_wrap" style="display:none">
                        <input type="password" id="wifi_password" placeholder="Password">
                    </div>
                </div>`,
            buttons: [
                { label: "Refresh", action: "window.wifiPanel.refresh()" },
                { label: "Connect", action: "window.wifiPanel.connect()" }
            ]
        }, () => {
            this.modal = null;
            if (this._keyHandler) {
                document.removeEventListener("keydown", this._keyHandler);
                this._keyHandler = null;
            }
            clearTimeout(this._notifyTimer);
        });

        // The Modal class has no built-in Esc handling, so add our own keydown
        // listener (removed in the close callback above). ↑/↓ move through the
        // network list, Enter connects, Esc closes. Only the panel's own
        // password field keeps the arrows (typing); focus sitting anywhere else
        // (another app input, the body, a row) lets the list take the keys.
        this._keyHandler = e => {
            if (e.key === "Escape") { e.preventDefault(); this.close(); return; }
            const ae = document.activeElement;
            if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                if (ae === this._el("wifi_password")) return;
                const rows = Array.from(document.querySelectorAll("#wifi_list .wifi_net"));
                if (!rows.length) return;
                e.preventDefault();
                const cur = rows.indexOf(ae);
                const next = e.key === "ArrowDown"
                    ? (cur < 0 ? 0 : (cur + 1) % rows.length)
                    : (cur < 0 ? rows.length - 1 : (cur - 1 + rows.length) % rows.length);
                const n = this.networks[next];
                if (n) this.selectNetwork(n, true);
            } else if (e.key === "Enter") {
                const row = ae && ae.closest ? ae.closest(".wifi_net") : null;
                if (row) {
                    e.preventDefault();
                    const idx = parseInt(row.dataset.idx, 10);
                    const n = this.networks[idx];
                    if (n) { this.selectNetwork(n, false); this.connect(); }
                } else if (ae === this._el("wifi_password") && this.selected) {
                    e.preventDefault();
                    this.connect();
                }
            }
        };
        document.addEventListener("keydown", this._keyHandler);
        this.refresh();
    }

    close() { if (this.modal) this.modal.close(); }

    _el(id) { return document.getElementById(id); }

    async refresh() {
        const list = this._el("wifi_list");
        const status = this._el("wifi_status");
        if (!list || !status) return;
        status.textContent = "Scanning…";
        status.className = "wifi_status";
        list.innerHTML = "<div class='wifi_empty'>…</div>";

        const st = await window.wifiApi.status();
        const res = await window.wifiApi.list();
        if (!res || !res.ok) {
            status.textContent = "WiFi unavailable — " + ((res && res.error) || "not running on Linux");
            status.className = "wifi_status err";
            list.innerHTML = "";
            return;
        }
        this.networks = res.networks || [];
        this.connectedSsid = (st && st.connected && st.ssid) ? st.ssid : null;
        status.textContent = this.connectedSsid
            ? "Connected: " + this.connectedSsid
            : "Not connected — pick a network below";
        status.className = "wifi_status" + (this.connectedSsid ? " ok" : "");
        this._renderList(list);
        // Hand the keyboard a starting point: focus the first network row so
        // ↑/↓/Enter work immediately after the panel opens (unless the user has
        // already picked one, e.g. after a manual Refresh).
        if (!this.selected) {
            const first = list.querySelector(".wifi_net");
            if (first) first.focus();
        }
    }

    selectNetwork(n, focusRow) {
        this.selected = n;
        const pw = this._el("wifi_pw_wrap");
        const input = this._el("wifi_password");
        if (pw) {
            pw.style.display = n.security ? "block" : "none";
            if (input) {
                input.value = "";
                if (n.security) input.placeholder = "Password for " + n.ssid;
            }
        }
        this._renderList(this._el("wifi_list"));
        if (focusRow) this._focusSelected();
    }

    // Focus the row of the currently-selected network. Re-rendering the list
    // replaces the DOM nodes (dropping focus to the body), so call this after
    // any render that should leave the keyboard on the selection.
    _focusSelected() {
        const idx = this.networks.indexOf(this.selected);
        const r = idx >= 0 ? this._el("wifi_list").querySelector(`.wifi_net[data-idx="${idx}"]`) : null;
        if (r) r.focus();
    }

    _renderList(list) {
        if (!list) return;
        list.innerHTML = "";
        this.networks.forEach((n, idx) => {
            const sel = this.selected && this.selected.ssid === n.ssid;
            const conn = this.connectedSsid === n.ssid;
            const row = document.createElement("div");
            row.className = "wifi_net" + (sel ? " selected" : "") + (conn ? " connected" : "");
            row.dataset.idx = idx;
            row.tabIndex = 0;
            row.innerHTML = `<span class="wifi_sig">${this._bars(n.signal)}</span>
                <span class="wifi_name">${this._esc(n.ssid)}</span>
                ${conn ? `<span class="wifi_tag">CONNECTED</span>` : ""}
                <span class="wifi_lock">${n.security ? "◆" : ""}</span>`;
            row.onclick = () => this.selectNetwork(n, true);
            list.appendChild(row);
        });
        if (!this.networks.length) list.innerHTML = "<div class='wifi_empty'>No networks found</div>";
    }

    async connect() {
        if (this.connecting || !this.selected) return;
        const target = this.selected;                 // capture; selection may move mid-flight
        const btn = this._connectBtn();
        const status = this._el("wifi_status");
        const input = this._el("wifi_password");
        const password = input ? input.value : "";

        this.connecting = true;
        if (btn) { btn.disabled = true; btn.textContent = "Connecting…"; }
        if (status) {
            status.textContent = 'Connecting to "' + target.ssid + '"…';
            status.className = "wifi_status";
        }

        let res;
        try {
            res = await window.wifiApi.connect(target.ssid, password);
        } catch (err) {
            res = { ok: false, error: String((err && err.message) || err) };
        }
        this.connecting = false;

        if (res && res.ok) {
            this.connectedSsid = target.ssid;
            if (btn) { btn.disabled = false; btn.textContent = "Connect"; }
            if (status) {
                status.textContent = "Connected to " + target.ssid;
                status.className = "wifi_status ok";
            }
            this._notify("Connected to " + target.ssid);
            this._renderList(this._el("wifi_list"));
            this._focusSelected();
            // Let the user SEE the connected state before the panel closes.
            setTimeout(() => this.close(), 900);
        } else {
            if (btn) { btn.disabled = false; btn.textContent = "Connect"; }
            const msg = "Failed: " + ((res && res.error) || "unknown error");
            if (status) { status.textContent = msg; status.className = "wifi_status err"; }
            this._notify(msg);
            this._focusSelected();
        }
    }

    _connectBtn() {
        if (!this.modal) return null;
        const el = this._el("modal_" + this.modal.id);
        if (!el) return null;
        return Array.from(el.querySelectorAll("button"))
            .find(b => b.textContent === "Connect" || b.textContent === "Connecting…") || null;
    }

    _bars(signal) {
        const b = signal >= 75 ? "▅▅▅" : signal >= 50 ? "▅▅▂" : signal >= 25 ? "▅▂▂" : "▂▂▂";
        return b;
    }

    _esc(s) {
        return String(s || "").replace(/[<>&"]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));
    }

    _notify(msg) {
        let t = this._el("edex_toast");
        if (!t) {
            t = document.createElement("div");
            t.id = "edex_toast";
            t.className = "browser_toast";
            document.body.appendChild(t);
        }
        t.textContent = msg;
        t.classList.add("show");
        clearTimeout(this._notifyTimer);
        this._notifyTimer = setTimeout(() => t.classList.remove("show"), 2500);
    }
}

module.exports = { WifiPanel };
