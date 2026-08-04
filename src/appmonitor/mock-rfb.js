// RFB 3.8 server (mock) — renders interactive demo framebuffers so the whole
// "webview → noVNC → framebuffer → input" path can be validated on any platform
// without a real X server or native apps. The wire protocol here is exactly
// what x11vnc speaks, so swapping the backend to "real" only changes the
// wsUrl the noVNC client connects to — this file never runs against real X.
//
// Encodings: only Raw (0) is implemented, which is all a demo needs. The
// request-driven flow is the one critical trap: noVNC issues one full-screen
// FramebufferUpdateRequest after ServerInit, then one incremental request per
// received update. EVERY request MUST be answered — a full Raw frame, or a
// zero-rect update when throttled — otherwise the client stalls on black.

"use strict";
const WebSocket = require("ws");

const W = 800;
const H = 600;
const THROTTLE_MS = 100;          // ~10 fps max on the wire
const BYTES = W * H * 4;          // 32bpp BGRA little-endian

const LOG_LINES = [
    "BOOT SEQUENCE INITIATED",
    "MOUNT /dev/sda2 -> /mnt/edex",
    "NETLINK: interface eth0 UP",
    "KERNEL: 6.8.0-generic",
    "RENDERER: vulkan 1.3 ready",
    "SCHEDULER: 12 tasks spawned",
    "FUSE: appimage mount OK",
    "DOCK: 4 containers running",
    "TELEMETRY: uplink stable",
    "CORE TEMP: 41 C  LOAD: 23%"
];

/* ---- 5x7 pixel font (bit 4 = leftmost column) ---------------------------- */
const FONT = {
    " ": [0x00,0x00,0x00,0x00,0x00,0x00,0x00],
    "0": [0x0E,0x11,0x13,0x15,0x19,0x11,0x0E], "1": [0x04,0x0C,0x04,0x04,0x04,0x04,0x0E],
    "2": [0x0E,0x11,0x01,0x02,0x04,0x08,0x1F], "3": [0x1F,0x02,0x04,0x02,0x01,0x11,0x0E],
    "4": [0x02,0x06,0x0A,0x12,0x1F,0x02,0x02], "5": [0x1F,0x10,0x1E,0x01,0x01,0x11,0x0E],
    "6": [0x06,0x08,0x10,0x1E,0x11,0x11,0x0E], "7": [0x1F,0x01,0x02,0x04,0x08,0x08,0x08],
    "8": [0x0E,0x11,0x11,0x0E,0x11,0x11,0x0E], "9": [0x0E,0x11,0x11,0x0F,0x01,0x02,0x0C],
    "A": [0x0E,0x11,0x11,0x1F,0x11,0x11,0x11], "B": [0x1E,0x11,0x11,0x1E,0x11,0x11,0x1E],
    "C": [0x0F,0x10,0x10,0x10,0x10,0x10,0x0F], "D": [0x1E,0x11,0x11,0x11,0x11,0x11,0x1E],
    "E": [0x1F,0x10,0x10,0x1E,0x10,0x10,0x1F], "F": [0x1F,0x10,0x10,0x1E,0x10,0x10,0x10],
    "G": [0x0F,0x10,0x10,0x17,0x11,0x11,0x0F], "H": [0x11,0x11,0x11,0x1F,0x11,0x11,0x11],
    "I": [0x0E,0x04,0x04,0x04,0x04,0x04,0x0E], "J": [0x03,0x01,0x01,0x01,0x01,0x11,0x0E],
    "K": [0x11,0x12,0x14,0x18,0x14,0x12,0x11], "L": [0x10,0x10,0x10,0x10,0x10,0x10,0x1F],
    "M": [0x11,0x1B,0x15,0x11,0x11,0x11,0x11], "N": [0x11,0x11,0x19,0x15,0x13,0x11,0x11],
    "O": [0x0E,0x11,0x11,0x11,0x11,0x11,0x0E], "P": [0x1E,0x11,0x11,0x1E,0x10,0x10,0x10],
    "Q": [0x0E,0x11,0x11,0x11,0x15,0x12,0x0D], "R": [0x1E,0x11,0x11,0x1E,0x14,0x12,0x11],
    "S": [0x0F,0x10,0x10,0x0E,0x01,0x01,0x1E], "T": [0x1F,0x04,0x04,0x04,0x04,0x04,0x04],
    "U": [0x11,0x11,0x11,0x11,0x11,0x11,0x0E], "V": [0x11,0x11,0x11,0x11,0x11,0x0A,0x04],
    "W": [0x11,0x11,0x11,0x15,0x15,0x15,0x0A], "X": [0x11,0x11,0x0A,0x04,0x0A,0x11,0x11],
    "Y": [0x11,0x11,0x11,0x0A,0x04,0x04,0x04], "Z": [0x1F,0x01,0x02,0x04,0x08,0x10,0x1F],
    "+": [0x00,0x04,0x04,0x1F,0x04,0x04,0x00], "-": [0x00,0x00,0x00,0x1F,0x00,0x00,0x00],
    ":": [0x00,0x0C,0x0C,0x00,0x0C,0x0C,0x00], ".": [0x00,0x00,0x00,0x00,0x00,0x0C,0x0C],
    "/": [0x01,0x01,0x02,0x04,0x08,0x10,0x10], ">": [0x10,0x08,0x04,0x02,0x04,0x08,0x10],
    "[": [0x0E,0x08,0x08,0x08,0x08,0x08,0x0E], "]": [0x0E,0x02,0x02,0x02,0x02,0x02,0x0E],
    "?": [0x0E,0x11,0x01,0x02,0x04,0x00,0x04], "*": [0x00,0x0A,0x04,0x0E,0x04,0x0A,0x00]
};

