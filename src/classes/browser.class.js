// Embedded Chromium browser for shell tab 5 - a "monitor" view with its own
// internal multi-tab support. Each browser tab is a <webview> backed by the
// Chromium binary bundled inside Electron, so it is fully independent of the
// system Chrome (separate binary, separate profile, separate updates - it
// updates when eDEX updates Electron).
//
// Session data uses partition="persist:edex-browser", which stores cookies in
// the eDEX userData dir: logins survive restarts and never touch the real
// Chrome. In-browser shortcuts (Ctrl+T / Ctrl+W / Ctrl+L) are routed from the
// main process via before-input-event (see _boot.js), because a focused webview
// swallows key events and globalShortcut would leak into every other app.

class Browser {
    constructor(opts) {
        this.container = typeof opts.container === "string" ? document.getElementById(opts.container) : opts.container;
        if (!this.container) return;

        this.tabs = [];           // [{ id, webview, el, title, url, favicon, loading }]
        this.activeId = null;
        this._nextId = 1;
        this.maxTabs = 8;
        // Start page lives inside the app bundle (resolved from ui.html's URL);
        // the Chromium version is passed along so the page can display it.
        try {
            this.startUrl = new URL("assets/browser/start.html?v=" + encodeURIComponent(process.versions.chrome), window.location.href).href;
        } catch (e) {
            this.startUrl = "about:blank";
        }

        this.settings = this._loadSettings();
        this.bookmarks = this._loadBookmarks();
        this._downloads = {};

        this._buildChrome();
        this._bindToolbar();
        this._restore();

        // Download progress from the main process (see _boot.js will-download).
        require("electron").ipcRenderer.on("browser-download", (e, type, data) => this._onDownload(type, data));

        // Sync the saved ad-block setting to the main process blocker.
        try { require("electron").ipcRenderer.send("set-adblock", !!this.settings.adblock); } catch (err) {}
    }

    /* ---------------------------- DOM / chrome ---------------------------- */

    _buildChrome() {
        this.container.innerHTML = "";
        const root = document.createElement("div");
        root.className = "browser_chrome";
        root.innerHTML = `
            <div class="browser_tabstrip">
                <div class="browser_tabs"></div>
                <button class="browser_newtab" title="New tab">${Icons.plus}</button>
            </div>
            <div class="browser_toolbar">
                <button data-act="back" title="Back">${Icons.back}</button>
                <button data-act="forward" title="Forward">${Icons.forward}</button>
                <button data-act="reload" data-state="idle" title="Reload">${Icons.reload}</button>
                <div class="browser_omnibox">
                    <span class="browser_omnibox_icon">${Icons.globe}</span>
                    <input class="browser_address" type="text" spellcheck="false" autocomplete="off" placeholder="Search or type a URL…">
                </div>
                <button data-act="bookmark" title="Bookmark this page">${Icons.star}</button>
                <button data-act="fullscreen" title="Fullscreen">${Icons.maximize}</button>
                <button data-act="menu" title="Browser menu">${Icons.menu}</button>
            </div>
            <div class="browser_views"></div>`;
        this.container.appendChild(root);

        this.tabstrip = root.querySelector(".browser_tabs");
        this.views = root.querySelector(".browser_views");
        this.omniboxIcon = root.querySelector(".browser_omnibox_icon");
        this.address = root.querySelector(".browser_address");
        this.reloadBtn = root.querySelector('[data-act="reload"]');

        // While the omnibox is focused it shows a search glyph; on blur it
        // reverts to the page's security icon.
        this.address.addEventListener("focus", () => { if (this.omniboxIcon) this.omniboxIcon.innerHTML = Icons.search; });
        this.address.addEventListener("blur", () => this._syncOmniboxIcon());

        // Bookmark/menu/history panels live on <body> (the toolbar clips
        // overflow); the Chrome-style settings overlay lives INSIDE the views
        // area so it covers just the web content below the toolbar.
        this.bmMenu = this._makePanel("browser_bookmark_menu");
        this.menuEl = this._makePanel("browser_menu");
        this.histEl = this._makePanel("browser_history");
        this.settingsEl = document.createElement("div");
        this.settingsEl.className = "browser_settings";
        this.settingsEl.style.display = "none";
        this.views.appendChild(this.settingsEl);
        this._bindPanelClose();
    }

    _makePanel(className) {
        const el = document.createElement("div");
        el.className = className;
        el.style.display = "none";
        document.body.appendChild(el);
        return el;
    }

    /* ------------------------------ tabs ------------------------------ */

    newTab(url, opts) {
        if (this.tabs.length >= this.maxTabs) return null;
        const incognito = !!(opts && opts.incognito);
        const id = this._nextId++;

        const wv = document.createElement("webview");
        wv.className = "browser_webview";
        // Incognito uses a NON-persistent session (no "persist:" prefix), so
        // cookies/history vanish when the app quits - like a real incognito tab.
        wv.setAttribute("partition", incognito ? "edex-incognito" : "persist:edex-browser");
        wv.setAttribute("webpreferences", "contextIsolation=yes, nodeIntegration=no, sandbox=yes");
        wv.setAttribute("allowpopups", "");
        this.views.appendChild(wv);

        const tab = { id, webview: wv, el: null, title: "New Tab", url: url || "about:blank", favicon: null, loading: false, incognito, devtoolsOpen: false };
        tab.el = this._makeTabEl(tab);
        this.tabs.push(tab);

        this._wireWebview(tab);
        wv.setAttribute("src", tab.url);

        this.activateTab(id);
        this._save();
        return tab;
    }

