// Native app discovery for the app monitors (Phase 1):
//   * Linux : scan /usr/share/applications + ~/.local/share/applications for
//             .desktop entries (Name/Exec/Icon, field codes stripped)
//             + AppImage directories
//   * macOS : nothing is scanned (the mock backend supplies demo apps instead)
//   * custom: entries added from the eDEX "ADD APP" dialog, persisted to
//             <userData>/appmonitor-apps.json (works on every platform)

"use strict";
const fs = require("fs");
const path = require("path");
const os = require("os");

const CUSTOM_FILE = "appmonitor-apps.json";

// System plumbing that must never appear in the user's app launcher: terminal
// emulators we ship for setup, the input-method, X.org helpers and GNOME/KDE
// admin utilities. The launcher is for the user's GUI apps, not the distro's.
// Matched against both the .desktop Name and the Exec basename.
const SYSTEM_APP_RE = /(^|[\s_.\/-])(uxterm|xterm|x-terminal-emulator|fcitx5|fcitx|gsettings|gdbus|dbus-|gnome-terminal|gnome-control-center|gnome-system-monitor|gnome-software|gnome-disks|gnome-calculator|gnome-calendar|gnome-characters|gnome-clocks|gnome-connections|gnome-contacts|gnome-documents|gnome-files|gnome-fonts|gnome-logs|gnome-maps|gnome-music|gnome-photos|gnome-power-statistics|gnome-screenshot|gnome-tweaks|gnome-weather|gnome-text-editor|gedit|nautilus|yelp|blueman|onboard|openbox|pcmanfm|thunar|xfce4-terminal|mousepad|picom|compton|avahi-|python3|konsole|dolphin|kwrite|ark|kcalc|kgpg|kcolorchooser|kcharselect|kfind|kolourpaint|systemsettings|org\.gnome\.|org\.kde\.)([\s_.\/-]|$)/i;
// Web-search launcher entries ("Google", "Bing") belong to the browser's webapp
// list, not the native app monitors.
function isSearchLauncher(a) {
    if (/^(google|bing)$/i.test(a.name)) return true;
    if (/\/search[^\s]*?(google|bing)\./i.test(a.exec || "")) return true;
    return false;
}

/* Parse one .desktop file into { id, name, exec, icon } or null. */
function parseDesktopFile(file) {
    let content = "";
    try { content = fs.readFileSync(file, "utf8"); } catch (e) { return null; }

    let name = null, exec = null, icon = null;
    let skip = false;
    for (const rawLine of content.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#") || line.startsWith("[")) continue;
        if (line === "NoDisplay=true" || line === "Terminal=true") { skip = true; }
        if (line.startsWith("X-WebApp-Url=")) skip = true;      // belongs to the webapps list
        if (line.startsWith("Name=") && !line.startsWith("Name[")) name = line.slice(5);
        else if (line.startsWith("Exec=")) exec = line.slice(5);
        else if (line.startsWith("Icon=") && !line.startsWith("Icon[")) icon = line.slice(5);
    }
    if (skip || !name || !exec) return null;
    let installed = 0;
    try { installed = fs.statSync(file).mtimeMs; } catch (e) {}
    return { id: "native:" + name, name, exec, icon, installed };
}

/* Shell-tokenize a command line, dropping desktop field codes (%f %F %u %U ...). */
function tokenizeExec(execLine) {
    const tokens = [];
    let cur = "", inSingle = false, inDouble = false;
    for (let i = 0; i < execLine.length; i++) {
        const c = execLine[i];
        if (inSingle) {
            if (c === "'") inSingle = false; else cur += c;
        } else if (inDouble) {
            if (c === '"') inDouble = false; else cur += c;
        } else if (c === "'") inSingle = true;
        else if (c === '"') inDouble = true;
        else if (c === "\\" && i + 1 < execLine.length) { cur += execLine[++i]; }
        else if (c === " " || c === "\t") { if (cur) { tokens.push(cur); cur = ""; } }
        else cur += c;
    }
    if (cur) tokens.push(cur);
    return tokens.filter(t => !(t.length >= 2 && t[0] === "%"));
}