function fontRows(ch) { return FONT[ch] || FONT["?"]; }

/* ---- Pixel helpers (buffer is BGRA little-endian) ------------------------ */
function px(buf, x, y, r, g, b) {
    if (x < 0 || x >= W || y < 0 || y >= H) return;
    const i = (y * W + x) * 4;
    buf[i] = b; buf[i + 1] = g; buf[i + 2] = r;
}

function fillRect(buf, x, y, w, h, c) {
    const x0 = Math.max(0, x), y0 = Math.max(0, y);
    const x1 = Math.min(W, x + w), y1 = Math.min(H, y + h);
    for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) px(buf, xx, yy, c[0], c[1], c[2]);
    }
}

function drawText(buf, x, y, str, c, scale = 1) {
    let cx = x;
    for (const ch of String(str)) {
        const rows = fontRows(ch);
        for (let ry = 0; ry < 7; ry++) {
            const row = rows[ry];
            for (let bx = 0; bx < 5; bx++) {
                if (row & (1 << (4 - bx))) {
                    for (let sy = 0; sy < scale; sy++)
                        for (let sx = 0; sx < scale; sx++)
                            px(buf, cx + bx * scale + sx, y + ry * scale + sy, c[0], c[1], c[2]);
                }
            }
        }
        cx += 6 * scale;
    }
}

function drawLine(buf, x0, y0, x1, y1, c) {
    let dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
        px(buf, x0, y0, c[0], c[1], c[2]);
        if (x0 === x1 && y0 === y1) break;
        const e2 = 2 * err;
        if (e2 >= dy) { err += dy; x0 += sx; }
        if (e2 <= dx) { err += dx; y0 += sy; }
    }
}

function drawCircle(buf, cx, cy, r, c) {
    let x = 0, y = r, d = 3 - 2 * r;
    while (x <= y) {
        for (const [a, b] of [[x, y], [y, x], [-x, y], [-y, x], [x, -y], [y, -x], [-x, -y], [-y, -x]]) {
            px(buf, cx + a, cy + b, c[0], c[1], c[2]);
        }
        if (d < 0) d = d + 4 * x + 6;
        else { d = d + 4 * (x - y) + 10; y--; }
        x++;
    }
}

/* ---- Scenes -------------------------------------------------------------- */
function createScene(id) {
    return {
        id,
        demo: "terminal",
        cx: W / 2, cy: H / 2,
        ripples: [],
        typed: "",
        scroll: 0,
        lastKey: 0,
        drops: null,
        connected: 0,
        buf: Buffer.alloc(BYTES)
    };
}

