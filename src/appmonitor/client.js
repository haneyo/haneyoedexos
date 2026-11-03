// Thin noVNC wrapper for the eDEX app monitors.
//
// Uses noVNC's mature RFB client library (@novnc/novnc, vendored and served at
// /novnc/) but NOT noVNC's stock UI — this page is our own, themed with the
// eDEX accent color / font passed in via query params. Same page works against
// the mock RFB backend and a real x11vnc websocket; only wsUrl differs.
//
// Query params: wsUrl, autoconnect=1, r, g, b, font, name, scale(0 to disable).

import RFB from "/novnc/core/rfb.js";

const q = new URLSearchParams(location.search);
const wsUrl = q.get("wsUrl") || "ws://127.0.0.1:6081/a";
const name = q.get("name") || "MONITOR";

const rootStyle = document.documentElement.style;
rootStyle.setProperty("--cr", q.get("r") || 170);
rootStyle.setProperty("--cg", q.get("g") || 207);
rootStyle.setProperty("--cb", q.get("b") || 209);
rootStyle.setProperty("--cfont", q.get("font") || '"United Sans Light", sans-serif');
document.getElementById("name").textContent = name;

const screen = document.getElementById("screen");
const overlay = document.getElementById("overlay");
const overlayMsg = document.getElementById("overlay-msg");
const syncEl = document.getElementById("sync");

let rfb = null;
let lastFrameAt = 0;

// Shown while the remote framebuffer is connecting or being repainted: the
// canvas is blank until the first update, which otherwise reads as a dead
// monitor. Fades out on the first frame, or after a short grace period when the
// remote desktop is static and produces no updates.
let syncTimer = null;
function beginSync(graceMs) {
    // Frames are still arriving: the stream is live and the canvas is correct,
    // so an animation here would be fake. Only cover a genuinely stale view.
    if (Date.now() - lastFrameAt < 1200) return;
    syncEl.classList.remove("fade");
    syncEl.classList.add("on");
    clearTimeout(syncTimer);
    syncTimer = setTimeout(endSync, graceMs || 2500);
}
function endSync() {
    clearTimeout(syncTimer);
    if (!syncEl.classList.contains("on") || syncEl.classList.contains("fade")) return;
    syncEl.classList.add("fade");
    setTimeout(() => syncEl.classList.remove("on"), 440);
}
// Called by the shell when this monitor is shown again (tab switch, or coming
// back from native fullscreen), where Chromium may have throttled the hidden
// guest and the canvas lags behind the live stream. Short grace: if nothing
// arrives the view was merely static, not broken.
window.__sync = () => beginSync(900);

function showOverlay(msg) {
    endSync();
    overlayMsg.textContent = msg;
    overlay.style.display = "flex";
}

function connect() {
    screen.innerHTML = "";
    overlay.style.display = "none";
    beginSync();
    try {
        rfb = new RFB(screen, wsUrl, { wsProtocols: [] });
    } catch (err) {
        showOverlay("LINK ERROR");
        return;
    }
    // noVNC has no "frame painted" event, so wrap its update handler: the first
    // FramebufferUpdate ends the sync animation.
    try {
        const handle = rfb._framebufferUpdate.bind(rfb);
        rfb._framebufferUpdate = function () {
            const done = handle();
            if (done) { lastFrameAt = Date.now(); endSync(); }
            return done;
        };
    } catch (e) {}
    rfb.scaleViewport = true;   // fit the remote framebuffer into the tab, keep aspect
    rfb.resizeSession = false;  // never change the remote session size
    rfb.clipViewport = false;
    rfb.dragViewport = false;
    rfb.viewOnly = false;
    rfb.focusOnClick = true;
    rfb.background = "#05080d"; // letterbox colour
    rfb.addEventListener("connect", () => { try { rfb.focus(); } catch (e) {} });
    rfb.addEventListener("disconnect", () => showOverlay("LINK LOST"));
    rfb.addEventListener("securityfailure", e => showOverlay("SECURITY FAIL"));
    rfb.connect();
}

window.__connect = connect;
if (q.get("autoconnect") === "1") connect();
