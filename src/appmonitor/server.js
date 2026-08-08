// eDEX app-monitor backend. Spawned by _boot.js with ELECTRON_RUN_AS_NODE=1.
// Binds to 127.0.0.1 ONLY and serves:
//   * the thin noVNC client page      (client.html / client.js)
//   * the vendored @novnc/novnc core  (/novnc/*)
//   * a small REST API                (/api/*)
//   * (mock mode) an RFB 3.8 server per monitor on /a and /b
//
// The renderer NEVER talks to this over http:// directly — ui.html's CSP
// (connect-src ws: file:) would block it. All API calls go renderer → IPC →
// main process → http://127.0.0.1.

"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");
const mockRfb = require("./mock-rfb.js");
const { createBackend } = require("./backend.js");

const HTTP_PORT = Number(process.env.EDEX_APPMONITOR_HTTP_PORT || 6080);
const WS_PORT = Number(process.env.EDEX_APPMONITOR_WS_PORT || 6081);
const MODE = process.env.EDEX_APPMONITOR_BACKEND || "mock";
const USERDATA = process.env.EDEX_APPMONITOR_USERDATA || "";
const APPM_IMAGE_DIRS = process.env.EDEX_APPMONITOR_APPIMAGE_DIRS || "";
const THEME = [
    Number(process.env.EDEX_APPMONITOR_THEME_R || 170),
    Number(process.env.EDEX_APPMONITOR_THEME_G || 207),
    Number(process.env.EDEX_APPMONITOR_THEME_B || 209)
];

const ROOT = __dirname;
const VENDOR = path.join(__dirname, "..", "assets", "vendor", "novnc");

const MONITORS = [
    { id: "a", display: ":101", rfbPort: 5901, wsPath: "/websockify" },
    { id: "b", display: ":102", rfbPort: 5902, wsPath: "/websockify" }
];

const MIME = {
    ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
    ".png": "image/png", ".json": "application/json", ".svg": "image/svg+xml",
    ".txt": "text/plain", ".md": "text/plain", ".map": "application/json"
};

/* ---- backend wiring ------------------------------------------------------- */
let backend;
const wsUrlFor = m => MODE === "real"
    ? "ws://127.0.0.1:" + m.rfbPort + m.wsPath
    : "ws://127.0.0.1:" + HTTP_PORT + "/" + m.id;

const APPM_APP_FILTER = process.env.EDEX_APPMONITOR_APP_FILTER || "";
const opts = { userData: USERDATA, appImageDirs: APPM_IMAGE_DIRS, appFilter: APPM_APP_FILTER };

let scenes = null;
if (MODE === "real") {
    backend = createBackend("real", { monitors: MONITORS, opts });
} else {
    scenes = {};
    for (const m of MONITORS) scenes[m.id] = mockRfb.createScene(m.id);
    backend = createBackend("mock", { scenes, opts });
    mockRfb.startRendering(MONITORS.map(m => scenes[m.id]), THEME);
}

function sendJson(res, code, obj) {
    const b = Buffer.from(JSON.stringify(obj));
    res.writeHead(code, { "Content-Type": "application/json", "Content-Length": b.length });
    res.end(b);
}

function sendFile(res, file, fallbackMime) {
    fs.readFile(file, (err, data) => {
        if (err) { res.writeHead(404); res.end("Not found"); return; }
        res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || fallbackMime || "application/octet-stream",
                             "Content-Length": data.length });
        res.end(data);
    });
}

function readBody(req) {
    return new Promise(resolve => {
        let data = "";
        req.on("data", c => { data += c; if (data.length > 1e6) req.destroy(); });
        req.on("end", () => {
            try { resolve(data ? JSON.parse(data) : {}); } catch (e) { resolve({}); }
        });
        req.on("error", () => resolve({}));
    });
}

