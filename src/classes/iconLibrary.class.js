// iconLibrary — shared inline-SVG icon set + a keyboard-operable picker modal.
//
// Both the CLI panel (CliPanel) and the GUI app panel (AppMonitorPanel) look
// up an entry's icon here first (library id → inline SVG), then fall back to
// an <img src> path (.desktop icons) and finally a placeholder. "+ ADD APP"
// dialogs open the picker (arrow keys + Enter + Esc, per ui-keyboard-operable)
// to choose one of these ids, or the ✕ cell to store no icon.
//
// The 6 ids used by the stock CLI apps (ai/browser/monitor/mail/terminal/music)
// are kept verbatim so claude/w3m/aerc/btop/musicfox render unchanged.
//
// Origin: packaging/patch-appimage.sh (ICON_LIBRARY_JS). Behavior is kept
// byte-equivalent so the patch-injected copy and this source stay
// interchangeable. Loaded via ui.html before the panels.
const _ic = (svg) =>
    '<svg class="appmonitor_icon_ph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' + svg + '</svg>';

window.iconLibrary = {
    icons: {
        ai:       { name: "AI",          svg: _ic('<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>') },
        browser:  { name: "Browser",     svg: _ic('<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>') },
        monitor:  { name: "Monitor",     svg: _ic('<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>') },
        mail:     { name: "Mail",        svg: _ic('<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>') },
        terminal: { name: "Terminal",    svg: _ic('<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>') },
        git:      { name: "Git",         svg: _ic('<line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>') },
        python:   { name: "Python",      svg: _ic('<path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1"/><path d="M16 21h1a2 2 0 0 0 2-2v-5c0-1.1.9-2 2-2a2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1"/>') },
        node:     { name: "Node",        svg: _ic('<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>') },
        docker:   { name: "Docker",      svg: _ic('<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>') },
        ssh:      { name: "SSH",         svg: _ic('<path d="m21 2-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4"/>') },
        tmux:     { name: "Tmux",        svg: _ic('<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>') },
        vim:      { name: "Vim",         svg: _ic('<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>') },
        database: { name: "Database",    svg: _ic('<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/>') },
        download: { name: "Download",    svg: _ic('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>') },
        globe:    { name: "Globe",       svg: _ic('<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>') },
        code:     { name: "Code",        svg: _ic('<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>') },
        server:   { name: "Server",      svg: _ic('<rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/>') },
        package:  { name: "Package",     svg: _ic('<path d="M16.5 9.4 7.55 4.24"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>') },
        game:     { name: "Game",        svg: _ic('<line x1="6" y1="11" x2="10" y2="11"/><line x1="8" y1="9" x2="8" y2="13"/><line x1="15" y1="12" x2="15.01" y2="12"/><line x1="18" y1="10" x2="18.01" y2="10"/><path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z"/>') },
        music:    { name: "Music",       svg: _ic('<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>') },
        video:    { name: "Video",       svg: _ic('<rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="17" x2="22" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/>') },
        image:    { name: "Image",       svg: _ic('<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>') },
        calculator: { name: "Calculator", svg: _ic('<rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="16" y1="14" x2="16" y2="18"/><path d="M16 10h.01"/><path d="M12 10h.01"/><path d="M8 10h.01"/><path d="M12 14h.01"/><path d="M8 14h.01"/><path d="M12 18h.01"/><path d="M8 18h.01"/>') },
        folder:   { name: "Folder",      svg: _ic('<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>') },
        settings: { name: "Settings",    svg: _ic('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>') },
        file:     { name: "File",        svg: _ic('<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>') },
        wifi:     { name: "WiFi",        svg: _ic('<path d="M12 20h.01"/><path d="M2 8.82a15 15 0 0 1 20 0"/><path d="M5 12.859a10 10 0 0 1 14 0"/><path d="M8.5 16.429a5 5 0 0 1 7 0"/>') },
        shield:   { name: "Shield",      svg: _ic('<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>') },
        editor:   { name: "Editor",      svg: _ic('<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>') },
        clock:    { name: "Clock",       svg: _ic('<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>') },
        default:  { name: "Default",     svg: _ic('<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>') }
    },
    get(id) {
        const i = this.icons[id];
        return i ? i.svg : null;
    },
    list() {
        return Object.keys(this.icons).map(id => ({ id, name: this.icons[id].name, svg: this.icons[id].svg }));
    },
    // Keyboard-operable grid picker: arrows move across the grid, Enter picks,
    // Esc cancels. Calls cb(iconId) — cb(null) means "no icon" (✕ cell).
    pickerModal(cb) {
        try { if (window._icPickModal && window._icPickModal.close) window._icPickModal.close(); } catch (e) {}
        const icons = this.list();
        const cell = (i, html, cls) => '<div class="edex_ic_cell ' + (cls || "") + '" data-idx="' + i + '" onclick="window.iconLibrary._icPick(' + i + ')">' + html + '</div>';
        const noneSvg = '<svg class="appmonitor_icon_ph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
        const cells = icons.map((ic, i) => cell(i, ic.svg, "")).join("")
            + cell(icons.length, noneSvg, "edex_ic_none");
        this._icCb = cb;
        window._icPickModal = new Modal({
            type: "custom",
            title: "CHOOSE ICON",
            html: '<div class="edex_ic_grid" id="edex_ic_grid">' + cells + '</div>',
            buttons: [],
            closeLabel: "Cancel"
        });
        const grid = document.getElementById("edex_ic_grid");
        if (grid) {
            const all = grid.querySelectorAll(".edex_ic_cell");
            const cols = 8;
            let idx = 0;
            const focus = i => {
                if (!all.length) return;
                i = Math.max(0, Math.min(i, all.length - 1));
                all.forEach((x, j) => x.classList.toggle("active", j === i));
                idx = i;
                all[i] && all[i].scrollIntoView({ block: "nearest" });
            };
            focus(0);
            grid.setAttribute("tabindex", "-1");
            grid.addEventListener("keydown", e => {
                if (e.key === "ArrowRight") { e.preventDefault(); focus(idx + 1); }
                else if (e.key === "ArrowLeft") { e.preventDefault(); focus(idx - 1); }
                else if (e.key === "ArrowDown") { e.preventDefault(); focus(idx + cols); }
                else if (e.key === "ArrowUp") { e.preventDefault(); focus(idx - cols); }
                else if (e.key === "Enter") { e.preventDefault(); const el = all[idx]; if (el) el.click(); }
                else if (e.key === "Escape") { e.preventDefault(); try { window._icPickModal && window._icPickModal.close(); } catch (_) {} }
            });
            grid.focus();
        }
    },
    _icPick(i) {
        const icons = this.list();
        const id = (i >= 0 && i < icons.length) ? icons[i].id : null;
        const cb = this._icCb;
        this._icCb = null;
        try { if (window._icPickModal && window._icPickModal.close) window._icPickModal.close(); } catch (e) {}
        if (cb) cb(id);
    }
};

// Self-contained grid styling (theme variables, same as the app menu rows).
(function () {
    try {
        if (document.getElementById("edex_ic_css")) return;
        const s = document.createElement("style");
        s.id = "edex_ic_css";
        s.textContent = ".edex_ic_grid{display:grid;grid-template-columns:repeat(8,1fr);gap:1vh;max-height:52vh;overflow-y:auto;padding:1vh 0}.edex_ic_cell{display:flex;align-items:center;justify-content:center;padding:1.3vh;border:.092vh solid rgba(var(--color_r),var(--color_g),var(--color_b),.3);cursor:pointer;transition:background .15s}.edex_ic_cell .appmonitor_icon_ph{width:3.6vh;height:3.6vh;opacity:1}.edex_ic_cell:hover,.edex_ic_cell.active{background:rgba(var(--color_r),var(--color_g),var(--color_b),.28)}.edex_ic_none{opacity:.6}";
        document.head.appendChild(s);
    } catch (e) {}
})();
