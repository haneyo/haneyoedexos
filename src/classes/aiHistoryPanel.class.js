// AiHistoryPanel — the AI-assistant chat log as a popup modal (like the
// Wifi/BT panels). Opened from settings → AI 功能 → 聊天记录. Lists the stored
// user/AI exchanges newest-first; ↑/↓ move through the rows, Esc closes.
// Backed by the ai:history / ai:history-clear IPC channels in _boot.js (via
// window.aiHistoryApi, exposed in _renderer.js).
class AiHistoryPanel {
    constructor() {
        this.modal = null;
        this._keyHandler = null;
    }

    open() {
        if (this.modal) return;                       // already open
        const zh = window.settings && window.settings.language === "zh";
        this.modal = new Modal({
            type: "custom",
            title: zh ? "AI 聊天记录" : "AI CHAT HISTORY",
            html: `
                <div class="wifi_panel ai_hist_panel">
                    <div class="wifi_status" id="ai_hist_status">…</div>
                    <div class="wifi_list ai_hist_list" id="ai_hist_list" tabindex="0"></div>
                </div>`,
            buttons: [
                { label: window.t("settings.ai.history.historyRefresh"), action: "window.aiHistoryPanel.refresh()" },
                { label: window.t("settings.ai.history.historyClear"), action: "window.aiHistoryPanel.clear()" }
            ]
        }, () => {
            this.modal = null;
            if (this._keyHandler) {
                document.removeEventListener("keydown", this._keyHandler);
                this._keyHandler = null;
            }
        });

        // Modal has no built-in Esc handling (same as the wifi panel) — add our
        // own keydown listener, removed in the close callback above. ↑/↓ move
        // through the rows, Esc closes.
        this._keyHandler = e => {
            if (e.key === "Escape") { e.preventDefault(); this.close(); return; }
            if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                const rows = Array.from(document.querySelectorAll("#ai_hist_list .appmgr_row"));
                if (!rows.length) return;
                e.preventDefault(); e.stopPropagation();
                const cur = rows.indexOf(document.activeElement);
                const next = e.key === "ArrowDown"
                    ? (cur < 0 ? 0 : (cur + 1) % rows.length)
                    : (cur < 0 ? rows.length - 1 : (cur - 1 + rows.length) % rows.length);
                rows.forEach(r => r.classList.remove("active"));
                rows[next].classList.add("active");
                rows[next].focus();
                try { rows[next].scrollIntoView({ block: "nearest" }); } catch (e2) {}
            }
        };
        document.addEventListener("keydown", this._keyHandler);
        this.refresh();
    }

    refresh() {
        if (!this.modal) return;
        window.aiHistoryApi.list().then(r => {
            const box = document.getElementById("ai_hist_list");
            const status = document.getElementById("ai_hist_status");
            if (!box) return;
            const h = (r && r.ok && r.history) || [];
            const zh = window.settings && window.settings.language === "zh";
            if (status) status.textContent = h.length
                ? (zh ? "共 " + h.length + " 轮" : h.length + " turns")
                : (zh ? "暂无聊天记录" : "empty");
            if (!h.length) {
                box.innerHTML = `<div class="settings_net_empty">${window.t("settings.ai.history.historyEmpty")}</div>`;
                return;
            }
            box.innerHTML = h.slice().reverse().map(p => `
                <div class="appmgr_row ai_hist_row" tabindex="-1">
                    <span class="ai_hist_role ai_hist_user">${window.t("ai.hist.user")}</span>
                    <span class="ai_hist_body">${window._escapeHtml(p.user || "")}</span>
                </div>
                <div class="appmgr_row ai_hist_row" tabindex="-1">
                    <span class="ai_hist_role ai_hist_ai">${window.t("ai.hist.ai")}</span>
                    <span class="ai_hist_body">${window._escapeHtml(p.assistant || "")}</span>
                </div>`).join("");
        }).catch(() => {});
    }

    clear() {
        if (!this.modal) return;
        window.aiHistoryApi.clear().then(() => this.refresh());
    }

    close() {
        if (this.modal) this.modal.close();
    }
}

module.exports = { AiHistoryPanel };