/* ---- HTTP server ---------------------------------------------------------- */
const DEBUG_HTTP = process.env.EDEX_APPMONITOR_DEBUG === "1";
const server = http.createServer((req, res) => {
    const url = req.url.split("?")[0];
    if (DEBUG_HTTP) console.log("[http] " + req.method + " " + url);
    const isGet = req.method === "GET";
    const isPost = req.method === "POST";
    const isDelete = req.method === "DELETE";

    if (isGet && url === "/api/health") { return sendJson(res, 200, { ok: true, mode: MODE }); }

    if (isGet && url === "/api/config") {
        const monitors = {};
        for (const m of MONITORS) monitors[m.id] = { wsUrl: wsUrlFor(m), display: m.display, rfbPort: m.rfbPort };
        return sendJson(res, 200, { ok: true, mode: MODE, httpPort: HTTP_PORT, monitors });
    }

    if (isGet && url === "/api/native-apps") {
        return backend.listNativeApps().then(apps => sendJson(res, 200, { ok: true, apps }));
    }

    if (isGet && url === "/api/monitors/status") {
        return backend.status().then(r => sendJson(res, 200, r));
    }

    const monMatch = url.match(/^\/api\/monitors\/([ab])\/(launch|kill|fullscreen)$/);
    if (monMatch && (isPost || isGet)) {
        const mid = monMatch[1], action = monMatch[2];
        if (action === "launch" || action === "fullscreen") {
            return readBody(req).then(body =>
                backend[action](mid, body && body.appId).then(r => sendJson(res, r.ok ? 200 : 404, r)));
        }
        return backend.kill(mid).then(r => sendJson(res, 200, r));
    }

    if (isPost && url === "/api/apps/close") {
        return readBody(req).then(body =>
            backend.closeApp(body && body.appId).then(r => sendJson(res, 200, r)));
    }

    if (isPost && url === "/api/fullscreen/exit") {
        return backend.exitFullscreen().then(r => sendJson(res, 200, r));
    }

    if (isPost && url === "/api/native-apps") {
        return readBody(req).then(entry =>
            backend.addNativeApp(entry).then(r => sendJson(res, r.ok ? 200 : 400, r)));
    }

    const delMatch = url.match(/^\/api\/native-apps\/(.+)$/);
    if (isDelete && delMatch) {
        return backend.removeNativeApp(decodeURIComponent(delMatch[1])).then(r => sendJson(res, 200, r));
    }

    // static
    if (isGet && (url === "/" || url === "/client.html")) return sendFile(res, path.join(ROOT, "client.html"));
    if (isGet && url === "/client.js") return sendFile(res, path.join(ROOT, "client.js"));

    if (isGet && url.startsWith("/novnc/")) {
        const rel = url.slice("/novnc/".length);
        const target = path.resolve(VENDOR, rel);
        if (!target.startsWith(VENDOR)) { res.writeHead(403); return res.end("Forbidden"); }
        return sendFile(res, target);
    }

    res.writeHead(404);
    res.end("Not found");
});

/* ---- mock RFB WebSocket endpoint ------------------------------------------ */
// A SINGLE WebSocket.Server on the http server. Multiple ws servers on one http
// server each listen for 'upgrade' and a non-matching one aborts the handshake,
// corrupting the accepted connection — so route by URL in the connection handler
// instead of using `path`.
if (MODE !== "real") {
    const wss = new WebSocket.Server({ server, perMessageDeflate: false });
    wss.on("connection", (ws, req) => {
        const url = (req && req.url) || "";
        const id = url.indexOf("/a") !== -1 ? "a" : (url.indexOf("/b") !== -1 ? "b" : null);
        if (!id || !scenes[id]) { try { ws.close(); } catch (e) {} return; }
        mockRfb.attachRfb(ws, scenes[id]);
    });
}

server.listen(HTTP_PORT, "127.0.0.1", () => {
    console.log("[appmonitor] listening on http://127.0.0.1:" + HTTP_PORT + " mode=" + MODE);
});

process.on("SIGTERM", () => {
    if (backend) { try { backend.shutdown(); } catch (e) {} }
    process.exit(0);
});
process.on("SIGINT", () => process.exit(0));
