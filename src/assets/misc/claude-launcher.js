#!/usr/bin/env node
/* claude-launcher.js - sci-fi workspace picker for the CLAUDE tab.

   Spawned by the main process instead of launching `claude` directly. Renders
   a file map of the current directory with an animated border, tree-indented
   subfolders and their sizes, plus a manual path-input mode (/). Once a
   directory is chosen, spawns the claude binary (CLAUDE_BIN) there with this
   terminal inherited.

   Env:
     CLAUDE_BIN  path to the claude CLI
     START_DIR   directory the picker opens in (defaults to $HOME)
*/
"use strict";
const fs = require("fs");
const path = require("path");
const { spawn, exec } = require("child_process");

const claudeBin = process.env.CLAUDE_BIN || "claude";
const home = process.env.HOME || "/";
let cwd = process.env.START_DIR || home;

let mode = "list";       // "list" | "input"
let input = "";          // manual path being typed
let cursor = -1;         // -1 = "use this directory", >=0 = entry index
let entries = [];
let status = "";
let statusAt = 0;

const C = {
    reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
    cyan: "\x1b[36m", green: "\x1b[32m", yellow: "\x1b[33m", red: "\x1b[31m",
    hide: "\x1b[?25l", show: "\x1b[?25h",
    home: "\x1b[H", clear: "\x1b[2J"
};

const BOX = { w: 54, h: 3 };
const bar = "═".repeat(BOX.w - 2);

const flash = (msg) => {
    status = msg;
    statusAt = Date.now();
    setTimeout(() => { if (Date.now() - statusAt >= 2000) { status = ""; render(); } }, 2100);
    render();
};

const listDirs = (dir) => {
    try {
        return fs.readdirSync(dir, { withFileTypes: true })
            .filter(e => e.isDirectory() && !e.name.startsWith("."))
            .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
            .map(e => ({ name: e.name, fullPath: path.join(dir, e.name) }));
    } catch (e) { return []; }
};

