// Discovery of the user's installed Chrome web apps (PWAs), used by the tab 4
// webapp panel. This reads Chrome's OWN install locations so the panel mirrors
// exactly what the user has saved in Chrome (e.g. an installed Outlook app
// shows up here), while the actual browsing inside eDEX stays fully isolated
// from the external Chrome (separate Chromium + separate profile).
//
//   macOS : ~/Applications/Chrome Apps.localized/*.app  (Info.plist keys
//           CFBundleName / CrAppModeShortcutURL / CrAppModeShortcutID)
//   Linux : ~/.local/share/applications/*.desktop       (X-WebApp-Url)
//   Win   : best-effort, currently falls back to the settings list

class Webapps {
    constructor() {
        this._cache = null;
        this._customKey = "edex_custom_webapps";
        this._hiddenKey = "edex_hidden_webapps";
    }

    async list() {
        if (this._cache) return this._cache;
        let apps = [];
        try {
            if (process.platform === "darwin") apps = await this._mac();
            else if (process.platform === "linux") apps = this._linux();
            else apps = this._windows();
        } catch (e) {
            apps = [];
        }
        // Any entries the user added manually in settings.json get merged in.
        if (window.settings && Array.isArray(window.settings.webapps)) {
            window.settings.webapps.forEach(w => {
                if (w && w.name && w.url && !apps.some(a => a.name === w.name)) apps.push({ name: w.name, url: w.url, id: null, icon: null });
            });
        }
        // Webapps the user saved from inside the browser ("Add as webapp").
        this._customList().forEach(c => {
            if (c && c.name && c.url && !apps.some(a => a.url === c.url)) {
                apps.push({ name: c.name, url: c.url, id: null, icon: null, custom: true });
            }
        });
        // Drop any the user removed from the list (hidden Chrome PWAs etc).
        const hidden = this._hiddenList();
        apps = apps.filter(a => !hidden.includes(a.url));
        apps.sort((a, b) => a.name.localeCompare(b.name));
        this._cache = apps;
        return apps;
    }

    /* Custom webapps the user saved from inside the browser (localStorage,
       so they survive restarts and show up in the tab-4 webapp switcher). */
    _customList() {
        try { const c = JSON.parse(localStorage.getItem(this._customKey)); return Array.isArray(c) ? c : []; } catch (e) { return []; }
    }

    addCustom(name, url) {
        if (!name || !url || /^about:|^data:/.test(url)) return false;
        const list = this._customList();
        if (list.some(a => a.url === url)) return false;
        list.push({ name, url, id: null, icon: null, custom: true });
        try { localStorage.setItem(this._customKey, JSON.stringify(list)); } catch (e) {}
        this._cache = null; // next list() re-reads custom entries
        return true;
    }

    removeCustom(url) {
        const list = this._customList().filter(a => a.url !== url);
        try { localStorage.setItem(this._customKey, JSON.stringify(list)); } catch (e) {}
        this._cache = null;
    }

    _hiddenList() {
        try { const h = JSON.parse(localStorage.getItem(this._hiddenKey)); return Array.isArray(h) ? h : []; } catch (e) { return []; }
    }

    // Remove a webapp from the tab-4 list. Custom ones (saved from the browser)
    // are truly deleted; Chrome-installed PWAs are hidden from THIS list (they
    // belong to Chrome and reappear until hidden, so a remove just hides them).
    removeApp(app) {
        if (!app || !app.url) return "error";
        if (app.custom) {
            this.removeCustom(app.url);
            return "removed";
        }
        const h = this._hiddenList();
        if (!h.includes(app.url)) h.push(app.url);
        try { localStorage.setItem(this._hiddenKey, JSON.stringify(h)); } catch (e) {}
        this._cache = null;
        return "hidden";
    }

    /* macOS: Chrome-installed web apps are .app bundles in ~/Applications. */
    async _mac() {
        const path = require("path"), os = require("os"), fs = require("fs");
        const execFile = require("child_process").execFile;

        const dirs = [
            path.join(os.homedir(), "Applications", "Chrome Apps.localized"),
            "/Applications/Chrome Apps.localized"
        ];
        const chromeManifestRoot = path.join(
            os.homedir(), "Library", "Application Support", "Google", "Chrome", "Default",
            "Web Applications", "Manifest Resources");

        const readKey = plist => key => new Promise(res => {
            execFile("/usr/bin/plutil", ["-extract", key, "raw", plist], (err, out) => {
                res(err ? null : String(out).trim());
            });
        });

        const apps = [];
        const seen = new Set();
        for (const dir of dirs) {
            let entries = [];
            try { entries = fs.readdirSync(dir).filter(e => e.endsWith(".app")); } catch (e) { continue; }
            for (const entry of entries) {
                const plist = path.join(dir, entry, "Contents", "Info.plist");
                if (!fs.existsSync(plist)) continue;
                const read = readKey(plist);
                const name = await read("CFBundleName");
                const url = await read("CrAppModeShortcutURL");
                const id = await read("CrAppModeShortcutID");
                if (!name || !url || seen.has(name)) continue;
                seen.add(name);

                let icon = null;
                if (id) {
                    // Chrome keeps a copy of the PWA icons in its own profile.
                    const iconPath = path.join(chromeManifestRoot, id, "Icons", "64.png");
                    try {
                        if (fs.existsSync(iconPath)) {
                            icon = "data:image/png;base64," + fs.readFileSync(iconPath).toString("base64");
                        }
                    } catch (e) {}
                }
                apps.push({ name, url, id: id || null, icon });
            }
        }
        return apps;
    }

    /* Linux: Chrome web apps create .desktop launchers with X-WebApp-Url. */
    _linux() {
        const path = require("path"), os = require("os"), fs = require("fs");
        const dir = path.join(os.homedir(), ".local", "share", "applications");
        const apps = [];
        let files = [];
        try { files = fs.readdirSync(dir).filter(f => f.endsWith(".desktop")); } catch (e) { return apps; }
        for (const f of files) {
            let content = "";
            try { content = fs.readFileSync(path.join(dir, f), "utf-8"); } catch (e) { continue; }
            const urlMatch = content.match(/^X-WebApp-Url=(.*)$/m);
            const nameMatch = content.match(/^Name=(.*)$/m);
            if (!urlMatch) continue;
            const name = nameMatch ? nameMatch[1].trim() : path.basename(f, ".desktop");
            if (name && !apps.some(a => a.name === name)) {
                apps.push({ name, url: urlMatch[1].trim(), id: null, icon: null });
            }
        }
        return apps;
    }

    /* Windows: best-effort stub - falls back to the settings list. */
    _windows() {
        return [];
    }
}

module.exports = {
    Webapps
};
