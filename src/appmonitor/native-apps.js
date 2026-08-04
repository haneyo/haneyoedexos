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
    return { id: "native:" + name, name, exec, icon };
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
            try { if (!fs.statSync(full).isFile()) continue; } catch (e) { continue; }
            apps.push({ id: "appimage:" + full, name: path.basename(f, path.extname(f)), path: full, exec: null, icon: null });
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
    // opts: { userData, appImageDirs: string }
    const apps = process.platform === "linux"
        ? scanDesktopDirs().concat(scanAppImages(splitDirs(opts.appImageDirs)))
        : [];
    const custom = loadCustom(opts.userData).map(c => ({
        id: "custom:" + c.name, name: c.name, exec: c.value, icon: null, custom: true
    }));
    const seen = new Set();
    return apps.concat(custom).filter(a => {
        if (seen.has(a.name)) return false;
        seen.add(a.name);
        return true;
    });
}

function addNativeApp(opts, entry) {
    // entry: { name, value }  (value = command or AppImage path or web URL)
    const list = loadCustom(opts.userData);
    if (!entry || !entry.name || !entry.value) return { ok: false, error: "missing name/value" };
    if (list.some(c => c.name === entry.name)) return { ok: false, error: "duplicate name" };
    list.push({ name: entry.name, value: entry.value, added: Date.now() });
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