// ---- folder sizes (async `du -sk`, cached per path) ----
const sizes = {};
const pending = {};
const fmtSize = kb => kb < 1024 ? kb + "K" : (kb / 1024).toFixed(1) + "M";
const ensureSize = (dir) => {
    if (sizes[dir] !== undefined || pending[dir]) return;
    pending[dir] = true;
    const q = "'" + dir.replace(/'/g, "'\\''") + "'";
    exec("du -sk " + q + " 2>/dev/null", (err, stdout) => {
        pending[dir] = false;
        const m = /^\s*(\d+)/.exec(stdout || "");
        sizes[dir] = m ? fmtSize(parseInt(m[1], 10)) : "?";
        render();
    });
};

// ---- animated border: a bright dot travels around the box perimeter ----
const perimeter = [];
for (let c = 1; c <= BOX.w; c++) perimeter.push([1, c]);
for (let r = 2; r <= BOX.h; r++) perimeter.push([r, BOX.w]);
for (let c = BOX.w - 1; c >= 1; c--) perimeter.push([BOX.h, c]);
for (let r = BOX.h - 1; r >= 2; r--) perimeter.push([r, 1]);
const baseChar = (r, c) => {
    if (r === 1 && c === 1) return "╔";
    if (r === 1 && c === BOX.w) return "╗";
    if (r === BOX.h && c === BOX.w) return "╝";
    if (r === BOX.h && c === 1) return "╚";
    if (r === 1 || r === BOX.h) return "═";
    return "║";
};
const writeAt = (r, c, s) => process.stdout.write("\x1b[" + r + ";" + c + "H" + s);
let animPos = 0, prevP = null;
const animTimer = setInterval(() => {
    if (mode !== "list") return;
    if (prevP) writeAt(prevP[0], prevP[1], baseChar(prevP[0], prevP[1]));
    const p = perimeter[animPos % perimeter.length];
    writeAt(p[0], p[1], C.green + "█" + C.reset);
    prevP = p;
    animPos++;
}, 110);

const displayPath = () => (cwd === home ? "~" : cwd);

const render = () => {
    let out = C.home + C.clear + C.hide;

    if (mode === "input") {
        out += C.green + "╔" + bar + "╗" + C.reset + "\r\n";
        out += C.green + "║ " + C.reset + C.bold + "MANUAL PATH" + C.reset + " ".repeat(BOX.w - 3 - "MANUAL PATH".length) + C.green + "║" + C.reset + "\r\n";
        out += C.green + "╚" + bar + "╝" + C.reset + "\r\n\r\n";
        out += C.cyan + "path > " + C.reset + (input || C.dim + "(type a path, ~ or absolute)" + C.reset) + "\r\n\r\n";
        if (status) out += C.yellow + status + C.reset + "\r\n\r\n";
        out += C.dim + "[Enter] go   [Backspace] delete   [Esc] back to list" + C.reset;
        process.stdout.write(out);
        return;
    }

    entries = listDirs(cwd);
    if (!entries.length) cursor = -1;
    else if (cursor > entries.length - 1) cursor = entries.length - 1;
    else if (cursor < -1) cursor = -1;
    const rows = Math.max(6, (process.stdout.rows || 24) - 10);
    const start = Math.max(0, cursor - Math.floor(rows / 2));
    const view = entries.slice(start, start + rows);

    const dp = displayPath();
    out += C.green + "╔" + bar + "╗" + C.reset + "\r\n";
    out += C.green + "║ " + C.reset + C.bold + dp + C.reset + " ".repeat(Math.max(0, BOX.w - 3 - dp.length)) + C.green + "║" + C.reset + "\r\n";
    out += C.green + "╚" + bar + "╝" + C.reset + "\r\n\r\n";
    out += (cursor === -1 ? C.green + "▶ " : "  ") + C.cyan + "[ Enter ] use this directory" + C.reset + "\r\n";
    out += C.green + "│" + C.reset + "\r\n";
    view.forEach((e, i) => {
        const idx = start + i;
        const sel = idx === cursor;
        const last = idx === entries.length - 1;
        const branch = last ? "└──" : "├──";
        const nm = e.name + "/";
        const sz = sizes[e.fullPath] !== undefined ? C.dim + sizes[e.fullPath] + C.reset : "";
        const pad = Math.max(1, 26 - nm.length);
        const line = (sel ? C.green + "▶ " : "  ") + C.cyan + branch + " " + nm + " ".repeat(pad) + sz
            + (sel ? C.dim + "  <-- cd here" + C.reset : "");
        out += line + "\r\n";
        ensureSize(e.fullPath);
    });
    out += "\r\n";
    if (status) out += C.yellow + status + C.reset + "\r\n";
    out += C.dim + "[↑/↓] move  [Enter] open  [/] path  [←] up  [Esc] cancel" + C.reset;
    process.stdout.write(out);
};

const launch = (dir) => {
    clearInterval(animTimer);
    process.stdout.write(C.home + C.clear + C.show);
    try {
        process.stdin.removeAllListeners("data");
        process.stdin.setRawMode(false);
        process.stdin.pause();
    } catch (e) {}
    const child = spawn(claudeBin, [], { cwd: dir, stdio: "inherit", env: process.env });
    child.on("exit", (code, signal) => process.exit(typeof code === "number" ? code : 0));
    child.on("error", () => process.exit(1));
};

const goUp = () => {
    const parent = path.dirname(cwd);
    if (parent !== cwd) { cwd = parent; cursor = -1; }
    render();
};

const select = () => {
    if (cursor === -1) launch(cwd);
    else if (cursor >= 0 && cursor < entries.length) {
        cwd = entries[cursor].fullPath;
        cursor = -1;
        render();
    }
};

const submitPath = () => {
    let p = input.trim();
    input = "";
    if (!p) { mode = "list"; render(); return; }
    if (p === "~" || p.startsWith("~/")) p = home + p.slice(1);
    if (!path.isAbsolute(p)) p = path.join(cwd, p);
    try {
        const st = fs.statSync(p);
        if (st.isDirectory()) { cwd = p; cursor = -1; mode = "list"; render(); return; }
        flash(C.red + "not a directory: " + p + C.reset);
        return;
    } catch (e) {}
    flash(C.red + "no such path: " + p + C.reset);
};

let buf = "";
process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.setEncoding("utf8");
process.stdout.on("resize", render);

process.stdin.on("data", chunk => {
    buf += chunk;
    while (buf.length) {
        const b = buf;
        if (b[0] === "\x1b") {
            if (b.length < 2) break;
            if (b[1] === "[" || b[1] === "O") {
                if (b.length < 3) break;
                const code = b[2];
                if (mode === "list") {
                    if (code === "A") cursor = Math.max(-1, cursor - 1);
                    else if (code === "B") cursor = entries.length ? Math.min(entries.length - 1, cursor + 1) : -1;
                    else if (code === "C") { buf = b.slice(3); select(); continue; }
                    else if (code === "D") { buf = b.slice(3); goUp(); continue; }
                    render();
                }
                buf = b.slice(3);
            } else {
                buf = b.slice(1);
                if (mode === "input") { mode = "list"; render(); }
                else launch(home);   // lone ESC = cancel, fall back to home
            }
        } else {
            const ch = b[0];
            buf = b.slice(1);
            if (mode === "input") {
                if (ch === "\r" || ch === "\n") submitPath();
                else if (ch === "\x7f" || ch === "\x08") { input = input.slice(0, -1); render(); }
                else if (ch === "\x03") { mode = "list"; render(); }
                else { input += ch; render(); }   // echo the typed character
            } else {
                if (ch === "\r" || ch === "\n") select();
                else if (ch === "\x7f" || ch === "\x08") goUp();
                else if (ch === "j" || ch === "J") { cursor = entries.length ? Math.min(entries.length - 1, cursor + 1) : -1; render(); }
                else if (ch === "k" || ch === "K") { cursor = Math.max(-1, cursor - 1); render(); }
                else if (ch === "l" || ch === "L") select();
                else if (ch === "h" || ch === "H") goUp();
                else if (ch === "/" || ch === ":") { mode = "input"; input = ""; render(); }
                else if (ch === "q") launch(home);
            }
        }
    }
});

process.on("exit", () => { try { process.stdout.write(C.show); } catch (e) {} });
render();
