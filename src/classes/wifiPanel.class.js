// WifiPanel — a simple, intuitive WiFi connect UI for the Linux system.
// Backed by NetworkManager via `nmcli` (IPC: wifi:list / wifi:connect /
// wifi:status in _boot.js). Opened from the floating WiFi button, the gear
// settings menu, or Ctrl+Shift+W.
//
// The panel itself is a eDEX-styled modal: current status on top, a list of
// nearby networks (click to select), a password field for secured networks,
// and Connect / Refresh actions.

class WifiPanel {
    constructor() {
        this.modal = null;
        this.networks = [];
        this.selected = null;
        this.connecting = false;
    }

    open() {
        if (this.modal) return;                       // already open
        this.networks = [];
        this.selected = null;
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
        }, () => { this.modal = null; });
        this.refresh();
    }

    close() { if (this.modal) this.modal.close(); }

    async refresh() {
        const list = document.getElementById("wifi_list");
        const status = document.getElementById("wifi_status");
        if (!list || !status) return;
        status.textContent = "Scanning…";
        list.innerHTML = "<div class='wifi_empty'>…</div>";

        const st = await window.wifiApi.status();
        const res = await window.wifiApi.list();
        if (!res || !res.ok) {
            status.textContent = "WiFi unavailable — " + ((res && res.error) || "not running on Linux");
            list.innerHTML = "";
            return;
        }
        this.networks = res.networks || [];
        status.textContent = (st && st.connected)
            ? "Connected: " + st.ssid
            : "Not connected — pick a network below";
        this._renderList(list, status);
    }

    _renderList(list) {
        list.innerHTML = "";
        this.networks.forEach(n => {
            const row = document.createElement("div");
            const sel = this.selected && this.selected.ssid === n.ssid;
            row.className = "wifi_net" + (sel ? " selected" : "");
            row.innerHTML = `<span class="wifi_sig">${this._bars(n.signal)}</span>
                <span class="wifi_name">${this._esc(n.ssid)}</span>
                <span class="wifi_lock">${n.security ? "◆" : ""}</span>`;
            row.onclick = () => {
                this.selected = n;
                const pw = document.getElementById("wifi_pw_wrap");
                const input = document.getElementById("wifi_password");
                if (pw) {
                    pw.style.display = n.security ? "block" : "none";
                    if (input) { input.value = ""; if (n.security) input.placeholder = "Password for " + n.ssid; }
                }
                this._renderList(list);
            };
            list.appendChild(row);
        });
        if (!this.networks.length) list.innerHTML = "<div class='wifi_empty'>No networks found</div>";
    }

    async connect() {
        if (this.connecting || !this.selected) return;
        this.connecting = true;
        const input = document.getElementById("wifi_password");
        const password = input ? input.value : "";
        const res = await window.wifiApi.connect(this.selected.ssid, password);
        this.connecting = false;
        if (res && res.ok) {
            this._notify("Connected to " + this.selected.ssid);
            this.close();
        } else {
            this._notify("Failed: " + ((res && res.error) || "unknown error"));
            this.refresh();
        }
    }

    _bars(signal) {
        const b = signal >= 75 ? "▅▅▅" : signal >= 50 ? "▅▅▂" : signal >= 25 ? "▅▂▂" : "▂▂▂";
        return b;
    }

    _esc(s) {
        return String(s || "").replace(/[<>&"]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));
    }

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
        this._notifyTimer = setTimeout(() => t.classList.remove("show"), 2500);
    }
}

module.exports = { WifiPanel };