function handleTyped(scene, keysym) {
    if (keysym >= 0x20 && keysym <= 0x7e) scene.typed += String.fromCharCode(keysym);
    else if (keysym === 0xff0d) scene.typed = "";
    else if (keysym === 0xff08) scene.typed = scene.typed.slice(0, -1);
    if (scene.typed.length > 80) scene.typed = scene.typed.slice(-80);
}

function renderTerminal(scene, buf, th, now) {
    const [tr, tg, tb] = th;
    fillRect(buf, 0, 0, W, H, [5, 8, 13]);
    fillRect(buf, 0, 0, W, 16, [tr >> 2, tg >> 2, tb >> 2]);
    drawText(buf, 8, 4, "DEMO TERMINAL :: " + scene.id.toUpperCase(), [tr, tg, tb]);

    const startIdx = Math.floor(scene.scroll / 2) % LOG_LINES.length;
    for (let i = 0; i < 10; i++) {
        const li = (startIdx + i) % LOG_LINES.length;
        drawText(buf, 10, 26 + i * 14, "> " + LOG_LINES[li], [tr >> 1, tg >> 1, tb >> 1]);
    }
    // waveform
    for (let x = 0; x < W; x++) {
        const y = H / 2 + Math.sin(x / 28 + scene.scroll / 8) * 42 + Math.sin(x / 7 + scene.scroll / 3) * 14;
        px(buf, x, Math.round(y), tr >> 1, tg >> 1, tb >> 1);
    }
    // prompt + typed line + blinking block cursor
    const py = H - 20;
    drawText(buf, 10, py, "> " + scene.typed, [tr, tg, tb]);
    if (Math.floor(now / 500) % 2 === 0) {
        fillRect(buf, 10 + (scene.typed.length + 2) * 6, py, 5, 8, [tr, tg, tb]);
    }
}

function renderMatrix(scene, buf, th, now) {
    const [tr, tg, tb] = th;
    fillRect(buf, 0, 0, W, H, [3, 6, 10]);
    if (!scene.drops) {
        scene.drops = [];
        for (let x = 0; x < W; x += 8) {
            scene.drops.push({ x, y: Math.floor(Math.random() * H), len: 8 + Math.floor(Math.random() * 46) });
        }
    }
    for (const d of scene.drops) {
        d.y += 3;
        if (d.y > H + d.len) { d.y = -d.len; d.len = 8 + Math.floor(Math.random() * 46); }
        for (let k = 0; k < d.len; k++) {
            const yy = d.y - k;
            const c = k < 2 ? [tr, tg, tb] : (k > d.len - 5 ? [tr >> 3, tg >> 3, tb >> 3] : [tr >> 1, tg >> 1, tb >> 1]);
            fillRect(buf, d.x, yy, 6, 5, c);
        }
    }
}

function renderRadar(scene, buf, th, now) {
    const [tr, tg, tb] = th;
    fillRect(buf, 0, 0, W, H, [5, 8, 13]);
    const cx = W / 2, cy = H / 2, R = Math.min(W, H) / 2 - 40;
    for (const r of [R * 0.33, R * 0.66, R]) drawCircle(buf, cx, cy, r, [tr >> 2, tg >> 2, tb >> 2]);
    drawLine(buf, cx - R, cy, cx + R, cy, [tr >> 2, tg >> 2, tb >> 2]);
    drawLine(buf, cx, cy - R, cx, cy + R, [tr >> 2, tg >> 2, tb >> 2]);
    const ang = (now / 1500) % (Math.PI * 2);
    drawLine(buf, cx, cy, cx + Math.cos(ang) * R, cy + Math.sin(ang) * R, [tr, tg, tb]);
    const blips = [[R * 0.6, 0.4], [R * 0.3, 2.2], [R * 0.8, 4.0]];
    for (const [rr, aa] of blips) {
        const p = 0.5 + 0.5 * Math.sin(now / 400 + rr);
        const bx = cx + Math.cos(aa) * rr, by = cy + Math.sin(aa) * rr;
        fillRect(buf, Math.round(bx) - 2, Math.round(by) - 2, 4, 4,
            [Math.round(tr * p + 10), Math.round(tg * p + 10), Math.round(tb * p + 10)]);
    }
}

