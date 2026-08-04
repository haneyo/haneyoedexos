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

let rfb = null;

function showOverlay(msg) {
    overlayMsg.textContent = msg;
    overlay.style.display = "flex";
}

function connect() {
    screen.innerHTML = "";
    overlay.style.display = "none";
    try {
        rfb = new RFB(screen, wsUrl, { wsProtocols: [] });
    } catch (err) {
        showOverlay("LINK ERROR");
        return;
    }
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