function scanDesktopDirs() {
    const dirs = [];
    if (process.platform === "linux") {
        dirs.push("/usr/share/applications");
        dirs.push("/usr/local/share/applications");
        dirs.push(path.join(os.homedir(), ".local", "share", "applications"));
        // Flatpak apps export their .desktop launchers to these dirs (not copied
        // into /usr/share/applications), so a flatpak-installed app must be found
        // here or it never shows up in the GUI-app list. System installs → the
        // /var/lib path; `--user` installs → the homedir path.
        dirs.push("/var/lib/flatpak/exports/share/applications");
        dirs.push(path.join(os.homedir(), ".local", "share", "flatpak", "exports", "share", "applications"));
    }
    const apps = [];
    for (const dir of dirs) {
        let files = [];
        try { files = fs.readdirSync(dir).filter(f => f.endsWith(".desktop")); } catch (e) { continue; }
        for (const f of files) {
            const app = parseDesktopFile(path.join(dir, f));
            if (app) apps.push(app);
        }
    }
    // de-dupe by name (user-local wins: it comes later)
    const seen = new Set();
    return apps.filter(a => {
        if (seen.has(a.name)) return false;
        seen.add(a.name);
        return true;
    }).sort((a, b) => a.name.localeCompare(b.name));
}

function scanAppImages(dirs) {
    const apps = [];
    for (const dir of dirs) {
        let files = [];
        try { files = fs.readdirSync(dir); } catch (e) { continue; }
        for (const f of files) {
            if (!/\.appimage$/i.test(f)) continue;
            const full = path.join(dir, f);
            let st = null;
            try { st = fs.statSync(full); } catch (e) { continue; }
            if (!st.isFile()) continue;
            apps.push({ id: "appimage:" + full, name: path.basename(f, path.extname(f)), path: full, exec: null, icon: null, installed: st.mtimeMs });
        }
    }
    return apps.sort((a, b) => a.name.localeCompare(b.name));
}

/* ---- Custom app store (all platforms) ---- */
function customFile(userData) {
    return path.join(userData || os.tmpdir(), CUSTOM_FILE);
}

function loadCustom(userData) {
    try {
        const list = JSON.parse(fs.readFileSync(customFile(userData), "utf8"));
        return Array.isArray(list) ? list : [];
    } catch (e) { return []; }
}

function saveCustom(userData, list) {
    try { fs.writeFileSync(customFile(userData), JSON.stringify(list, null, 2)); } catch (e) {}
}

function listNativeApps(opts) {
    // opts: { userData, appImageDirs: string, appFilter?: string }
    const apps = process.platform === "linux"
        ? scanDesktopDirs().concat(scanAppImages(splitDirs(opts.appImageDirs)))
        : [];
    const custom = loadCustom(opts.userData).map(c => ({
        id: "custom:" + c.name, name: c.name, exec: c.value, icon: c.icon || null, custom: true,
        installed: c.added || 0
    }));
    // User-supplied filter from settings (extra entries to hide), plus the
    // built-in system-tool / search-launcher denylist.
    let userRe = null;
    if (opts.appFilter) { try { userRe = new RegExp(opts.appFilter, "i"); } catch (e) {} }
    const seen = new Set();
    return apps.concat(custom).filter(a => {
        if (seen.has(a.name)) return false;
        seen.add(a.name);
        // Never hide the user's own custom entries.
        if (a.custom) return true;
        if (isSearchLauncher(a)) return false;
        if (SYSTEM_APP_RE.test(a.name) || SYSTEM_APP_RE.test(a.exec || "")) return false;
        if (userRe && (userRe.test(a.name) || userRe.test(a.exec || ""))) return false;
        return true;
    });
}

function addNativeApp(opts, entry) {
    // entry: { name, value, icon? }  (value = command or AppImage path or web URL)
    const list = loadCustom(opts.userData);
    if (!entry || !entry.name || !entry.value) return { ok: false, error: "missing name/value" };
    if (list.some(c => c.name === entry.name)) return { ok: false, error: "duplicate name" };
    // icon is an iconLibrary id — keep only short, safe ids, drop anything else.
    let icon = null;
    if (typeof entry.icon === "string" && /^[a-z0-9_\-]{1,48}$/i.test(entry.icon)) icon = entry.icon;
    list.push({ name: entry.name, value: entry.value, icon, added: Date.now() });
    saveCustom(opts.userData, list);
    return { ok: true };
}

function removeNativeApp(opts, name) {
    const list = loadCustom(opts.userData).filter(c => c.name !== name);
    saveCustom(opts.userData, list);
    return { ok: true };
}

function splitDirs(str) {
    if (!str) return [];
    const home = os.homedir();
    return String(str).split(",").map(s => s.trim()).filter(Boolean).map(s => {
        if (s === "~" || s.startsWith("~/")) s = path.join(home, s.slice(1));
        return s;
    });
}

module.exports = { parseDesktopFile, tokenizeExec, listNativeApps, addNativeApp, removeNativeApp };