    _makeTabEl(tab) {
        const el = document.createElement("div");
        el.className = "browser_tab" + (tab.incognito ? " incognito" : "");
        el.dataset.id = tab.id;
        el.innerHTML = `<span class="browser_tab_fav"></span><span class="browser_tab_title">New Tab</span><button class="browser_tab_close" title="Close tab">${Icons.close}</button>`;
        el.addEventListener("mousedown", e => {
            if (e.button === 1) { e.preventDefault(); this.closeTab(tab.id); }
            else { this._closePanels(); this.activateTab(tab.id); }
        });
        el.querySelector(".browser_tab_close").addEventListener("click", e => {
            e.stopPropagation();
            this.closeTab(tab.id);
        });
        this.tabstrip.appendChild(el);
        return el;
    }

    _wireWebview(tab) {
        const wv = tab.webview;
        wv.addEventListener("did-start-loading", () => { tab.loading = true; this._syncTabUi(tab); this._syncToolbar(); });
        wv.addEventListener("did-stop-loading", () => { tab.loading = false; this._syncTabUi(tab); this._syncToolbar(); });
        wv.addEventListener("page-title-updated", e => { tab.title = e.title || tab.title; this._syncTabUi(tab); });
        wv.addEventListener("did-navigate", e => { tab.url = e.url; this._syncAddress(); this._syncToolbar(); this._save(); this._recordHistory(e.url, tab.title); });
        wv.addEventListener("did-navigate-in-page", e => { tab.url = e.url; this._syncAddress(); });
        wv.addEventListener("did-fail-load", e => {
            // -3 == ERR_ABORTED (e.g. navigation replaced by another one) - ignore.
            if (e.isMainFrame && e.errorCode !== -3) {
                tab.title = "Failed to load";
                this._syncTabUi(tab);
                this._syncToolbar();
            }
        });
        // Track devtools state from events: isDevToolsOpened() is unreliable
        // for a detached devtools window, which made the toggle unable to close.
        wv.addEventListener("devtools-opened", () => { tab.devtoolsOpen = true; this._syncToolbar(); });
        wv.addEventListener("devtools-closed", () => { tab.devtoolsOpen = false; this._syncToolbar(); });
        // Live match count for the find bar.
        wv.addEventListener("found-in-page", e => {
            if (!this.findBar || this.findBar.style.display === "none") return;
            const { activeMatchOrdinal, matches, finalUpdate } = (e.result || {});
            if (this.findCount && finalUpdate) this.findCount.textContent = matches ? activeMatchOrdinal + "/" + matches : "0/0";
        });
        wv.addEventListener("page-favicon-updated", e => {
            tab.favicon = (e.favicons && e.favicons.length) ? e.favicons[0] : null;
            this._syncTabUi(tab);
        });
        wv.addEventListener("did-attach", () => {
            // window.open / target=_blank is routed via the main process
            // (webview-window-open IPC, see _boot.js) because the <webview>
            // element has no setWindowOpenHandler in modern Electron.
            try {
                // Apply the configured default zoom to freshly attached guests.
                if (this.settings && this.settings.zoom && this.settings.zoom !== 1 && wv.setZoomFactor) {
                    wv.setZoomFactor(this.settings.zoom);
                }
            } catch (e) {}
        });
        wv.addEventListener("focus", () => { this._hasFocus = true; });
        wv.addEventListener("blur", () => { this._hasFocus = false; });
    }

    activateTab(id) {
        const tab = this.tabs.find(t => t.id === id);
        if (!tab) return;
        this.activeId = id;
        this.tabs.forEach(t => {
            const active = t.id === id;
            t.el.classList.toggle("active", active);
            t.webview.style.display = active ? "" : "none";
        });
        this._syncAddress();
        this._syncToolbar();
        this._focusActive();
    }

    closeTab(id) {
        const i = this.tabs.findIndex(t => t.id === id);
        if (i < 0) return;
        const tab = this.tabs[i];
        // Unload before removing so the renderer process is released promptly.
        try { tab.webview.setAttribute("src", "about:blank"); } catch (e) {}
        if (tab.el && tab.el.remove) tab.el.remove();
        if (tab.webview && tab.webview.remove) tab.webview.remove();
        this.tabs.splice(i, 1);

        if (this.tabs.length === 0) {
            this.newTab(this.startUrl);
        } else if (id === this.activeId) {
            this.activateTab(this.tabs[Math.max(0, i - 1)].id);
        } else {
            this._syncToolbar();
        }
        this._save();
    }

    /* --------------------------- navigation --------------------------- */

    activeTab() {
        return this.tabs.find(t => t.id === this.activeId) || null;
    }

    navigateTo(url) {
        const tab = this.activeTab();
        if (!tab || !url) return;
        tab.webview.setAttribute("src", url);
        this._syncAddress();
    }