function renderCommon(scene, buf, th, now) {
    const [tr, tg, tb] = th;
    const { cx, cy } = scene;
    drawLine(buf, cx - 12, cy, cx - 4, cy, [tr, tg, tb]);
    drawLine(buf, cx + 4, cy, cx + 12, cy, [tr, tg, tb]);
    drawLine(buf, cx, cy - 12, cx, cy - 4, [tr, tg, tb]);
    drawLine(buf, cx, cy + 4, cx, cy + 12, [tr, tg, tb]);
    scene.ripples = scene.ripples.filter(rp => now - rp.t < 800);
    for (const rp of scene.ripples) {
        const p = (now - rp.t) / 800;
        drawCircle(buf, rp.x, rp.y, Math.round(10 + p * 90), [Math.round(tr * p), Math.round(tg * p), Math.round(tb * p)]);
    }
    if (scene.lastKey) {
        drawText(buf, W - 66, H - 14, scene.lastKey < 128 ? String.fromCharCode(scene.lastKey) : "*",
            [tr >> 1, tg >> 1, tb >> 1]);
    }
}

function renderInto(scene, now) {
    const th = scene.theme || [170, 207, 209];
    if (scene.demo === "matrix") renderMatrix(scene, scene.buf, th, now);
    else if (scene.demo === "radar") renderRadar(scene, scene.buf, th, now);
    else renderTerminal(scene, scene.buf, th, now);
    renderCommon(scene, scene.buf, th, now);
}

function startRendering(scenes, theme) {
    for (const s of scenes) { s.theme = theme; renderInto(s, Date.now()); }
    setInterval(() => {
        const now = Date.now();
        for (const s of scenes) {
            if (s.connected > 0) { s.scroll++; renderInto(s, now); }
        }
    }, THROTTLE_MS);
}

function setDemo(scene, demo) { scene.demo = demo || "terminal"; }

/* ---- RFB 3.8 wire protocol ------------------------------------------------ */
function serverInit() {
    const name = Buffer.from("EDEX MONITOR", "utf8");
    const b = Buffer.alloc(24 + name.length);
    b.writeUInt16BE(W, 0);
    b.writeUInt16BE(H, 2);
    b[4] = 32; b[5] = 24; b[6] = 0; b[7] = 1;          // bpp,depth,big-endian,true-colour
    b.writeUInt16BE(0xff, 8); b.writeUInt16BE(0xff, 10); b.writeUInt16BE(0xff, 12);
    b[14] = 16; b[15] = 8; b[16] = 0;                   // shifts
    b.writeUInt32BE(name.length, 20);
    name.copy(b, 24);
    return b;
}

function isDefaultPixelFormat(pf) {
    return !pf || (pf.bpp === 32 && pf.depth === 24 && !pf.bigEndian &&
        pf.redMax === 255 && pf.greenMax === 255 && pf.blueMax === 255 &&
        pf.redShift === 16 && pf.greenShift === 8 && pf.blueShift === 0);
}

function convertBuffer(src, pf) {
    const n = pf.bpp / 8;
    const out = Buffer.alloc(W * H * n);
    const rmax = pf.redMax, gmax = pf.greenMax, bmax = pf.blueMax;
    const rs = pf.redShift, gs = pf.greenShift, bs = pf.blueShift;
    let o = 0;
    for (let i = 0; i < src.length; i += 4) {
        const rv = Math.round(src[i + 2] / 255 * rmax);
        const gv = Math.round(src[i + 1] / 255 * gmax);
        const bv = Math.round(src[i] / 255 * bmax);
        let val = (rv << rs) | (gv << gs) | (bv << bs);
        if (pf.bigEndian) { for (let k = n - 1; k >= 0; k--) { out[o + k] = val & 0xff; val >>>= 8; } }
        else { for (let k = 0; k < n; k++) { out[o + k] = val & 0xff; val >>>= 8; } }
        o += n;
    }
    return out;
}

