// BtPanel — a Bluetooth device panel for the Linux system, opened from the
// settings → Network → Bluetooth row. Mirrors the WifiPanel modal: a status
// line on top, the device list below, and per-device Pair / Connect /
// Disconnect / Forget actions. Backed by bluetoothctl via IPC
// (bluetooth:status / devices / scan / pair / connect / disconnect / forget).
//
// Each device row shows name + a badge (CONNECTED / PAIRED) plus the action
// buttons that make sense for its state:
//   - connected   → Disconnect + Forget
//   - paired      → Connect + Forget
//   - discovered  → Pair + Connect + Forget
// A scan runs with `bluetoothctl --timeout 8 scan on` and polls devices every
// 1.5s so fresh discoveries stream in while the scan is active.

class BtPanel {
    constructor() {
        this.modal = null;
        this.devices = [];
        this.connectedAddrs = new Set();
        this.pairedAddrs = new Set();
        this._keyHandler = null;
        this._notifyTimer = null;
        this._pollTimer = null;
    }

    open() {
        if (this.modal) return;                       // already open
        this.devices = [];
        this.connectedAddrs = new Set();
        this.pairedAddrs = new Set();
        this.modal = new Modal({
            type: "custom",
            title: "BLUETOOTH",
            html: `
                <div class="bt_panel">
                    <div class="bt_status" id="bt_status">Loading…</div>
                    <div class="bt_list" id="bt_list"></div>
                </div>`,
            buttons: [
                { label: "Scan", action: "window.btPanel.scan()" },
                { label: "Refresh", action: "window.btPanel.refresh()" }
            ]
        }, () => {
            this.modal = null;
            if (this._keyHandler) {
                document.removeEventListener("keydown", this._keyHandler);
                this._keyHandler = null;
            }
            if (this._pollTimer) { clearInterval(this._pollTimer); this._pollTimer = null; }
            clearTimeout(this._notifyTimer);
        });

        this._keyHandler = e => {
            if (e.key === "Escape") { e.preventDefault(); this.close(); return; }
            if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                const rows = Array.from(document.querySelectorAll("#bt_list .bt_net"));
                if (!rows.length) return;
                e.preventDefault();
                const cur = rows.indexOf(document.activeElement);
                const next = e.key === "ArrowDown"
                    ? (cur < 0 ? 0 : (cur + 1) % rows.length)
                    : (cur < 0 ? rows.length - 1 : (cur - 1 + rows.length) % rows.length);
                rows[next].focus();
            }
        };
        document.addEventListener("keydown", this._keyHandler);
        this.refresh();
    }

    close() { if (this.modal) this.modal.close(); }

    _el(id) { return document.getElementById(id); }

    async refresh() {
        const list = this._el("bt_list");
        const status = this._el("bt_status");
        if (!list || !status) return;
        const st = await window.btApi.status();
        if (!st || !st.ok) {
            status.textContent = "Bluetooth unavailable — " + ((st && st.error) || "not running on Linux");
            status.className = "bt_status err";
            list.innerHTML = "";
            return;
        }
        if (st.powered) {
            status.textContent = (st.name || "Controller") + (st.address ? "  (" + st.address + ")" : "") + "  —  on";
            status.className = "bt_status ok";
        } else {
            status.textContent = (st.name || "Controller") + "  —  off";
            status.className = "bt_status";
        }
        const res = await window.btApi.devices();
        this.devices = (res && res.ok && res.devices) ? res.devices : [];
        this._renderList(list);
    }

    async scan() {
        const status = this._el("bt_status");
        if (status) { status.textContent = "Scanning… (8s)"; status.className = "bt_status"; }
        await window.btApi.scan(8);
        // Poll devices while the scan session is alive so discoveries stream in.
        if (this._pollTimer) clearInterval(this._pollTimer);
        this._pollTimer = setInterval(() => this.refresh(), 1500);
        // Stop polling once the 8s scan window has passed (refresh again to
        // drop the transient "scanning" state cleanly).
        setTimeout(() => {
            if (this._pollTimer) { clearInterval(this._pollTimer); this._pollTimer = null; }
            this.refresh();
        }, 9000);
    }

    _renderList(list) {
        if (!list) return;
        list.innerHTML = "";
        if (!this.devices.length) {
            list.innerHTML = "<div class='bt_empty'>No devices — press Scan to look for nearby devices</div>";
            return;
        }
        this.devices.forEach((d, idx) => {
            const connected = !!d.connected;
            const paired = !!d.paired;
            const row = document.createElement("div");
            row.className = "bt_net" + (connected ? " connected" : "");
            row.dataset.idx = idx;
            row.tabIndex = 0;
            const badge = connected ? `<span class="bt_badge connected">CONNECTED</span>`
                : paired ? `<span class="bt_badge">PAIRED</span>` : "";
            const btns = connected
                ? `<button type="button" class="bt_act" data-act="disc" data-addr="${this._esc(d.address)}">Disconnect</button>
                   <button type="button" class="bt_act danger" data-act="forget" data-addr="${this._esc(d.address)}">Forget</button>`
                : (!paired
                    ? `<button type="button" class="bt_act" data-act="pair" data-addr="${this._esc(d.address)}">Pair</button>`
                    : "")
                  + `<button type="button" class="bt_act" data-act="conn" data-addr="${this._esc(d.address)}">Connect</button>
                     <button type="button" class="bt_act danger" data-act="forget" data-addr="${this._esc(d.address)}">Forget</button>`;
            row.innerHTML = `<span class="bt_name">${this._esc(d.name || d.address)}</span>${badge}
                <span class="bt_actions">${btns}</span>`;
            row.onclick = e => {
                if (e.target && e.target.closest && e.target.closest("button")) return; // let the button handle it
                this._focusActions(row);
            };
            row.querySelectorAll("button.bt_act").forEach(btn => {
                btn.onclick = () => this.act(btn.dataset.act, btn.dataset.addr, btn);
            });
            list.appendChild(row);
        });
    }

    _focusActions(row) {
        const b = row.querySelector("button.bt_act");
        if (b) b.focus();
    }

    // Run a device action, disable the clicked button while it works, and
    // re-render once it finishes so badges/buttons reflect the new state.
    async act(act, address, btn) {
        if (btn) { btn.disabled = true; }
        const method = { pair: "pair", conn: "connect", disc: "disconnect", forget: "forget" }[act] || act;
        let r;
        try {
            r = await window.btApi[method](address);
        } catch (err) {
            r = { ok: false, error: String((err && err.message) || err) };
        }
        this._notify(r && r.ok
            ? (act === "pair" ? "Paired: " + address : act === "forget" ? "Forgotten: " + address : act === "disc" ? "Disconnected: " + address : "Connected: " + address)
            : "Failed: " + ((r && r.error) || "unknown"));
        await this.refresh();
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

module.exports = { BtPanel };