    navigateFromBar(raw) {
        const url = this._normalizeUrl(raw);
        if (!url) return;
        this.navigateTo(url);
        this.address.blur();
    }

    // Turn user input into a navigable URL. Local dev servers (localhost / LAN
    // IPs / host:port) go straight to http:// so `npm run dev` pages load; a
    // bare word or phrase becomes a web search.
    _normalizeUrl(input) {
        let s = String(input || "").trim();
        if (!s) return null;
        // Only RECOGNIZED schemes pass through untouched - a bare word:port
        // (e.g. "localhost:3000") is not a scheme and must become http://.
        if (/^(https?|file|about|data|ws|wss|ftp|chrome|devtools):/i.test(s)) return s;
        if (/^(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(s) ||
            /^(\d{1,3}\.){3}\d{1,3}(:\d+)?([/?#].*)?$/.test(s) ||
            /^[\w-]+(\.[\w-]+)+:\d+([/?#].*)?$/.test(s) ||
            /^[\w-]+:\d+([/?#].*)?$/.test(s)) {
            return "http://" + s;
        }
        if (/^[\w-]+(\.[\w-]+)+([/:?#].*)?$/.test(s) && !/\s/.test(s)) {
            return "https://" + s;
        }
        return this._engineUrl(s);
    }

    _engineUrl(q) {
        switch (this.settings && this.settings.engine) {
            case "google": return "https://www.google.com/search?q=" + encodeURIComponent(q);
            case "bing":   return "https://www.bing.com/search?q=" + encodeURIComponent(q);
            case "baidu":  return "https://www.baidu.com/s?wd=" + encodeURIComponent(q);
            default:       return "https://duckduckgo.com/?q=" + encodeURIComponent(q);
        }
    }

    /* --------------------------- toolbar --------------------------- */

    _bindToolbar() {
        this.container.addEventListener("click", e => {
            const btn = e.target.closest ? e.target.closest("button[data-act]") : null;
            if (!btn) return;
            const act = btn.dataset.act;
            const tab = this.activeTab();
            const wv = tab && tab.webview;
            switch (act) {
                case "back":
                    if (wv && wv.canGoBack) wv.goBack();
                    break;
                case "forward":
                    if (wv && wv.canGoForward) wv.goForward();
                    break;
                case "reload":
                    if (wv) (tab.loading ? wv.stop() : wv.reload());
                    break;
                case "home":
                    this.navigateTo(this.settings.home || this.startUrl);
                    break;
                case "devtools":
                    this.toggleDevTools();
                    break;
                case "bookmark":
                    this.toggleBookmark();
                    break;
                case "fullscreen":
                    this.toggleFullscreen();
                    break;
                case "menu":
                    this._toggleMenu();
                    break;
                case "external":
                    if (tab && tab.url && !/^about:/i.test(tab.url)) {
                        try { require("electron").shell.openExternal(tab.url); } catch (err) {}
                    }
                    break;
            }
        });

        this.address.addEventListener("keydown", e => {
            if (e.key === "Enter") this.navigateFromBar(this.address.value);
            else if (e.key === "Escape") this.address.blur();
        });

        const newBtn = this.container.querySelector(".browser_newtab");
        if (newBtn) newBtn.addEventListener("click", () => this.newTab(this.startUrl));
    }

    toggleDevTools() {
        const tab = this.activeTab();
        if (!tab || !tab.webview) return;
        try {
            if (tab.devtoolsOpen) { tab.webview.closeDevTools(); tab.devtoolsOpen = false; }
            else { tab.webview.openDevTools({ mode: "detach" }); tab.devtoolsOpen = true; }
        } catch (e) {}
    }

    // Fullscreen the active tab's page in a body-level overlay (see
    // window.webViewFullscreen). A fresh webview loads the same URL so the
    // in-frame tab keeps its state untouched.
    toggleFullscreen() {
        const tab = this.activeTab();
        if (!tab || !tab.webview) return;
        if (window.webViewFullscreen.el) { window.webViewFullscreen.exit(); return; }
        if (!tab.url || /^about:|^data:/.test(tab.url)) return;
        const partition = tab.webview.getAttribute("partition") || "persist:edex-browser";
        window.webViewFullscreen.enter(tab.url, partition);
    }

    focusAddressBar() {
        if (!this.address) return;
        this.address.focus();
        this.address.select();
    }

    /* ---------------------- find in page / print ---------------------- */

    _buildFindBar() {
        if (this.findBar) return;
        this.findBar = document.createElement("div");
        this.findBar.className = "browser_find";
        this.findBar.style.display = "none";
        this.findBar.innerHTML = `
            <input class="browser_find_input" type="text" placeholder="Find in page…">
            <span class="browser_find_count">0/0</span>
            <button class="browser_find_prev" title="Previous">${Icons.chevronUp}</button>
            <button class="browser_find_next" title="Next">${Icons.chevronDown}</button>
            <button class="browser_find_close" title="Close">${Icons.close}</button>`;
        this.findInput = this.findBar.querySelector(".browser_find_input");
        this.findCount = this.findBar.querySelector(".browser_find_count");
        const onInput = () => this._doFind();
        this.findInput.addEventListener("input", onInput);
        this.findInput.addEventListener("keydown", e => {
            if (e.key === "Enter") { e.preventDefault(); this.findNext(e.shiftKey); }
            if (e.key === "Escape") { e.preventDefault(); this.closeFind(); }
        });
        this.findBar.querySelector(".browser_find_prev").onclick = () => this.findNext(true);
        this.findBar.querySelector(".browser_find_next").onclick = () => this.findNext(false);
        this.findBar.querySelector(".browser_find_close").onclick = () => this.closeFind();
        this.views.appendChild(this.findBar);
    }

    openFind() {
        this._buildFindBar();
        this.findBar.style.display = "flex";
        this.findInput.focus();
        this.findInput.select();
    }

    closeFind() {
        if (!this.findBar || this.findBar.style.display === "none") return;
        this.findBar.style.display = "none";
        const tab = this.activeTab();
        if (tab && tab.webview) { try { tab.webview.stopFindInPage("clearSelection"); } catch (e) {} }
    }

    _doFind() {
        const tab = this.activeTab();
        const q = this.findInput.value;
        if (!tab || !tab.webview) return;
        if (!q) { try { tab.webview.stopFindInPage("clearSelection"); } catch (e) {} if (this.findCount) this.findCount.textContent = "0/0"; return; }
        try { tab.webview.findInPage(q, { forward: true, findNext: false }); } catch (e) {}
    }

    findNext(backward) {
        const tab = this.activeTab();
        const q = this.findInput.value;
        if (!tab || !tab.webview || !q) return;
        try { tab.webview.findInPage(q, { forward: !backward, findNext: true }); } catch (e) {}
    }

    printPage() {
        const tab = this.activeTab();
        if (!tab || !tab.webview) return;
        try { tab.webview.print({}, () => {}); } catch (e) {}
    }

    /* ---------------------------- downloads ---------------------------- */

    _buildDownloadsBar() {
        if (this.downloadsBar) return;
        this.downloadsBar = document.createElement("div");
        this.downloadsBar.className = "browser_downloads";
        this.downloadsBar.style.display = "none";
        this.downloadsBar.innerHTML = `
            <div class="browser_downloads_title">Downloads <button class="browser_downloads_close" title="Hide">${Icons.close}</button></div>
            <div class="browser_downloads_list"></div>`;
        this.downloadsList = this.downloadsBar.querySelector(".browser_downloads_list");
        this.downloadsBar.querySelector(".browser_downloads_close").onclick = () => { this.downloadsBar.style.display = "none"; };
        this.views.appendChild(this.downloadsBar);
    }

    _onDownload(type, data) {
        this._buildDownloadsBar();
        this.downloadsBar.style.display = "block";
        let row = this._downloads[data.id];
        if (!row) {
            row = document.createElement("div");
            row.className = "browser_dl";
            row.innerHTML = `
                <span class="browser_dl_name"></span>
                <div class="browser_dl_progress"><div class="browser_dl_bar"></div></div>
                <span class="browser_dl_pct"></span>
                <button class="browser_dl_open" title="Open file">${Icons.chevronDown}</button>
                <button class="browser_dl_rm" title="Remove">${Icons.close}</button>`;
            this._downloads[data.id] = row;
            this.downloadsList.appendChild(row);
        }
        row.querySelector(".browser_dl_name").textContent = data.name || data.id;
        const bar = row.querySelector(".browser_dl_bar");
        const pct = row.querySelector(".browser_dl_pct");
        const p = data.total ? Math.min(100, Math.round(100 * data.received / data.total)) : 0;
        if (bar) bar.style.width = p + "%";
        if (pct) pct.textContent = type === "done" ? "100%" : (type === "failed" ? "Failed" : p + "%");
        if (type === "done" || type === "failed") row.classList.add("done");
        const openBtn = row.querySelector(".browser_dl_open");
        if (openBtn) openBtn.onclick = () => { try { require("electron").shell.openPath(data.path || ""); } catch (e) {} };
        row.querySelector(".browser_dl_rm").onclick = () => { row.remove(); delete this._downloads[data.id]; };
    }

    /* ---------------------------- sync / ui ---------------------------- */

    _syncAddress() {
        const tab = this.activeTab();
        if (!tab || !this.address) return;
        this.address.value = (tab.url && !/^about:|^data:/.test(tab.url)) ? tab.url : "";
        this._syncOmniboxIcon();
        this._syncBookmarkState();
    }

    // Chrome-style omnibox status glyph: shield on https, globe otherwise,
    // search while the box is focused/typed (handled in _buildChrome).
    _syncOmniboxIcon() {
        if (!this.omniboxIcon) return;
        const tab = this.activeTab();
        const url = tab && tab.url;
        if (!url || /^about:|^data:/.test(url)) this.omniboxIcon.innerHTML = Icons.search;
        else if (/^https:/i.test(url)) this.omniboxIcon.innerHTML = Icons.shield;
        else this.omniboxIcon.innerHTML = Icons.globe;
    }

    _syncToolbar() {
        if (!this.reloadBtn) return;
        const tab = this.activeTab();
        const wv = tab && tab.webview;
        this.reloadBtn.setAttribute("data-state", (tab && tab.loading) ? "loading" : "idle");
        const back = this.container.querySelector('[data-act="back"]');
        const fwd = this.container.querySelector('[data-act="forward"]');
        const can = (fn) => { try { return !!(wv && wv[fn] && wv[fn]()); } catch (e) { return false; } };
        if (back) back.classList.toggle("disabled", !can("canGoBack"));
        if (fwd) fwd.classList.toggle("disabled", !can("canGoForward"));
    }

    _syncTabUi(tab) {
        if (!tab || !tab.el) return;
        const titleEl = tab.el.querySelector(".browser_tab_title");
        if (titleEl) titleEl.textContent = (tab.loading ? "◌ " : "") + (tab.title || "New Tab");
        const fav = tab.el.querySelector(".browser_tab_fav");
        if (fav) fav.innerHTML = tab.favicon ? `<img src="${tab.favicon}" alt="">` : "";
    }

    /* ---------------------------- bookmarks ---------------------------- */

    _loadBookmarks() {
        try { const b = JSON.parse(localStorage.getItem("edex_bookmarks")); return Array.isArray(b) ? b : []; } catch (e) { return []; }
    }

    _saveBookmarks() {
        try { localStorage.setItem("edex_bookmarks", JSON.stringify(this.bookmarks)); } catch (e) {}
    }

    _syncBookmarkState() {
        const btn = this.container.querySelector('[data-act="bookmark"]');
        if (!btn) return;
        const tab = this.activeTab();
        const isBm = !!(tab && tab.url && !/^about:|^data:/.test(tab.url) && this.bookmarks.some(b => b.url === tab.url));
        btn.innerHTML = isBm ? Icons.starFilled : Icons.star;
        btn.classList.toggle("active", isBm);
        btn.title = isBm ? "Remove bookmark" : "Bookmark this page";
    }

    toggleBookmark() {
        const tab = this.activeTab();
        if (!tab || !tab.url || /^about:|^data:/.test(tab.url)) return;
        const i = this.bookmarks.findIndex(b => b.url === tab.url);
        if (i >= 0) this.bookmarks.splice(i, 1);
        else this.bookmarks.unshift({ title: tab.title || tab.url, url: tab.url, addedAt: Date.now() });
        this._saveBookmarks();
        this._syncBookmarkState();
        this._renderBookmarkPanel();
        this._togglePanel(this.bmMenu, this.container.querySelector('[data-act="bookmark"]'));
    }

    _renderBookmarkPanel() {
        if (!this.bmMenu) return;
        this.bmMenu.innerHTML = "";
        const title = document.createElement("div");
        title.className = "browser_panel_title";
        title.textContent = "Bookmarks";
        this.bmMenu.appendChild(title);
        if (!this.bookmarks.length) {
            const e = document.createElement("div");
            e.className = "browser_panel_empty";
            e.textContent = "No bookmarks yet - tap ☆ to save this page";
            this.bmMenu.appendChild(e);
            return;
        }
        this.bookmarks.forEach(b => {
            const opt = document.createElement("div");
            opt.className = "browser_panel_opt";
            const label = document.createElement("span");
            label.className = "browser_panel_label";
            label.textContent = b.title || b.url;
            const url = document.createElement("span");
            url.className = "browser_panel_url";
            url.textContent = b.url.replace(/^https?:\/\//, "");
            const del = document.createElement("button");
            del.className = "browser_panel_del";
            del.innerHTML = Icons.close;
            del.title = "Remove bookmark";
            del.onclick = ev => { ev.stopPropagation(); this.bookmarks = this.bookmarks.filter(x => x.url !== b.url); this._saveBookmarks(); this._renderBookmarkPanel(); this._syncBookmarkState(); };
            opt.appendChild(label);
            opt.appendChild(url);
            opt.appendChild(del);
            opt.onclick = () => { this.newTab(b.url); this._closePanels(); };
            this.bmMenu.appendChild(opt);
        });
    }

    /* ---------------------------- history ---------------------------- */

    _loadHistory() {
        try { const h = JSON.parse(localStorage.getItem("edex_history")); return Array.isArray(h) ? h : []; } catch (e) { return []; }
    }

    _recordHistory(url, title) {
        if (!url || /^about:|^data:/.test(url)) return;
        const h = this._loadHistory();
        const i = h.findIndex(x => x.url === url);
        const rec = { title: title || url, url, ts: Date.now() };
        if (i >= 0) h.splice(i, 1);
        h.unshift(rec);
        if (h.length > 200) h.length = 200;
        try { localStorage.setItem("edex_history", JSON.stringify(h)); } catch (e) {}
    }

    _renderHistoryPanel() {
        if (!this.histEl) return;
        this.histEl.innerHTML = "";
        const title = document.createElement("div");
        title.className = "browser_panel_title";
        title.innerHTML = "History <button class='browser_panel_clear'>Clear</button>";
        this.histEl.appendChild(title);
        const h = this._loadHistory();
        if (!h.length) {
            const e = document.createElement("div");
            e.className = "browser_panel_empty";
            e.textContent = "No history yet";
            this.histEl.appendChild(e);
            return;
        }
        h.forEach(rec => {
            const opt = document.createElement("div");
            opt.className = "browser_panel_opt";
            const label = document.createElement("span");
            label.className = "browser_panel_label";
            label.textContent = rec.title || rec.url;
            const url = document.createElement("span");
            url.className = "browser_panel_url";
            url.textContent = rec.url.replace(/^https?:\/\//, "");
            opt.appendChild(label);
            opt.appendChild(url);
            opt.onclick = () => { this.newTab(rec.url); this._closePanels(); };
            this.histEl.appendChild(opt);
        });
        const clear = this.histEl.querySelector(".browser_panel_clear");
        if (clear) clear.onclick = () => { try { localStorage.removeItem("edex_history"); } catch (e) {} this._renderHistoryPanel(); };
    }

    /* ---------------------------- menu ---------------------------- */

    _toggleMenu() {
        if (!this.menuEl) return;
        if (this.menuEl.style.display !== "none") { this._closePanels(); return; }
        this.menuEl.innerHTML = "";
        const items = [
            ["newtab", "New tab"],
            ["incognito", "New incognito tab"],
            ["add-webapp", "Add current page as webapp"],
            null,
            ["home", "Home"],
            ["bookmarks", "Bookmarks"],
            ["history", "History"],
            null,
            ["find", "Find in page"],
            ["print", "Print"],
            null,
            ["zoom-in", "Zoom in"],
            ["zoom-out", "Zoom out"],
            ["zoom-reset", "Reset zoom"],
            null,
            ["devtools", "Developer tools"],
            ["settings", "Settings"],
        ];
        items.forEach(item => {
            if (!item) {
                const sep = document.createElement("div");
                sep.className = "browser_menu_sep";
                this.menuEl.appendChild(sep);
                return;
            }
            const opt = document.createElement("div");
            opt.className = "browser_menu_opt";
            opt.textContent = item[1];
            opt.onclick = () => this._handleMenuAction(item[0]);
            this.menuEl.appendChild(opt);
        });
        this._togglePanel(this.menuEl, this.container.querySelector('[data-act="menu"]'), true);
    }

    _handleMenuAction(act) {
        this._closePanels();
        switch (act) {
            case "newtab": this.newTab(this.settings.home || this.startUrl); break;
            case "incognito": this.newTab(this.settings.home || this.startUrl, { incognito: true }); break;
            case "add-webapp": this._addCurrentAsWebapp(); break;
            case "home": this.navigateTo(this.settings.home || this.startUrl); break;
            case "find": this.openFind(); break;
            case "print": this.printPage(); break;
            case "bookmarks": this._renderBookmarkPanel(); this._togglePanel(this.bmMenu); break;
            case "history": this._renderHistoryPanel(); this._togglePanel(this.histEl); break;
            case "zoom-in": this._zoomBy(0.1); break;
            case "zoom-out": this._zoomBy(-0.1); break;
            case "zoom-reset": this._zoomBy(0, true); break;
            case "devtools": this.toggleDevTools(); break;
            case "settings": this._renderSettingsPanel(); this._showSettings(); break;
        }
    }

    // Save the current page as a custom webapp so it shows up in the tab-4
    // webapp switcher (alongside Chrome's installed PWAs).
    _addCurrentAsWebapp() {
        const tab = this.activeTab();
        if (!tab || !tab.url || /^about:|^data:/.test(tab.url)) {
            this._notify("Cannot add this page as a webapp");
            return;
        }
        const name = (tab.title && !/^New Tab/.test(tab.title)) ? tab.title : tab.url.replace(/^https?:\/\//, "").split("/")[0];
        const added = window.webapps ? window.webapps.addCustom(name, tab.url) : false;
        this._notify(added ? "Added \"" + name + "\" to webapps" : "\"" + name + "\" is already a webapp");
        if (window.webappPanel && added) window.webappPanel.refresh();
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
        clearTimeout(this._toastTimer);
        this._toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
    }

    _zoomBy(delta, reset) {
        const tab = this.activeTab();
        if (!tab || !tab.webview) return;
        try {
            if (reset) { tab.webview.setZoomFactor(1); return; }
            const cur = (typeof tab.webview.getZoomFactor === "function") ? tab.webview.getZoomFactor() : 1;
            tab.webview.setZoomFactor(Math.min(3, Math.max(0.25, cur + delta)));
        } catch (e) {}
    }

    /* ---------------------------- settings ---------------------------- */

    _defaultSettings() {
        return { home: this.startUrl, engine: "duckduckgo", startup: "ntp", zoom: 1, adblock: true };
    }

    _loadSettings() {
        try { return Object.assign(this._defaultSettings(), JSON.parse(localStorage.getItem("edex_browser_settings") || "{}")); } catch (e) { return this._defaultSettings(); }
    }

    _saveSettings() {
        try { localStorage.setItem("edex_browser_settings", JSON.stringify(this.settings)); } catch (e) {}
    }

    _renderSettingsPanel() {
        if (!this.settingsEl) return;
        const s = this.settings;
        const engines = [["duckduckgo", "DuckDuckGo"], ["google", "Google"], ["bing", "Bing"], ["baidu", "Baidu"]];
        const zooms = [0.75, 0.9, 1, 1.1, 1.25, 1.5];
        const field = (label, inner) => `<label class="browser_settings_field"><span class="browser_settings_label">${label}</span>${inner}</label>`;
        const radio = (name, v, label, extra = "") =>
            `<label class="browser_settings_field browser_settings_check"><input type="radio" name="${name}" value="${v}"${s.startup === v ? " checked" : ""}> ${label}${extra}</label>`;

        this.settingsEl.innerHTML = `
            <div class="browser_settings_header">
                <div class="browser_settings_title">Settings</div>
                <input class="browser_settings_search" type="text" placeholder="Search settings…">
                <button class="browser_settings_close" title="Back">${Icons.close}</button>
            </div>
            <div class="browser_settings_body">
                <div class="browser_settings_sidebar">
                    <div class="browser_settings_cat active" data-cat="general">${Icons.home}<span>On startup</span></div>
                    <div class="browser_settings_cat" data-cat="appearance">${Icons.minimize}<span>Appearance</span></div>
                    <div class="browser_settings_cat" data-cat="search">${Icons.search}<span>Search engine</span></div>
                    <div class="browser_settings_cat" data-cat="privacy">${Icons.shield}<span>Privacy and security</span></div>
                    <div class="browser_settings_cat" data-cat="about">${Icons.settings}<span>About</span></div>
                </div>
                <div class="browser_settings_content">
                    <div class="browser_settings_section" data-section="general">
                        <h3>On startup</h3>
                        ${radio("bs_startup", "ntp", "Open the New Tab page")}
                        ${radio("bs_startup", "restore", "Continue where you left off")}
                        ${radio("bs_startup", "home", "Open a specific page", `<input id="bs_startup_page" type="text" value="${s.home}" placeholder="${this.startUrl}">`)}
                    </div>
                    <div class="browser_settings_section" data-section="appearance" style="display:none">
                        <h3>Appearance</h3>
                        ${field("Default zoom", `<select id="bs_zoom">${zooms.map(z => `<option value="${z}"${s.zoom === z ? " selected" : ""}>${Math.round(z * 100)}%</option>`).join("")}</select>`)}
                        <p class="browser_settings_hint">Zoom applies to the web content of new pages; adjust per-page with the browser menu.</p>
                    </div>
                    <div class="browser_settings_section" data-section="search" style="display:none">
                        <h3>Search engine</h3>
                        ${field("Default search engine", `<select id="bs_engine">${engines.map(([v, l]) => `<option value="${v}"${s.engine === v ? " selected" : ""}>${l}</option>`).join("")}</select>`)}
                        <p class="browser_settings_hint">Used when you type a search query into the address bar.</p>
                    </div>
                    <div class="browser_settings_section" data-section="privacy" style="display:none">
                        <h3>Privacy and security</h3>
                        <p class="browser_settings_hint">Clear the embedded browser's own data. Fully independent of your system Chrome - separate profile and storage, updates with eDEX.</p>
                        <label class="browser_settings_field browser_settings_check"><input id="bs_adblock" type="checkbox"${s.adblock ? " checked" : ""}> Block ads &amp; trackers (ad blocking)</label>
                        <h4>Clear browsing data</h4>
                        <div class="browser_settings_row">
                            <button id="bs_clear_history" class="browser_panel_btn">History</button>
                            <button id="bs_clear_bookmarks" class="browser_panel_btn">Bookmarks</button>
                            <button id="bs_clear_cache" class="browser_panel_btn">Cache</button>
                            <button id="bs_clear_cookies" class="browser_panel_btn">Cookies &amp; site data</button>
                        </div>
                        <p class="browser_settings_hint">Incognito tabs already use a non-persistent session that forgets everything on exit.</p>
                    </div>
                    <div class="browser_settings_section" data-section="about" style="display:none">
                        <h3>About</h3>
                        <p class="browser_settings_hint">This browser runs the Chromium engine bundled inside eDEX - a separate browser from your system Chrome.</p>
                        <div class="browser_settings_row">
                            <span class="browser_settings_about">Chromium ${process.versions.chrome} · Electron ${process.versions.electron}</span>
                        </div>
                    </div>
                    <div class="browser_settings_footer">
                        <button id="bs_save" class="browser_panel_btn">Save</button>
                        <button id="bs_cancel" class="browser_panel_btn">Cancel</button>
                    </div>
                </div>
            </div>`;

        this.settingsEl.querySelectorAll(".browser_settings_cat").forEach(catEl => {
            catEl.addEventListener("click", () => this._showSettingsCat(catEl.dataset.cat));
        });

        const search = this.settingsEl.querySelector(".browser_settings_search");
        if (search) search.addEventListener("input", () => {
            const q = search.value.trim().toLowerCase();
            this.settingsEl.querySelectorAll(".browser_settings_section").forEach(sec => {
                sec.style.display = sec.textContent.toLowerCase().includes(q) ? "" : "none";
            });
        });

        const close = this.settingsEl.querySelector(".browser_settings_close");
        if (close) close.onclick = () => this._closePanels();

        const save = this.settingsEl.querySelector("#bs_save");
        const cancel = this.settingsEl.querySelector("#bs_cancel");
        const val = id => this.settingsEl.querySelector("#" + id);
        if (save) save.onclick = () => {
            try {
                const startupSel = this.settingsEl.querySelector('input[name="bs_startup"]:checked');
                this.settings.startup = startupSel ? startupSel.value : "ntp";
                this.settings.home = (val("bs_startup_page").value || "").trim() || this.startUrl;
                this.settings.engine = val("bs_engine").value;
                this.settings.zoom = parseFloat(val("bs_zoom").value) || 1;
                this.settings.adblock = !!val("bs_adblock") && val("bs_adblock").checked;
                this._saveSettings();
                try { require("electron").ipcRenderer.send("set-adblock", this.settings.adblock); } catch (err) {}
            } catch (e) {}
            this._closePanels();
        };
        if (cancel) cancel.onclick = () => this._closePanels();

        const clearHist = this.settingsEl.querySelector("#bs_clear_history");
        if (clearHist) clearHist.onclick = () => { try { localStorage.removeItem("edex_history"); } catch (e) {} this._notify("History cleared"); };
        const clearBm = this.settingsEl.querySelector("#bs_clear_bookmarks");
        if (clearBm) clearBm.onclick = () => { this.bookmarks = []; this._saveBookmarks(); this._notify("Bookmarks cleared"); };
        const clearCache = this.settingsEl.querySelector("#bs_clear_cache");
        if (clearCache) clearCache.onclick = () => { this._notify("Clearing cache…"); try { require("electron").ipcRenderer.send("browser-clear-data", "cache"); } catch (e) {} };
        const clearCookies = this.settingsEl.querySelector("#bs_clear_cookies");
        if (clearCookies) clearCookies.onclick = () => { this._notify("Clearing cookies & site data…"); try { require("electron").ipcRenderer.send("browser-clear-data", "storage"); } catch (e) {} };
    }

    // Open the Chrome-style settings overlay (covers the web content).
    _showSettings() {
        this._closePanels();
        if (!this.settingsEl) return;
        this._showSettingsCat("general");
        this.settingsEl.style.display = "flex";
    }

    _showSettingsCat(cat) {
        if (!this.settingsEl) return;
        this.settingsEl.querySelectorAll(".browser_settings_cat").forEach(c => c.classList.toggle("active", c.dataset.cat === cat));
        this.settingsEl.querySelectorAll(".browser_settings_section").forEach(sec => {
            sec.style.display = (sec.dataset.section === cat) ? "" : "none";
        });
    }

    /* ---------------------------- panels ---------------------------- */

    _togglePanel(el, anchor, alignRight) {
        if (!el) return;
        if (el.style.display !== "none") { el.style.display = "none"; return; }
        this._closePanels();
        if (anchor) {
            const r = anchor.getBoundingClientRect();
            if (alignRight) el.style.right = Math.max(4, window.innerWidth - r.right) + "px";
            else el.style.left = Math.max(4, r.left - 20) + "px";
            el.style.top = (r.bottom + 6) + "px";
        }
        el.style.display = "block";
    }

    _closePanels() {
        [this.bmMenu, this.menuEl, this.histEl, this.settingsEl].forEach(el => { if (el) el.style.display = "none"; });
    }

    _bindPanelClose() {
        const panelSel = ".browser_bookmark_menu, .browser_menu, .browser_history, .browser_settings";
        document.addEventListener("click", e => {
            if (!e.target || !e.target.closest) return;
            if (e.target.closest('[data-act="bookmark"], [data-act="menu"]')) return;
            if (e.target.closest(panelSel)) return;
            this._closePanels();
        });
    }

    /* ------------------ focus entry points used by the shell ------------------ */

    // Called when the shell switches to this tab (and via the shim's .term.focus()).
    activate() {
        this._focusActive();
        this._syncToolbar();
    }

    focus() {
        this._focusActive();
    }

    _focusActive() {
        const tab = this.activeTab();
        if (tab && tab.webview && tab.webview.focus) tab.webview.focus();
    }

    fit() {
        // Webviews are CSS-sized; nothing to measure (kept for API parity with
        // the terminal, which window.onresize calls on the current slot).
    }

    /* ---------------------------- persistence ---------------------------- */

    _save() {
        try {
            const urls = this.tabs
                .filter(t => t.url && !/^about:|^data:/.test(t.url))
                .map(t => t.url);
            localStorage.setItem("edex_browser_tabs", JSON.stringify({ urls }));
        } catch (e) {}
    }

    _restore() {
        // On-startup behavior: ntp = new tab page, restore = continue where you
        // left off, home = open the home page.
        const mode = (this.settings && this.settings.startup) || "ntp";
        if (mode === "restore") {
            try {
                const raw = localStorage.getItem("edex_browser_tabs");
                if (raw) {
                    const { urls } = JSON.parse(raw);
                    if (Array.isArray(urls) && urls.length) {
                        urls.forEach(u => this.newTab(u));
                        return;
                    }
                }
            } catch (e) {}
        }
        this.newTab(mode === "home" ? (this.settings.home || this.startUrl) : this.startUrl);
    }
}

module.exports = {
    Browser
};