function sendFull(conn, scene) {
    if (!conn.ws || conn.ws.readyState !== WebSocket.OPEN) return;
    const payload = isDefaultPixelFormat(conn.pf) ? scene.buf : convertBuffer(scene.buf, conn.pf);
    const rectHdr = Buffer.alloc(12);
    rectHdr.writeUInt16BE(0, 0); rectHdr.writeUInt16BE(0, 2);
    rectHdr.writeUInt16BE(W, 4); rectHdr.writeUInt16BE(H, 6);
    rectHdr.writeUInt32BE(0, 8);                       // Raw
    const hdr = Buffer.from([0x00, 0x00, 0x00, 0x01]); // FramebufferUpdate, 1 rect
    conn.ws.send(Buffer.concat([hdr, rectHdr, payload]));
}

function handleMessage(conn, scene, msg) {
    const type = msg[0];
    if (type === 0x00) {                                // SetPixelFormat
        conn.pf = {
            bpp: msg[4], depth: msg[5], bigEndian: !!msg[6], trueColour: !!msg[7],
            redMax: msg.readUInt16BE(8), greenMax: msg.readUInt16BE(10), blueMax: msg.readUInt16BE(12),
            redShift: msg[14], greenShift: msg[15], blueShift: msg[16]
        };
    } else if (type === 0x03) {                         // FramebufferUpdateRequest
        const incremental = msg[1] === 1;
        if (!incremental) { sendFull(conn, scene); return; }
        const now = Date.now();
        if (now - conn.lastSent >= THROTTLE_MS) { conn.lastSent = now; sendFull(conn, scene); }
        else conn.ws.send(Buffer.from([0x00, 0x00, 0x00, 0x00]));   // zero-rect: keeps the loop alive
    } else if (type === 0x04) {                         // KeyEvent
        if (msg[1] === 1) { scene.lastKey = msg.readUInt32BE(4); handleTyped(scene, scene.lastKey); }
    } else if (type === 0x05) {                         // PointerEvent
        scene.cx = msg.readUInt16BE(2); scene.cy = msg.readUInt16BE(4);
        if (msg[1] & 1) scene.ripples.push({ x: scene.cx, y: scene.cy, t: Date.now() });
    }
    // SetEncodings / ClientCutText are accepted and ignored.
}

function attachRfb(ws, scene) {
    const conn = { ws, stage: "version", buf: Buffer.alloc(0), pf: null, lastSent: 0 };
    scene.connected++;
    console.log("[rfb] " + scene.id + " client connected (" + scene.connected + ")");
    ws.send(Buffer.from("RFB 003.008\n"));
    ws.on("message", data => {
            if (!Buffer.isBuffer(data)) data = Buffer.from(data);   // tolerate text frames
            conn.buf = Buffer.concat([conn.buf, data]);
            while (conn.ws && conn.buf.length) {
                if (conn.stage === "version") {
                    if (conn.buf.length < 12) return;
                    conn.buf = conn.buf.slice(12);
                    conn.stage = "security";
                    conn.ws.send(Buffer.from([0x01, 0x01]));   // 1 security type: None
                    continue;
                }
                if (conn.stage === "security") {
                    if (conn.buf.length < 1) return;
                    conn.buf = conn.buf.slice(1);
                    conn.stage = "ready";
                    conn.ws.send(Buffer.from([0x00, 0x00, 0x00, 0x00]));   // SecurityResult OK
                    conn.ws.send(serverInit());
                    continue;
                }
                const type = conn.buf[0];
                let need;
                if (type === 0x00) need = 20;
                else if (type === 0x02) { if (conn.buf.length < 4) return; need = 4 + conn.buf.readUInt16BE(2) * 4; }
                else if (type === 0x03) need = 10;
                else if (type === 0x04) need = 8;
                else if (type === 0x05) need = 6;
                else if (type === 0x06) { if (conn.buf.length < 8) return; need = 8 + conn.buf.readUInt32BE(4); }
                else return;                              // unknown message type: stop parsing this connection
                if (conn.buf.length < need) return;
                handleMessage(conn, scene, conn.buf.slice(0, need));
                conn.buf = conn.buf.slice(need);
            }
        });
    ws.on("close", () => { conn.ws = null; scene.connected--; console.log("[rfb] " + scene.id + " client disconnected (" + scene.connected + ")"); });
    ws.on("error", () => {});
}

module.exports = { W, H, createScene, attachRfb, setDemo, startRendering };

