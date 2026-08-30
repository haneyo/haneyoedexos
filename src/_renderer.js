// Disable eval()
window.eval = global.eval = function () {
    throw new Error("eval() is disabled for security reasons.");
};
// Security helper :)
window._escapeHtml = text => {
    let map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => {return map[m];});
};
window._encodePathURI = uri => {
    return encodeURI(uri).replace(/#/g, "%23");
};
window._purifyCSS = str => {
    if (typeof str === "undefined") return "";
    if (typeof str !== "string") {
        str = str.toString();
    }
    return str.replace(/[<]/g, "");
};
window._delay = ms => {
    return new Promise((resolve, reject) => {
        setTimeout(resolve, ms);
    });
};
// Detect a hot reload (dev shortcut / theme switch). `performance.navigation` was
// removed in modern Chromium, so fall back to the Navigation Timing API.
window._isHotReload = () => {
    try {
        if (window.performance && typeof window.performance.getEntriesByType === "function") {
            let nav = window.performance.getEntriesByType("navigation")[0];
            if (nav) return nav.type === "reload";
        }
        if (window.performance && window.performance.navigation) {
            return window.performance.navigation.type === 1;
        }
    } catch (e) {}
    return false;
};

// ---- Cover mode ----
// While the screensaver or the lock screen is up, eDEX presents itself as a
// strategic nuclear launch terminal: terminal tab labels, the file browser,
// the public IP and the process list all show fabricated data; everything else
// stays real. `window.cover` is the single switch every consumer checks. All
// DOM access happens at call time (set()), never at module load.
window.cover = (() => {
    const FAKE_TABS = { 0: "MAIN - LAUNCHCTRL", 1: "#2 - GUIDANCE", 2: "KEYHOLDER", 3: "WARHEAD A", 4: "WARHEAD B" };
    const FALLBACK_TABS = { 0: "MAIN SHELL", 1: "EMPTY", 2: "EMPTY", 3: "MONITOR A", 4: "MONITOR B" };
    const FAKE_PROCS = ["launch_seq", "targeting_core", "guidance_fuse", "key_custodian",
        "threat_eval", "silo_monitor", "telemetry_relay", "auth_gate",
        "warhead_diag", "perim_alarm"];
    const R = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo));
    const j = (dir, name) => (dir + "/" + name).replace(/\/+/g, "/");

    let active = false;
    // Real process names seen by the terminal tabs while NOT covered, so they
    // can be restored verbatim when the cover is released. Tab 2 is now a plain
    // terminal too (claude lives in the CLI-app panels), so it follows the same
    // MAIN/#2 real-process labelling as tabs 0/1.
    const realProc = { 0: null, 1: null, 2: null };
    let prevFsDir = null; // directory the file browser showed before covering
    // The fabricated process list is minted ONCE per cover session (screensaver
    // → lock both wear the same cover) and frozen, so the TOP PROCESSES panel
    // does not reshuffle every refresh cycle and "suddenly change" at the
    // screensaver→lock handover (#92). Cleared when the cover lifts.
    let coverProcs = null;

    // ---- fake filesystem ----
    const fakeFile = (dir, name, maxSize) => ({
        name, type: "file",
        size: R(512, (maxSize || (1 << 20))),
        lastAccessed: Date.now() - R(60000, 60 * 86400000),
        path: j(dir, name)
    });
    const fakeFolder = (dir, name) => ({
        name, type: "dir", size: 4096,
        lastAccessed: Date.now() - R(60000, 90 * 86400000),
        path: j(dir, name)
    });
    const fakeDir = dir => {
        dir = String(dir || "/").replace(/\/+$/, "") || "/";
        const out = [];
        if (dir === "/") {
            ["bin", "launch", "warheads", "targets", "keys", "logs", "telemetry", "systems", "crypto", "ops", "archive"]
                .forEach(n => out.push(fakeFolder("/", n)));
            out.push(fakeFile("/", "launch_auth.sig"));
            out.push(fakeFile("/", "boot_checksum.bin", 1 << 10));
            out.push(fakeFile("/", "silo_manifest.enc", 1 << 12));
            out.push(fakeFile("/", "crypto_root.key", 1 << 8));
            out.push(fakeFile("/", "ops_summary.cfg"));
        } else if (dir === "/bin") {
            ["diag", "redundancy", "core_dump"].forEach(n => out.push(fakeFolder("/bin", n)));
            ["bootstrap.elf", "watchdog", "diag_agent.elf", "redundancy_link", "telemetry_relay", "checksum_tool", "secure_erase"]
                .forEach(n => out.push(fakeFile("/bin", n, 1 << 16)));
        } else if (dir === "/launch") {
            ["sequence.dat", "arm_switch.ctl", "auth_checksum.sig", "two_person_rule.log", "launch_keys.bin", "countdown.db", "guidance_lock.cfg", "fire_order.enc"]
                .forEach(n => out.push(fakeFile("/launch", n)));
        } else if (dir === "/warheads") {
            for (let i = 1; i <= 12; i++) out.push(fakeFolder("/warheads", "warhead_0" + i));
            out.push(fakeFile("/warheads", "inventory_manifest.enc"));
        } else if (/^\/warheads\/warhead_\d+$/.test(dir)) {
            ["state.bin", "yield.cfg", "arming_cert.sig", "core_temp.log", "fuel_purity.snapshot", "serial.key", "veto_record.bin", "casing_id.txt"]
                .forEach(n => out.push(fakeFile(dir, n)));
        } else if (dir === "/targets") {
            ["target_list.enc", "coordinates.bin", "reentry_schedule.dat", "priority_matrix.cfg", "strike_order.seq", "trajectory_table.csv", "impact_model.bin", "drone_assignments.cfg"]
                .forEach(n => out.push(fakeFile("/targets", n)));
        } else if (dir === "/keys") {
            out.push(fakeFile("/keys", "launch_keys.enc"));
            out.push(fakeFile("/keys", "master_key.der", 1 << 8));
            out.push(fakeFile("/keys", "rotating_cypher.key", 1 << 8));
            out.push(fakeFolder("/keys", "key_fragments"));
            out.push(fakeFolder("/keys", "backup_custody"));
        } else if (dir === "/keys/key_fragments") {
            for (let i = 1; i <= 8; i++) out.push(fakeFile("/keys/key_fragments", "frag_0" + i + ".key", 1 << 8));
        } else if (dir === "/keys/backup_custody") {
            for (let i = 1; i <= 5; i++) out.push(fakeFile("/keys/backup_custody", "custody_" + i + ".kf", 1 << 8));
        } else if (dir === "/logs") {
            ["access_audit.log", "telemetry.log", "handshake_trail.log", "perimeter_watch.log", "comm_sweep.log", "failsafe_checks.log", "rotation_audit.log", "temp_probe.log"]
                .forEach(n => out.push(fakeFile("/logs", n)));
        } else if (dir === "/telemetry") {
            ["downlink_stream.buf", "silo_state.snapshot", "uplink_buffer.dat", "relay_status.snap", "telemetry_archive.enc", "sensor_grid.csv", "comms_log.bin", "beacon_ping.log"]
                .forEach(n => out.push(fakeFile("/telemetry", n)));
        } else if (dir === "/systems") {
            ["integrity_scan.cfg", "failover.ctl", "mesh_topology.json", "power_distribution.map", "coolant_pressure.dat", "uplink_antennas.cfg", "self_test.suite", "redundancy_matrix.json"]
                .forEach(n => out.push(fakeFile("/systems", n)));
        } else if (dir === "/crypto") {
            ["root_cert.pem", "signing_key.pub", "cipher_suites.cfg", "session_tokens.enc", "key_bundle.bin"].forEach(n => out.push(fakeFile("/crypto", n)));
        } else if (dir === "/ops") {
            ["current_deployment.cfg", "roster.enc", "duty_rotation.sched", "clearance_matrix.json", "incident_reports.log"].forEach(n => out.push(fakeFile("/ops", n)));
        } else if (dir === "/archive") {
            ["payload_schematics.bin", "historical_targets.enc", "engineering_notes.pdf", "migration_backup.tgz", "legacy_arm_codes.key"].forEach(n => out.push(fakeFile("/archive", n)));
        } else if (dir === "/operations" || dir.startsWith("/operations")) {
            // Every real path the cover didn't plan lands here (fakePath maps
            // unknown dirs → /operations), so this must be as rich as the real
            // roots — a sparse listing read as "only one fake file".
            ["bootstrap_state.cfg", "sync_manifest.enc", "operator_schedule.sched", "cleared_badge.key", "sector_handshake.bin", "verify_token.sig", "watchdog_heartbeat.log", "cold_standby.dat", "runbook_rev.txt", "access_levels.json", "mission_ledger.bin", "drift_calibration.csv"]
                .forEach(n => out.push(fakeFile(dir, n)));
            out.push(fakeFolder(dir, "systems"));
            out.push(fakeFolder(dir, "archive"));
            out.push(fakeFolder(dir, "logs"));
            out.push(fakeFolder(dir, "crypto"));
        } else {
            // Fallback for any path the cover didn't plan: sparse generic dir.
            out.push(fakeFile(dir, "state.bin"));
            out.push(fakeFolder(dir, "subsystem"));
        }
        return out;
    };
    // Map a real path to a plausible fake display path (safety net for real
    // reads that were already in flight when the cover turned on).
    const fakePath = dir => {
        dir = String(dir || "/");
        if (dir === "/" || dir.startsWith("/launch") || dir.startsWith("/warheads") ||
            dir.startsWith("/targets") || dir.startsWith("/keys") || dir.startsWith("/logs") ||
            dir.startsWith("/telemetry") || dir.startsWith("/systems") || dir.startsWith("/bin")) return dir;
        return "/operations";
    };

    const fakeProcesses = () => {
        // Return the frozen list while covered — the toplist polls every 2s, and
        // re-rolling it each time made the panel look like it "refreshes" at the
        // screensaver→lock handover. Only the first request in a cover session
        // mints a fresh list.
        if (active && coverProcs) return coverProcs;
        const names = FAKE_PROCS.slice().sort(() => Math.random() - 0.5).slice(0, 5);
        coverProcs = names.map(name => ({ pid: R(1024, 4096), name, cpu: R(0, 90), mem: R(1, 38) }));
        return coverProcs;
    };

    const fakeMonitorLabel = monitorId => monitorId === "a" ? "WARHEAD A" : "WARHEAD B";

    // ---- tab labels ----
    const tabEl = num => document.getElementById("shell_tab" + num);
    // Real app-monitor labels (tabs 3/4) captured when the cover turns on, so
    // they can be restored verbatim instead of reverting to the placeholder.
    const realMonitor = { 3: null, 4: null };
    const tabLabel = (num, realP) => {
        if (active) return FAKE_TABS[num] != null ? FAKE_TABS[num] : "";
        if (num === 0) return realP ? "MAIN - " + realP : FALLBACK_TABS[num];
        if (num === 1) return realP ? "#2 - " + realP : FALLBACK_TABS[num];
        if (num === 2) return realP ? "#3 - " + realP : FALLBACK_TABS[num];
        if (num === 3 || num === 4) return realMonitor[num] || FALLBACK_TABS[num];
        return FALLBACK_TABS[num] != null ? FALLBACK_TABS[num] : "";
    };
    const renderTab = num => {
        if (num <= 2) {
            const t = tabEl(num);
            if (t) t.innerHTML = `<p>${tabLabel(num, realProc[num])}</p>`;
        } else {
            const s = document.getElementById("shell_tab" + num + "_label");
            if (s) s.textContent = tabLabel(num, null);
        }
    };
    const rememberProc = (num, p) => {
        if (num === 0 || num === 1 || num === 2) realProc[num] = p;
    };

    // A path is "fake" if it belongs to the fabricated tree; we must never
    // treat one as the real directory to restore after the cover lifts.
    const isFakePath = p => {
        p = String(p || "");
        return p === "/" || p === "/operations" || p.startsWith("/launch") || p.startsWith("/warheads")
            || p.startsWith("/targets") || p.startsWith("/keys") || p.startsWith("/logs")
            || p.startsWith("/telemetry") || p.startsWith("/systems") || p.startsWith("/bin");
    };

    const set = on => {
        on = !!on;
        if (on === active) return;
        active = on;
        try {
            if (on) {
                // Remember the real directory the file browser was showing so it
                // can be restored on release. Guard against capturing a stale
                // fake path (e.g. when dismiss→lock re-engages cover before the
                // previous real read has finished navigating back).
                if (window.fsDisp && window.fsDisp.dirpath && !isFakePath(window.fsDisp.dirpath)) {
                    prevFsDir = window.fsDisp.dirpath;
                }
                // Remember the real app-monitor tab labels before overwriting.
                [3, 4].forEach(n => {
                    const s = document.getElementById("shell_tab" + n + "_label");
                    if (s && s.textContent) realMonitor[n] = s.textContent;
                });
                for (let n = 0; n <= 4; n++) renderTab(n);
                if (window.fsDisp && typeof window.fsDisp.readFS === "function") window.fsDisp.readFS("/");
                if (window.mods && window.mods.toplist) window.mods.toplist.updateList();
                if (window.mods && window.mods.netstat) window.mods.netstat.updateInfo();
            } else {
                // Cover lifted: forget the fabricated process list so the next
                // cover session mints a fresh one (the real toplist re-engages
                // through its normal updateList() path below).
                coverProcs = null;
                for (let n = 0; n <= 4; n++) renderTab(n);
                if (window.fsDisp && typeof window.fsDisp.readFS === "function") {
                    window.fsDisp.readFS(prevFsDir || (window.settings && window.settings.cwd) || "/");
                }
                if (window.mods && window.mods.toplist) window.mods.toplist.updateList();
                if (window.mods && window.mods.netstat) window.mods.netstat.updateInfo();
            }
        } catch (e) {}
    };

    return {
        isActive: () => active,
        set,
        rememberProc,
        tabLabel,
        fakeDir,
        fakePath,
        fakeProcesses,
        fakeMonitorLabel
    };
})();

// Created up-front so the boot-time lock (bootShow) can fire as soon as the
// boot animation ends — before initUI builds any UI — without a real-UI flash.
window.lockScreen = new LockScreen();

// #92/#93: global "is the main UI covered or hidden" flag used by the animation
// loops (globe, cyberPanel) to skip their canvas redraws. Counts TRUE
// invisibility only: a hidden window, or the real screen-off blank (#screen_off,
// set by showScreenOff() past screenOffIdle). The screensaver and lock screen
// keep the panel ON and the user watching — their animations (globe/radar) must
// keep running there (the #93 regression froze radar+globe dead on the lock
// screen by treating lockScreen.active as covered). Defined before initUI() so
// every module sees it.
window.__uiCovered = () =>
    document.hidden ||
    document.body.classList.contains("screen_off");

// CRT-TV power-off: collapse the screen to a bright horizontal centre line and
// go dark, like an old tube TV switching off. Called from lockScreen.unlock()
// after the boot lock and the matrix lock clear. It is a pure overlay that runs
// in PARALLEL with replayBoot()/initUI() (the welcome-back flow continues
// underneath at its normal pace), so the password→welcome-back time is
// unchanged — the animation only covers the first ~0.6s of that window.
window.playCrtShutdown = () => {
    if (document.getElementById("crt_off")) return;
    const el = document.createElement("div");
    el.id = "crt_off";
    el.innerHTML = '<div class="crt_panel crt_top"></div><div class="crt_panel crt_bot"></div><div class="crt_line"></div>';
    document.body.appendChild(el);
    setTimeout(() => {
        const e = document.getElementById("crt_off");
        if (e) e.remove();
    }, 800);
};

// "Welcome back" greeting after the matrix lock clears. The matrix unlock no
// longer replays the boot logo (#80) — instead, like the boot-time welcome, a
// dark overlay holds a "Welcome back, <user>" greeting and the real UI is only
// revealed once it has faded out. The overlay sits one step under the CRT-off
// overlay (z 9999999) and above every UI element (the lock itself is z 10000),
// so the desktop is never exposed mid-sequence. In sync with playCrtShutdown:
// the greeting fades in as the CRT collapse finishes (~0.65 s) and the overlay
// drops after the fade-out, revealing the already-built UI underneath.
window.welcomeBack = (onComplete) => {
    if (document.getElementById("welcome_back")) return;
    const el = document.createElement("div");
    el.id = "welcome_back";
    el.innerHTML = '<h1 id="welcome_back_greeting"></h1>';
    document.body.appendChild(el);
    const greet = el.querySelector("#welcome_back_greeting");
    getDisplayName().then(user => {
        greet.innerHTML = user ? `Welcome back, <em>${user}</em>` : "Welcome back";
        setTimeout(() => { greet.style.opacity = "1"; }, 650);
        setTimeout(() => { greet.style.opacity = "0"; }, 2100);
        setTimeout(() => {
            if (el.parentNode) el.parentNode.removeChild(el);
            // The greeting is gone — hand back to the caller (the matrix unlock
            // uses this to start LOADING the real UI, #81).
            if (typeof onComplete === "function") {
                try { onComplete(); } catch (e) {}
            }
        }, 2650);
    });
};

// False until initUI has finished building the real desktop. While false, any
// lock request (idle dismiss, resumeFromSuspend on visibilitychange — both can
// fire during startup) is redirected to the Matrix boot lock instead of a code
// lock, which needs a live terminal and produced a broken box during boot.
window._uiReady = false;

// Boot sequence: the boot lock comes FIRST, before any of the desktop is built,
// so nothing real is ever exposed pre-unlock. On unlock (or immediately, when
// no passcode is configured) the deferred `then` runs — initUI, which builds
// the shell frame, plays the "Welcome back" greeting, and only then assembles
// the real desktop. bootShow() queues the continuation via lockScreen._onUnlocked.
function bootLockThenRun(then) {
    if (String(window.settings.lockCode || "").length > 0) {
        // A lock passcode exists — show the boot lock first; nothing real is
        // exposed until the user unlocks (lockScreen fires _onUnlocked → then).
        if (window.cover && !window.cover.isActive()) window.cover.set(true);
        window.lockScreen._onUnlocked = () => { then(); };
        window.lockScreen.bootShow();
    } else if (!window.firstRun) {
        // First boot: the seeded settings.json has no lockCode yet, so run the
        // in-app setup (language → timezone → unlock PIN). It writes lockCode /
        // language / lockOnIdle, then fires onDone → then (initUI), which skips
        // its own language picker because settings.language is already set.
        window.firstRun = new FirstRun({ onDone: () => { then(); } });
        window.firstRun.show();
    } else {
        then();
    }
}

// Initiate basic error handling
window.onerror = (msg, path, line, col, error) => {
    document.getElementById("boot_screen").innerHTML += `${error} :  ${msg}<br/>==> at ${path}  ${line}:${col}`;
};

const path = require("path");
const fs = require("fs");
const electron = require("electron");
const remote = require("@electron/remote");
const ipc = electron.ipcRenderer;

const settingsDir = remote.app.getPath("userData");
const themesDir = path.join(settingsDir, "themes");
const keyboardsDir = path.join(settingsDir, "keyboards");
const fontsDir = path.join(settingsDir, "fonts");
const cursorsDir = path.join(settingsDir, "cursors");
const settingsFile = path.join(settingsDir, "settings.json");
// Expose the path on window so the first-boot setup (classes/firstRun.class.js)
// can persist lockCode/language/lockOnIdle with the same write the editor uses.
window.settingsFile = settingsFile;
const shortcutsFile = path.join(settingsDir, "shortcuts.json");
const lastWindowStateFile = path.join(settingsDir, "lastWindowState.json");

// Load config
window.settings = require(settingsFile);
window.shortcuts = require(shortcutsFile);
window.lastWindowState = require(lastWindowStateFile);

// Load CLI parameters
if (remote.process.argv.includes("--nointro")) {
    window.settings.nointroOverride = true;
} else {
    window.settings.nointroOverride = false;
}
if (remote.process.argv.includes("--nocursor")) {
    window.settings.nocursorOverride = true;
} else {
    window.settings.nocursorOverride = false;
}

// Retrieve theme override (hotswitch)
ipc.once("getThemeOverride", (e, theme) => {
    if (theme !== null) {
        window.settings.theme = theme;
        window.settings.nointroOverride = true;
        _loadTheme(require(path.join(themesDir, window.settings.theme+".json")));
    } else {
        _loadTheme(require(path.join(themesDir, window.settings.theme+".json")));
    }
});
ipc.send("getThemeOverride");
// Same for keyboard override/hotswitch
ipc.once("getKbOverride", (e, layout) => {
    if (layout !== null) {
        window.settings.keyboard = layout;
        window.settings.nointroOverride = true;
    }
});
ipc.send("getKbOverride");

// Sci-fi cursor: a minimal 45° "<" chevron drawn in the theme accent colour
// with a soft glow, so the pointer echoes the UI. Rebuilt whenever the theme
// changes (see _loadTheme). Hotspot is the chevron's apex (2,2).
const scifiCursor = () => {
    const r = window.theme && window.theme.r != null ? window.theme.r : 64;
    const g = window.theme && window.theme.g != null ? window.theme.g : 224;
    const b = window.theme && window.theme.b != null ? window.theme.b : 255;
    const hex = v => ("0" + Math.min(255, Math.max(0, Math.round(v))).toString(16)).slice(-2);
    const color = "#" + hex(r) + hex(g) + hex(b);
    const svg =
        "<svg xmlns='http://www.w3.org/2000/svg' width='26' height='26' viewBox='0 0 26 26'>" +
        "<g transform='rotate(-45 2 2)'>" +
        "<path d='M2 2 L24 13 L2 24' fill='none' stroke='" + color + "' stroke-width='7' stroke-linecap='round' stroke-linejoin='round' opacity='0.15'/>" +
        "<path d='M2 2 L24 13 L2 24' fill='none' stroke='" + color + "' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round' opacity='0.95'/>" +
        "</g></svg>";
    return "url(\"data:image/svg+xml;utf8," + encodeURIComponent(svg) + "\") 2 2, default";
};

// ---- Windows pointer set (assets/cursors/*.ani) ----
// The bundled .ani files are WP7 animated Windows cursors; only the 32×32
// 32bpp DIB first frame is used here (BITMAPINFOHEADER with the height doubled
// for the AND mask). Chromium can load a still via `cursor: url()`, but then
// the pointer size is chosen by the OS, not the user. So each frame is parsed
// here, blitted to a canvas at the configured size (settings.cursorSize), and
// emitted as a data-URI PNG with the hotspot scaled proportionally. A
// `#cursor_style` block then maps the pointer roles (default / hand / text / …)
// to those data URIs. Native CSS cursors mean the OS still does the
// hit-testing — no overlay div.
const CURSOR_ROLES = {
    // .ani frames carry no hotspot in the ICO entries (that lives in the ACON
    // header), so each role's click point is pinned here instead of read from
    // the file (measured from the 32×32 first frame of the WP7 pack).
    default:     { file: "WP7CursorBG.ani", hotX: 2, hotY: 5 },
    hand:        { file: "WP7Links.ani", hotX: 2, hotY: 5 },
    text:        { file: "WP7Text.ani", hotX: 6, hotY: 11 },
    crosshair:   { file: "WP7Precision.ani", hotX: 10, hotY: 10 },
    notallowed:  { file: "WP7Unavail.ani", hotX: 15, hotY: 15 },
    move:        { file: "WP7Move.ani", hotX: 13, hotY: 13 },
    ns:          { file: "WP7Vert.ani", hotX: 13, hotY: 13 },
    ew:          { file: "WP7Hor.ani", hotX: 13, hotY: 13 },
    nwse:        { file: "WP7Nwse.ani", hotX: 20, hotY: 10 },
    nesw:        { file: "WP7Nesw.ani", hotX: 10, hotY: 10 }
};

// Pick the frame closest to (but ≥) the target size — downscaling from a
// larger frame is sharper than upscaling from a smaller one. Returns the
// ICONDIRENTRY, or null when the file is not a .cur.
function _curPickEntry(dv, count, target) {
    let best = null, bestFallback = null;
    for (let i = 0; i < count; i++) {
        const off = 6 + i * 16;
        const w = dv.getUint8(off) || 256;
        const h = dv.getUint8(off + 1) || 256;
        if (!bestFallback || w < bestFallback.w) bestFallback = { w, h, off, hotX: dv.getUint16(off + 4, true), hotY: dv.getUint16(off + 6, true), size: dv.getUint32(off + 8, true), imgOff: dv.getUint32(off + 12, true) };
        if (w >= target && (!best || w < best.w)) {
            best = { w, h, off, hotX: dv.getUint16(off + 4, true), hotY: dv.getUint16(off + 6, true), size: dv.getUint32(off + 8, true), imgOff: dv.getUint32(off + 12, true) };
        }
    }
    return best || bestFallback;
}

// Resolve a cursor resource to its ICONDIR, returning {dv, count} or null.
// Accepts a Windows .cur (ICONDIR at offset 0) and an animated .ani — a RIFF
// "ACON" wrapper whose first "icon" chunk holds a self-contained ICONDIR.
// .ani frames carry no hotspot in the ICO entries (that lives in the ACON
// header), so roles built from .ani sources rely on the hotX/hotY overrides
// in CURSOR_ROLES.
function _curIconDir(buf) {
    const dv = new DataView(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    // .cur / .ico — ICONDIR right at the start
    if (dv.getUint16(0, true) === 0 && dv.getUint16(2, true) === 2) {
        return { dv, count: dv.getUint16(4, true) };
    }
    // .ani — RIFF "ACON" wrapper; the frames live as "icon" sub-chunks inside a
    // LIST ("fram") chunk. Walk the top level, then descend into any LIST.
    if (dv.getUint32(0, true) === 0x46464952 && dv.getUint32(8, true) === 0x4e4f4341) {
        let off = 12;
        const end = dv.byteLength;
        while (off + 8 <= end) {
            const id = dv.getUint32(off, true);
            const size = dv.getUint32(off + 4, true);
            if (id === 0x5453494c) {                    // "LIST" → "fram" frames
                const subEnd = off + 8 + size;
                let sub = off + 12;                     // skip the 4-byte form type
                while (sub + 8 <= subEnd) {
                    const sid = dv.getUint32(sub, true);
                    const ssize = dv.getUint32(sub + 4, true);
                    if (sid === 0x6e6f6369) {           // "icon" — first frame wins
                        const c = new DataView(dv.buffer.slice(sub + 8, sub + 8 + ssize));
                        if (c.getUint16(0, true) === 0 && c.getUint16(2, true) === 2) {
                            return { dv: c, count: c.getUint16(4, true) };
                        }
                    }
                    sub += 8 + ssize + (ssize & 1);
                }
            }
            off += 8 + size + (size & 1);               // RIFF chunks are word-aligned
        }
    }
    return null;
}

// Decode one 32bpp DIB frame into an <img>-ready canvas (already has correct
// alpha from the DIB's 0xABGR pixels; bottom-up rows are flipped here).
function _curFrameToCanvas(dv, entry) {
    const base = entry.imgOff;
    if (dv.getUint32(base, true) < 40) return null;      // not a BITMAPINFOHEADER
    const w = dv.getInt32(base + 4, true);
    const h = dv.getInt32(base + 8, true) / 2;           // height doubled for the AND mask
    if (w <= 0 || h <= 0) return null;
    if (dv.getUint16(base + 12, true) !== 1) return null; // planes
    if (dv.getUint16(base + 14, true) !== 32) return null; // 32bpp only
    const xorOff = base + dv.getUint32(base, true);
    const rowBytes = w * 4;
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const img = canvas.getContext("2d").createImageData(w, h);
    const px = img.data;
    for (let y = 0; y < h; y++) {
        const srcRow = h - 1 - y;                        // DIB is bottom-up
        const si = xorOff + srcRow * rowBytes;
        const di = y * w * 4;
        for (let x = 0; x < w; x++) {
            const s = si + x * 4;
            px[di + x * 4]     = dv.getUint8(s + 2);     // B→R
            px[di + x * 4 + 1] = dv.getUint8(s + 1);     // G
            px[di + x * 4 + 2] = dv.getUint8(s);         // R→B
            px[di + x * 4 + 3] = dv.getUint8(s + 3);     // A
        }
    }
    canvas.getContext("2d").putImageData(img, 0, 0);
    return { canvas, w, h };
}

// Render role cursors at the configured size and rebuild the #cursor_style
// block. Appended to <head> AFTER the theming style so its rules win the
// cascade; the idle-hide guard (body.cursor_hidden) is emitted last so it
// beats every role rule. Emits nothing for the scifi style or nocursor.
window._refreshCursor = () => {
    const old = document.getElementById("cursor_style");
    if (old) old.remove();
    if (window.settings.nocursor || window.settings.nocursorOverride) return;
    if ((window.settings.cursorStyle || "lightech") !== "lightech") return;
    const size = Math.max(16, Math.min(64, Math.round(Number(window.settings.cursorSize) || 28)));
    const dataUris = {};
    for (const [role, spec] of Object.entries(CURSOR_ROLES)) {
        const p = path.join(cursorsDir, spec.file);
        let buf;
        try { buf = fs.readFileSync(p); } catch (e) { continue; }
        try {
            const icon = _curIconDir(buf);
            if (!icon || !icon.count) continue;
            const entry = _curPickEntry(icon.dv, icon.count, size);
            const frame = _curFrameToCanvas(icon.dv, entry);
            if (!frame) continue;
            const scale = size / entry.w;
            const cw = Math.max(1, Math.round(entry.w * scale));
            const ch = Math.max(1, Math.round(entry.h * scale));
            const out = document.createElement("canvas");
            out.width = cw; out.height = ch;
            const ctx = out.getContext("2d");
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = "high";
            ctx.drawImage(frame.canvas, 0, 0, cw, ch);
            const hotX = spec.hotX != null ? spec.hotX : entry.hotX; // .ani frames have no hotspot
            const hotY = spec.hotY != null ? spec.hotY : entry.hotY;
            dataUris[role] = {
                url: `url("${out.toDataURL("image/png")}") ${Math.round(hotX * scale)} ${Math.round(hotY * scale)}`,
                fallback: (role === "default") ? "default" : (role === "hand" ? "pointer" : (role === "text" ? "text" : role))
            };
        } catch (e) {}
    }
    if (!dataUris.default) return;                       // no cursors on disk → keep scifi
    const cur = role => dataUris[role] ? `${dataUris[role].url}, ${dataUris[role].fallback}` : "";
    const css = [];
    css.push(`html, body, body * { cursor: ${cur("default")} !important; }`);
    css.push(`a, button, select, summary, label, [role="button"], [onclick], .clickable, input[type="button"], input[type="submit"], input[type="reset"], input[type="checkbox"], input[type="radio"], input[type="color"], input[type="file"] { cursor: ${cur("hand")} !important; }`);
    css.push(`input:not([type="range"]), textarea, [contenteditable] { cursor: ${cur("text")} !important; }`);
    css.push(`input[type="range"] { cursor: ${cur("default")} !important; }`);
    css.push(`[disabled], button:disabled, .disabled { cursor: ${cur("notallowed")} !important; }`);
    css.push(`[draggable="true"], .grabbable, .mod_handle, .mod_h, .modal_title, .mod_title { cursor: ${cur("move")} !important; }`);
    // idle-hide guard — last so it beats every role rule on specificity ties
    css.push(`body.cursor_hidden, body.cursor_hidden * { cursor: none !important; }`);
    const st = document.createElement("style");
    st.id = "cursor_style";
    st.textContent = css.join("\n");
    document.head.appendChild(st);
};

// Load UI theme
window._loadTheme = theme => {
    window.theme = theme;
    window.theme.r = theme.colors.r;
    window.theme.g = theme.colors.g;
    window.theme.b = theme.colors.b;

    if (document.querySelector("style.theming")) {
        document.querySelector("style.theming").remove();
    }

    // Load fonts
    let mainFont = new FontFace(theme.cssvars.font_main, `url("${path.join(fontsDir, theme.cssvars.font_main.toLowerCase().replace(/ /g, '_')+'.woff2').replace(/\\/g, '/')}")`);
    let lightFont = new FontFace(theme.cssvars.font_main_light, `url("${path.join(fontsDir, theme.cssvars.font_main_light.toLowerCase().replace(/ /g, '_')+'.woff2').replace(/\\/g, '/')}")`);
    let termFont = new FontFace(theme.terminal.fontFamily, `url("${path.join(fontsDir, theme.terminal.fontFamily.toLowerCase().replace(/ /g, '_')+'.woff2').replace(/\\/g, '/')}")`);

    document.fonts.add(mainFont);
    document.fonts.load("12px "+theme.cssvars.font_main);
    document.fonts.add(lightFont);
    document.fonts.load("12px "+theme.cssvars.font_main_light);
    document.fonts.add(termFont);
    document.fonts.load("12px "+theme.terminal.fontFamily);

    document.querySelector("head").innerHTML += `<style class="theming">
    :root {
        --font_main: "${window._purifyCSS(theme.cssvars.font_main)}";
        --font_main_light: "${window._purifyCSS(theme.cssvars.font_main_light)}";
        --font_mono: "${window._purifyCSS(theme.terminal.fontFamily)}";
        --color_r: ${window._purifyCSS(theme.colors.r)};
        --color_g: ${window._purifyCSS(theme.colors.g)};
        --color_b: ${window._purifyCSS(theme.colors.b)};
        --color_black: ${window._purifyCSS(theme.colors.black)};
        --color_light_black: ${window._purifyCSS(theme.colors.light_black)};
        --color_grey: ${window._purifyCSS(theme.colors.grey)};

        /* Used for error and warning modals */
        --color_red: ${window._purifyCSS(theme.colors.red) || "red"};
        --color_yellow: ${window._purifyCSS(theme.colors.yellow) || "yellow"};
    }

    body {
        font-family: var(--font_main), sans-serif;
        cursor: ${(window.settings.nocursorOverride || window.settings.nocursor) ? "none" : scifiCursor()} !important;
    }

    * {
   	   ${(window.settings.nocursorOverride || window.settings.nocursor) ? "cursor: none !important;" : ""}
	}

    // The wallpaper lives in theme.injectCSS as a huge body{background-image}
    // data-URI rule. The previous "defer wallpaper until after the boot lock"
    // hack split this body rule out and re-applied it only after _uiReady; on
    // a large data-URI theme that left the wallpaper AND dependent UI styles
    // unresolved, so the boot lock and the first desktop rendered blank.
    // Colour-vars above are enough for the desktop chrome, but the wallpaper and
    // UI must never be dropped — always inject the full theme CSS. The boot lock
    // itself draws over this anyway, so keeping it present costs nothing visible.
    const inject = theme.injectCSS || "";
    window._deferredWallpaper = null;

    /* auto-hide the cursor after a quiet period — see cursorTrap below */
    .cursor_hidden, .cursor_hidden * { cursor: none !important; }

    ${window._purifyCSS(inject)}
    </style>`;
    // The cursor-role style must stay AFTER the theming style so its rules win
    // the cascade; re-append it now that the theming block was rebuilt.
    if (window._refreshCursor) window._refreshCursor();
    // Re-apply the user's background-source choice on top of the fresh theme (the
    // inline body override beats the theme's body background in the cascade).
    if (window.applyBackground) window.applyBackground();
};

function initGraphicalErrorHandling() {
    window.edexErrorsModals = [];
    window.onerror = (msg, path, line, col, error) => {
        let errorModal = new Modal({
            type: "error",
            title: error,
            message: `${msg}<br/>        at ${path}  ${line}:${col}`
        });
        window.edexErrorsModals.push(errorModal);

        ipc.send("log", "error", `${error}: ${msg}`);
        ipc.send("log", "debug", `at ${path} ${line}:${col}`);
    };
}

function waitForFonts() {
    return new Promise(resolve => {
        if (document.readyState !== "complete" || document.fonts.status !== "loaded") {
            document.addEventListener("readystatechange", () => {
                if (document.readyState === "complete") {
                    if (document.fonts.status === "loaded") {
                        resolve();
                    } else {
                        document.fonts.onloadingdone = () => {
                            if (document.fonts.status === "loaded") resolve();
                        };
                    }
                }
            });
        } else {
            resolve();
        }
    });
}

// A proxy function used to add multithreading to systeminformation calls - see backend process manager @ _multithread.js
//
// Performance note: every `window.si.x()` used to fire its own IPC round-trip
// plus a shell subprocess in the main process. Several modules poll the SAME
// data on overlapping timers (processes() from toplist+cpuinfo+cyberPanel,
// mem() from ramwatcher+cyberPanel, currentLoad() from cpuinfo+cyberPanel,
// networkStats() from conninfo+cyberPanel, ...), so a long session spawned a
// steady stream of redundant `ps`/`sysctl`/`lsof` calls — the dominant CPU cost
// behind "越用越卡". This cache collapses those into one in-flight call + a
// short TTL cache. The TTL for each key is tuned to stay <= its fastest
// feeder's interval, so NO live chart loses a sample (CPU curve stays 500ms,
// NET curve stays 1s). Animations are untouched — only the data plumbing is
// deduplicated.
function initSystemInformationProxy() {
    const { nanoid } = require("nanoid/non-secure");

    // Per-method cache lifetime (ms). Methods not listed are not cached (only
    // deduplicated while an identical call is already in flight).
    const CACHE_TTL = {
        cpu: 900,               // dynamic speed/speedMax readout (cpuinfo 1s)
        cpuTemperature: 1900,   // 2s temperature readout
        currentLoad: 450,       // feeds the CPU curve (500ms) — kept live
        mem: 1400,              // ramwatcher 1.5s (shared with cyberPanel)
        processes: 1900,        // toplist 2s (shared with cpuinfo/cyberPanel)
        networkInterfaces: 1900,// netstat 2s
        networkStats: 900,      // feeds the NET curve (1s) — kept live
        battery: 30000,         // slow-changing (was 3s)
        fsSize: 1900            // cyberPanel 2s + filesystem space bar
    };

    // `processes()` results are mutated in place by toplist (data.list.sort /
    // .splice and per-item cpu/mem writes), so a cached/shared object MUST be
    // cloned before serving to keep the cached copy pristine for later readers.
    const CLONE_KEYS = new Set(["processes"]);
    const cloneValue = v => {
        try { return (typeof structuredClone === "function") ? structuredClone(v) : JSON.parse(JSON.stringify(v)); }
        catch (e) { return v; }
    };

    const inflight = new Map(); // key -> Promise (dedup concurrent identical calls)
    const cache = new Map();    // key -> { value, expires }
    const cacheKey = (prop, args) =>
        prop + "::" + args.map(a => (typeof a === "function" ? "fn" : String(a))).join("|");
    const isHidden = () => (typeof document !== "undefined" && document.hidden);

    window.si = new Proxy({}, {
        apply: () => {throw new Error("Cannot use sysinfo proxy directly as a function")},
        set: () => {throw new Error("Cannot set a property on the sysinfo proxy")},
        get: (target, prop, receiver) => {
            return function(...args) {
                let callback = (typeof args[args.length - 1] === "function") ? true : false;
                let key = cacheKey(prop, args);
                let ttl = CACHE_TTL[prop] || 0;

                const resolveServed = value => {
                    if (callback) args[args.length - 1](value);
                    return Promise.resolve(value);
                };

                // Window occluded/hidden: serve the last known value and skip the
                // subprocess entirely (cheap data poll like the animation gate).
                let hit = cache.get(key);
                if (hit && isHidden()) {
                    return resolveServed(CLONE_KEYS.has(prop) ? cloneValue(hit.value) : hit.value);
                }

                // Still fresh within TTL.
                if (hit && Date.now() < hit.expires) {
                    return resolveServed(CLONE_KEYS.has(prop) ? cloneValue(hit.value) : hit.value);
                }

                // An identical call is already in flight — share its result.
                if (inflight.has(key)) {
                    return inflight.get(key).then(v =>
                        resolveServed(CLONE_KEYS.has(prop) ? cloneValue(v) : v)
                    );
                }

                let id = nanoid();
                let p = new Promise((resolve, reject) => {
                    ipc.once("systeminformation-reply-" + id, (e, res) => {
                        inflight.delete(key);
                        if (ttl > 0) {
                            // Store a clone for mutating callers so the cached
                            // copy is never corrupted by downstream sort/splice.
                            cache.set(key, { value: CLONE_KEYS.has(prop) ? cloneValue(res) : res, expires: Date.now() + ttl });
                        }
                        if (callback) {
                            args[args.length - 1](res);
                        }
                        resolve(res);
                    });
                    ipc.send("systeminformation-call", prop, id, ...args);
                });
                inflight.set(key, p);
                return p;
            };
        }
    });
}

// Init audio
window.audioManager = new AudioManager();

// Play an event sound (user-provided, "eventAudio" category). Gated by the
// master audio toggle AND settings.eventAudio; returns true when it played.
// Existing built-in sounds (granted.wav on unlock, error.wav on error modals)
// play BEFORE the matching event sound and still play when eventAudio is off —
// eventPlay only adds the user sound on top when enabled.
window.eventPlay = (name) => {
    if (!window.settings || window.settings.audio !== true) return false;
    if (window.settings.eventAudio === false) return false;
    const s = window.audioManager && window.audioManager[name];
    if (s && typeof s.play === "function") {
        try { s.play(); } catch (e) {}
        return true;
    }
    return false;
};

// See #223
remote.app.focus();

let i = 0;
if (window.settings.nointro || window.settings.nointroOverride) {
    initGraphicalErrorHandling();
    initSystemInformationProxy();
    document.getElementById("boot_screen").remove();
    document.body.setAttribute("class", "");
    // no boot animation — lock before initUI reveals anything
    bootLockThenRun(() => waitForFonts().then(initUI));
} else {
    displayLine();
}

// Startup boot log
function displayLine() {
    let bootScreen = document.getElementById("boot_screen");
    let log = fs.readFileSync(path.join(__dirname, "assets", "misc", "boot_log.txt")).toString().split('\n');

    function isArchUser() {
        return require("os").platform() === "linux"
                && fs.existsSync("/etc/os-release")
                && fs.readFileSync("/etc/os-release").toString().includes("arch");
    }

    if (typeof log[i] === "undefined") {
        if (window._replayUI) {
            // Matrix-screensaver replay: keep the old centre-logo flow so the
            // panels re-run their entrance without re-locking or re-initing.
            setTimeout(displayTitleScreen, 300);
            return;
        }
        // Real boot log finished. Instead of the old centre logo, roll the boot
        // passcode panel in from the bottom so it lands centre-screen and feels
        // like the last line of the log ("WELCOME TO RIVER OPS").
        // bootLockThenRun wires _onUnlocked (so a correct passcode runs initUI)
        // and calls bootShow() (idempotent — only builds the panel once). No
        // passcode configured → it falls through to run initUI directly.
        setTimeout(() => bootLockThenRun(() => initUI()), 300);
        return;
    }

    if (log[i] === "Boot Complete") {
        window.audioManager.granted.play();
    } else {
        window.audioManager.stdout.play();
    }
    bootScreen.innerHTML += log[i]+"<br/>";
    i++;

    switch(true) {
        case i === 2:
            bootScreen.innerHTML += `eDEX-UI Kernel version ${remote.app.getVersion()} boot at ${Date().toString()}; root:xnu-1699.22.73~1/RELEASE_X86_64`;
        case i === 4:
            setTimeout(displayLine, 500);
            break;
        case i > 4 && i < 25:
            setTimeout(displayLine, 30);
            break;
        case i === 25:
            setTimeout(displayLine, 400);
            break;
        case i === 42:
            setTimeout(displayLine, 300);
            break;
        case i > 42 && i < 82:
            setTimeout(displayLine, 25);
            break;
        case i === 83:
            if (isArchUser())
                bootScreen.innerHTML += "btw i use arch<br/>";
            setTimeout(displayLine, 25);
            break;
        case i >= log.length-2 && i < log.length:
            setTimeout(displayLine, 300);
            break;
        default:
            setTimeout(displayLine, Math.pow(1 - (i/1000), 3)*25);
    }
}

// Show "logo" and background grid
async function displayTitleScreen() {
    let bootScreen = document.getElementById("boot_screen");
    if (bootScreen === null) {
        bootScreen = document.createElement("section");
        bootScreen.setAttribute("id", "boot_screen");
        bootScreen.setAttribute("style", "z-index: 9999999");
        document.body.appendChild(bootScreen);
    }
    bootScreen.innerHTML = "";
    window.audioManager.theme.play();

    await _delay(400);

    document.body.setAttribute("class", "");
    bootScreen.setAttribute("class", "center");
    bootScreen.innerHTML = "<h1>eDEX-UI</h1>";
    let title = document.querySelector("section > h1");

    await _delay(200);

    document.body.setAttribute("class", "solidBackground");

    await _delay(100);

    title.setAttribute("style", `background-color: rgb(${window.theme.r}, ${window.theme.g}, ${window.theme.b});border-bottom: 5px solid rgb(${window.theme.r}, ${window.theme.g}, ${window.theme.b});`);

    await _delay(300);

    title.setAttribute("style", `border: 5px solid rgb(${window.theme.r}, ${window.theme.g}, ${window.theme.b});`);

    await _delay(100);

    title.setAttribute("style", "");
    title.setAttribute("class", "glitch");

    await _delay(500);

    document.body.setAttribute("class", "");
    title.setAttribute("class", "");
    title.setAttribute("style", `border: 5px solid rgb(${window.theme.r}, ${window.theme.g}, ${window.theme.b});`);

    await _delay(1000);
    if (window.term) {
        bootScreen.remove();
        // Matrix-screensaver wake: after the boot animation, re-run the panel
        // entrance so the UI "loads" like a fresh start (terminals + file
        // browser are left untouched).
        if (window._replayUI) reRevealUI();
        return true;
    }
    initGraphicalErrorHandling();
    initSystemInformationProxy();
    waitForFonts().then(() => {
        bootScreen.remove();
        // Boot lock FIRST, before the desktop is built — nothing real is shown
        // pre-unlock. On unlock (or immediately, with no passcode) bootLockThenRun
        // runs initUI: shell frame → "Welcome back" → the real desktop assembles.
        bootLockThenRun(() => initUI());
    });
}

// Returns the user's desired display name. The `username` npm package only
// returns the POSIX login name (whoami/$USER) — on this appliance that is the
// fixed "edex" account, never the name the user typed during Ubuntu install
// ("Your name" → the GECOS full name). Prefer the GECOS real name so "Welcome
// back" shows the real identity; fall back to the login name when GECOS is
// empty or identical to it.
async function getDisplayName() {
    let user = settings.username || null;
    if (user)
        return user;

    let login = null;
    try {
        login = await require("username")();
    } catch (e) {}
    try {
        const info = require("os").userInfo();
        if (info && typeof info.realname === "string" && info.realname.trim() !== "" && info.realname !== login) {
            user = info.realname;
        }
    } catch (e) {}
    if (!user) user = login;
    if (user) settings.username = user; // remember it so the settings UI shows a real name

    return user;
}

// Create the UI's html structure and initialize the terminal client and the keyboard
async function initUI() {
    // insertAdjacentHTML (not innerHTML +=) so a pre-existing #lock_screen
    // overlay survives the UI build — innerHTML += would rebuild <body>.
    document.body.insertAdjacentHTML("beforeend", `<section class="mod_column" id="mod_column_left">
        <h3 class="title"><p>PANEL</p><p>SYSTEM</p></h3>
    </section>
    <h3 class="title" id="main_shell_title" style="opacity:0;"><p>TERMINAL</p><p>MAIN SHELL</p></h3>
    <section id="main_shell" style="height:0%;width:0%;opacity:0;margin-bottom:30vh;" augmented-ui="bl-clip tr-clip exe">
        <h1 id="main_shell_greeting"></h1>
    </section>
    <section class="mod_column" id="mod_column_right">
        <h3 class="title"><p>PANEL</p><p>NETWORK</p></h3>
    </section>`);

    await _delay(10);

    window.audioManager.expand.play();
    document.getElementById("main_shell").setAttribute("style", "height:0%;margin-bottom:30vh;");

    await _delay(500);

    document.getElementById("main_shell").setAttribute("style", "margin-bottom: 30vh;");
    document.getElementById("main_shell_title").setAttribute("style", "");

    await _delay(700);

    document.getElementById("main_shell").setAttribute("style", "opacity: 0;");
    document.body.insertAdjacentHTML("beforeend", `
    <div id="bottom_row">
        <section id="filesystem" style="width: 0px;" class="${window.settings.hideDotfiles ? "hideDotfiles" : ""} ${window.settings.fsListView ? "list-view" : ""}">
        </section>
        <section id="cyber_panel" style="opacity:0;" augmented-ui="bl-clip tr-clip exe">
        </section>
    </div>`);
    window.cyberPanel = new CyberPanel({
        container: "cyber_panel"
    });

    // Virtual keyboard (settings.showKeyboard, or forced during the code-mode
    // lock screen): overlay the ORIGINAL eDEX keyboard, scaled to fit the DATA
    // box; the waveform/data stays visible in the leftover space.
    window.ensureKeyboard = () => {
        if (document.getElementById("keyboard_layer")) return window.keyboard;
        let cyberPanel = document.getElementById("cyber_panel");
        if (!cyberPanel) return null;
        let kbLayer = document.createElement("div");
        kbLayer.id = "keyboard_layer";
        cyberPanel.appendChild(kbLayer);
        let kbEl = document.createElement("section");
        kbEl.id = "keyboard";
        kbLayer.appendChild(kbEl);
        try {
            window.keyboard = new Keyboard({
                layout: path.join(keyboardsDir, (window.settings.keyboard || "en-US") + ".json"),
                container: "keyboard"
            });
            window.keyboard.attach();
        } catch (e) {
            require("electron").ipcRenderer.send("log", "error", "Keyboard init failed: " + (e && e.message));
        }
        const fitKeyboard = () => {
            const kb = document.getElementById("keyboard");
            if (!kb) return;
            const lr = kbLayer.getBoundingClientRect();
            if (!lr.width || !lr.height) return;
            kb.style.zoom = "1";
            void kb.offsetWidth;
            const nw = kb.getBoundingClientRect().width;
            const nh = kb.getBoundingClientRect().height;
            if (!nw || !nh) return;
            kb.style.zoom = 0.99 * Math.min(lr.width / nw, lr.height / nh);
        };
        setTimeout(fitKeyboard, 200);
        setTimeout(fitKeyboard, 2600);
        const fitRO = window.ResizeObserver ? new ResizeObserver(fitKeyboard) : null;
        if (fitRO) fitRO.observe(cyberPanel);
        window.addEventListener("resize", fitKeyboard);
        return window.keyboard;
    };
    window.destroyKeyboard = () => {
        const layer = document.getElementById("keyboard_layer");
        if (layer) layer.remove();
        window.keyboard = null;
    };
    if (window.settings.showKeyboard) window.ensureKeyboard();

    await _delay(10);

    document.getElementById("main_shell").setAttribute("style", "");

    await _delay(270);

    let greeter = document.getElementById("main_shell_greeting");

    getDisplayName().then(user => {
        if (user) {
            greeter.innerHTML += `Welcome back, <em>${user}</em>`;
        } else {
            greeter.innerHTML += "Welcome back";
        }
    });

    greeter.setAttribute("style", "opacity: 1;");
    window.eventPlay("boot_welcome");

    document.getElementById("filesystem").setAttribute("style", "");
    // cyber_panel stays hidden (opacity:0) during the boot welcome - its
    // frame/background must not pop out early. cyberEntrance() reveals it
    // after the greeting is gone.

    await _delay(1000);

    greeter.setAttribute("style", "opacity: 0;");

    await _delay(100);

    await _delay(400);

    // (The boot lock ran before initUI — see bootLockThenRun — so the welcome
    // plays right after unlock, and this point simply continues into the real
    // desktop build below.)
    greeter.remove();

    // Initialize modules
    window.mods = {};

    // Left column
    window.mods.clock = new Clock("mod_column_left");

    // Laptop battery readout pinned to the clock's top-left corner. Absolutely
    // positioned so the centered clock text never shifts; desktops (powerMonitor
    // reports no battery) hide it entirely.
    const batteryEl = document.createElement("div");
    batteryEl.id = "edex_battery";
    batteryEl.className = "battery_hidden";
    // Lightweight toast, shared with the panels' #edex_toast element. The
    // app-monitor panels are constructed later than this block, so fall
    // back to creating the element ourselves when they are not ready yet.
    // Declared at initUI scope (not inside `if (clockHost)`) so other initUI
    // features — the mic mode menu, the download manager — can show toasts
    // too; the settings-editor's `notify` helper is out of scope up here.
    const notifyToast = msg => {
        if (window.appmonitorA && window.appmonitorA._notify) {
            return window.appmonitorA._notify(msg);
        }
        let t = document.getElementById("edex_toast");
        if (!t) {
            t = document.createElement("div");
            t.id = "edex_toast";
            t.className = "browser_toast";
            document.body.appendChild(t);
        }
        t.textContent = msg;
        t.classList.add("show");
        clearTimeout(notifyToast._timer);
        notifyToast._timer = setTimeout(() => t.classList.remove("show"), 2200);
    };
    const clockHost = document.getElementById("mod_clock");
    if (clockHost) {
        clockHost.appendChild(batteryEl);
        // Cross-refresh memory so the graded warnings fire once per transition,
        // not on every 30s tick.
        const battTrack = { first: true, charging: null, lowWarned: false, critWarned: false, fullWarned: false, warn40: false };
        const battery = {
            async refresh() {
                try {
                    // Re-query each tick: the clock module may re-render its
                    // subtree, leaving a captured element detached.
                    const el = document.getElementById("edex_battery");
                    if (!el) return;
                    let b = await ipc.invoke("battery:level");
                    // Desktops / the mac mini report no battery. When
                    // settings.batteryAlways is on, show a steady simulated
                    // readout so the indicator (and its placement) can be seen
                    // on machines without one.
                    if ((!b || !b.present) && window.settings.batteryAlways) {
                        b = { present: true, level: 0.87, charging: true };
                    }
                    if (!b || !b.present) { el.className = "battery_hidden"; return; }
                    const pct = Math.max(0, Math.min(100, Math.round((b.level || 0) * 100)));
                    // Grade always follows the charge level so a low battery
                    // stays red even while charging (#169). Charging is an
                    // additive class: it pulses the fill and brightens the edge
                    // glow (mod_clock.css).
                    const grade = pct <= 5 ? "critical"
                        : pct <= 20 ? "low"
                        : pct <= 50 ? "mid"
                        : pct <= 80 ? "high"
                        : "full";
                    el.className = "battery_" + grade + (b.charging ? " battery_charging" : "");
                    el.title = `${pct}% ${b.charging ? "(charging)" : "(battery)"}`;
                    // First read of a session: snapshot the battery state WITHOUT
                    // any toast or sound, so a boot that starts plugged-in / full
                    // / low does not replay the plug-in, full or low-battery
                    // alerts every time. Only a real change after this baseline
                    // (e.g. not-full → full, unplugged → plugged) triggers them.
                    if (battTrack.first) {
                        battTrack.first = false;
                        battTrack.charging = b.charging;
                        battTrack.fullWarned = !!(b.charging && pct >= 99);
                        battTrack.warn40 = !b.charging && pct < 40;
                        battTrack.critWarned = grade === "critical";
                        battTrack.lowWarned = grade === "low";
                    }
                    // One-shot toasts on transitions: plug-in, low, critical,
                    // full. Reset the discharged warnings once back above 20%.
                    if (b.charging && battTrack.charging !== true) {
                        if (battTrack.charging === false) {
                            notifyToast("CHARGING");
                            window.eventPlay("battery_plug");
                        }
                        battTrack.charging = true;
                    } else if (!b.charging && battTrack.charging === true) {
                        battTrack.charging = false;
                        battTrack.fullWarned = false;
                    }
                    // User event sound: first drop below 40% in a session
                    // (discharging only), resets once back above 40%.
                    if (!b.charging) {
                        if (!battTrack.warn40 && pct < 40) {
                            window.eventPlay("battery_low40");
                            battTrack.warn40 = true;
                        } else if (pct >= 40 && battTrack.warn40) {
                            battTrack.warn40 = false;
                        }
                    }
                    if (b.charging) {
                        if (pct >= 99 && !battTrack.fullWarned) {
                            notifyToast("BATTERY FULL");
                            battTrack.fullWarned = true;
                        }
                    } else if (grade === "critical" && !battTrack.critWarned) {
                        notifyToast("BATTERY CRITICAL");
                        window.eventPlay("battery_critical");
                        battTrack.critWarned = true;
                    } else if (grade === "low" && !battTrack.lowWarned) {
                        notifyToast("LOW BATTERY " + pct + "%");
                        window.eventPlay("battery_low20");
                        battTrack.lowWarned = true;
                    } else if (grade === "mid" || grade === "high" || grade === "full") {
                        battTrack.lowWarned = false;
                        battTrack.critWarned = false;
                    }
                    // No bolt inside the cell: the old charging/non-charging bolt
                    // paths both drew a stray glyph (#169) — charging is now
                    // indicated purely by a gentle breathing glow (mod_clock.css).
                    el.innerHTML =
                        `<svg viewBox="0 0 32 14" class="battery_ico">` +
                        `<rect x="1" y="1" width="25" height="12" rx="2" class="battery_out"/>` +
                        `<rect x="3" y="3" width="${(23 * pct / 100).toFixed(1)}" height="8" rx="1" class="battery_fill"/>` +
                        `<path d="M28 5v4" class="battery_cap"/>` +
                        `</svg>`;
                } catch (e) {}
            }
        };
        battery.refresh();
        setInterval(() => battery.refresh(), 30000);
        // Refresh soon after (un)plug transitions too.
        setTimeout(() => battery.refresh(), 4000);
        // AC plug/unplug arrives as an immediate powerMonitor event from the main
        // process (instead of waiting up to 30s for the next poll) — refresh now
        // so the plug-in/out voice + toast fire instantly. The 30s poll stays as
        // the battery percentage fallback, and the existing transition state
        // machine de-duplicates so no double sound is played.
        ipc.on("pm:ac", () => { try { battery.refresh(); } catch (e) {} });
        window.battery = battery; // exposed so the settings save can re-run it
    }

    window.mods.sysinfo = new Sysinfo("mod_column_left");
    window.mods.hardwareInspector = new HardwareInspector("mod_column_left");
    window.mods.cpuinfo = new Cpuinfo("mod_column_left");
    window.mods.ramwatcher = new RAMwatcher("mod_column_left");
    window.mods.toplist = new Toplist("mod_column_left");

    // Right column
    window.mods.netstat = new Netstat("mod_column_right");
    window.mods.globe = new LocationGlobe("mod_column_right");
    window.mods.conninfo = new Conninfo("mod_column_right");

    // Fade-in animations
    document.querySelectorAll(".mod_column").forEach(e => {
        e.setAttribute("class", "mod_column activated");
    });
    let i = 0;
    let left = document.querySelectorAll("#mod_column_left > div");
    let right = document.querySelectorAll("#mod_column_right > div");
    let x = setInterval(() => {
        if (!left[i] && !right[i]) {
            clearInterval(x);
        } else {
            window.audioManager.panels.play();
            if (left[i]) {
                left[i].setAttribute("style", "animation-play-state: running;");
            }
            if (right[i]) {
                right[i].setAttribute("style", "animation-play-state: running;");
            }
            i++;
        }
    }, 500);

    // Reveal the DATA STREAM panel + radar elements one by one
    setTimeout(cyberEntrance, 800);

    await _delay(100);

    // Initialize the terminal
    let shellContainer = document.getElementById("main_shell");
    shellContainer.innerHTML += `
        <div class="shell_outline"></div>
        <ul id="main_shell_tabs">
            <li id="shell_tab0" onclick="window.focusShellTab(0);" class="active"><p>MAIN SHELL</p></li>
            <li id="shell_tab1" onclick="window.focusShellTab(1);"><p>EMPTY</p></li>
            <li id="shell_tab2" onclick="window.focusShellTab(2);"><p>EMPTY</p></li>
            <li id="shell_tab3" onclick="window.focusShellTab(3);"><p><span id="shell_tab3_label">APP</span> <span class="webapp_chevron" title="Switch app" onclick="event.stopPropagation();window.appmonitorA.toggleMenu(event);">${Icons.chevronDown}</span></p></li>
            <li id="shell_tab4" onclick="window.focusShellTab(4);"><p><span id="shell_tab4_label">APP</span> <span class="webapp_chevron" title="Switch app" onclick="event.stopPropagation();window.appmonitorB.toggleMenu(event);">${Icons.chevronDown}</span></p></li>
        </ul>
        <div id="main_shell_innercontainer">
            <pre id="terminal0" class="active"></pre>
            <pre id="terminal1"></pre>
            <pre id="terminal2"></pre>
            <div id="appmonitor_a_slot" class="shell_slot"></div>
            <div id="appmonitor_b_slot" class="shell_slot"></div>
        </div>`;
    window.term = {
        0: new Terminal({
            role: "client",
            parentId: "terminal0",
            port: window.settings.port || 3000
        })
    };
    window.currentTerm = 0;
    // Slot kinds: 0-2 are terminals, 3/4 are the two CLI panels
    // (MONITOR A / MONITOR B). Everything below that reads window.term[] is
    // made safe for slots 3/4 via a terminal-shaped shim.
    window.shellSlotKinds = { 0: "term", 1: "term", 2: "term", 3: "appmonitor", 4: "appmonitor" };

    // Global IME (Chinese input / Rime) toggle button pinned to the shell's
    // bottom-right corner — visible on every tab (terminals, Claude, monitors).
    window.edexIME = {
        refresh() {
            try {
                require("child_process").exec("fcitx5-remote -n 2>/dev/null", (err, stdout) => {
                    const name = String(stdout || "").trim().toLowerCase();
                    const btn = document.getElementById("edex_ime_btn");
                    if (btn) btn.textContent = /rime|pinyin|chinese/.test(name) ? "中" : "EN";
                });
            } catch (e) {}
        },
        toggle() {
            try {
                require("child_process").exec("fcitx5-remote -t 2>/dev/null");
                setTimeout(() => this.refresh(), 350);
            } catch (e) {}
        }
    };
    const imeBtn = document.createElement("button");
    imeBtn.id = "edex_ime_btn";
    imeBtn.className = "appmonitor_ime_btn";
    imeBtn.textContent = "EN";
    imeBtn.title = "Toggle input method (中/EN)";
    imeBtn.onclick = e => { e.stopPropagation(); window.edexIME.toggle(); };

    // ---- Offline voice input (mic → sherpa-onnx → text into the terminal) ----
    window.voiceInput = {
        _stream: null, _ctx: null, _source: null, _processor: null, _recording: false,
        async init() {
            try {
                const r = await ipc.invoke("voice:init");
                this._ready = !!(r && r.ok);
            } catch (e) { this._ready = false; }
            const b = document.getElementById("edex_voice_btn");
            if (b) b.classList.toggle("voice_disabled", !this._ready);
            return this._ready;
        },
        _resample(input, from, to) {
            if (from === to) return new Float32Array(input);
            const ratio = to / from;
            const out = new Float32Array(Math.round(input.length * ratio));
            for (let i = 0; i < out.length; i++) {
                const idx = i / ratio;
                const i0 = Math.floor(idx), i1 = Math.min(i0 + 1, input.length - 1);
                const f = idx - i0;
                out[i] = input[i0] * (1 - f) + input[i1] * f;
            }
            return out;
        },
        async start() {
            if (this._recording) return;
            if (!this._ready && !(await this.init())) return;
            try {
                if (!this._stream) {
                    this._stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                    const Ctx = window.AudioContext || window.webkitAudioContext;
                    this._ctx = new Ctx({ sampleRate: 16000 });
                    this._source = this._ctx.createMediaStreamSource(this._stream);
                    this._processor = this._ctx.createScriptProcessor(4096, 1, 1);
                    this._source.connect(this._processor);
                    this._processor.connect(this._ctx.destination);
                    this._processor.onaudioprocess = e => {
                        if (!this._recording) return;
                        const ch = e.inputBuffer.getChannelData(0);
                        ipc.send("voice:chunk", this._resample(ch, this._ctx.sampleRate, 16000));
                    };
                }
                await this._ctx.resume();
                this._recording = true;
                this._setUi(true);
                await ipc.invoke("voice:start");
            } catch (e) {
                console.warn("voice start failed:", e && e.message);
                // Roll back partial state so the button never sticks in a
                // "recording" state it can't exit (#5). The old code only
                // toggled the UI after the try — a failed getUserMedia still
                // painted "recording" while _recording stayed false.
                this._recording = false;
                if (this._stream) {
                    try { this._stream.getTracks().forEach(tr => tr.stop()); } catch (e) {}
                    this._stream = null;
                }
                try { await ipc.invoke("voice:stop"); } catch (e) {}
                this._setUi(false);
            }
        },
        async stop() {
            if (!this._recording) return;
            this._recording = false;
            this._setUi(false);
            if (this._partialEl) this._partialEl.textContent = "";
            try {
                const r = await ipc.invoke("voice:stop");
                // Clear again: the stop window still streams recognized audio,
                // so a final partial can arrive after the clear above and
                // repopulate the bubble forever (the gated voice:partial
                // listener covers future ones — this covers the one in flight).
                if (this._partialEl) this._partialEl.textContent = "";
                const text = String((r && r.text) || "").trim();
                if (text) {
                    // #151: with the mic switched to AI-chat mode the recognized
                    // text goes to the assistant (typed toast + spoken reply)
                    // instead of the terminal. A busy AI is aborted first so a
                    // repeat press naturally starts a fresh exchange.
                    if ((window.settings.voiceMicMode || "input") === "chat" && window.aiChat) {
                        if (window.aiChat._busy) window.aiChat.cancel();
                        window.aiChat.ask(text);
                    } else this._insert(text);
                }
                return text;
            } catch (e) { return ""; }
        },
        _insert(text) {
            // write the recognized text into the focused terminal (term shim for
            // the app-monitor tabs is a no-op, so this targets the real terminals).
            // The Terminal wrapper exposes the live xterm as `.term` — the wrapper
            // itself has no `.write`, so target `.term.write` (the wrapper-level
            // `.write` was undefined, silently dropping every recognized result).
            try {
                const t = window.term[window.currentTerm];
                if (t && t.term && typeof t.term.write === "function") t.term.write(text);
            } catch (e) {}
        },
        _setUi(recording) {
            const b = document.getElementById("edex_voice_btn");
            if (!b) return;
            b.classList.toggle("voice_recording", recording);
            b.title = recording ? "Listening… (click to stop)" : "Voice input (click to talk)";
        },
        toggle() {
            // #151: in chat mode a click while the AI is replying starts a
            // fresh exchange. #158: the old code returned after cancel(), so
            // the second question's press was swallowed entirely — the user got
            // no recording, no new reply, and concluded "第二句就不回复了".
            // Cancel the busy reply, then fall through to record the next
            // question immediately.
            if ((window.settings.voiceMicMode || "input") === "chat" &&
                window.aiChat && window.aiChat._busy) {
                window.aiChat.cancel();
            }
            if (this._recording) this.stop();
            else this.start();
        }
    };
    const micBtn = document.createElement("button");
    micBtn.id = "edex_voice_btn";
    micBtn.className = "appmonitor_ime_btn appmonitor_voice_btn";
    micBtn.innerHTML = '<svg class="voice_icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg><span class="voice_eq"><i></i><i></i><i></i><i></i><i></i></span>';
    micBtn.addEventListener("click", e => { e.stopPropagation(); window.voiceInput.toggle(); });
    // #158: right-click toggles the mic between plain voice input (text →
    // terminal) and the AI assistant (text → chat). Takes effect immediately:
    // the mode is written to settings.json (survives restart) and the button
    // gets an amber AI accent + bilingual tooltip so the active mode is visible.
    const setMicMode = () => {
        const chat = (window.settings.voiceMicMode || "input") === "chat";
        micBtn.classList.toggle("voice_chat_mode", chat);
        micBtn.title = chat ? t("settings.voice.micMode.titleChat") : t("settings.voice.micMode.titleInput");
        const sel = document.getElementById("settingsEditor-voiceMicMode");
        if (sel) sel.value = chat ? "chat" : "input";
    };

    // #158: right-click opens a small anchored menu with the two choices — "AI
    // assistant" (recognized speech goes to the chat) or "voice input" (plain
    // text → terminal). Picking one writes voiceMicMode to settings.json (so the
    // change persists across restarts) and updates the button visual at once.
    let micMenu = null;
    const closeMicMenu = () => {
        if (!micMenu) return;
        if (micMenu._cleanup) micMenu._cleanup();
        micMenu.remove();
        micMenu = null;
    };
    const applyMicMode = mode => {
        const cur = window.settings.voiceMicMode || "input";
        if (cur !== mode) {
            window.settings.voiceMicMode = mode;
            try { fs.writeFileSync(settingsFile, JSON.stringify(window.settings, "", 4)); } catch (e2) {}
            setMicMode();
            // `notify` lives in the settings-editor function (outside initUI's
            // scope) — use the in-scope battery helper notifyToast instead.
            notifyToast(t(mode === "chat" ? "settings.voice.micMode.toastChat" : "settings.voice.micMode.toastInput"));
        }
        closeMicMenu();
    };
    const showMicMenu = () => {
        closeMicMenu();
        const chat = (window.settings.voiceMicMode || "input") === "chat";
        micMenu = document.createElement("div");
        micMenu.className = "voice_mode_menu";
        micMenu.innerHTML =
            `<div class="voice_mode_opt${chat ? " selected" : ""}" tabindex="-1" data-mode="chat">${t("settings.voice.micMode.assistant")}</div>` +
            `<div class="voice_mode_opt${!chat ? " selected" : ""}" tabindex="-1" data-mode="input">${t("settings.voice.micMode.input")}</div>`;
        document.body.appendChild(micMenu);
        // Anchor the menu's bottom-right corner just above the mic button.
        const r = micBtn.getBoundingClientRect();
        micMenu.style.right = (window.innerWidth - r.right) + "px";
        micMenu.style.bottom = (window.innerHeight - r.top + 4) + "px";

        const opts = Array.from(micMenu.querySelectorAll(".voice_mode_opt"));
        const pick = o => applyMicMode(o.dataset.mode);
        opts.forEach(o => {
            o.addEventListener("click", e => { e.stopPropagation(); pick(o); });
            o.addEventListener("mouseenter", () => opts.forEach(x => x.classList.toggle("active", x === o)));
        });
        (micMenu.querySelector(".selected") || opts[0]).focus();
        // Keyboard: ↑/↓ move, Enter picks, Esc closes. Clicking anywhere outside
        // also closes (mousedown fires before the option's click — the contains()
        // check keeps clicks inside the menu alive).
        const keyH = e => {
            if (e.key === "Escape") { e.preventDefault(); closeMicMenu(); return; }
            if (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "Tab") {
                const cur = opts.indexOf(document.activeElement);
                const next = (e.key === "ArrowDown" || e.key === "Tab")
                    ? (cur < 0 ? 0 : (cur + 1) % opts.length)
                    : (cur < 0 ? opts.length - 1 : (cur - 1 + opts.length) % opts.length);
                e.preventDefault(); e.stopPropagation();
                opts.forEach(x => x.classList.toggle("active", x === opts[next]));
                opts[next].focus();
            } else if (e.key === "Enter") {
                const a = document.activeElement;
                if (a && a.classList.contains("voice_mode_opt")) { e.preventDefault(); pick(a); }
            }
        };
        const mouseH = e => { if (micMenu && !micMenu.contains(e.target)) closeMicMenu(); };
        document.addEventListener("keydown", keyH);
        document.addEventListener("mousedown", mouseH, true);
        micMenu._cleanup = () => {
            document.removeEventListener("keydown", keyH);
            document.removeEventListener("mousedown", mouseH, true);
        };
    };
    micBtn.addEventListener("contextmenu", e => {
        e.preventDefault(); e.stopPropagation();
        showMicMenu();
    });
    setMicMode();

    // Corner button stack pinned flush to the terminal/content area's bottom-right.
    const corner = document.createElement("div");
    corner.id = "edex_corner_btns";
    corner.appendChild(micBtn);
    corner.appendChild(imeBtn);
    document.getElementById("main_shell_innercontainer").appendChild(corner);
    // #175: 系统语言为英语时,语音输入(ASR 仅中文)与中文输入法切换(中/EN)都没有意义。
    // 直接去掉「语音输入键」+「语言切换键」;切回中文(设置语言或首启选择)立即恢复。
    window.applyLangHiding = () => {
        const en = (window.settings.language || "en") === "en";
        micBtn.style.display = en ? "none" : "";
        imeBtn.style.display = en ? "none" : "";
    };
    window.applyLangHiding();
    // Real-time ASR feedback: the main process streams partial text on every
    // audio chunk; render it in a bubble above the mic so words appear while
    // the user is talking (without this the button looks dead until stop).
    const partialEl = document.createElement("span");
    partialEl.id = "edex_voice_partial";
    partialEl.className = "voice_partial";
    corner.appendChild(partialEl);
    window.voiceInput._partialEl = partialEl;
    ipc.on("voice:partial", (e, text) => {
        // #171: a final partial can arrive after stop() cleared the bubble and
        // set _recording=false (the stop window still streams recognized audio) —
        // if we repaint it here it stays stuck at the corner forever. Only show
        // while actually recording; stop() clears the bubble itself afterwards.
        if (partialEl && window.voiceInput && window.voiceInput._recording) partialEl.textContent = text || "";
    });
    window.edexIME.refresh();
    setInterval(() => window.edexIME.refresh(), 5000);

    // Win key (hold) = voice input push-to-talk, replacing the old F9 shortcut
    // (F9 was unreliable — xterm also escapes it into \x1b[19~ for the shell).
    // The Win key is a modifier: openbox here has no Super binding so its
    // keydown reaches the page, and a lone Meta is not sent to the shell as
    // input. A short hold delay (250ms) starts recording so a quick tap or a
    // Win combo (e.g. Win+L lock) never trips it; releasing the key stops.
    const termFocused = () => (window.shellSlotKinds[window.currentTerm] === "term");
    const isWinKey = e => (e.key === "Meta" || e.code === "MetaLeft" || e.code === "MetaRight");
    let winVoiceTimer = null;
    document.addEventListener("keydown", e => {
        // #175: 英文系统已隐藏语音输入,Win 键 PTT 一并停用。
        if ((window.settings.language || "en") === "en") return;
        // Any other key pressed while Win is held (e.g. Win+L lock, Win+R …)
        // cancels the pending talk timer — never start recording mid-combo.
        if (e.metaKey && !isWinKey(e) && winVoiceTimer) { clearTimeout(winVoiceTimer); winVoiceTimer = null; }
        if (isWinKey(e) && !e.repeat && termFocused()) {
            e.preventDefault(); e.stopPropagation();
            clearTimeout(winVoiceTimer);
            winVoiceTimer = setTimeout(() => {
                winVoiceTimer = null;
                window.voiceInput.start();
            }, 250);
        }
    });
    document.addEventListener("keyup", e => {
        // #175: 英文系统 Win 键 PTT 停用(与 keydown 一致)。
        if ((window.settings.language || "en") === "en") return;
        if (isWinKey(e) && termFocused()) {
            e.preventDefault(); e.stopPropagation();
            if (winVoiceTimer) { clearTimeout(winVoiceTimer); winVoiceTimer = null; }
            window.voiceInput.stop();
        }
    });
    window.addEventListener("blur", () => {
        // If the Win key is released while focus leaves the window (e.g.
        // Alt+Tab mid-recording), the keyup would be lost and the mic would
        // stay open — stop on blur so push-to-talk can never wedge the mic.
        if (winVoiceTimer) { clearTimeout(winVoiceTimer); winVoiceTimer = null; }
        if (window.voiceInput && window.voiceInput._recording) window.voiceInput.stop();
    });

    // ---- AI chat (#151): mic in "chat" mode ----
    // When settings.voiceMicMode === "chat", the recognized text goes to the
    // AI instead of the terminal. The reply streams in via ai-token events, is
    // typed out letter-by-letter in a small toast above the mic (auto-dismisses
    // ~6s after the last token), and complete sentences are spoken with the
    // bundled sherpa-onnx TTS. `_gen` invalidates stale async completions so a
    // cancel() racing a fresh ask() can never repaint the old reply.
    window.aiChat = {
        _busy: false, _gen: 0, _buf: "", _shown: 0, _flushFrom: 0,
        _timer: null, _toast: null, _label: null, _text: null,
        _queue: [], _playing: false, _audio: null, _dismiss: null, _streamDone: false,
        _cached: null, _generating: false, // 预生成双缓冲:播放本句时提前合成下一句,消除句间合成间隙
        ask(text) {
            if (this._busy) { this._showErr("busy"); return; }
            const gen = ++this._gen;
            this._busy = true;
            this._buf = ""; this._shown = 0; this._flushFrom = 0; this._queue = [];
            this._cached = null; this._generating = false; // 清掉上一轮未用的预生成
            this._streamDone = false; // 新一轮:语音播放未完成前不让弹窗消失
            this._playing = false; // a cancelled playback may have left _playing stuck true
            this._stopAudio();
            this._ensureToast();
            // #158 "第二句不回复": a previous reply's 6s auto-dismiss removed
            // the toast's "show" class, and _ensureToast() reuses the existing
            // element — so the NEXT question streamed into an invisible toast
            // and looked like no reply at all. Re-add "show" on every exchange.
            if (this._toast) this._toast.classList.add("show");
            if (this._label) this._label.textContent = window.t("ai.thinking");
            if (this._text) this._text.textContent = "";
            this._setThinking(true); // #171 思考动画:首 token 到前保持脉冲
            ipc.invoke("ai:chat", { text }).then(r => {
                if (gen !== this._gen) return; // superseded by cancel()/a newer ask
                this._busy = false;
                this._setThinking(false);
                this._stopType();
                this._shown = this._buf.length;
                if (this._text) this._text.textContent = this._buf;
                if (r && r.ok) {
                    this._flushTail();
                    // #171 弹窗等语音读完:不设固定 6s,等 TTS 队列排空才收。
                    this._streamDone = true;
                    this._maybeDismiss();
                } else {
                    this._flushTail();
                    this._streamDone = true;
                    this._showErr((r && r.error) || "network", true); // 延迟 dismiss,交给播放完成
                    this._maybeDismiss();
                }
            }).catch(() => {
                // #158: a rejected invoke (main-process throw/crash mid-stream)
                // must not leave _busy stuck true — the mic button would stay
                // disabled and every later press would be swallowed.
                if (gen !== this._gen) return;
                this._busy = false;
                this._setThinking(false);
                this._stopType();
                this._showErr("network");
            });
            this._startType();
        },
        cancel() {
            ++this._gen;                       // invalidate the pending invoke's .then
            try { ipc.send("ai:chat-abort"); } catch (e) {}
            this._busy = false;
            this._setThinking(false);
            this._stopType();
            this._playing = false; // _stopAudio() detaches the onended fin callback, so reset the serial lock here
            this._stopAudio();
            this._queue = [];
            this._cached = null; this._generating = false; // 作废在途预生成
            this._scheduleDismiss(1500);
        },
        _ensureToast() {
            if (this._toast) return;
            const toast = document.createElement("div");
            toast.id = "edex_ai_toast";
            toast.className = "browser_toast show";
            const label = document.createElement("span");
            label.className = "ai_toast_label";
            const text = document.createElement("span");
            text.className = "ai_toast_text";
            // #171 思考动画:思考期间 label 右侧 5 根条形以 accent 色霓虹脉冲,
            // 首 token 到达后隐藏(纯视觉,键盘无关)。
            const think = document.createElement("span");
            think.className = "ai_thinking";
            think.style.display = "none";
            for (let i = 0; i < 5; i++) think.appendChild(document.createElement("i"));
            // 头行:label + 思考动画同一行,回复正文在下方。
            const head = document.createElement("span");
            head.className = "ai_toast_head";
            head.appendChild(label);
            head.appendChild(think);
            toast.appendChild(head);
            toast.appendChild(text);
            document.body.appendChild(toast);
            this._toast = toast; this._label = label; this._text = text; this._thinking = think;
        },
        _setThinking(on) {
            if (this._thinking) this._thinking.style.display = on ? "" : "none";
        },
        _startType() {
            if (this._timer) return;
            this._timer = setInterval(() => {
                if (this._shown < this._buf.length) {
                    this._shown++;
                    if (this._text) this._text.textContent = this._buf.slice(0, this._shown);
                    this._flushSentences();
                }
            }, 25);
        },
        _stopType() { if (this._timer) { clearInterval(this._timer); this._timer = null; } },
        // Queue complete sentences for TTS as they scroll past the typewriter's
        // cursor, so speech tracks what is on screen instead of reading the
        // whole reply ahead of time. #171: the old regex only broke on
        // 。！？!?./newline — a flowing reply full of ，and —— with a single
        // trailing 。 accumulated ~200 chars into ONE generateAsync call
        // (measured 18s to synthesize / 45s of audio in the field). Split on
        // clause punctuation too and hard-cap every chunk so speech streams out
        // in short pieces instead of one long stall.
        _splitTts(text) {
            const MAX = 40;
            const parts = String(text).split(/(?<=[。！？!?，、；;：:\n])/);
            const out = [];
            let cur = "";
            for (const p of parts) {
                if (cur && (cur + p).length > MAX) { out.push(cur.trim()); cur = ""; }
                cur += p;
            }
            if (cur.trim()) out.push(cur.trim());
            return out;
        },
        _flushSentences() {
            const typed = this._buf.slice(0, this._shown);
            const re = /[^。！？!?，、；;：:\n]+[。！？!?，、；;：:\n]+/g;
            re.lastIndex = this._flushFrom;
            let m;
            while ((m = re.exec(typed))) {
                const sent = m[0].trim();
                this._flushFrom = m.index + m[0].length;
                if (sent) this._queue.push(...this._splitTts(sent));
            }
            this._playNext();
        },
        _flushTail() {
            const tail = this._buf.slice(this._flushFrom).trim();
            if (tail) this._queue.push(...this._splitTts(tail));
            this._flushFrom = this._buf.length;
            this._playNext();
        },
        _playNext() {
            if (this._playing || !this._queue.length) return;
            const sent = this._queue.shift();
            this._playing = true;
            // 双缓冲:本句若已被 _prefetchNext 预生成,直接用缓存(零句间间隙)。
            const cached = this._cached && this._cached.sent === sent ? this._cached : null;
            this._cached = null;
            const startPlay = wav => {
                this._playWav(wav, () => { this._playing = false; this._playNext(); this._maybeDismiss(); });
                this._prefetchNext();
            };
            if (cached) {
                ipc.send("dbg-log", "playNext cache-hit: " + sent.slice(0, 12));
                startPlay(cached.wav);
                return;
            }
            ipc.invoke("tts:speak", { text: sent }).then(r => {
                ipc.send("dbg-log", "playNext resp ok=" + !!(r && r.ok) + " hasWav=" + !!(r && r.wav) +
                    (r && !r.ok ? " err=" + (r.error || "") : ""));
                if (!r || !r.ok || !r.wav) { this._playing = false; this._playNext(); this._maybeDismiss(); return; }
                startPlay(r.wav);
            }).catch(err => {
                ipc.send("dbg-log", "playNext invoke FAIL: " + ((err && err.message) || err));
                this._playing = false; this._playNext(); this._maybeDismiss();
            });
        },
        // 播放本句时提前合成队首下一句,消除逐句生成造成的句间停顿。
        // 前提:合成耗时(≈音频时长/5x)恒小于播放耗时,故预生成总在本句播完前就绪。
        _prefetchNext() {
            if (this._generating || !this._queue.length) return;
            const gen = this._gen;
            const sent = this._queue[0];
            this._generating = true;
            ipc.invoke("tts:speak", { text: sent }).then(r => {
                this._generating = false;
                if (gen !== this._gen) return; // 被 cancel()/新一轮 ask() 作废
                if (r && r.ok && r.wav) this._cached = { sent, wav: r.wav };
                else ipc.send("dbg-log", "prefetch miss: " + ((r && r.error) || "no-wav"));
            }).catch(() => { this._generating = false; });
        },
        _playWav(b64, onEnd) {
            try {
                const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
                // #158 "AI 回复没有语音" root cause: this Electron's <audio>
                // element + blob URL rejects even a byte-valid WAV with
                // "Failed to load because no supported source was found"
                // (MEDIA_ERR_SRC_NOT_SUPPORTED). The system sounds play fine
                // because howler/audiofx decodes through WebAudio — so route
                // the TTS blob through the same decodeAudioData path. It takes
                // the raw ArrayBuffer, no blob URL, no MIME sniffing.
                const AC = window.AudioContext || window.webkitAudioContext;
                const ctx = this._audioCtx || (this._audioCtx = new AC());
                const myGen = this._gen;
                const fin = () => { this._audio = null; if (onEnd) onEnd(); };
                ctx.decodeAudioData(bytes.buffer.slice(0), buffer => {
                    // A new ask()/cancel() while the (async) decode was pending
                    // must not start the old reply playing.
                    if (myGen !== this._gen) { fin(); return; }
                    if (ctx.state === "suspended") ctx.resume().catch(() => {});
                    const src = ctx.createBufferSource();
                    src.buffer = buffer;
                    src.connect(ctx.destination);
                    this._audio = src;
                    src.onended = fin;
                    src.start();
                }, err => {
                    const hex = Array.from(bytes.slice(0, 16)).map(b => b.toString(16).padStart(2, "0")).join(" ");
                    ipc.send("dbg-log", "playWav decodeAudioData FAIL: " + ((err && err.message) || err) +
                        " wavBytes=" + bytes.length + " head=" + hex);
                    fin();
                });
            } catch (e) { ipc.send("dbg-log", "playWav throw: " + ((e && e.message) || e)); if (onEnd) onEnd(); }
        },
        _stopAudio() {
            if (this._audio) {
                try {
                    // WebAudio path (_playWav) stores an AudioBufferSourceNode
                    // which has stop() — the old <audio> element had pause().
                    if (typeof this._audio.stop === "function") this._audio.stop();
                    else this._audio.pause();
                } catch (e) {}
                this._audio = null;
            }
        },
        _scheduleDismiss(ms) {
            clearTimeout(this._dismiss);
            this._dismiss = setTimeout(() => {
                if (this._toast) this._toast.classList.remove("show");
            }, ms);
        },
        // #171 弹窗生命周期绑定语音播放:流已结束(_streamDone)且 TTS 队列排空
        // (_playing && _queue 都空)才收;预生成在途(_generating)也视为未完。
        _maybeDismiss() {
            if (this._streamDone && !this._playing && !this._queue.length && !this._generating) this._scheduleDismiss(4000);
        },
        _showErr(code, deferDismiss) {
            const key = code === "LOCAL_MODEL_MISSING" ? "ai.err.localModel"
                : code === "LLM_NOT_READY" ? "ai.err.llm"
                : code === "TTS_MODEL_NOT_FOUND" ? "ai.err.ttsModel"
                : code === "BUSY" ? "ai.busy"
                : "ai.err.network";
            if (this._label) this._label.textContent = window.t(key);
            if (!deferDismiss) this._scheduleDismiss(4000);
        }
    };
    // Streamed reply tokens from the main process feed the typewriter buffer.
    ipc.on("ai-token", (e, text) => {
        if (!window.aiChat || !text) return;
        // #171 思考动画:第一个 token 到达 → 思考态结束,收掉脉冲条。
        if (!window.aiChat._buf && window.aiChat._setThinking) window.aiChat._setThinking(false);
        window.aiChat._buf += text;
    });

    // ---- Module click → detail/action modals (all CLI-backed) ----
    window.sysCmd = {
        run(cmd) {
            return new Promise(resolve => {
                require("child_process").exec(cmd, { timeout: 30000, maxBuffer: 8 * 1024 * 1024 }, (e, so, se) => resolve({ out: so || "", err: se || "", ok: !e }));
            });
        },
        // Run a one-shot command and close the open modal (restart / shutdown / mkfs).
        act(cmd) {
            const p = this.run(cmd);
            const ks = Object.keys(window.modals);
            if (ks.length) { try { window.modals[ks[ks.length - 1]].close(); } catch (e) {} }
            return p;
        },
        // Start the screensaver from the power menu: close the menu first so the
        // animation isn't covered by the modal. With lockAfter the dismiss
        // (any mouse/key input via bumpActivity) always leads into the lock
        // screen — that's what the power menu's "Lock Screen" does now.
        startScreensaver(lockAfter) {
            const ks = Object.keys(window.modals);
            if (ks.length) { try { window.modals[ks[ks.length - 1]].close(); } catch (e) {} }
            if (window.screensaver) {
                if (lockAfter) window.screensaver.forceLockOnDismiss = true;
                window.screensaver.show();
            }
        },
        // Open a modal that runs a command and shows its output; Refresh re-runs it.
        open(title, cmd) {
            const id = "mod_" + require("nanoid").nanoid().slice(0, 6);
            this._last = { id, cmd };
            new Modal({
                type: "custom", title,
                html: `<pre class="mod_cmd_out" id="mco_${id}">LOADING…</pre>`,
                // Only the Refresh button: the Modal class appends its own Close
                // button, so including one here produced two "Close" buttons.
                buttons: [
                    { label: "Refresh", action: `window.sysCmd.refresh('${id}')` }
                ]
            });
            this._render(id, cmd);
        },
        _render(id, cmd) {
            const el = document.getElementById("mco_" + id);
            if (el) el.textContent = "RUNNING…";
            this.run(cmd).then(r => {
                const e2 = document.getElementById("mco_" + id);
                if (e2) e2.textContent = (r.out || r.err || "(no output)").trim();
            });
        },
        refresh(id) { if (this._last && this._last.id === id) this._render(id, this._last.cmd); },
        _closeTop() { const ks = Object.keys(window.modals); if (ks.length) { try { window.modals[ks[ks.length - 1]].close(); } catch (e) {} } },
        formatDialog() {
            new Modal({
                type: "custom", title: "FORMAT DISK",
                html: `<p class="mod_cmd_warn">⚠ Destroys ALL data on the device!</p>
                       <p style="margin:0 0 0.4vh">Device</p>
                       <input id="sysfmt_dev" placeholder="/dev/sdb">
                       <p style="margin:0.6vh 0 0.4vh">Filesystem</p>
                       <select id="sysfmt_fs"><option>vfat</option><option>ext4</option><option>ntfs</option></select>`,
                buttons: [
                    { label: "Format", action: "window.sysCmd.doFormat()" }
                    // Close is auto-appended by the Modal class (an explicit
                    // Cancel here produced two close-behaving buttons).
                ]
            });
        },
        doFormat() {
            const dev = ((document.getElementById("sysfmt_dev") || {}).value || "").trim();
            const fs = ((document.getElementById("sysfmt_fs") || {}).value || "vfat");
            if (!/^\/dev\/(sd|vd|nvme|mmcblk)/.test(dev)) return;
            this.act("sudo mkfs." + fs + " " + dev);
        },
        // Show/hide the Claude API key in Settings. Toggling type between
        // password<->text; the input's id never changes so the save handler
        // still reads the value via getElementById.
        toggleClaudeKey() {
            const el = document.getElementById("settingsEditor-claude-apiKey");
            const btn = document.getElementById("settingsEditor-claude-apiKey-toggle");
            if (!el) return;
            if (el.type === "password") { el.type = "text"; if (btn) btn.textContent = "HIDE"; }
            else { el.type = "password"; if (btn) btn.textContent = "SHOW"; }
        },
        // Fill the URL + models from the selected provider preset. The API key
        // is left untouched (the user pastes their own); every field stays
        // editable afterwards, so a preset is just a convenience pre-fill.
        // `overwrite` (default true, i.e. the user just switched provider)
        // resets the fields to the preset's defaults; false only fills fields
        // that are still empty (used when the settings dialog opens, so a
        // previously saved custom value is not clobbered).
        applyClaudeProvider(overwrite = true) {
            // #175 英文系统隐藏 AI 分类:claude 表单不渲染,元素缺失时直接跳过
            // (否则 openSettings 的预填充 applyClaudeProvider(false) 会 TypeError)。
            const el = document.getElementById("settingsEditor-claude-provider");
            if (!el) return;
            const id = el.value;
            const p = (window.CLAUDE_PROVIDERS || []).find(x => x.id === id);
            if (!p) return;
            // Rebuild a model combo box's option list from the provider's
            // models; the highlight follows the current input value when it is
            // one of the listed models (otherwise the preset default).
            const fillPick = (inputId, models, def) => {
                const inputEl = document.getElementById(inputId);
                if (!inputEl) return;
                const box = inputEl.closest(".settings_combobox");
                const listEl = box && box.querySelector(".mod_loc_list");
                const cur = inputEl.value;
                const val = (models || []).indexOf(cur) >= 0 ? cur : (def || "");
                if (listEl) {
                    listEl.innerHTML = "";
                    (models || []).forEach(m => {
                        const d = document.createElement("div");
                        d.className = "mod_loc_opt" + (m === val ? " mod_loc_opt_active" : "");
                        d.dataset.value = m;
                        d.textContent = m;
                        listEl.appendChild(d);
                    });
                }
            };
            const baseUrl = document.getElementById("settingsEditor-claude-baseUrl");
            const model = document.getElementById("settingsEditor-claude-model");
            const haiku = document.getElementById("settingsEditor-claude-haikuModel");
            if (overwrite || (baseUrl && !baseUrl.value)) baseUrl.value = p.baseUrl || "";
            if (overwrite || (model && !model.value)) model.value = p.model || "";
            if (overwrite || (haiku && !haiku.value)) haiku.value = p.haikuModel || "";
            fillPick("settingsEditor-claude-model", p.models, p.model);
            fillPick("settingsEditor-claude-haikuModel", p.haikuModels, p.haikuModel);
        }
    };

    // ---- Click-to-expand SYSTEM / UPTIME detail (the LOAD/UPTIME/TYPE/POWER
    // grid). CPU load + uptime come from Node's os module; the battery's
    // instantaneous charge/discharge rate is read straight from sysfs — Linux
    // only, so on the macOS preview the POWER row reports AC / no battery.
    const _pad2 = n => String(n).padStart(2, "0");
    const _readSysBattery = () => {
        try {
            const fs = require("fs");
            const dirs = fs.readdirSync("/sys/class/power_supply").filter(d => d.startsWith("BAT"));
            if (!dirs.length) return null;
            const rd = (d, f) => { try { return fs.readFileSync(`/sys/class/power_supply/${d}/${f}`, "utf8").trim(); } catch (e) { return null; } };
            for (const d of dirs) {
                const status = rd(d, "status");
                const cap = parseInt(rd(d, "capacity"), 10);
                let watts = null;
                const pw = parseInt(rd(d, "power_now"), 10);
                if (!isNaN(pw) && pw > 0) watts = pw / 1e6;                    // µW → W
                else {
                    const v = parseInt(rd(d, "voltage_now"), 10);
                    const i = parseInt(rd(d, "current_now"), 10);
                    if (!isNaN(v) && !isNaN(i) && v > 0 && i > 0) watts = (v * i) / 1e12; // µV·µA → W
                }
                return { path: d, status: status || "", capacity: isNaN(cap) ? null : cap, watts };
            }
        } catch (e) {}
        return null;
    };
    const _sysinfoLive = () => {
        let out = "";
        try {
            const os = require("os");
            const l = os.loadavg();
            out += "LOAD        " + l.map(x => x.toFixed(2)).join("   ") + "    (1 / 5 / 15 MIN)\n";
            const s = Math.floor(os.uptime());
            out += "UPTIME      " + Math.floor(s / 86400) + "D " + _pad2(Math.floor(s % 86400 / 3600)) + ":" + _pad2(Math.floor(s % 3600 / 60)) + ":" + _pad2(s % 60) + "\n";
        } catch (e) { out += "UPTIME      N/A\n"; }
        const bat = _readSysBattery();
        if (bat && (bat.capacity !== null || bat.status)) {
            out += "BATTERY     " + (bat.capacity !== null ? bat.capacity + "%" : "—") + (bat.status ? "  " + bat.status.toUpperCase() : "") + "\n";
            if (bat.watts) {
                out += "POWER       " + (bat.status === "Charging" ? "CHARGING  " : "DRAW      ") + bat.watts.toFixed(1) + " W    (" + bat.path + ")\n";
            } else {
                out += "POWER       " + (bat.status === "Charging" ? "CHARGING (RATE N/A)" : "AC") + "\n";
            }
        } else {
            out += "BATTERY     NONE — AC POWER\n";
        }
        return out;
    };
    window.openSysinfoModal = () => {
        const id = require("nanoid").nanoid().slice(0, 6);
        const upd = () => { const el = document.getElementById("sysinfo_live_" + id); if (el) el.textContent = _sysinfoLive(); };
        upd();
        const timer = setInterval(upd, 1000);
        new Modal({
            type: "custom", title: "SYSTEM / UPTIME",
            html: `<pre class="mod_cmd_out" id="sysinfo_live_${id}"></pre>`,
            closeLabel: "Close"
        }, () => clearInterval(timer));
    };

    // ---- Click-to-expand WEATHER detail. The netstat module keeps the latest
    // enriched Open-Meteo payload on window.mods.netstat._wx; render it as a
    // current-conditions grid plus the 7-day forecast with sun times.
    const _wxTime = iso => (typeof iso === "string" && iso.indexOf("T") > 0) ? iso.slice(11, 16) : (iso || "—");
    window.openWeatherModal = () => {
        const wx = window.mods && window.mods.netstat && window.mods.netstat._wx;
        if (!wx || !wx.current) {
            new Modal({ type: "warning", message: "Weather data is still loading — check back in a moment." });
            return;
        }
        const c = wx.current;
        const cond = Weather.condition(c.weather_code);
        const loc = wx.loc || "WEATHER";
        const kv = (k, v) => `<div class="mod_wx_kv"><span>${k}</span><b>${v}</b></div>`;
        const gust = (typeof c.wind_gusts_10m === "number") ? " · G " + Math.round(c.wind_gusts_10m) + " KM/H" : "";
        const vis = (typeof c.visibility === "number")
            ? (c.visibility >= 1000 ? (c.visibility / 1000).toFixed(1) + " KM" : c.visibility + " M")
            : "—";
        const grid = kv("FEELS LIKE", Math.round(c.apparent_temperature) + "°") +
            kv("HUMIDITY", c.relative_humidity_2m + "%") +
            kv("WIND", Math.round(c.wind_speed_10m) + " KM/H" + gust) +
            kv("PRESSURE", (typeof c.pressure_msl === "number") ? Math.round(c.pressure_msl) + " HPA" : "—") +
            kv("VISIBILITY", vis) +
            kv("DEW POINT", (typeof c.dew_point_2m === "number") ? Math.round(c.dew_point_2m) + "°" : "—") +
            kv("UV INDEX", (typeof c.uv_index === "number") ? c.uv_index.toFixed(1) : "—") +
            kv("PRECIP", (typeof c.precipitation === "number") ? c.precipitation + " MM" : "—");
        const week = (wx.weekly || []).slice(0, 7).map(d => {
            const wc = Weather.condition(d.code);
            const [y, m, dd] = d.time.split("-").map(Number);
            const dn = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"][new Date(Date.UTC(y, m - 1, dd)).getUTCDay()];
            return `<div class="mod_wx_day">
                <span class="mod_wx_dayname">${dn}</span>
                <span class="mod_weather_icon">${wc[2]}</span>
                <b>${Math.round(d.temp_max)}°</b>
                <em>${Math.round(d.temp_min)}°</em>
                <span class="mod_wx_rain">${(typeof d.precip === "number" && d.precip > 0) ? d.precip + "%" : ""}</span>
                <span class="mod_wx_sun">${_wxTime(d.sunrise)} – ${_wxTime(d.sunset)}</span>
            </div>`;
        }).join("");
        new Modal({
            type: "custom", title: "WEATHER",
            html: `<div class="mod_wx">
                <div class="mod_wx_now">
                    <span class="mod_weather_icon">${cond[2]}</span>
                    <b>${Math.round(c.temperature_2m)}°</b>
                    <span class="mod_wx_cond">${cond[0].toUpperCase()}</span>
                    <span class="mod_wx_loc">${loc}</span>
                </div>
                <div class="mod_wx_grid">${grid}</div>
                <div class="mod_wx_week">${week}</div>
            </div>`,
            closeLabel: "Close"
        });
    };

    // Shutdown / reboot with a 7s countdown + cancel. The user event sound
    // (eventAudio) plays first and is longer than the countdown, so the audio
    // finishes before the machine powers off / reboots. powerCancel aborts
    // (plays power_cancel); timeout runs the real command.
    window.powerAction = (kind) => {
        if (document.getElementById("power_countdown")) return; // already counting down
        const isReboot = kind === "reboot";
        const cmd = isReboot ? "sudo systemctl reboot" : "sudo poweroff";
        window.eventPlay(isReboot ? "power_reboot" : "power_shutdown");
        const total = 7;
        const el = document.createElement("div");
        el.id = "power_countdown";
        el.style.cssText = "position:fixed;inset:0;z-index:999999;background:rgba(2,6,12,.82);display:flex;align-items:center;justify-content:center;";
        el.innerHTML = `<div style="text-align:center;font-family:monospace;">
            <div id="power_cd_num" style="font-size:72px;line-height:1;color:#00c8ff;text-shadow:0 0 18px rgba(0,200,255,.6);">${total}</div>
            <div style="color:#9fb6c9;letter-spacing:4px;margin:8px 0 22px;">${isReboot ? "RESTARTING IN…" : "SHUTTING DOWN IN…"}</div>
            <button onclick="window.powerCancel()" style="min-width:140px;padding:8px 20px;cursor:pointer;background:#1a2634;color:#ff5252;border:1px solid #ff5252;font-size:15px;letter-spacing:2px;">CANCEL</button>
        </div>`;
        document.body.appendChild(el);
        let left = total;
        window._powerCountdown = {
            kind,
            timer: setInterval(() => {
                left--;
                const n = document.getElementById("power_cd_num");
                if (n) n.textContent = String(Math.max(0, left));
                if (left <= 0) {
                    clearInterval(window._powerCountdown.timer);
                    window._powerCountdown = null;
                    document.removeEventListener("keydown", window._powerEsc, true);
                    const e = document.getElementById("power_countdown");
                    if (e) e.remove();
                    // #168 失败可见:成功的 poweroff/reboot 会立刻杀掉本进程(exec 回调
                    // 收不到),能走到回调 = 命令失败(如 sudo 报错/被 inhibitor 挡)。
                    // 原来 fire-and-forget,失败时静默 no-op 最坑——屏幕上毫无反馈。
                    window.sysCmd.act(cmd).then(r => {
                        if (!r || r.ok) return;
                        let _t = document.getElementById("edex_toast");
                        if (!_t) { _t = document.createElement("div"); _t.id = "edex_toast"; _t.className = "browser_toast"; document.body.appendChild(_t); }
                        _t.textContent = "Power failed: " + (r.err || "command failed").split("\n").filter(Boolean).pop();
                        _t.classList.add("show");
                        clearTimeout(window._powerToastTimer);
                        window._powerToastTimer = setTimeout(() => _t.classList.remove("show"), 4000);
                    });
                }
            }, 1000)
        };
        window._powerEsc = (e) => { if (e.key === "Escape") { e.stopPropagation(); window.powerCancel(); } };
        document.addEventListener("keydown", window._powerEsc, true);
    };

    window.powerCancel = () => {
        const s = window._powerCountdown;
        if (!s) return;
        clearInterval(s.timer);
        window._powerCountdown = null;
        document.removeEventListener("keydown", window._powerEsc, true);
        window._powerEsc = null;
        // The power-menu "Restart" flow stays quiet on cancel: only the shutdown
        // (and update-restart) cancel announces, so a reboot abort reads as a
        // silent cancel (the shutdown cancels keep their "cancelled" voice).
        if (s.kind !== "reboot") window.eventPlay("power_cancel");
        const el = document.getElementById("power_countdown");
        if (el) el.remove();
        if (s && s.onCancel) s.onCancel();
    };

    // Update-restart with the same 7s countdown + cancel as shutdown/reboot, so
    // the update_done sound finishes before the app relaunches. powerCancel
    // (Esc / CANCEL button) aborts; the new build then applies on the next
    // manual restart. Reuses the same #power_countdown overlay / _powerCountdown
    // timer / _powerEsc mechanism as powerAction, so only one countdown is ever
    // active.
    window.updateRestartCountdown = () => {
        if (document.getElementById("power_countdown")) return; // already counting down
        const total = 7;
        const el = document.createElement("div");
        el.id = "power_countdown";
        el.style.cssText = "position:fixed;inset:0;z-index:999999;background:rgba(2,6,12,.82);display:flex;align-items:center;justify-content:center;";
        el.innerHTML = `<div style="text-align:center;font-family:monospace;">
            <div id="power_cd_num" style="font-size:72px;line-height:1;color:#00c8ff;text-shadow:0 0 18px rgba(0,200,255,.6);">${total}</div>
            <div style="color:#9fb6c9;letter-spacing:4px;margin:8px 0 22px;">RESTARTING IN…</div>
            <button onclick="window.powerCancel()" style="min-width:140px;padding:8px 20px;cursor:pointer;background:#1a2634;color:#ff5252;border:1px solid #ff5252;font-size:15px;letter-spacing:2px;">CANCEL</button>
        </div>`;
        document.body.appendChild(el);
        let left = total;
        window._powerCountdown = {
            timer: setInterval(() => {
                left--;
                const n = document.getElementById("power_cd_num");
                if (n) n.textContent = String(Math.max(0, left));
                if (left <= 0) {
                    clearInterval(window._powerCountdown.timer);
                    window._powerCountdown = null;
                    document.removeEventListener("keydown", window._powerEsc, true);
                    const e = document.getElementById("power_countdown");
                    if (e) e.remove();
                    remote.app.relaunch(); remote.app.quit();
                }
            }, 1000),
            onCancel: () => {
                const pre = document.getElementById("edexup_out");
                if (pre) pre.textContent += "\n⏸ Restart canceled — the new build applies on the next restart.";
            }
        };
        window._powerEsc = (e) => { if (e.key === "Escape") { e.stopPropagation(); window.powerCancel(); } };
        document.addEventListener("keydown", window._powerEsc, true);
    };

    // Open the POWER menu — shared by the clock click and the OS power button
    // (the main process listens on 127.0.0.1:17322 and sends "show-power-menu").
    window.openPowerMenu = () => {
        // While the lock screen is up the clock stays interactive so the power
        // options remain reachable — but "Lock Screen" is pointless when we're
        // already locked, so drop that entry.
        const alreadyLocked = window.lockScreen && window.lockScreen.active;
        new Modal({ type: "custom", title: "POWER",
            html: `<div class="mod_menu">
                <button onclick="window.powerAction('reboot')">Restart</button>
                ${alreadyLocked ? "" : `<button onclick="window.sysCmd.startScreensaver(true)">Lock Screen</button>`}
                <button onclick="window.sysCmd.act('sudo systemctl suspend')">Suspend</button>
                <button class="mod_menu_danger" onclick="window.powerAction('shutdown')">Shutdown</button>
            </div>`, closeLabel: "Close" });
    };

    // One delegated click handler for all modules (their DOM is rebuilt by later
    // modules, so direct listeners would be lost). The weather's location editor
    // is handled separately in netstat.class.js.
    document.addEventListener("click", e => {
        const t = e.target;
        if (!t || !t.closest) return;
        if (t.closest("button") || t.closest("#keyboard_layer")) return; // interactive children

        if (t.closest("#mod_clock")) {
            window.openPowerMenu();
        } else if (t.closest("#mod_cpuinfo")) {
            window.sysCmd.open("CPU INFO", "lscpu 2>/dev/null | head -25; echo; echo '--- LOAD ---'; uptime");
        } else if (t.closest("#mod_ramwatcher_inner")) {
            window.sysCmd.open("MEMORY", "free -h; echo; echo '--- SWAP ---'; swapon --show 2>/dev/null; echo; echo '--- VMSTAT ---'; vmstat 1 2 | tail -2");
        } else if (t.closest("#cyber_panel") && !(window.lockScreen && window.lockScreen.active)) {
            // While locked, the cyber panel is raised only so the on-screen
            // keyboard stays interactive (#85). The strip above the keys has
            // pointer-events:none, so a click there falls through to the panel
            // itself — it must not open the DISK MANAGEMENT menu mid-lock.
            new Modal({ type: "custom", title: "DISK MANAGEMENT",
                html: `<div class="mod_menu">
                    <button onclick="window.sysCmd.open('Disks', 'lsblk -o NAME,SIZE,TYPE,MOUNTPOINT,FSTYPE')">List Disks</button>
                    <button onclick="window.sysCmd.open('Disk Space', 'lsblk -o NAME,SIZE,TYPE,FSTYPE,LABEL,MOUNTPOINT 2>/dev/null; echo; echo ==== df -h ====; df -h -x tmpfs -x devtmpfs -x squashfs -x overlay 2>/dev/null')">Disk Space</button>
                    <button onclick="window.sysCmd.open('Mount', 'lsblk -o NAME,SIZE,MOUNTPOINT,FSTYPE; echo; echo Use: udisksctl mount -b /dev/XXX')">Mount / Unmount</button>
                    <button class="mod_menu_danger" onclick="window.sysCmd.formatDialog()">Format USB / Disk…</button>
                </div>`, closeLabel: "Close" });
        } else if (t.closest("#cyber_radar")) {
            window.sysCmd.open("PROCESSES", "ps -eo pid,comm,%cpu,%mem --sort=-%cpu | head -20");
        } else if (t.closest("#mod_globe")) {
            window.sysCmd.open("NETWORK CONNECTIONS", "ss -tunp 2>/dev/null | head -20");
        } else if (t.closest("#mod_netstat_netfooter")) {
            new Modal({ type: "custom", title: "NETWORK",
                html: `<div class="mod_menu">
                    <button onclick="window.sysCmd.open('Interfaces', 'ip -brief addr')">Interfaces</button>
                    <button onclick="window.sysCmd.open('WiFi', 'nmcli -t -f IN-USE,SSID,SIGNAL device wifi list 2>/dev/null | head -15')">WiFi</button>
                    <button onclick="window.sysCmd.open('Routing / Ping', 'ip route; echo; echo ---; ping -c 2 1.1.1.1 2>&1 | tail -3')">Routing / Ping</button>
                </div>`, closeLabel: "Close" });
        } else if (t.closest("#mod_conninfo")) {
            // Network traffic charts (below the globe) → per-interface traffic
            window.sysCmd.open("NETWORK TRAFFIC", "echo '--- Interface stats ---'; awk 'NR>2 {print $1, \"RX:\"$2\"B  TX:\"$10\"B\"}' /proc/net/dev 2>/dev/null; echo; echo '--- Connection summary ---'; ss -s 2>/dev/null | head -6");
        } else if (t.closest("#mod_hardwareInspector_inner")) {
            // The MODEL panel → full machine info
            window.sysCmd.open("MACHINE INFO", "hostnamectl 2>/dev/null; echo; lscpu 2>/dev/null | head -15; echo; free -h 2>/dev/null | head -2");
        } else if (t.closest("#mod_sysinfo")) {
            // LOAD / UPTIME / TYPE / POWER grid → live CPU load + uptime + power
            window.openSysinfoModal();
        } else if (t.closest("#mod_netstat_weather_main") || t.closest("#mod_netstat_forecast") || t.closest("#mod_netstat_forecast_label")) {
            // Weather display → detailed conditions + 7-day forecast
            window.openWeatherModal();
        }
    });

    window.term[0].onprocesschange = p => {
        if (window.cover) window.cover.rememberProc(0, p);
        document.getElementById("shell_tab0").innerHTML = `<p>${window.cover ? window.cover.tabLabel(0, p) : "MAIN - " + p}</p>`;
    };
    // Keep hardware keyboard focus on the terminal, but never steal it back
    // from things that need their own keyboard focus: the embedded browser's
    // chrome (address bar, tab strip, webapp dropdown), modal dialogs (settings
    // inputs etc.), or any text field. Clicks inside a webview never reach this
    // document anyway.
    window.onmouseup = e => {
        if (!window.keyboard || window.keyboard.linkedToTerm) {
            if (e.target && e.target.closest) {
                if (e.target.closest(".browser_chrome, .webapp_menu, .modal_popup, input, textarea, select, [contenteditable]")) return;
            }
            if (window.term[window.currentTerm]) window.term[window.currentTerm].term.focus();
        }
    };
    window.term[0].term.writeln("\033[1m"+`Welcome to eDEX-UI v${remote.app.getVersion()} - Electron v${process.versions.electron}`+"\033[0m");

    await _delay(100);

    window.fsDisp = new FilesystemDisplay({
        parentId: "filesystem"
    });

    await _delay(200);

    document.getElementById("filesystem").setAttribute("style", "opacity: 1;");

    // Resend terminal CWD to fsDisp if we're hot reloading
    if (window._isHotReload()) {
        window.term[window.currentTerm].resendCWD();
    }

    await _delay(200);

    // Compact system-music controller (bottom-right of the DATA window).
    // Created only after the boot welcome + entrance animations are over so it
    // doesn't pop up before the welcome. Appended via createElement/appendChild
    // - `innerHTML +=` would rebuild <body> and destroy the panel canvases.
    let miniAudioEl = document.createElement("div");
    miniAudioEl.id = "mini_audio";
    document.body.appendChild(miniAudioEl);
    window.miniAudio = new MiniAudio({
        container: miniAudioEl
    });

    // Tabs 4 & 5 are CLI panels by default: command-line apps with a UI
    // (claude, w3m, aerc, btop, musicfox) run in a real terminal session, and
    // both tabs read "APP". When the experimental GUI-app mode
    // (settings.appMonitor.showGui) is enabled, tab 5 becomes the
    // AppMonitorPanel virtual-display entry ("GUI APPS") and shows the hollow
    // fullscreen triangle. The appmonitor backend server always runs (Xvfb is
    // lazy-started), so toggling the setting just needs a restart. Webapps
    // discovery stays.
    window.webapps = new Webapps();
    window.appmonitorApi = {
        config: () => ipc.invoke("appmonitor:config"),
        nativeList: () => ipc.invoke("appmonitor:native-list"),
        launch: (monitorId, appId) => ipc.invoke("appmonitor:launch", { monitorId, appId }),
        kill: (monitorId) => ipc.invoke("appmonitor:kill", { monitorId }),
        status: () => ipc.invoke("appmonitor:status"),
        close: (appId) => ipc.invoke("appmonitor:close", { appId }),
        addNative: (entry) => ipc.invoke("appmonitor:add-native", entry),
        removeNative: (id) => ipc.invoke("appmonitor:remove-native", id),
        fullscreen: (monitorId, appId) => ipc.invoke("appmonitor:fullscreen", { monitorId, appId }),
        exitFullscreen: () => ipc.invoke("appmonitor:exit-fullscreen")
    };
    window.appmonitorA = new CliPanel({ parentId: "appmonitor_a_slot", monitorId: "a", labelId: "shell_tab3_label" });
    window.appmonitorB = (window.settings.appMonitor || {}).showGui
        ? new AppMonitorPanel({ parentId: "appmonitor_b_slot", monitorId: "b", labelId: "shell_tab4_label" })
        : new CliPanel({ parentId: "appmonitor_b_slot", monitorId: "b", labelId: "shell_tab4_label" });

    // WiFi connect panel (Linux + NetworkManager via nmcli).
    window.wifiApi = {
        list: () => ipc.invoke("wifi:list"),
        connect: (ssid, password) => ipc.invoke("wifi:connect", { ssid, password }),
        status: () => ipc.invoke("wifi:status"),
        saved: () => ipc.invoke("wifi:saved"),
        forget: (name) => ipc.invoke("wifi:forget", { name }),
        setAutoconnect: (name, auto) => ipc.invoke("wifi:set-autoconnect", { name, auto })
    };
    window.wifiPanel = new WifiPanel();

    // Bluetooth device panel (Linux + bluetoothctl) — settings popup.
    window.btApi = {
        status: () => ipc.invoke("bluetooth:status"),
        devices: () => ipc.invoke("bluetooth:devices"),
        scan: (sec) => ipc.invoke("bluetooth:scan", sec),
        pair: (address) => ipc.invoke("bluetooth:pair", { address }),
        connect: (address) => ipc.invoke("bluetooth:connect", { address }),
        disconnect: (address) => ipc.invoke("bluetooth:disconnect", { address }),
        forget: (address) => ipc.invoke("bluetooth:forget", { address })
    };
    window.btPanel = new BtPanel();

    // AI-assistant chat log popup (#161) — opened from the settings AI category.
    window.aiHistoryApi = {
        list: () => ipc.invoke("ai:history"),
        clear: () => ipc.invoke("ai:history-clear")
    };
    window.aiHistoryPanel = new AiHistoryPanel();

    // Background WiFi watcher — user event sound on connect. Polls wifi:status
    // every 10s and fires on a not-connected → connected transition; the first
    // connect observed in this session plays wifi_first, later ones wifi_known.
    {
        let wifiPrev = false;      // previous poll: connected?
        let wifiSeenOnce = false;  // session-first connect flag
        const wifiWatch = async () => {
            try {
                const st = await ipc.invoke("wifi:status");
                const conn = !!(st && st.ok && st.connected);
                if (conn && !wifiPrev) {
                    window.eventPlay(wifiSeenOnce ? "wifi_known" : "wifi_first");
                    wifiSeenOnce = true;
                }
                wifiPrev = conn;
            } catch (e) {}
        };
        // First check slightly delayed so the boot-welcome sound isn't drowned.
        setTimeout(wifiWatch, 3000);
        setInterval(wifiWatch, 10000);
    }

    // Fn-key OSD toast (volume / brightness / mute / kbd-backlight). The main
    // process forwards the shell scripts' POSTs (127.0.0.1:17323) here. It reuses
    // the small .browser_toast look (bottom-center, accent border) that the
    // battery/wifi notifications use — just with an icon + thin bar inside.
    window._showOsd = p => {
        if (!p || !p.type) return;
        let el = document.getElementById("edex_osd");
        if (!el) {
            el = document.createElement("div");
            el.id = "edex_osd";
            el.className = "browser_toast";
            el.innerHTML = '<span class="osd_icon"></span><span class="osd_bar"><span class="osd_fill"></span></span><span class="osd_pct"></span>';
            const st = document.createElement("style");
            st.textContent = "#edex_osd{display:flex;align-items:center;gap:1.1vh;padding:0.75vh 1.5vh}#edex_osd .osd_icon{width:1.9vh;height:1.9vh;display:flex;align-items:center;justify-content:center;color:rgb(var(--color_r),var(--color_g),var(--color_b))}#edex_osd .osd_icon svg{width:100%;height:100%}#edex_osd .osd_bar{width:11vh;height:0.55vh;border-radius:0.3vh;background:rgba(255,255,255,.16);overflow:hidden}#edex_osd .osd_fill{display:block;height:100%;border-radius:0.3vh;background:rgb(var(--color_r),var(--color_g),var(--color_b));transition:width .1s linear}#edex_osd .osd_pct{margin-left:0.2vh;color:rgba(255,255,255,.85)}";
            (document.head || document.documentElement).appendChild(st);
            document.body.appendChild(el);
        }
        const v = Math.max(0, Math.min(100, Number(p.value) || 0));
        const icon = el.querySelector(".osd_icon");
        const fill = el.querySelector(".osd_fill");
        const pct = el.querySelector(".osd_pct");
        const SPK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/></svg>';
        const SPK_X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4V5z"/><line x1="21" y1="9.5" x2="15" y2="14.5"/><line x1="15" y1="9.5" x2="21" y2="14.5"/></svg>';
        const SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
        const KBD = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="11" rx="2"/><path d="M6 11h.01M10 11h.01M14 11h.01M18 11h.01M6 15h12"/></svg>';
        if (p.type === "volume") icon.innerHTML = p.muted ? SPK_X : SPK;
        else if (p.type === "brightness") icon.innerHTML = SUN;
        else if (p.type === "kbdbacklight") icon.innerHTML = KBD;
        else icon.innerHTML = "";
        fill.style.width = v + "%";
        pct.textContent = v + "%";
        el.classList.add("show");
        clearTimeout(window._osdTimer);
        window._osdTimer = setTimeout(() => el.classList.remove("show"), 1600);
    };
    ipc.on("osd-show", (e, p) => { if (window._showOsd) window._showOsd(p); });
    ipc.on("open-wifi-panel", () => { if (window.wifiPanel) window.wifiPanel.open(); });
    ipc.on("lock-screen", () => { if (window.lockScreen) window.lockScreen.engage(); });
    // OS power button → POWER menu (main listens on 127.0.0.1:17322). While
    // the display is covered the key means something different per overlay:
    // the matrix rain (screensaver or its adopted lock) is the "machine is
    // dreaming" state, so the power key blanks the display — any key wakes it.
    // The code box is the idle state, so the power menu stays reachable.
    ipc.on("show-power-menu", () => {
        const covered = (window.lockScreen && window.lockScreen.active)
            || (window.screensaver && window.screensaver.isActive());
        if (covered) {
            const matrix = (window.screensaver && typeof window.screensaver.isMatrixActive === "function" && window.screensaver.isMatrixActive())
                || (window.lockScreen && window.lockScreen._matrixTimer !== null);
            if (matrix) {
                try { showScreenOff(); } catch (e) {}
                return;
            }
        }
        if (window.openPowerMenu) window.openPowerMenu();
    });
    ipc.on("edex-download-done", (e, d) => {
        if (window.wifiPanel) window.wifiPanel._notify((d && d.ok ? "Saved to Downloads: " : "Download failed: ") + ((d && d.name) || ""));
    });

    // Floating WiFi quick-connect button (bottom-right corner).
    const wifiBtn = document.createElement("button");
    wifiBtn.className = "wifi_btn";
    wifiBtn.title = "WiFi";
    wifiBtn.innerHTML = "WIFI";
    wifiBtn.onclick = () => { if (window.wifiPanel) window.wifiPanel.open(); };
    document.body.appendChild(wifiBtn);

    // System update modal (sudo apt update + full-upgrade, streamed).
    window.systemUpdate = {
        modal: null,
        open() {
            if (this.modal) return;
            this.modal = new Modal({
                type: "custom",
                title: "SYSTEM UPDATE",
                html: `<pre class="sysup_out" id="sysup_out">Needs network + passwordless sudo.\nPress Start to check for & install updates…</pre>`,
                buttons: [
                    { label: "Start", action: "window.systemUpdate.start()" }
                    // Close is auto-appended by the Modal class (the explicit
                    // one used to double the Close button).
                ]
            }, () => { this.modal = null; });
        },
        close() { if (this.modal) this.modal.close(); },
        start() {
            const pre = document.getElementById("sysup_out");
            if (!pre || pre.dataset.running === "1") return;
            // #1: disable the Start button while running (label switch) so a
            // user can't fire a second apt run on top of the first.
            const setStartBtn = (running) => {
                const modal = pre.closest(".modal_popup");
                if (!modal) return;
                for (const b of modal.lastElementChild.querySelectorAll("button")) {
                    if (b.textContent === "Start" || b.textContent === "Running…") {
                        b.disabled = running;
                        b.textContent = running ? "Running…" : "Start";
                        return;
                    }
                }
            };
            setStartBtn(true);
            pre.dataset.running = "1";
            pre.textContent = "Running apt update + full-upgrade…\n";
            pre.scrollTop = pre.scrollHeight;
            ipc.invoke("system:update").then(r => {
                pre.textContent += r.ok
                    ? "\n✓ Update complete. Reboot if the kernel changed."
                    : "\n✗ Update failed" + (r.error ? ": " + r.error : "") + ".";
                pre.scrollTop = pre.scrollHeight;
                delete pre.dataset.running;
                if (r.ok) {
                    // #3: after a successful update, offer an explicit restart
                    // button (powerAction('reboot') reuses the 7s countdown).
                    const modal = pre.closest(".modal_popup");
                    if (modal && !document.getElementById("sysup_restart_btn")) {
                        const btn = document.createElement("button");
                        btn.id = "sysup_restart_btn";
                        btn.textContent = "Restart";
                        btn.onclick = () => window.powerAction("reboot");
                        modal.lastElementChild.appendChild(btn);
                    }
                } else {
                    setStartBtn(false);
                }
            });
        }
    };
    ipc.on("system-update-output", (e, line) => {
        const pre = document.getElementById("sysup_out");
        if (pre && line) {
            pre.textContent += line + "\n";
            // #2: keep the log pinned to the newest output while apt streams.
            pre.scrollTop = pre.scrollHeight;
        }
    });

    // Clash / mihomo proxy (#46): settings category + browser dashboard. All
    // state comes from the main-process daemon over IPC (on macOS preview the
    // daemon reports the no-binary mock state and this pane still works).
    window.clash = {
        status: null,
        refreshStatus() {
            ipc.invoke("clash:status").then(st => {
                this.status = st;
                const status = document.getElementById("settingsClashStatus");
                if (status) {
                    if (!st.available) status.textContent = t("settings.clash.mock");
                    else if (st.running) status.textContent = t("settings.clash.running") + (st.version ? " · v" + st.version : "");
                    else if (!st.configValid) status.textContent = t("settings.clash.noConfig");
                    else status.textContent = t("settings.clash.stopped");
                }
                const port = document.getElementById("settingsClashPort");
                if (port) port.textContent = st.port || "–";
                const cfg = document.getElementById("settingsClashConfigPath");
                if (cfg) cfg.textContent = st.configPath || "–";
                const log = document.getElementById("settingsClashLog");
                if (log && st.log && st.log.length) log.textContent = st.log.join("\n");
                this.refreshTransfer();
                this.refreshCtrl();
            }).catch(() => {});
        },
        // Live application of the enabled toggle: starts/stops the daemon now
        // AND persists so boot auto-start picks it up (the main process reads
        // settings.clash.enabled at startup). Merges into window.settings so a
        // later Save doesn't reintroduce the old value.
        applyEnabled() {
            const el = document.getElementById("settingsClashEnabled");
            const on = el ? el.value === "true" : false;
            window.settings.clash = Object.assign({}, window.settings.clash, { enabled: on });
            try { fs.writeFileSync(settingsFile, JSON.stringify(window.settings, "", 4)); } catch (e) {}
            ipc.invoke("clash:set-enabled", { enabled: on }).then(() => this.refreshStatus());
        },
        start() {
            ipc.invoke("clash:start").then(r => {
                const status = document.getElementById("settingsClashStatus");
                if (status && r && !r.ok) {
                    status.textContent = r.error === "NO_BINARY" ? t("settings.clash.mock")
                        : r.error === "NO_CONFIG" ? t("settings.clash.noConfig")
                        : (r.error || "?");
                }
                this.refreshStatus();
            });
        },
        stop() { ipc.invoke("clash:stop").then(() => this.refreshStatus()); },
        toggleSecret() {
            const el = document.getElementById("settingsClashSecret");
            if (!el) return;
            const btn = document.getElementById("settingsClashSecretToggle");
            if (el.type === "password") { el.type = "text"; if (btn) btn.textContent = "HIDE"; }
            else { el.type = "password"; if (btn) btn.textContent = t("settings.clash.toggleSecret"); }
        },
        fetchSub() {
            const url = document.getElementById("settingsClashSubUrl");
            if (!url) return;
            ipc.invoke("clash:fetch-subscription", { url: url.value.trim() }).then(r => {
                this.refreshStatus();
                const status = document.getElementById("settingsClashStatus");
                if (status && r) {
                    if (r.ok) status.textContent = t("settings.clash.subFetched");
                    else if (r.error === "BAD_URL") status.textContent = "Bad URL";
                    else if (r.error === "NO_BINARY") status.textContent = t("settings.clash.mock");
                    else status.textContent = t("settings.clash.subFailed");
                }
            });
        },
        // Pick a config file with a native dialog and install it as the
        // active clash config (validated with mihomo -t in main).
        importFile() {
            ipc.invoke("clash:import-file").then(r => {
                this.refreshStatus();
                const status = document.getElementById("settingsClashStatus");
                if (status && r) {
                    if (r.ok) status.textContent = t("settings.clash.imported");
                    else if (r.error === "BAD_CONFIG") status.textContent = t("settings.clash.importFailed") + (r.detail ? " — " + r.detail.split("\n")[0] : "");
                    else if (r.error !== "CANCELED") status.textContent = t("settings.clash.importFailed");
                }
            });
        },
        // WiFi transfer switch: starts/stops the LAN upload server and shows
        // the drop-zone URL (open it on a phone or another device).
        transferToggle() {
            const el = document.getElementById("settingsClashTransfer");
            const on = el ? el.value === "true" : false;
            ipc.invoke(on ? "clash:transfer-start" : "clash:transfer-stop").then(r => {
                if (on && r && !r.ok) {
                    if (el) el.value = "false";
                    const status = document.getElementById("settingsClashStatus");
                    if (status) status.textContent = t("settings.clash.transferFail") + (r.error ? " — " + r.error : "");
                }
                this.refreshTransfer();
            }).catch(() => this.refreshTransfer());
        },
        refreshTransfer() {
            ipc.invoke("clash:transfer-status").then(st => {
                const el = document.getElementById("settingsClashTransfer");
                if (el) el.value = (st && st.running) ? "true" : "false";
                const wrap = document.getElementById("settingsClashTransferUrlWrap");
                if (wrap) wrap.style.display = (st && st.running && st.url) ? "" : "none";
                const url = document.getElementById("settingsClashTransferUrl");
                if (url) url.textContent = (st && st.url) ? st.url : "";
            }).catch(() => {});
        },
        // #9 Controller REST passthrough (clash:ctrl in main): mode switch,
        // proxy-group node selection + delay test, read-only rules.
        refreshCtrl() {
            const st = this.status;
            if (!st || !st.running || !st.controller) { this._clearGroups(); return; }
            this.refreshMode(); this.refreshGroups(); this.refreshRules();
        },
        refreshMode() {
            ipc.invoke("clash:ctrl", { method: "GET", path: "/configs" }).then(r => {
                if (r && r.ok && r.data && r.data.mode) this.setModeValue(r.data.mode);
            }).catch(() => {});
        },
        // 同步自定义下拉的可见值(setupSettingsDropdowns 闭包 setValue 外部不可达,
        // 只能手动更新 hidden input + 按钮文本 + 激活项)。
        setModeValue(mode) {
            const el = document.getElementById("settingsClashMode");
            if (!el) return;
            el.value = mode;
            const wrap = el.closest(".settings_dd");
            if (wrap) {
                const btn = wrap.querySelector(".mod_loc_btn");
                const opt = wrap.querySelector(`.mod_loc_opt[data-value="${mode}"]`);
                if (btn && opt) btn.textContent = opt.textContent;
                wrap.querySelectorAll(".mod_loc_opt").forEach(d => d.classList.toggle("mod_loc_opt_active", d.dataset.value === mode));
            }
        },
        setMode() {
            const el = document.getElementById("settingsClashMode");
            if (!el) return;
            ipc.invoke("clash:ctrl", { method: "PATCH", path: "/configs", body: { mode: el.value } }).then(() => {});
        },
        refreshGroups() {
            ipc.invoke("clash:ctrl", { method: "GET", path: "/proxies" }).then(r => {
                const box = document.getElementById("settingsClashGroups");
                if (!box) return;
                if (!r || !r.ok || !r.data) { box.innerHTML = `<div class="settings_net_empty">${t("settings.clash.ctrlError")}</div>`; return; }
                const proxies = r.data.proxies || {};
                // 组名/节点名来自订阅文件(外部数据),插入 DOM 前转义。
                const esc = window._escapeHtml;
                const groups = Object.entries(proxies).filter(([k, v]) => v && ["Selector", "URLTest", "Fallback", "LoadBalance"].includes(v.type));
                if (!groups.length) { box.innerHTML = `<div class="settings_net_empty">${t("settings.clash.groupsEmpty")}</div>`; return; }
                box.innerHTML = groups.map(([name, g]) => {
                    const opts = (g.all || []).map(n =>
                        `<option value="${esc(n)}" ${n === g.now ? "selected" : ""}>${esc(n)}</option>`).join("");
                    return `<div class="settings_net_row" style="flex-direction:column;align-items:stretch;cursor:default">
                        <div style="display:flex;justify-content:space-between;align-items:center">
                            <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(name)}</span>
                            <span data-delay="${esc(name)}" class="settings_net_info">–</span>
                        </div>
                        <div style="display:flex;gap:1vh;align-items:center">
                            <select class="clash_group_sel" data-group="${esc(name)}">${opts}</select>
                            <button type="button" class="settings_net_btn settings_net_mini" data-test="${esc(name)}">${t("settings.clash.test")}</button>
                        </div>
                    </div>`;
                }).join("");
                box.querySelectorAll(".clash_group_sel").forEach(sel => sel.addEventListener("change", () => {
                    ipc.invoke("clash:ctrl", { method: "PUT",
                        path: "/proxies/" + encodeURIComponent(sel.dataset.group), body: { name: sel.value } }).then(() => {});
                }));
                box.querySelectorAll("[data-test]").forEach(btn => btn.addEventListener("click", () => {
                    const span = box.querySelector(`[data-delay="${btn.dataset.test}"]`);
                    if (span) span.textContent = t("settings.clash.testing");
                    ipc.invoke("clash:ctrl", { method: "GET",
                        path: "/proxies/" + encodeURIComponent(btn.dataset.test) + "/delay?url=https://www.gstatic.com/generate_204&timeout=3000" })
                        .then(r => { if (span) span.textContent = (r && r.ok && r.data && r.data.delay)
                            ? t("settings.clash.delay") + " " + r.data.delay + "ms"
                            : t("settings.clash.delayFail"); })
                        .catch(() => { if (span) span.textContent = t("settings.clash.delayFail"); });
                }));
            }).catch(() => {});
        },
        refreshRules() {
            ipc.invoke("clash:ctrl", { method: "GET", path: "/rules" }).then(r => {
                const pre = document.getElementById("settingsClashRules");
                if (!pre) return;
                const rules = (r && r.ok && r.data && r.data.rules) || [];
                pre.textContent = rules.length ? rules.map(x => `${x.type}  ${x.payload || ""}  →  ${x.proxy}`).join("\n").slice(0, 6000) : t("settings.clash.rulesEmpty");
            }).catch(() => {});
        },
        _clearGroups() {
            const box = document.getElementById("settingsClashGroups");
            if (box) box.innerHTML = "";
        },
    };
    ipc.on("clash-log", (e, line) => {
        const log = document.getElementById("settingsClashLog");
        if (!log || !line) return;
        if (log.textContent === "–") log.textContent = "";
        log.textContent += (log.textContent ? "\n" : "") + line;
        log.scrollTop = log.scrollHeight;
    });

    // ---- #8 AXEL download manager (settings → apps → download) ----
    const axelFmtSpeed = bps => {
        const u = bps >= 1073741824 ? [bps / 1073741824, "GB/s"] : bps >= 1048576 ? [bps / 1048576, "MB/s"] : bps >= 1024 ? [bps / 1024, "KB/s"] : [bps, "B/s"];
        return u[0].toFixed(1) + " " + u[1];
    };
    window.axel = {
        tasks: [], _started: false,
        refresh() {
            ipc.invoke("axel:list").then(r => {
                this.tasks = (r && r.tasks) || [];
                this.render();
            }).catch(() => {});
        },
        render() {
            const box = document.getElementById("settingsDlTasks");
            if (!box) return;
            box.innerHTML = "";
            if (!this.tasks.length) {
                box.innerHTML = `<div class="settings_net_empty">${t("settings.download.noTasks")}</div>`;
                return;
            }
            this.tasks.forEach(task => {
                const row = document.createElement("div");
                row.className = "settings_net_row";
                row.style.flexDirection = "column"; row.style.alignItems = "stretch";
                const pct = Math.max(0, Math.min(100, task.percent || 0));
                const statusText = task.status === "done" ? t("settings.download.status.done")
                    : task.status === "paused" ? t("settings.download.status.paused")
                    : task.status === "error" ? (task.error || t("settings.download.status.error"))
                    : t("settings.download.status.downloading");
                row.innerHTML =
                    `<div style="display:flex;justify-content:space-between;gap:1vh">
                        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${window._escapeHtml(task.url)}">${window._escapeHtml(task.file)}</span>
                        <span>${statusText} ${pct}%</span>
                    </div>
                    <div style="height:1.4vh;background:rgba(0,0,0,.4);border-radius:2px;overflow:hidden">
                        <div style="width:${pct}%;height:100%;background:rgba(var(--color_r),var(--color_g),var(--color_b),.55)"></div>
                    </div>
                    <div style="display:flex;justify-content:space-between;align-items:center">
                        <span style="opacity:.8">${task.speed ? axelFmtSpeed(task.speed) : "–"} · ${task.eta ? t("settings.download.eta") + " " + task.eta : "–"}</span>
                        <span style="display:flex;gap:1vh">
                            <button type="button" class="settings_net_btn settings_net_mini" data-act="${task.paused ? "resume" : "pause"}">${t(task.paused ? "settings.download.resume" : "settings.download.pause")}</button>
                            <button type="button" class="settings_net_btn settings_net_mini" data-act="remove">${t("settings.download.remove")}</button>
                        </span>
                    </div>`;
                row.querySelectorAll("button").forEach(b =>
                    b.addEventListener("click", () => this.act(task.id, b.dataset.act)));
                box.appendChild(row);
            });
        },
        act(id, act) {
            const map = { pause: "axel:pause", resume: "axel:resume", remove: "axel:remove" };
            ipc.invoke(map[act], { id }).then(() => this.refresh()).catch(() => {});
        },
        add() {
            const urlEl = document.getElementById("settingsDlUrl");
            const thEl = document.getElementById("settingsDlThreads");
            const dirEl = document.getElementById("settingsDlDir");
            const url = urlEl ? urlEl.value.trim() : "";
            if (!/^https?:\/\//i.test(url)) { notifyToast(t("settings.download.badUrl")); return; }
            const dir = (dirEl ? dirEl.value.trim() : "") || undefined;
            ipc.invoke("axel:add", { url, threads: (thEl ? thEl.value : 6), dir }).then(r => {
                notifyToast(r && r.ok ? t("settings.download.added") : t("settings.download.addFailed") + (r && r.error ? " — " + r.error : ""));
                if (r && r.ok && urlEl) urlEl.value = "";
                this.refresh();
            }).catch(() => {});
        },
        // 只做初始刷新;实时进度靠主进程 axel-tick 就地更新(不重建 DOM,保留焦点)。
        startPoll() {
            if (this._started) return;
            this._started = true;
            this.refresh();
        }
    };
    ipc.on("axel-tick", (e, snapshot) => {
        if (!document.getElementById("settingsEditor") || !window.axel) return;
        const snap = snapshot || [];
        const box = document.getElementById("settingsDlTasks");
        if (!box) return;
        // 任务数变化(新增/删除)走全量 refresh;否则就地更新进度条/状态/速度,保留键盘焦点。
        if (snap.length !== box.querySelectorAll(".settings_net_row").length) { window.axel.refresh(); return; }
        window.axel.tasks = snap;
        const rows = box.querySelectorAll(".settings_net_row");
        snap.forEach((task, i) => {
            const row = rows[i];
            if (!row) return;
            const pct = Math.max(0, Math.min(100, task.percent || 0));
            const track = row.children[1];
            const bar = track && track.children[0];
            if (bar) bar.style.width = pct + "%";
            const top = row.children[0];
            const statusSpan = top && top.children[1];
            if (statusSpan) {
                const statusText = task.status === "done" ? t("settings.download.status.done")
                    : task.status === "paused" ? t("settings.download.status.paused")
                    : task.status === "error" ? (task.error || t("settings.download.status.error"))
                    : t("settings.download.status.downloading");
                statusSpan.textContent = statusText + " " + pct + "%";
            }
            const bottom = row.children[2];
            const infoSpan = bottom && bottom.children[0];
            if (infoSpan) {
                infoSpan.textContent = (task.speed ? axelFmtSpeed(task.speed) : "–") + " · " + (task.eta ? t("settings.download.eta") + " " + task.eta : "–");
            }
            const btns = bottom && bottom.children[1];
            const pauseBtn = btns && btns.children[0];
            if (pauseBtn) {
                const resume = task.paused;
                pauseBtn.dataset.act = resume ? "resume" : "pause";
                pauseBtn.textContent = t(resume ? "settings.download.resume" : "settings.download.pause");
            }
        });
    });

    // Updates category (#47): app self-update, apt system update + last-update,
    // and per-bundled-program status. All data comes from the main-process IPC
    // added alongside (edex:latest-release, apt:last-update, bundled:status,
    // clash:check-update). The app update itself reuses window.edexUpdate, and
    // the apt modal reuses window.systemUpdate.
    const cmpVer = (a, b) => {
        const pa = (a || "").replace(/[^0-9.]/g, "").split(".").map(Number);
        const pb = (b || "").replace(/[^0-9.]/g, "").split(".").map(Number);
        const n = Math.max(pa.length, pb.length);
        for (let i = 0; i < n; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0) ? 1 : -1;
        return 0;
    };
    const relTime = ts => {
        if (!ts) return null;
        const sec = Math.round((Date.now() - ts) / 1000);
        if (sec < 60) return "<1m";
        if (sec < 3600) return Math.round(sec / 60) + "m";
        if (sec < 86400) return Math.round(sec / 3600) + "h";
        if (sec < 86400 * 30) return Math.round(sec / 86400) + "d";
        return Math.round(sec / (86400 * 30)) + "mo";
    };
    window.updates = {
        app: null,
        clash: null,
        _clashUpdating: false,
        _appUpdatable: false,
        _clashUpdatable: false,
        _appUpdatePlayed: false,
        refresh() {
            this.checkApp();
            this.refreshBundled();
            this.refreshLastUpdate();
            this.checkClashUpdate();
        },
        checkApp(manual) {
            // manual=true (the "Check" button): dialog with the outcome. refresh()
            // also calls this on every settings open — no dialog then.
            return ipc.invoke("edex:latest-release").then(r => {
                this.app = r;
                const ver = document.getElementById("settingsUpAppVersion");
                const btn = document.getElementById("settingsUpAppCheck");
                if (!ver) return r;
                const current = (r && r.current) || remote.app.getVersion();
                if (r && r.ok) {
                    const c = cmpVer(r.latest, current);
                    if (c > 0) ver.textContent = "v" + current + " → " + t("settings.updates.newVersion") + " v" + r.latest;
                    else if (c === 0) ver.textContent = "v" + current + " (" + t("settings.updates.upToDate") + ")";
                    else ver.textContent = "v" + current + " (dev)";
                    // Available update → the check button becomes the update button.
                    this._appUpdatable = (c > 0 && r.appImageUrl);
                    if (this._appUpdatable && !this._appUpdatePlayed) {
                        window.eventPlay("update_available");
                        this._appUpdatePlayed = true;
                    }
                    if (btn) btn.textContent = this._appUpdatable ? t("settings.updates.updateBtn") : t("settings.updates.check");
                } else {
                    ver.textContent = "v" + current + (r && r.error === "FETCH_FAILED" ? " — GitHub unreachable" : "");
                    this._appUpdatable = false;
                    this._appUpdatePlayed = false;
                    if (btn) btn.textContent = t("settings.updates.check");
                }
                if (manual) this._appManualResult(r, current);
                return r;
            }).catch(err => { if (manual) this.toast(t("settings.updates.updateFailed")); return null; });
        },
        _appManualResult(r, current) {
            // The check button was pressed by hand: surface the outcome in a
            // dialog. Update available → confirm (shows current + latest, offers
            // Update / Close); already current → tell the user.
            if (!r || !r.ok) { this.toast(t("settings.updates.updateFailed") + (r && r.error ? " " + r.error : "")); return; }
            const c = cmpVer(r.latest, current);
            if (c > 0 && r.appImageUrl) {
                this._confirmModal(
                    t("settings.updates.newVersion"),
                    `${t("settings.updates.current")} v${current}<br>${t("settings.updates.latest")} v${r.latest}`,
                    () => this.updateApp(),
                    t("settings.updates.updateBtn")
                );
            } else if (c === 0) {
                this._confirmModal(
                    t("settings.updates.upToDate"),
                    `${t("settings.updates.current")} v${current}`,
                    null, null
                );
            } else {
                this.toast(t("settings.updates.upToDate"));
            }
        },
        updateApp() {
            const r = this.app;
            if (!r) return;
            window.edexUpdate.start(r.appImageUrl || "", r.sha256Url || "", r.releaseUrl || "");
        },
        // Shared update-dialog (type:custom Modal). html shows current + latest;
        // when confirmLabel is given, a confirm button runs `onConfirm` and the
        // check button in the row flips to "Update" before closing. The Modal
        // constructor returns the generated id; the instance lives in
        // window.modals[id], so we capture the id after construction and close
        // through the registry when the confirm button is pressed.
        _confirmModal(title, html, onConfirm, confirmLabel) {
            let modalId = null;
            const btns = [];
            if (confirmLabel && typeof onConfirm === "function") {
                window.__updConfirm = () => {
                    try { onConfirm(); } catch (e) {}
                    if (modalId && window.modals[modalId]) window.modals[modalId].close();
                };
                btns.push({ label: confirmLabel, action: "window.__updConfirm();" });
            }
            modalId = new Modal({
                type: "custom",
                title,
                html: `<div class="settings_update_dialog">${html}</div>`,
                buttons: btns,
                closeLabel: t("settings.updates.close")
            }, () => { try { delete window.__updConfirm; } catch (e) {} });
        },
        systemUpdate() { window.systemUpdate.open(); },
        refreshBundled() {
            ipc.invoke("bundled:status").then(st => {
                if (!st) return;
                const set = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
                set("settingsUpClashVer", (st.clash && st.clash.installed) ? (st.clash.version ? "v" + st.clash.version : "installed") : "–");
                set("settingsUpClaudeVer", (st.claude && st.claude.version) ? "v" + st.claude.version : "–");
                set("settingsUpW3mVer", (st.w3m && st.w3m.installed) ? (st.w3m.version ? "v" + st.w3m.version : "installed") : "–");
                set("settingsUpFirefoxVer", (st.firefox && st.firefox.installed) ? (st.firefox.version ? "v" + st.firefox.version : "installed") : "–");
                set("settingsUpBtopVer", (st.btop && st.btop.version) ? "v" + st.btop.version : "–");
                set("settingsUpAercVer", (st.aerc && st.aerc.version) ? "v" + st.aerc.version : "–");
            }).catch(() => {});
        },
        refreshLlmStatus() {
            ipc.invoke("llm:status").then(st => {
                const el = document.getElementById("settingsLlmStatus");
                if (!el) return;
                if (!st || !st.available) { el.textContent = (window.settings.language === "zh") ? "未安装" : "not bundled"; return; }
                const zh = window.settings.language === "zh";
                if (st.ready) el.textContent = zh ? ("运行中 · :" + st.port) : ("ready · :" + st.port);
                else if (st.running) el.textContent = zh ? "模型加载中…" : "loading…";
                else el.textContent = zh ? "未启动" : "stopped";
            }).catch(() => {});
        },
        refreshAiTtsStatus() {
            ipc.invoke("tts:status").then(st => {
                const el = document.getElementById("settingsAiTtsStatus");
                if (!el) return;
                const zh = window.settings.language === "zh";
                if (st && st.ready) el.textContent = zh ? "已就绪" : "ready";
                else if (st && st.available) el.textContent = zh ? "模型加载中…" : "loading…";
                else el.textContent = zh ? "未安装" : "not bundled";
            }).catch(() => {});
        },
        refreshAiHistory() {
            ipc.invoke("ai:history").then(r => {
                const box = document.getElementById("settingsAiHistoryList");
                if (!box) return;
                const h = (r && r.ok && r.history) || [];
                if (!h.length) { box.innerHTML = `<span class="settings_net_info">${window.t("settings.ai.history.historyEmpty")}</span>`; return; }
                box.innerHTML = h.slice().reverse().map((p, i) => `
                    <div class="appmgr_row ai_hist_row" tabindex="-1">
                        <span class="ai_hist_role ai_hist_user">${window.t("ai.hist.user")}</span>
                        <span class="ai_hist_body">${window._escapeHtml(p.user || "")}</span>
                    </div>
                    <div class="appmgr_row ai_hist_row" tabindex="-1">
                        <span class="ai_hist_role ai_hist_ai">${window.t("ai.hist.ai")}</span>
                        <span class="ai_hist_body">${window._escapeHtml(p.assistant || "")}</span>
                    </div>`).join("");
            }).catch(() => {});
        },
        clearAiHistory() {
            ipc.invoke("ai:history-clear").then(() => this.refreshAiHistory());
        },
        refreshLastUpdate() {
            ipc.invoke("apt:last-update").then(r => {
                const el = document.getElementById("settingsUpLastUpdate");
                if (!el) return;
                const saved = (window.settings.updates && window.settings.updates.lastSystemUpdate) || 0;
                const apt = (r && r.ok && r.lastUpdate) || 0;
                const ts = Math.max(saved, apt);
                el.textContent = ts ? relTime(ts) + " ago" : t("settings.updates.never");
            }).catch(() => {
                const el = document.getElementById("settingsUpLastUpdate");
                if (el) el.textContent = t("settings.updates.never");
            });
        },
        checkClashUpdate(manual) {
            // manual=true (the "Check" button): dialog with the outcome. refresh()
            // also calls this on every settings open — no dialog then.
            ipc.invoke("clash:check-update").then(r => {
                this.clash = r;
                const el = document.getElementById("settingsUpClashVer");
                const btn = document.getElementById("settingsUpClashCheck");
                let updatable = false;
                if (el) {
                    if (r && r.available) {
                        const c = r.ok && r.latest && r.current && cmpVer(r.latest, r.current) > 0;
                        updatable = !!(c && r.downloadUrl);
                        el.textContent = (r.current ? "v" + r.current : "–") + (c ? " → v" + r.latest : "");
                    } else {
                        el.textContent = t("settings.clash.mock");
                    }
                }
                this._clashUpdatable = updatable;
                // Available update → the check button becomes the update button.
                if (btn) btn.textContent = updatable ? t("settings.updates.updateBtn") : t("settings.updates.check");
                if (manual) this._clashManualResult(r);
            }).catch(() => { if (manual) this.toast(t("settings.updates.updateFailed")); });
        },
        _clashManualResult(r) {
            // The check button was pressed by hand: surface the outcome in a
            // dialog. Update available → confirm (current + latest, Update /
            // Close); already current → tell the user.
            if (!r || !r.available) { this.toast(t("settings.clash.mock")); return; }
            if (!r.ok) { this.toast(t("settings.updates.updateFailed") + (r.error ? " " + r.error : "")); return; }
            const c = r.latest && r.current && cmpVer(r.latest, r.current) > 0;
            if (c && r.downloadUrl) {
                this._confirmModal(
                    t("settings.updates.newVersion"),
                    `${t("settings.updates.app")} v${r.current}<br>${t("settings.updates.latest")} v${r.latest}`,
                    () => this.updateClash(),
                    t("settings.updates.updateBtn")
                );
            } else {
                this._confirmModal(
                    t("settings.updates.upToDate"),
                    `${t("settings.updates.app")} v${r.current || "–"}`,
                    null, null
                );
            }
        },
        updateClash() {
            if (this._clashUpdating) return;
            const r = this.clash;
            const btn = document.getElementById("settingsUpClashCheck");
            // Pressing Update without a prior (or successful) check: say so
            // instead of silently doing nothing (#78).
            if (!r || !r.downloadUrl) {
                this.toast(t("settings.updates.noUpdate"));
                return;
            }
            this._clashUpdating = true;
            if (btn) {
                btn.disabled = true;
                btn.textContent = t("settings.updates.updating");
            }
            ipc.invoke("clash:update", { url: r.downloadUrl }).then(res => {
                this._clashUpdating = false;
                if (btn) {
                    btn.disabled = false;
                    btn.textContent = t("settings.updates.updateBtn");
                }
                if (res && res.ok) {
                    this.toast(t("settings.updates.updated") + (r.latest ? " v" + r.latest : ""));
                    window.eventPlay("cliapp_update");
                    window.clash.refreshStatus();
                    this.checkClashUpdate();
                } else {
                    this.toast(t("settings.updates.updateFailed") + (res && res.error ? " " + res.error : ""));
                }
            }).catch(() => {
                this._clashUpdating = false;
                if (btn) {
                    btn.disabled = false;
                    btn.textContent = t("settings.updates.updateBtn");
                }
                this.toast(t("settings.updates.updateFailed"));
            });
        },
        toast(msg) {
            if (window.appmonitorA && typeof window.appmonitorA._notify === "function") {
                window.appmonitorA._notify(msg);
                return;
            }
            let el = document.getElementById("edex_toast");
            if (!el) {
                el = document.createElement("div");
                el.id = "edex_toast";
                el.className = "browser_toast";
                document.body.appendChild(el);
            }
            el.textContent = msg;
            el.classList.add("show");
            clearTimeout(this.toast._timer);
            this.toast._timer = setTimeout(() => el.classList.remove("show"), 2200);
        }
    };

    // SSH server toggle (#4, redesigned): a single on/off switch living in the
    // network settings category. Applies through a background command via sysCmd
    // (like file moves), so it never shows in a terminal tab. eDEX has
    // passwordless sudo, so `enable --now` / `disable --now` is enough — no
    // main-process involvement, and the state survives reboots. On by default.
    window.ssh = {
        refreshStatus() {
            // Ubuntu 24.04 socket-activates sshd: ssh.socket is what listens on
            // :22. ssh.service only goes active while a connection is open, so
            // `is-active ssh` reads "inactive" (toggle would wrongly show OFF)
            // whenever the machine is idle — check the socket, not the service.
            window.sysCmd.run("sudo -n systemctl is-active ssh.socket").then(r => {
                const el = document.getElementById("settingsSshEnabled");
                if (el) el.value = r.ok && (r.out || "").trim() === "active" ? "1" : "0";
            }).catch(() => {});
        },
        applyEnabled() {
            const el = document.getElementById("settingsSshEnabled");
            if (!el) return;
            const action = el.value === "1" ? "enable --now" : "disable --now";
            // Ubuntu 24.04 socket-activates sshd via ssh.socket; installs bake
            // only the socket on (ssh.service stays disabled). The toggle must
            // match: enabling ssh.service too makes ssh.socket bind :22 first at
            // boot and ssh.service then fail with "Address already in use" →
            // red FAILED text. So only the socket, both directions.
            window.sysCmd.run("sudo -n systemctl " + action + " ssh.socket")
                .then(() => this.refreshStatus())
                .catch(() => {});
        }
    };

    // GUI app manager (#62): one-click install/uninstall for the GUI apps the
    // user installs (Flatpak / AppImage / custom / deb). Purely renderer-side —
    // privileged commands go through a long-timeout exec, the same "single
    // control + background command" pattern as the SSH toggle. The list only
    // shows *user-installed* apps (a pristine system has none): flatpak apps via
    // `flatpak list`, AppImages + custom entries from the app-monitor backend,
    // and debs the manager itself installed (tracked in installed-debs.json).
    // The same sources feed the tab 4/5 GUI-app list, so an app installed here
    // shows up there too. `require` is used inline so the minified patch mirror
    // can drop this block verbatim without terser-renamed module identifiers.
    window.appManager = {
        _list: [],
        _searchList: [],
        _pending: null,
        _fpOk: false,

        _debFile() { return require("path").join(require("path").dirname(window.settingsFile), "installed-debs.json"); },
        _readDebs() {
            try { const l = JSON.parse(require("fs").readFileSync(this._debFile(), "utf8")); return Array.isArray(l) ? l : []; } catch (e) { return []; }
        },
        _writeDebs(list) { try { require("fs").writeFileSync(this._debFile(), JSON.stringify(list, null, 2)); } catch (e) {} },
        _home() { try { return require("os").homedir(); } catch (e) { return "~"; } },

        // Long-timeout exec (flatpak/apt installs take minutes; sysCmd.run caps
        // at 30s). Promise<{out,err,ok}>.
        _run(cmd, timeoutMs) {
            return new Promise(resolve => {
                require("child_process").exec(cmd, { timeout: timeoutMs || 1800000, maxBuffer: 32 * 1024 * 1024 }, (e, so, se) => resolve({ out: so || "", err: se || "", ok: !e }));
            });
        },
        // Shell-quote one argument (exec runs through sh -c).
        _shq(s) { return "'" + String(s).replace(/'/g, "'\\''") + "'"; },
        _esc(s) { return String(s == null ? "" : s).replace(/[<>&"]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c])); },
        _notify(m) {
            let _t = document.getElementById("edex_toast");
            if (!_t) { _t = document.createElement("div"); _t.id = "edex_toast"; _t.className = "browser_toast"; document.body.appendChild(_t); }
            _t.textContent = m; _t.classList.add("show");
            clearTimeout(this._notifyTimer);
            this._notifyTimer = setTimeout(() => _t.classList.remove("show"), 2200);
        },
        _ensureCss() {
            if (document.getElementById("appmgr-style")) return;
            const st = document.createElement("style");
            st.id = "appmgr-style";
            st.textContent = ".appmgr_row{display:flex;align-items:center;gap:.8vh;padding:.5vh .6vh;border-bottom:1px dashed rgba(128,128,128,.22)}.appmgr_row.active,.appmgr_row:focus{background:rgba(128,128,128,.16);outline:none}.appmgr_icon{width:2.2vh;height:2.2vh;flex:0 0 2.2vh;opacity:.85}.appmgr_name{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.appmgr_desc{opacity:.5;font-size:1.05vh}.appmgr_badge{font-size:1.05vh;opacity:.65;padding:0 .5vh;border:1px solid rgba(128,128,128,.45);border-radius:.3vh;white-space:nowrap}.appmgr_btn{font-size:1.15vh;padding:.25vh .9vh;cursor:pointer}.appmgr_btn:disabled{opacity:.4}.appmgr_empty{padding:.8vh;opacity:.55;text-align:center}.appmgr_banner{display:flex;align-items:center;justify-content:space-between;gap:1vh;padding:.5vh .8vh;margin-bottom:.6vh}";
            (document.head || document.documentElement).appendChild(st);
        },

        _flatpakIcon(appId) {
            const bases = ["/var/lib/flatpak/exports/share/icons/hicolor", this._home() + "/.local/share/flatpak/exports/share/icons/hicolor"];
            for (const base of bases) for (const sz of ["256x256", "128x128", "64x64", "512x512", "scalable"]) for (const ext of ["png", "svg"]) {
                const p = base + "/" + sz + "/apps/" + appId + "." + ext;
                try { if (require("fs").existsSync(p)) return p; } catch (e) {}
            }
            return null;
        },

        _parseFlatpakList(out) {
            const rows = [];
            for (const line of String(out || "").split("\n")) {
                const parts = line.split("\t").map(s => s.trim()).filter(Boolean);
                if (parts.length < 2) continue;
                let id = parts[0];
                if (/^(application|name|ref|application_id)$/i.test(id)) continue;
                if (id.indexOf("/") >= 0) { const segs = id.split("/"); id = segs[0] === "app" && segs[1] ? segs[1] : segs[segs.length - 1]; }
                rows.push({ id: "flatpak:" + id, appId: id, name: parts[1] || id, source: "flatpak" });
            }
            return rows;
        },
        _parseFlatpakSearch(out) {
            const rows = [];
            for (const line of String(out || "").split("\n")) {
                const parts = line.split("\t").map(s => s.trim()).filter(Boolean);
                if (!parts.length) continue;
                let id = parts[0];
                if (/^(application|name|ref|application_id)$/i.test(id)) continue;
                if (id.indexOf("/") >= 0) { const segs = id.split("/"); id = segs[0] === "app" && segs[1] ? segs[1] : segs[segs.length - 1]; }
                rows.push({ id: "flatpak:" + id, appId: id, name: parts[1] || id, desc: parts.slice(2).join(" ") || "", source: "flatpak" });
            }
            return rows;
        },
        _appImageDirs() {
            const s = String((((window.settings || {}).appMonitor || {}).appImageDirs) || "~/Applications,~/AppImages");
            const home = this._home();
            return s.split(",").map(x => x.trim()).filter(Boolean).map(x => x === "~" ? home : x.indexOf("~/") === 0 ? require("path").join(home, x.slice(2)) : x);
        },

        _iconHtml(app) {
            let lib = null;
            if (app.icon && window.iconLibrary) lib = window.iconLibrary.get(app.icon);
            if (lib) return lib;
            if (app.source === "flatpak" && app.appId) { const p = this._flatpakIcon(app.appId); if (p) return '<img class="appmgr_icon" src="' + this._esc(p) + '">'; }
            return '<svg class="appmgr_icon" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="3" fill="none" stroke="currentColor" stroke-opacity=".7"/></svg>';
        },
        _row(app, i, primary) {
            const badge = '<span class="appmgr_badge">' + this._esc(t("appmgr.source." + app.source)) + "</span>";
            const sub = primary === "installFlatpak" && app.desc ? ' <span class="appmgr_desc">' + this._esc(app.desc) + "</span>" : "";
            const name = app.name || app.appId || "";
            const btn = primary === "uninstall"
                ? '<button type="button" class="appmgr_btn" onclick="window.appManager.uninstall(' + i + ')">' + this._esc(t("appmgr.uninstall")) + "</button>"
                : '<button type="button" class="appmgr_btn" data-fpi="' + i + '" onclick="window.appManager.installFlatpak(' + i + ')">' + this._esc(t("appmgr.install")) + "</button>";
            return '<div class="appmgr_row" tabindex="-1">' + this._iconHtml(app) + '<span class="appmgr_name">' + this._esc(name) + sub + "</span>" + badge + btn + "</div>";
        },
        _wireKeys(cid) {
            const box = document.getElementById(cid);
            if (!box) return;
            box.onkeydown = e => {
                const rows = box.querySelectorAll(".appmgr_row");
                if (!rows.length) return;
                if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                    e.preventDefault(); e.stopPropagation();
                    let idx = -1; rows.forEach((r, i) => { if (r.classList.contains("active")) idx = i; });
                    idx = e.key === "ArrowDown" ? Math.min(idx + 1, rows.length - 1) : Math.max(idx - 1, 0);
                    rows.forEach(r => r.classList.remove("active"));
                    rows[idx].classList.add("active");
                    try { rows[idx].scrollIntoView({ block: "nearest" }); } catch (err) {}
                } else if (e.key === "Enter") {
                    e.preventDefault(); e.stopPropagation();
                    const active = box.querySelector(".appmgr_row.active");
                    const btn = active && active.querySelector("button.appmgr_btn");
                    if (btn) btn.click();
                } else if (e.key === "Escape") {
                    e.stopPropagation();
                    rows.forEach(r => r.classList.remove("active"));
                }
            };
        },

        async refresh() {
            const box = document.getElementById("appmgrInstalledList");
            if (!box) return;
            this._ensureCss();
            this._fpOk = false;
            try { this._fpOk = (await this._run("flatpak --version", 10000)).ok; } catch (e) {}
            let list = [];
            if (this._fpOk) {
                const r = await this._run("flatpak list --app --columns=application,name", 30000);
                if (r.ok) list = list.concat(this._parseFlatpakList(r.out));
            }
            try {
                const nl = await window.appmonitorApi.nativeList();
                const apps = (nl && nl.apps) || [];
                for (const a of apps) {
                    if (String(a.id || "").indexOf("appimage:") === 0) list.push({ id: a.id, name: a.name, source: "appimage", path: a.path, icon: null });
                    else if (String(a.id || "").indexOf("custom:") === 0) list.push({ id: a.id, name: a.name, source: "custom", icon: a.icon });
                }
            } catch (e) {}
            for (const d of this._readDebs()) list.push({ id: "deb:" + (d.pkg || d.name), name: d.name, pkg: d.pkg || d.name, source: "deb", icon: null });
            list.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
            this._list = list;
            let html = "";
            if (!this._fpOk) html += '<div class="appmgr_banner"><span>' + this._esc(t("appmgr.flatpakMissing")) + '</span><button type="button" class="appmgr_btn" onclick="window.appManager.ensureFlatpakThen()">' + this._esc(t("appmgr.flatpakInstall")) + "</button></div>";
            html += list.length ? list.map((a, i) => this._row(a, i, "uninstall")).join("") : '<div class="appmgr_empty">' + this._esc(t("appmgr.installed.empty")) + "</div>";
            box.innerHTML = html;
            this._wireKeys("appmgrInstalledList");
        },
        _renderSearchResults(list) {
            const box = document.getElementById("appmgrSearchResults");
            if (!box) return;
            this._searchList = list;
            box.innerHTML = list.map((a, i) => this._row(a, i, "installFlatpak")).join("");
            this._wireKeys("appmgrSearchResults");
        },

        async searchFlathub() {
            const input = document.getElementById("appmgrSearchInput");
            const box = document.getElementById("appmgrSearchResults");
            if (!input || !box) return;
            const kw = String(input.value || "").trim();
            if (!kw) return;
            box.innerHTML = '<div class="appmgr_empty">…</div>';
            await this.ensureFlathub();
            const r = await this._run("flatpak search --columns=application,name,description " + this._shq(kw), 60000);
            if (!r.ok) { box.innerHTML = '<div class="appmgr_empty">' + this._esc(t("appmgr.search.failed")) + "</div>"; return; }
            const list = this._parseFlatpakSearch(r.out);
            if (!list.length) { box.innerHTML = '<div class="appmgr_empty">' + this._esc(t("appmgr.search.empty")) + "</div>"; return; }
            this._renderSearchResults(list);
        },
        async ensureFlathub() {
            const vr = await this._run("flatpak --version", 10000);
            if (!vr.ok) { const r = await this._run("sudo -n apt install -y flatpak", 600000); if (!r.ok) return false; }
            await this._run("sudo -n flatpak remote-add --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo", 60000);
            return true;
        },
        ensureFlatpakThen() { this.ensureFlathub().then(() => this.refresh()); },

        installFlatpak(i) {
            const app = this._searchList && this._searchList[i];
            if (!app) return;
            const btn = document.querySelector('#appmgrSearchResults button[data-fpi="' + i + '"]');
            this._confirm(t("appmgr.confirm.install"), this._esc(app.name || app.appId) + " · <code>" + this._esc(app.appId) + "</code>", t("appmgr.install"), () => {
                if (btn) { btn.disabled = true; btn.textContent = t("appmgr.installing"); }
                this._runInstall("sudo -n flatpak install -y flathub " + this._shq(app.appId), () => {
                    if (btn) { btn.disabled = false; btn.textContent = t("appmgr.install"); }
                    this.refresh();
                });
            });
        },
        _runInstall(cmd, done) {
            this._run(cmd, 1800000).then(r => {
                if (r.ok) this._notify(t("appmgr.done"));
                else this._notify((r.err || "").split("\n").filter(Boolean).pop() || t("appmgr.failed"));
                if (done) done();
            });
        },

        async installLocal() {
            const input = document.getElementById("appmgrLocalInput");
            if (!input) return;
            const raw = String(input.value || "").trim();
            if (!raw) return;
            const p = raw.indexOf("~/") === 0 ? require("path").join(this._home(), raw.slice(2)) : raw;
            const abs = require("path").resolve(p);
            const lower = abs.toLowerCase();
            if (lower.indexOf(".appimage") === lower.length - 9) {
                const dirs = this._appImageDirs();
                if (!dirs.length) { this._notify(t("appmgr.failed")); return; }
                const dest = require("path").join(dirs[0], require("path").basename(abs));
                const r = await this._run("install -Dm755 " + this._shq(abs) + " " + this._shq(dest), 120000);
                if (r.ok) { this._notify(t("appmgr.done")); input.value = ""; }
                else this._notify((r.err || "").split("\n").filter(Boolean).pop() || t("appmgr.failed"));
                this.refresh();
                return;
            }
            if (lower.indexOf(".deb") === lower.length - 4) {
                this.installDeb(abs).then(ok => { if (ok) input.value = ""; });
                return;
            }
            this._notify(t("appmgr.badType"));
        },

        // Install a local .deb via apt and record it in installed-debs.json so it
        // shows up in the manager (settings) and the GUI-app list (tab 4/5).
        // Shared by the settings local-install path and the file browser's .deb
        // click (fs.class installDebFromBrowser). Resolves true on success.
        async installDeb(abs) {
            const pk = await this._run("dpkg-deb -f " + this._shq(abs) + " Package Description", 30000);
            const lines = (pk.out || "").split("\n").map(s => s.trim()).filter(Boolean);
            const pkg = lines[0] || "";
            if (!pk.ok || !pkg) { this._notify(t("appmgr.failed")); this.refresh(); return false; }
            const r = await this._run("sudo -n apt install -y " + this._shq(abs), 1800000);
            if (r.ok) {
                const debs = this._readDebs();
                if (!debs.some(d => d.pkg === pkg)) { debs.push({ name: lines[1] || pkg, pkg, added: Date.now() }); this._writeDebs(debs); }
                this._notify(t("appmgr.done"));
            } else this._notify((r.err || "").split("\n").filter(Boolean).pop() || t("appmgr.failed"));
            this.refresh();
            return !!r.ok;
        },

        uninstall(i) {
            const app = this._list && this._list[i];
            if (!app) return;
            const name = app.name || app.appId || "";
            if (app.source === "deb") {
                this._confirm(t("appmgr.confirm.uninstall"), this._esc(t("appmgr.confirm.debRisk").replace("{name}", name)), t("appmgr.uninstall"), () => {
                    this._confirm(t("appmgr.confirm.uninstall"), this._esc(t("appmgr.confirm.debRisk").replace("{name}", name)), t("appmgr.uninstall"), () => {
                        this._run("sudo -n apt remove --purge -y " + this._shq(app.pkg), 600000).then(r => {
                            if (r.ok) { this._writeDebs(this._readDebs().filter(d => d.pkg !== app.pkg)); this._notify(t("appmgr.done")); }
                            else this._notify((r.err || "").split("\n").filter(Boolean).pop() || t("appmgr.failed"));
                            this.refresh();
                        });
                    });
                });
                return;
            }
            this._confirm(t("appmgr.confirm.uninstall"), this._esc(name) + " · " + this._esc(t("appmgr.source." + app.source)), t("appmgr.uninstall"), () => {
                let p;
                if (app.source === "flatpak") p = this._run("sudo -n flatpak uninstall -y " + this._shq(app.appId), 600000);
                else if (app.source === "appimage") p = this._run("rm -f " + this._shq(app.path), 30000);
                else if (app.source === "custom") p = window.appmonitorApi.removeNative(app.id);
                if (!p) { this.refresh(); return; }
                p.then(r => {
                    if (r && r.ok === false) this._notify((r.err || "").split("\n").filter(Boolean).pop() || t("appmgr.failed"));
                    else this._notify(t("appmgr.done"));
                    this.refresh();
                }).catch(() => this.refresh());
            });
        },

        _confirm(title, html, okLabel, fn) {
            this._pending = fn;
            const self = this;
            const m = new Modal({
                type: "custom",
                title: title,
                html: '<div class="appmgr_confirm">' + html + "</div>",
                closeLabel: (window.settings && window.settings.language === "zh") ? "关闭" : "Close",
                buttons: [{ label: okLabel, action: "window.appManager._confirmed()" }]
            });
            const inst = window.modals[m];
            if (!inst) return;
            const onKey = e => {
                if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); inst.close(); }
                else if (e.key === "Enter") { e.stopPropagation(); e.preventDefault(); self._confirmed(); }
            };
            document.addEventListener("keydown", onKey, true);
            const origClose = inst.close.bind(inst);
            inst.close = () => { document.removeEventListener("keydown", onKey, true); origClose(); };
            setTimeout(() => { const btns = document.querySelectorAll('#modal_' + m + " button"); if (btns[0]) btns[0].focus(); }, 60);
        },
        _confirmed() {
            const fn = this._pending; this._pending = null;
            const keys = Object.keys(window.modals);
            const top = keys.length ? window.modals[keys[keys.length - 1]] : null;
            if (top && typeof top.close === "function") top.close();
            if (typeof fn === "function") fn();
        }
    };

    // "显示GUI应用" experimental toggle (virtual-display GUI apps on tab 5).
    // Off by default: tabs 4 & 5 are both CLI apps. The backend server always
    // runs (Xvfb is lazy-started), so flipping this just records intent — the
    // routing is decided at boot, hence the "restart to take effect" toast.
    window.showGui = {
        apply() {
            const el = document.getElementById("settingsEditor-showGui");
            if (!el) return;
            const on = el.value === "true";
            window.settings.appMonitor = window.settings.appMonitor || {};
            window.settings.appMonitor.showGui = on;
            try { fs.writeFileSync(settingsFile, JSON.stringify(window.settings, "", 4)); } catch (e) {}
            this._notify("重启后生效");
        },
        _notify(m) {
            let _t = document.getElementById("edex_toast");
            if (!_t) {
                _t = document.createElement("div");
                _t.id = "edex_toast";
                _t.className = "browser_toast";
                document.body.appendChild(_t);
            }
            _t.textContent = m;
            _t.classList.add("show");
            clearTimeout(this._notifyTimer);
            this._notifyTimer = setTimeout(() => _t.classList.remove("show"), 2200);
        }
    };

    // GitHub self-update of the eDEX-UI AppImage (eDEX-OS install). Downloads
    // the new AppImage from a release asset, verifies its sha256 and atomically
    // replaces /opt/edex/eDEX-UI.AppImage in the main process, then relaunches.
    // Only meaningful when running from an AppImage — from src/ during dev it
    // falls back to opening the release page in the browser.
    window.edexUpdate = {
        isAppImage: false,
        modal: null,
        init() {
            ipc.invoke("app:env").then(env => {
                if (env) this.isAppImage = !!env.isAppImage;
            }).catch(() => {});
        },
        start(url, sha256Url, releaseUrl) {
            if (!this.isAppImage) {
                require("electron").shell.openExternal(releaseUrl || url);
                return;
            }
            if (this.modal) return;
            this.modal = new Modal({
                type: "custom",
                title: "UPDATE",
                html:
                    `<div style="margin:0 0 .8vh">
                        <div class="edexup_bar"><div class="edexup_fill" id="edexup_fill"></div></div>
                        <div id="edexup_pct" style="font-size:1.4vh;opacity:.72;margin-top:.45vh">Downloading… 0%</div>
                     </div>
                     <pre id="edexup_out" style="max-height:42vh;overflow:auto;white-space:pre-wrap">Preparing update…</pre>`,
                buttons: []
                // Close is auto-appended; success auto-restarts below.
            }, () => { this.modal = null; });
            const pre = document.getElementById("edexup_out");
            ipc.invoke("system:edex-update", { url, sha256Url }).then(r => {
                if (!pre) return;
                if (r && r.ok) {
                    pre.textContent += "\n✓ Update ready. Restarting eDEX…";
                    window.eventPlay("update_done");
                    window.updateRestartCountdown();
                } else {
                    let msg = (r && r.error) || "unknown error";
                    if (msg === "NOT_APPIMAGE") msg = "not running from an AppImage — open the release page instead.";
                    if (msg === "SHA256_MISMATCH") msg = "checksum mismatch — the download is corrupt. Try again.";
                    pre.textContent += "\n✗ Update failed: " + msg + ".";
                }
            });
        }
    };
    window.edexUpdate.init();
    ipc.on("edex-update-output", (e, line) => {
        const pre = document.getElementById("edexup_out");
        if (pre && line) pre.textContent += line + "\n";
    });
    // Live download progress (main process sends the parsed curl percentage).
    ipc.on("edex-update-progress", (e, pct) => {
        const fill = document.getElementById("edexup_fill");
        if (fill) fill.style.width = Math.max(0, Math.min(100, pct)) + "%";
        const p = document.getElementById("edexup_pct");
        if (p) p.textContent = "Downloading… " + Math.floor(pct) + "%";
    });

    // True-fullscreen overlay for a webview: a body-level fixed layer hosting a
    // fresh <webview> for the same URL/partition, so the page can fill the whole
    // screen without touching the in-frame webview. Exit via the floating button
    // (the fullscreen guest swallows keyboard input, so Esc can't reach us).
    window.webViewFullscreen = {
        el: null,
        enter(url, partition) {
            if (!url || this.el) return;
            const el = document.createElement("div");
            el.className = "web_fullscreen";
            const btn = document.createElement("button");
            btn.className = "web_fullscreen_exit";
            btn.title = "Exit fullscreen";
            btn.innerHTML = Icons.close;
            btn.onclick = () => this.exit();
            const wv = document.createElement("webview");
            wv.setAttribute("partition", partition || "persist:edex-browser");
            wv.setAttribute("webpreferences", "contextIsolation=yes, nodeIntegration=no, sandbox=yes");
            wv.setAttribute("allowpopups", "");
            wv.setAttribute("src", url);
            el.appendChild(btn);
            el.appendChild(wv);
            document.body.appendChild(el);
            this.el = el;
        },
        exit() {
            if (!this.el) return;
            this.el.remove();
            this.el = null;
        }
    };

    // Slots 3/4 are not terminals, but a lot of code calls
    // `window.term[currentTerm].fit()/.term.focus()/.write()/...` blindly. A
    // terminal-shaped shim keeps all of that safe: fit/resendCWD/write/
    // clipboard are no-ops, and .term.focus() forwards to the actual webview.
    const makePanelShim = getPanel => ({
        isBrowserTab: true,
        fit() {},
        resendCWD() {},
        write() {},
        writelr() {},
        clipboard: { copy() {}, paste() {}, didCopy: false },
        term: {
            focus() { const p = getPanel(); if (p && p.focus) p.focus(); },
            write() {}, reset() {}, resize() {},
            rows: 24, cols: 80,
            element: null
        },
        onprocesschange: null,
        onclose: null
    });
    window.term[3] = makePanelShim(() => window.appmonitorA);
    window.term[4] = makePanelShim(() => window.appmonitorB);

    // In-browser shortcuts (Ctrl+T/W/L), forwarded from the main process via
    // before-input-event while a BROWSER webview has focus.
    ipc.on("browser-shortcut", (e, key) => {
        if (!window.browser || window.shellSlotKinds[window.currentTerm] !== "browser") return;
        if (key === "t") window.browser.newTab(window.browser.startUrl);
        else if (key === "w") window.browser.closeTab(window.browser.activeId);
        else if (key === "l") window.browser.focusAddressBar();
        else if (key === "f") window.browser.openFind();
        else if (key === "g") window.browser.findNext(false);
        else if (key === "p") window.browser.printPage();
    });

    // window.open / target=_blank from a webview (routed from the main process):
    // browser tabs open a new browser-internal tab, everything else goes external.
    ipc.on("webview-window-open", (e, { url, browser }) => {
        const external = () => { try { require("electron").shell.openExternal(url); } catch (err) {} };
        if (browser && window.browser && /^https?:/i.test(url)) window.browser.newTab(url);
        else external();
    });

    window.updateCheck = new UpdateChecker();

    // First launch: ask for the UI language once, once the interface is up.
    if (!window.settings.language) setTimeout(() => window.showLanguagePicker(), 800);
    // (The boot-time lock already ran before initUI — see bootLockThenRun.)

    // The real desktop is fully built (terminals + tabs + browser registered).
    // From here on, show() means a real code/matrix lock, never the boot lock.
    window._uiReady = true;
    // Boot-time guarantee: the app-monitor dropdowns are created during
    // initUI (right after the boot unlock) and must start hidden — force-close
    // both so no app list lingers at the edge of the screen.
    [window.appmonitorA, window.appmonitorB].forEach(p => {
        if (p && typeof p.closeMenu === "function") { try { p.closeMenu(); } catch (e) {} }
    });
    // Wallpaper (and full theme CSS) is injected up-front in _loadTheme; nothing
    // is deferred any longer (see _loadTheme). The old deferred-wallpaper hook is
    // now a no-op, kept only as a guard for anything still referencing it.
    if (window._deferredWallpaper) {
        try {
            const st = document.createElement("style");
            st.textContent = window._deferredWallpaper;
            document.head.appendChild(st);
        } catch (e) {}
        window._deferredWallpaper = null;
    }
}

window.themeChanger = theme => {
    ipc.send("setThemeOverride", theme);
    setTimeout(() => {
        window.location.reload(true);
    }, 100);
};

// Desktop background source (settings → 背景图片). The user picks between the
// active theme's default, the classic dot grid, the Endfield military topo
// sheet, or their own image. Whatever is chosen overrides the body background
// inline (which beats the theme's own body rule in the cascade); "theme" clears
// the override so main.css / the active theme decide.
window.BG_CONTOUR = "url('assets/misc/military-map.svg')"; // 终末地 等高线·军事地图
window.BG_CITY     = "url('assets/misc/city-map.svg')";    // 战地 城市军用图
window.BG_STAR     = "url('assets/misc/star-chart.svg')";  // 星穹 真实星图
window.BG_COAST    = "url('assets/misc/coast-map.svg')";   // 死亡搁浅 海岸图

const _bgSetInline = (body, image, color) => {
    body.style.backgroundImage = image;
    body.style.backgroundSize = "cover";
    body.style.backgroundPosition = "center";
    body.style.backgroundRepeat = "no-repeat";
    body.style.backgroundColor = color || "#0e0f0e";
};
const _bgDot = body => {
    // The classic dot/grid background (the same recipe as main.css body), used in
    // "dot" mode regardless of the active theme.
    body.style.backgroundImage =
        "linear-gradient(90deg, var(--color_light_black) 1.85vh, transparent 1%), " +
        "linear-gradient(var(--color_light_black) 1.85vh, transparent 1%)";
    body.style.backgroundPosition = "center";
    body.style.backgroundSize = "2.04vh 2.04vh";
    body.style.backgroundRepeat = "repeat";
    body.style.backgroundColor = "var(--color_grey)";
};
const _bgClear = body => {
    body.style.backgroundImage = "";
    body.style.backgroundSize = "";
    body.style.backgroundPosition = "";
    body.style.backgroundRepeat = "";
    body.style.backgroundColor = "";
};

window.applyBackground = (mode, image) => {
    const body = document.body;
    if (!body) return;
    const m = mode || window.settings.backgroundMode || "theme";
    const img = (image !== undefined ? image : window.settings.backgroundImage) || "";
    if (m === "image") {
        if (img) {
            let u;
            try { u = require("url").pathToFileURL(String(img)).href; } catch (e) { u = "file://" + img; }
            _bgSetInline(body, `url("${u}")`);
            return;
        }
        // An image mode with no picture yet: fall through to the theme default.
    } else if (m === "contour") {
        _bgSetInline(body, window.BG_CONTOUR);
        return;
    } else if (m === "city") {
        _bgSetInline(body, window.BG_CITY);
        return;
    } else if (m === "star") {
        _bgSetInline(body, window.BG_STAR);
        return;
    } else if (m === "coast") {
        _bgSetInline(body, window.BG_COAST);
        return;
    } else if (m === "dot") {
        _bgDot(body);
        return;
    }
    // theme mode: clear the override so the theme's own background shows.
    _bgClear(body);
};

window.bgSetMode = mode => {
    window._settingsBgMode = mode;
    document.querySelectorAll("#settingsBgModes .settings_bg_mode").forEach(b => b.classList.toggle("active", b.dataset.mode === mode));
    const actions = document.getElementById("settingsBgActions");
    if (actions) actions.style.display = mode === "image" ? "flex" : "none";
    window.applyBackground(mode);
};

window.openBgPicker = () => {
    const home = remote.app.getPath("home");
    let cwd = fs.existsSync(path.join(home, "Pictures")) ? path.join(home, "Pictures") : home;
    const isImg = f => /\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(f);
    // A list browser (like the CLI cd-picker): parent/dirs/images as rows,
    // navigable with ↑/↓ + Enter, Backspace = up a dir, and mouse click.
    let keyH = null;
    let rows = [], cursor = 0;
    const select = (full, f) => {
        window._settingsBgValue = full;
        window.bgSetMode("image");
        const st = document.getElementById("settingsBgStatus");
        if (st) st.textContent = f;
        const prev = document.getElementById("settingsBgPreview");
        if (prev) { try { prev.style.backgroundImage = `url("${require("url").pathToFileURL(full).href}")`; } catch (e) {} prev.classList.add("show"); }
        if (window.eventPlay) window.eventPlay("settings_save");
        setTimeout(() => { if (modal.id && window.modals[modal.id]) window.modals[modal.id].close(); }, 120);
    };
    const modal = new Modal({ type: "custom", title: t("settings.backgroundImage") + " — " + t("settings.backgroundImage.pick"),
        html:
            `<div class="edex_bgpick">
                <div class="edex_bgpick_cur" id="edexbg_cur"></div>
                <div class="edex_bgpick_path">
                    <input type="text" id="edexbg_path" spellcheck="false" placeholder="type a path">
                    <button type="button" id="edexbg_go" class="settings_net_btn">GO</button>
                </div>
                <div id="edexbg_list" class="edex_bgpick_list"></div>
                <div class="edex_bgpick_hint">${t("settings.bg.pickHint")}</div>
             </div>`,
        buttons: [{ label: t("settings.backgroundImage.clear"), action: "window.bgClear()" }]
    }, () => { if (keyH) { document.removeEventListener("keydown", keyH, true); keyH = null; } });
    const listEl = () => document.getElementById("edexbg_list");
    const highlight = () => { const list = listEl(); if (!list) return; Array.from(list.children).forEach((el, i) => el.classList.toggle("edex_bgpick_active", i === cursor)); };
    const render = () => {
        const curEl = document.getElementById("edexbg_cur");
        const pathEl = document.getElementById("edexbg_path");
        if (curEl) curEl.textContent = (cwd === home ? "~" : cwd);
        if (pathEl) pathEl.value = cwd;
        const list = listEl(); if (!list) return;
        let names = [];
        try { names = fs.readdirSync(cwd, { withFileTypes: true }); } catch (e) { list.innerHTML = `<div class="edex_bgpick_hint">—</div>`; return; }
        const dirs = names.filter(d => d.isDirectory() && !d.name.startsWith(".")).map(d => d.name).sort();
        const imgs = names.filter(d => d.isFile() && isImg(d.name)).map(d => d.name).sort();
        list.innerHTML = ""; rows = []; cursor = 0;
        const addRow = (el, activate, name) => { el.addEventListener("click", activate); rows.push({ el, activate, name }); list.appendChild(el); };
        const up = document.createElement("div");
        up.className = "edex_bgpick_row edex_bgpick_up";
        up.innerHTML = `<span class="edex_bgpick_ic">↑</span> .. <span class="edex_bgpick_tag">parent</span>`;
        addRow(up, () => { cwd = path.dirname(cwd); render(); }, "..");
        dirs.forEach(d => {
            const r = document.createElement("div"); r.className = "edex_bgpick_row";
            r.innerHTML = `<span class="edex_bgpick_ic">▸</span> <span class="edex_bgpick_name">${d}</span> <span class="edex_bgpick_tag">dir</span>`;
            addRow(r, () => { cwd = path.join(cwd, d); render(); }, d);
        });
        imgs.forEach(f => {
            const r = document.createElement("div"); r.className = "edex_bgpick_row edex_bgpick_img";
            const url = require("url").pathToFileURL(path.join(cwd, f)).href;
            r.innerHTML = `<span class="edex_bgpick_ic"><span class="edex_bgpick_thumb" style="background-image:url(&quot;${url}&quot;)"></span></span> <span class="edex_bgpick_name">${f}</span>`;
            addRow(r, () => select(path.join(cwd, f), f), f);
        });
        highlight();
    };
    keyH = e => {
        if (!modal.id || !window.modals || !window.modals[modal.id]) return;
        if (e.target && e.target.tagName === "INPUT") return;      // leave the path input alone
        if (!rows.length) return;
        if (e.key === "ArrowDown")       { e.preventDefault(); e.stopPropagation(); cursor = (cursor + 1) % rows.length; highlight(); }
        else if (e.key === "ArrowUp")    { e.preventDefault(); e.stopPropagation(); cursor = (cursor - 1 + rows.length) % rows.length; highlight(); }
        else if (e.key === "Enter")      { e.preventDefault(); e.stopPropagation(); if (rows[cursor]) rows[cursor].activate(); }
        else if (e.key === "Backspace")  { e.preventDefault(); e.stopPropagation(); cwd = path.dirname(cwd); render(); }
    };
    render();
    document.addEventListener("keydown", keyH, true);
    const go = document.getElementById("edexbg_go");
    if (go) go.addEventListener("click", render);
};

window.bgPick = () => window.openBgPicker();

window.bgClear = () => {
    window._settingsBgValue = "";
    window.bgSetMode("theme");
    const st = document.getElementById("settingsBgStatus");
    if (st) st.textContent = t("settings.backgroundImage.none");
    const prev = document.getElementById("settingsBgPreview");
    if (prev) { prev.style.backgroundImage = ""; prev.classList.remove("show"); }
};

// The on-screen keyboard was replaced by the Cyber Panel - keep this callback
// harmless for any code that still triggers it (e.g. opening a layout file).
window.remakeKeyboard = layout => {
    require("electron").ipcRenderer.send("log", "note", "Keyboard layout is disabled (Cyber Panel is active).");
};

window.focusShellTab = number => {
    // The cover-session switch (screensaver / lock) must not play the tab
    // chime — window.screensaverSilent is set by the screensaver module while
    // covering, and cleared when the cover lifts (#50).
    if (!window.screensaverSilent) window.audioManager.folder.play();
    const kind = window.shellSlotKinds[number] || "term";

    // Toggle the tab-strip <li> active classes.
    document.querySelectorAll(`ul#main_shell_tabs > li:not(:nth-child(${number+1}))`).forEach(e => {
        e.setAttribute("class", "");
    });
    const shellTabEl = document.getElementById("shell_tab"+number);
    if (shellTabEl) shellTabEl.setAttribute("class", "active");

    // Toggle the content pane active class. The generic child selector covers
    // both the <pre> terminals and the <div> browser/webapp slots.
    document.querySelectorAll(`div#main_shell_innercontainer > *:not(:nth-child(${number+1}))`).forEach(e => {
        e.classList.remove("active");
    });
    const pane = document.querySelector(`div#main_shell_innercontainer > :nth-child(${number+1})`);
    if (pane) pane.classList.add("active");

    if (number === window.currentTerm) {
        // Re-clicking the active tab just re-focuses the panel.
        if (kind === "appmonitor") {
            const p = number === 3 ? window.appmonitorA : window.appmonitorB;
            if (p) p.activate();
        } else if (window.term[number]) window.term[number].term.focus();
        return;
    }

    window.currentTerm = number;

    if (kind === "appmonitor") {
        const p = number === 3 ? window.appmonitorA : window.appmonitorB;
        if (p) p.activate();
    } else if (window.term[number]) {
        window.term[number].fit();
        window.term[number].term.focus();
        window.term[number].resendCWD();

        window.fsDisp.followTab();
    } else if (number > 0 && number <= 4 && window.term[number] !== null && typeof window.term[number] !== "object") {
        window.term[number] = null;

        // Every lazy tab (1-4) is a plain terminal now — claude lives in the
        // CLI-app panels (tab 3/4), so tab 2 is no longer special (#57).
        document.getElementById("shell_tab"+number).innerHTML = "<p>LOADING...</p>";
        ipc.send("ttyspawn", "term");
        ipc.once("ttyspawn-reply", (e, r) => {
            if (r.startsWith("ERROR")) {
                document.getElementById("shell_tab"+number).innerHTML = "<p>ERROR</p>";
            } else if (r.startsWith("SUCCESS")) {
                let port = Number(r.substr(9));

                window.term[number] = new Terminal({
                    role: "client",
                    parentId: "terminal"+number,
                    port
                });

                window.term[number].onclose = e => {
                    delete window.term[number].onprocesschange;
                    document.getElementById("terminal"+number).innerHTML = "";
                    window.term[number].term.dispose();
                    delete window.term[number];
                    window.useAppShortcut("PREVIOUS_TAB");
                };

                window.term[number].onprocesschange = p => {
                    if (window.cover) window.cover.rememberProc(number, p);
                    document.getElementById("shell_tab"+number).innerHTML = `<p>${window.cover ? window.cover.tabLabel(number, p) : `#${number+1} - ${p}`}</p>`;
                };

                document.getElementById("shell_tab"+number).innerHTML = `<p>::${port}</p>`;
                setTimeout(() => {
                    window.focusShellTab(number);
                }, 500);
            }
        });
    }
};

// Settings editor
window.openSettings = async () => {
    if (document.getElementById("settingsEditor")) return;

    // Build the list of available themes (the only remaining dropdown that needs
    // a dynamic option list; monitor/iface rows were removed in the cleanup).
    let themes;
    fs.readdirSync(themesDir).forEach(th => {
        if (!th.endsWith(".json")) return;
        th = th.replace(".json", "");
        if (th === window.settings.theme) return;
        themes += `<option>${th}</option>`;
    });

    // A settings row: label + optional "i" info button (with a hidden help
    // popover) on the left, control on the right. The verbose descriptions used
    // to take a full table column; they are now hidden behind the "i" button.
    const settingsRow = (labelKey, controlHtml, helpKey) => `
        <div class="settings_row">
            <div class="settings_row_label">
                <span>${t(labelKey)}</span>
                ${helpKey ? `<button type="button" class="settings_info_btn" title="${t(helpKey)}">i</button>
                <div class="settings_info_pop">${t(helpKey)}</div>` : ""}
            </div>
            <div class="settings_row_ctl">${controlHtml}</div>
        </div>`;
    const section = key => `<div class="settingsEditor_section">${t(key)}</div>`;

    // Numeric settings use dropdowns (no range sliders in the HUD): one <option>
    // per step from min..max. `val` picks the current selection; `label` renders
    // the visible text (e.g. "70%" for the persisted value "0.7").
    const numOptions = (min, max, step, label, val) => {
        const cur = Number(val);
        const out = [];
        for (let v = min; v <= max + step / 2; v += step) {
            const key = String(Math.round(v * 100) / 100);
            const selected = isFinite(cur) && Math.abs(v - cur) < step / 2 ? " selected" : "";
            out.push(`<option value="${key}"${selected}>${label(v)}</option>`);
        }
        return out.join("");
    };

    // Two-pane categories. Every control lives in the DOM at all times (hidden
    // panes are display:none), so setupSettingsDropdowns converts all <select>s
    // exactly once and writeSettingsFile can read every field regardless of
    // which category is visible.
    const CATS = [
        // "通用" now groups the small system/UX categories (sound, display,
        // download, software sources, time) under one sidebar entry so the list
        // stays short. Each former category keeps its own section header.
        { id: "general", titleKey: "settings.cat.general", html: () => [
            section("settings.cat.general"),
            settingsRow("settings.lang.label", `<select id="settingsEditor-language">
                <option value="zh" ${window.settings.language === "zh" ? "selected" : ""}>中文</option>
                <option value="en" ${window.settings.language !== "zh" ? "selected" : ""}>English</option>
            </select>`),
            settingsRow("settings.username", `<input type="text" id="settingsEditor-username" value="${window.settings.username || ""}">`),
            settingsRow("settings.theme", `<select id="settingsEditor-theme">
                <option>${window.settings.theme}</option>
                ${themes}
            </select>`),
            settingsRow("settings.backgroundImage",
                `<div class="settings_bg_modes" id="settingsBgModes">
                     <button type="button" class="settings_bg_mode${(window.settings.backgroundMode || "theme") === "theme" ? " active" : ""}" data-mode="theme">${t("settings.bg.themeDefault")}</button>
                     <button type="button" class="settings_bg_mode${(window.settings.backgroundMode || "") === "dot" ? " active" : ""}" data-mode="dot">${t("settings.bg.dot")}</button>
                     <button type="button" class="settings_bg_mode${(window.settings.backgroundMode || "") === "contour" ? " active" : ""}" data-mode="contour">${t("settings.bg.contour")}</button>
                     <button type="button" class="settings_bg_mode${(window.settings.backgroundMode || "") === "city" ? " active" : ""}" data-mode="city">${t("settings.bg.city")}</button>
                     <button type="button" class="settings_bg_mode${(window.settings.backgroundMode || "") === "star" ? " active" : ""}" data-mode="star">${t("settings.bg.star")}</button>
                     <button type="button" class="settings_bg_mode${(window.settings.backgroundMode || "") === "coast" ? " active" : ""}" data-mode="coast">${t("settings.bg.coast")}</button>
                     <button type="button" class="settings_bg_mode${(window.settings.backgroundMode || "") === "image" ? " active" : ""}" data-mode="image">${t("settings.bg.image")}</button>
                 </div>
                 <div class="settings_bg_actions" id="settingsBgActions" style="display:${(window.settings.backgroundMode || "theme") === "image" ? "flex" : "none"}">
                     <button type="button" id="settingsBgPick" class="settings_net_btn">${t("settings.backgroundImage.pick")}</button>
                     <button type="button" id="settingsBgClear" class="settings_net_btn">${t("settings.backgroundImage.clear")}</button>
                 </div>
                 <div class="settings_bg_preview" id="settingsBgPreview"></div>
                 <div class="settings_bg_status" id="settingsBgStatus"></div>`,
                "settings.backgroundImage.help"),
            settingsRow("settings.termFontSize", `<input type="text" id="settingsEditor-termFontSize" value="${window.settings.termFontSize}">`),
            settingsRow("settings.showKeyboard", `<select id="settingsEditor-showKeyboard">
                <option>${window.settings.showKeyboard === true}</option>
                <option>${window.settings.showKeyboard !== true}</option>
            </select>`),
            section("settings.cat.terminal"),
            settingsRow("settings.terminalScrollSensitivity", `<input type="text" id="settingsEditor-terminalScrollSensitivity" value="${window.settings.terminalScrollSensitivity ?? 1}">`, "settings.terminalScrollSensitivity.help"),
            settingsRow("settings.terminalScrollDirection", `<select id="settingsEditor-terminalScrollDirection">
                <option value="normal" ${window.settings.terminalScrollDirection !== "reversed" ? "selected" : ""}>${t("settings.scrollDir.normal")}</option>
                <option value="reversed" ${window.settings.terminalScrollDirection === "reversed" ? "selected" : ""}>${t("settings.scrollDir.reversed")}</option>
            </select>`, "settings.terminalScrollDirection.help"),
            section("settings.cat.sources"),
            settingsRow("settings.sources.mirror", `<select id="settingsSrcMirror">
                <option value="official">${t("settings.sources.mirror.official")}</option>
                <option value="aliyun">${t("settings.sources.mirror.aliyun")}</option>
                <option value="tuna">${t("settings.sources.mirror.tuna")}</option>
                <option value="ustc">${t("settings.sources.mirror.ustc")}</option>
                <option value="163">${t("settings.sources.mirror.163")}</option>
                <option value="custom">${t("settings.sources.mirror.custom")}</option>
            </select>`, "settings.sources.mirror.help"),
            settingsRow("settings.sources.customUrl", `<input type="text" id="settingsSrcCustom" placeholder="http://mirrors.example.com/ubuntu">`, "settings.sources.customUrl.help"),
            settingsRow("settings.sources.apply", `<button type="button" id="settingsSrcApply" class="settings_net_btn">${t("settings.sources.apply")}</button>`, "settings.sources.apply.help"),
        ].join("") },
        { id: "av", titleKey: "settings.cat.av", html: () => [
            section("settings.cat.sound"),
            settingsRow("settings.audio", `<select id="settingsEditor-audio">
                <option>${window.settings.audio}</option>
                <option>${!window.settings.audio}</option>
            </select>`),
            settingsRow("settings.audioVolume", `<select id="settingsEditor-audioVolume">${numOptions(0, 1, 0.05, v => Math.round(v * 100) + "%", window.settings.audioVolume ?? 1)}</select>`),
            settingsRow("settings.disableFeedbackAudio", `<select id="settingsEditor-disableFeedbackAudio">
                <option>${window.settings.disableFeedbackAudio}</option>
                <option>${!window.settings.disableFeedbackAudio}</option>
            </select>`, "settings.disableFeedbackAudio.help"),
            settingsRow("settings.eventAudio", `<select id="settingsEditor-eventAudio">
                <option>${window.settings.eventAudio}</option>
                <option>${!window.settings.eventAudio}</option>
            </select>`, "settings.eventAudio.help"),
            settingsRow("settings.power.volume", `<select id="settingsPowerVolume">${numOptions(0, 100, 5, v => v + "%", 70)}</select>`, "settings.power.volume.help"),
            section("settings.cat.display"),
            settingsRow("settings.power.brightness", `<select id="settingsPowerBrightness">${numOptions(0, 100, 5, v => v + "%", 50)}</select>`, "settings.power.brightness.help"),
            settingsRow("settings.nointro", `<select id="settingsEditor-nointro">
                <option>${window.settings.nointro}</option>
                <option>${!window.settings.nointro}</option>
            </select>`),
            settingsRow("settings.nocursor", `<select id="settingsEditor-nocursor">
                <option>${window.settings.nocursor}</option>
                <option>${!window.settings.nocursor}</option>
            </select>`),
            settingsRow("settings.cursorAutoHide", `<select id="settingsEditor-cursorAutoHide">
                <option>${window.settings.cursorAutoHide !== false}</option>
                <option>${window.settings.cursorAutoHide === false}</option>
            </select>`),
            settingsRow("settings.cursorAutoHideDelay", `<input type="text" id="settingsEditor-cursorAutoHideDelay" value="${window.settings.cursorAutoHideDelay ?? 10}">`),
            settingsRow("settings.cursorSize", `<select id="settingsEditor-cursorSize">${numOptions(16, 64, 2, v => v + "px", window.settings.cursorSize ?? 28)}</select>`),
            settingsRow("settings.mouseWheelSpeed", `<select id="settingsEditor-mouseWheelSpeed">${numOptions(0.25, 4, 0.25, v => v + "×", window.settings.mouseWheelSpeed ?? 1)}</select>`),
            settingsRow("settings.cursorSpeed", `<select id="settingsEditor-cursorSpeed">${numOptions(0.25, 4, 0.25, v => v + "×", window.settings.cursorSpeed ?? 1)}</select>`),
        ].join("") },
        { id: "time", titleKey: "settings.cat.time", html: () => {
            const y0 = new Date().getFullYear();
            const yr = () => Array.from({ length: 11 }, (_, i) => y0 - 5 + i).map(y => `<option value="${y}">${y}</option>`).join("");
            const mo = () => Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}">${String(i + 1).padStart(2, "0")}</option>`).join("");
            const dd = () => Array.from({ length: 31 }, (_, i) => `<option value="${i + 1}">${String(i + 1).padStart(2, "0")}</option>`).join("");
            const hh = () => Array.from({ length: 24 }, (_, i) => `<option value="${i}">${String(i).padStart(2, "0")}</option>`).join("");
            const mm = () => Array.from({ length: 60 }, (_, i) => `<option value="${i}">${String(i).padStart(2, "0")}</option>`).join("");
            return [
                section("settings.cat.time"),
                settingsRow("settings.time.status", `<span id="settingsTimeStatus" class="settings_time_status">–</span>`),
                settingsRow("settings.clockHours", `<select id="settingsEditor-clockHours">
                    <option>${(window.settings.clockHours === 12) ? "12" : "24"}</option>
                    <option>${(window.settings.clockHours === 12) ? "24" : "12"}</option>
                </select>`),
                settingsRow("settings.time.ntp", `<select id="settingsTimeNtp">
                    <option value="1">${t("settings.time.ntp.on")}</option>
                    <option value="0">${t("settings.time.ntp.off")}</option>
                </select>`, "settings.time.ntp.help"),
                // The date/time pickers are plain selects → converted to the same
                // theme dropdowns as every other setting (no native calendar/clock
                // popups). Day options are clamped to the selected month by the
                // bindings below.
                settingsRow("settings.time.date", `<div class="settings_time_grp">
                    <select id="settingsTimeYear">${yr()}</select>
                    <select id="settingsTimeMonth">${mo()}</select>
                    <select id="settingsTimeDay">${dd()}</select>
                </div>`),
                settingsRow("settings.time.clock", `<div class="settings_time_grp">
                    <select id="settingsTimeHour">${hh()}</select>
                    <select id="settingsTimeMinute">${mm()}</select>
                </div>`),
                settingsRow("settings.time.apply", `<button type="button" id="settingsTimeApply" class="settings_time_btn">${t("settings.time.apply")}</button>`, "settings.time.apply.help"),
            ].join("");
        } },
        { id: "lock", titleKey: "settings.cat.lock", html: () => [
            section("settings.cat.lock"),
            settingsRow("settings.screensaverEnabled", `<select id="settingsEditor-screensaverEnabled">
                <option>${window.settings.screensaverEnabled}</option>
                <option>${!window.settings.screensaverEnabled}</option>
            </select>`),
            settingsRow("settings.screensaverIdle", `<input type="text" id="settingsEditor-screensaverIdle" value="${window.settings.screensaverIdle || 300}">`),
            settingsRow("settings.screenOffIdle", `<input type="text" id="settingsEditor-screenOffIdle" value="${window.settings.screenOffIdle || 1800}">`, "settings.screenOffIdle.help"),
            settingsRow("settings.screensaverStyle", `<select id="settingsEditor-screensaverStyle">
                <option>${window.settings.screensaverStyle || "code"}</option>
                <option>${(window.settings.screensaverStyle === "matrix") ? "code" : "matrix"}</option>
            </select>`),
            section("settings.section.lock"),
            settingsRow("settings.lockCode", `<input type="password" id="settingsEditor-lockCode" autocomplete="off" inputmode="numeric" maxlength="8" value="${window.settings.lockCode || '0000'}">`, "settings.lockCode.help"),
            settingsRow("settings.lockOnIdle", `<select id="settingsEditor-lockOnIdle">
                <option>${window.settings.lockOnIdle !== false}</option>
                <option>${window.settings.lockOnIdle === false}</option>
            </select>`, "settings.lockOnIdle.help"),
        ].join("") },
        { id: "apps", titleKey: "settings.cat.apps", html: () => [
            section("settings.cat.apps"),
            settingsRow("settings.appMonitor.showGui",
                `<select id="settingsEditor-showGui">
                    <option>${!!((window.settings.appMonitor || {}).showGui)}</option>
                    <option>${!((window.settings.appMonitor || {}).showGui)}</option>
                </select>`,
                "settings.appMonitor.showGui.help"),
            settingsRow("settings.appSort", `<select id="settingsEditor-appSort">
                <option value="name-asc" ${window.settings.appSort === "name-asc" ? "selected" : ""}>${t("settings.appSort.nameAsc")}</option>
                <option value="name-desc" ${window.settings.appSort === "name-desc" ? "selected" : ""}>${t("settings.appSort.nameDesc")}</option>
                <option value="install-asc" ${window.settings.appSort === "install-asc" ? "selected" : ""}>${t("settings.appSort.installAsc")}</option>
                <option value="install-desc" ${window.settings.appSort === "install-desc" ? "selected" : ""}>${t("settings.appSort.installDesc")}</option>
                <option value="freq-asc" ${window.settings.appSort === "freq-asc" ? "selected" : ""}>${t("settings.appSort.freqAsc")}</option>
                <option value="freq-desc" ${window.settings.appSort === "freq-desc" ? "selected" : ""}>${t("settings.appSort.freqDesc")}</option>
            </select>`),
            settingsRow("settings.hideDotfiles", `<select id="settingsEditor-hideDotfiles">
                <option>${window.settings.hideDotfiles}</option>
                <option>${!window.settings.hideDotfiles}</option>
            </select>`),
            settingsRow("settings.fsListView", `<select id="settingsEditor-fsListView">
                <option>${window.settings.fsListView}</option>
                <option>${!window.settings.fsListView}</option>
            </select>`),
            section("settings.cat.download"),
            settingsRow("settings.download.dir",
                `<div class="settings_net_pw"><input type="text" id="settingsDlDir" placeholder="~/Downloads"></div>`),
            settingsRow("settings.download.threads",
                `<div class="settings_net_pw"><input type="text" id="settingsDlThreads" inputmode="numeric" value="${(window.settings.downloadThreads || 6)}"></div>`,
                "settings.download.threads.help"),
            settingsRow("settings.download.url",
                `<div class="settings_net_pw"><input type="text" id="settingsDlUrl" placeholder="https://…"></div>
                <div class="settings_net_actions">
                    <button type="button" id="settingsDlAdd" class="settings_net_btn">${t("settings.download.add")}</button>
                    <button type="button" id="settingsDlApply" class="settings_net_btn">${t("settings.download.apply")}</button>
                </div>`),
            settingsRow("settings.download.tasks",
                `<div id="settingsDlTasks" class="settings_net_list" augmented-ui="bl-clip tr-clip exe"></div>`),
        ].join("") },
        { id: "network", titleKey: "settings.cat.network", html: () => {
            const netOnOff = (id, on) => `<select id="${id}">
                <option value="1" ${on ? "selected" : ""}>${t("settings.network.on")}</option>
                <option value="0" ${!on ? "selected" : ""}>${t("settings.network.off")}</option>
            </select>`;
            return [
                section("settings.network.eth"),
                settingsRow("settings.network.ethStatus", `<span id="settingsNetEthStatus" class="settings_net_status">–</span>`),
                settingsRow("settings.network.ethInfo", `<div id="settingsNetEthInfo" class="settings_net_info"></div>`, "settings.network.ethInfo.help"),
                settingsRow("settings.network.ethConnect", `<button type="button" id="settingsNetEthConnect" class="settings_net_btn">${t("settings.network.ethConnect")}</button>`),
                section("settings.network.wifi"),
                settingsRow("settings.network.wifiPower", netOnOff("settingsNetWifiPower", true), "settings.network.wifiPower.help"),
                settingsRow("settings.network.wifiStatus", `<span id="settingsNetWifiStatus" class="settings_net_status">–</span>`),
                settingsRow("settings.network.wifiInfo", `<div id="settingsNetWifiInfo" class="settings_net_info"></div>`, "settings.network.wifiInfo.help"),
                settingsRow("settings.network.wifiDisconnect", `<button type="button" id="settingsNetWifiDisconnect" class="settings_net_btn">${t("settings.network.btDisc")}</button>`),
                settingsRow("settings.network.available", `<button type="button" id="settingsNetWifiOpen" class="settings_net_btn">${t("settings.network.openWifi")}</button>`, "settings.network.available.help"),
                settingsRow("settings.network.proxy", `<div id="settingsNetProxy" class="settings_net_proxy">
                        <select id="settingsNetWifiProxyMethod">
                            <option value="auto">${t("settings.network.proxy.auto")}</option>
                            <option value="none">${t("settings.network.proxy.none")}</option>
                            <option value="manual">${t("settings.network.proxy.manual")}</option>
                        </select>
                        <input type="text" id="settingsNetWifiProxyHttp" placeholder="HTTP proxy">
                        <input type="text" id="settingsNetWifiProxyHttps" placeholder="HTTPS proxy">
                        <button type="button" id="settingsNetProxyApply" class="settings_net_btn">${t("settings.network.proxy.apply")}</button>
                    </div>`, "settings.network.proxy.help"),
                section("settings.network.bt"),
                settingsRow("settings.network.btPower", netOnOff("settingsNetBtPower", true), "settings.network.btPower.help"),
                settingsRow("settings.network.btStatus", `<span id="settingsNetBtStatus" class="settings_net_status">–</span>`),
                settingsRow("settings.network.btDevices", `<button type="button" id="settingsNetBtOpen" class="settings_net_btn">${t("settings.network.openBt")}</button>`, "settings.network.btDevices.help"),
                section("settings.cat.ssh"),
                settingsRow("settings.ssh.enabled", netOnOff("settingsSshEnabled", true), "settings.ssh.enabled.help"),
            ].join("");
        } },
        { id: "appmgr", titleKey: "settings.cat.appmgr", html: () => {
            // Fill the lists as soon as the settings modal is built. The modal is
            // rebuilt on every open (openSettings early-returns only while it is
            // already open), so this refresh also runs each time settings opens.
            setTimeout(() => { if (window.appManager) window.appManager.refresh(); }, 0);
            return [
                section("settings.cat.appmgr"),
                section("appmgr.install.title"),
                settingsRow("appmgr.search",
                    `<div class="settings_net_pw"><input type="text" id="appmgrSearchInput" placeholder="${t("appmgr.search.placeholder")}" onkeydown="if(event.key==='Enter'){event.preventDefault();window.appManager.searchFlathub();}"></div>
                    <div class="settings_net_actions">
                        <button type="button" id="appmgrSearchBtn" class="settings_net_btn" onclick="window.appManager.searchFlathub()">${t("appmgr.search")}</button>
                    </div>
                    <div id="appmgrSearchResults" class="settings_net_list" tabindex="0" augmented-ui="bl-clip tr-clip exe"></div>`),
                settingsRow("appmgr.local.title",
                    `<div class="settings_net_pw"><input type="text" id="appmgrLocalInput" placeholder="${t("appmgr.local.placeholder")}" onkeydown="if(event.key==='Enter'){event.preventDefault();window.appManager.installLocal();}"></div>
                    <div class="settings_net_actions">
                        <button type="button" id="appmgrLocalInstall" class="settings_net_btn" onclick="window.appManager.installLocal()">${t("appmgr.local.install")}</button>
                    </div>`),
                section("appmgr.installed.title"),
                settingsRow("appmgr.installed",
                    `<div id="appmgrInstalledList" class="settings_net_list" tabindex="0" augmented-ui="bl-clip tr-clip exe"></div>`),
            ].join("");
        } },
        { id: "clash", titleKey: "settings.cat.clash", html: () => {
            // Clash on/off is a persisted boolean (settings.clash.enabled), so it
            // uses true/false values like every other toggle (the dropdown renderer
            // shows TRUE/FALSE) rather than the network category's live 1/0.
            const clashBool = (id, on) => `<select id="${id}">
                <option value="true" ${on ? "selected" : ""}>${t("settings.network.on")}</option>
                <option value="false" ${!on ? "selected" : ""}>${t("settings.network.off")}</option>
            </select>`;
            return [
                section("settings.cat.clash"),
                settingsRow("settings.clash.enabled", clashBool("settingsClashEnabled", !!((window.settings.clash || {}).enabled)), "settings.clash.enabled.help"),
                settingsRow("settings.clash.status", `<span id="settingsClashStatus" class="settings_net_status">–</span>`),
                settingsRow("settings.clash.port", `<span id="settingsClashPort" class="settings_net_info">–</span>`),
                settingsRow("settings.clash.mode", `<select id="settingsClashMode">
                    <option value="rule">${t("settings.clash.mode.rule")}</option>
                    <option value="global">${t("settings.clash.mode.global")}</option>
                    <option value="direct">${t("settings.clash.mode.direct")}</option>
                </select>`, "settings.clash.mode.help"),
                settingsRow("settings.clash.controller", `<input type="text" id="settingsClashController" value="${(window.settings.clash || {}).controller || '127.0.0.1:9090'}">`, "settings.clash.controller.help"),
                settingsRow("settings.clash.secret", `<div class="settings_api_pw">
                    <input type="password" id="settingsClashSecret" autocomplete="off" value="${(window.settings.clash || {}).secret || ''}">
                    <button type="button" id="settingsClashSecretToggle" class="settings_pw_toggle" onclick="window.clash.toggleSecret()">${t("settings.clash.toggleSecret")}</button>
                </div>`, "settings.clash.secret.help"),
                settingsRow("settings.clash.subUrl", `<div class="settings_net_pw"><input type="text" id="settingsClashSubUrl" placeholder="https://…" value="${(window.settings.clash || {}).subUrl || ''}"></div>
                    <div class="settings_net_actions">
                        <button type="button" id="settingsClashSubFetch" class="settings_net_btn">${t("settings.clash.subFetch")}</button>
                        <button type="button" id="settingsClashStart" class="settings_net_btn">${t("settings.clash.start")}</button>
                        <button type="button" id="settingsClashStop" class="settings_net_btn">${t("settings.clash.stop")}</button>
                    </div>`, "settings.clash.subUrl.help"),
                settingsRow("settings.clash.groups", `<div id="settingsClashGroups" class="settings_net_list" augmented-ui="bl-clip tr-clip exe"></div>
                    <div class="settings_net_actions">
                        <button type="button" id="settingsClashGroupsRefresh" class="settings_net_btn">${t("settings.clash.groupsRefresh")}</button>
                    </div>`),
                settingsRow("settings.clash.rules", `<pre id="settingsClashRules" class="settings_net_log">–</pre>`, "settings.clash.rules.help"),
                settingsRow("settings.clash.configPath", `<span id="settingsClashConfigPath" class="settings_net_info">–</span>
                    <div class="settings_net_actions">
                        <button type="button" id="settingsClashImportFile" class="settings_net_btn">${t("settings.clash.importFile")}</button>
                    </div>`),
                settingsRow("settings.clash.transfer", `<select id="settingsClashTransfer">
                        <option value="true">${t("settings.network.on")}</option>
                        <option value="false" selected>${t("settings.network.off")}</option>
                    </select>
                    <div id="settingsClashTransferUrlWrap" style="display:none;margin-top:1vh;width:100%">
                        <span id="settingsClashTransferUrl" class="settings_net_info">–</span>
                    </div>`, "settings.clash.transfer.help"),
                settingsRow("settings.clash.log", `<pre id="settingsClashLog" class="settings_net_log">–</pre>`),
            ].join("");
        } },
        { id: "claude", titleKey: "settings.cat.claude", html: () => [
            section("settings.cat.claude"),
            settingsRow("settings.claude.enabled", `<select id="settingsEditor-claude-enabled">
                <option>${(window.settings.claude || {}).enabled}</option>
                <option>${!(window.settings.claude || {}).enabled}</option>
            </select>`, "settings.claude.enabled.help"),
            settingsRow("settings.claude.provider", `<select id="settingsEditor-claude-provider" onchange="window.sysCmd.applyClaudeProvider()">
                ${(window.CLAUDE_PROVIDERS || []).map(p => `<option value="${p.id}"${(window.settings.claude && window.settings.claude.provider === p.id) ? " selected" : ""}>${(window.settings.language === "zh") ? p.label : p.labelEn}</option>`).join("")}
            </select>`, "settings.claude.provider.help"),
            settingsRow("settings.claude.llmStatus", `<div class="settings_ver_row"><span id="settingsLlmStatus" class="settings_net_info">–</span></div>`, "settings.claude.llmStatus.help"),
            settingsRow("settings.claude.baseUrl", `<input type="text" id="settingsEditor-claude-baseUrl" value="${(window.settings.claude || {}).baseUrl || ''}">`, "settings.claude.baseUrl.help"),
            settingsRow("settings.claude.apiKey", `<div class="settings_api_pw">
                <input type="password" id="settingsEditor-claude-apiKey" autocomplete="off" value="${(window.settings.claude || {}).apiKey || ''}">
                <button type="button" id="settingsEditor-claude-apiKey-toggle" class="settings_pw_toggle" onclick="window.sysCmd.toggleClaudeKey()">SHOW</button>
            </div>`, "settings.claude.apiKey.help"),
            // Model fields are editable combo boxes: one text input holds the
            // real value (editable, so any model name can be typed) with a
            // dropdown arrow that lists the active provider's models for quick
            // picking. The list is (re)built when a provider is chosen; picking
            // fills the input, which stays editable afterwards.
            settingsRow("settings.claude.model", `<div class="settings_combobox">
                <input type="text" id="settingsEditor-claude-model" value="${(window.settings.claude || {}).model || ''}" placeholder="${t("settings.claude.modelPlaceholder")}" autocomplete="off">
                <button type="button" class="mod_loc_btn" title="${t("settings.claude.modelPlaceholder")}"></button>
                <div class="mod_loc_list"></div>
            </div>`, "settings.claude.model.help"),
            settingsRow("settings.claude.haikuModel", `<div class="settings_combobox">
                <input type="text" id="settingsEditor-claude-haikuModel" value="${(window.settings.claude || {}).haikuModel || ''}" placeholder="${t("settings.claude.modelPlaceholder")}" autocomplete="off">
                <button type="button" class="mod_loc_btn" title="${t("settings.claude.modelPlaceholder")}"></button>
                <div class="mod_loc_list"></div>
            </div>`, "settings.claude.haikuModel.help"),
            section("settings.section.claudeNote"),
            section("settings.section.aiChat"),
            settingsRow("settings.voice.micMode", `<select id="settingsEditor-voiceMicMode">
                <option value="input" ${(window.settings.voiceMicMode || "input") === "input" ? "selected" : ""}>${t("settings.voice.micMode.input")}</option>
                <option value="chat" ${(window.settings.voiceMicMode || "input") === "chat" ? "selected" : ""}>${t("settings.voice.micMode.chat")}</option>
            </select>`, "settings.voice.micMode.help"),
            settingsRow("settings.claude.aiWebSearch", `<select id="settingsEditor-claude-aiWebSearch">
                <option value="true" ${(window.settings.claude || {}).aiWebSearch !== false ? "selected" : ""}>${t("settings.claude.aiWebSearch.on")}</option>
                <option value="false" ${(window.settings.claude || {}).aiWebSearch === false ? "selected" : ""}>${t("settings.claude.aiWebSearch.off")}</option>
            </select>`, "settings.claude.aiWebSearch.help"),
            settingsRow("settings.ai.ttsStatus", `<div class="settings_ver_row"><span id="settingsAiTtsStatus" class="settings_net_info">–</span></div>`, "settings.ai.ttsStatus.help"),
            settingsRow("settings.ai.history", `<div class="settings_net_actions">
                    <button type="button" id="settingsAiHistoryOpen" class="settings_net_btn">${t("settings.ai.history.historyOpen")}</button>
                </div>`, "settings.ai.history.help"),
        ].join("") },
        { id: "updates", titleKey: "settings.cat.updates", html: () => [
            section("settings.section.updatesApp"),
            settingsRow("settings.updates.app", `<div class="settings_ver_row">
                    <span id="settingsUpAppVersion" class="settings_net_info">v${remote.app.getVersion()}</span>
                    <div class="settings_net_actions">
                        <button type="button" id="settingsUpAppCheck" class="settings_net_btn">${t("settings.updates.check")}</button>
                    </div>
                </div>`),
            section("settings.section.updatesSystem"),
            settingsRow("settings.updates.system", `<div class="settings_ver_row">
                    <span id="settingsUpSystemInfo" class="settings_net_info">–</span>
                    <div class="settings_net_actions">
                        <button type="button" id="settingsUpSystemBtn" class="settings_net_btn">${t("settings.updates.check")}</button>
                    </div>
                </div>`, "settings.updates.system.help"),
            settingsRow("settings.updates.lastUpdate", `<span id="settingsUpLastUpdate" class="settings_net_status">–</span>`),
            section("settings.section.updatesBundled"),
            settingsRow("settings.updates.clash", `<div class="settings_ver_row">
                    <span id="settingsUpClashVer" class="settings_net_info">–</span>
                    <div class="settings_net_actions">
                        <button type="button" id="settingsUpClashCheck" class="settings_net_btn">${t("settings.updates.check")}</button>
                    </div>
                </div>`),
            settingsRow("settings.updates.claude", `<span id="settingsUpClaudeVer" class="settings_net_info">–</span> <span class="settings_net_info">· ${t("settings.updates.auto")}</span>`),
            settingsRow("settings.updates.w3m", `<span id="settingsUpW3mVer" class="settings_net_info">–</span> <span class="settings_net_info">· ${t("settings.updates.apt")}</span>`),
            settingsRow("settings.updates.firefox", `<span id="settingsUpFirefoxVer" class="settings_net_info">–</span>`),
            settingsRow("settings.updates.btop", `<span id="settingsUpBtopVer" class="settings_net_info">–</span> <span class="settings_net_info">· ${t("settings.updates.apt")}</span>`),
            settingsRow("settings.updates.mail", `<span id="settingsUpAercVer" class="settings_net_info">–</span> <span class="settings_net_info">· ${t("settings.updates.apt")}</span>`),
        ].join("") },
        { id: "power", titleKey: "settings.cat.power", html: () => [
            section("settings.cat.power"),
            settingsRow("settings.power.mode", `<div class="settings_power_modes" id="settingsPowerModes">
                <button type="button" data-gov="powersave">${t("settings.power.powersave")}</button>
                <button type="button" data-gov="schedutil">${t("settings.power.schedutil")}</button>
                <button type="button" data-gov="performance">${t("settings.power.performance")}</button>
            </div>`, "settings.power.mode.help"),
            settingsRow("settings.power.freq", `<span id="settingsPowerReadout">–</span>`),
            settingsRow("settings.power.kbdBacklight", `<select id="settingsKbdBacklight">${numOptions(0, 2, 1, v => v === 0 ? t("settings.power.kbd.off") : v === 1 ? t("settings.power.kbd.low") : t("settings.power.kbd.high"), window.settings.kbdBacklight ?? 1)}</select>`),
            settingsRow("settings.power.touchpadTap", `<select id="settingsTouchpadTap">${numOptions(0, 1, 1, v => v === 1 ? t("settings.power.touchpad.on") : t("settings.power.touchpad.off"), window.settings.touchpadTap ?? 1)}</select>`, "settings.power.touchpadTap.help"),
        ].join("") },
    ];

    // #175: 英文系统隐藏「AI 助手」设置分类(语音输入/聊天/联网查询都只服务中文)。
    const cats = (window.settings.language || "en") === "en"
        ? CATS.filter(c => c.id !== "claude")
        : CATS;

    // Remember the language the editor was opened in, so a change can re-open
    // the dialog in the new language (see writeSettingsFile). Note: `new Modal`
    // returns the Modal INSTANCE (class constructors ignore `return this.id`),
    // so keep the instance and address window.modals via its `.id`.
    window._settingsOpenLang = window.settings.language;
    const settingsModal = new Modal({
        type: "custom",
        closeLabel: t("settings.close"),
        title: `${t("settings.title")} <i>(v${remote.app.getVersion()})</i>`,
        html: `<div id="settingsBody">
                    <div id="settingsSide">
                        ${cats.map((c, i) => `<button type="button" class="settings_cat_btn${i === 0 ? " active" : ""}" data-cat="${c.id}">
                            <span class="settings_cat_idx">${String(i + 1).padStart(2, "0")}</span>
                            <span class="settings_cat_name">${t(c.titleKey)}</span>
                        </button>`).join("")}
                    </div>
                    <div id="settingsEditor">
                        ${cats.map((c, i) => `<div class="settings_cat${i === 0 ? " active" : ""}" data-cat="${c.id}">${c.html()}</div>`).join("")}
                    </div>
                </div>
                <h6 id="settingsEditorStatus">${t("settings.loadedStatus")}</h6>`,
        buttons: [
            {label: t("settings.btn.save"), action: "window.eventPlay('settings_save');window.writeSettingsFile()"},
            {label: t("settings.btn.shortcuts"), action: "window.openShortcutsHelp()"},
            {label: t("settings.btn.restart"), action: "remote.app.relaunch();remote.app.quit();"}
        ]
    }, () => {
        // Modal closed: drop the key listener, then focus back on the term.
        if (window._settingsKeyHandler) {
            document.removeEventListener("keydown", window._settingsKeyHandler);
            window._settingsKeyHandler = null;
        }
        window.term[window.currentTerm].term.focus();
    });
    window._settingsModal = settingsModal;

    // Sidebar category switching: clicking a button shows its pane and hides the
    // others (the panes themselves stay in the DOM, see the CATS comment above).
    const activateCategory = btn => {
        const cat = btn.dataset.cat;
        document.querySelectorAll("#settingsSide .settings_cat_btn").forEach(b => b.classList.toggle("active", b === btn));
        document.querySelectorAll("#settingsEditor .settings_cat").forEach(p => p.classList.toggle("active", p.dataset.cat === cat));
    };
    document.querySelectorAll("#settingsSide .settings_cat_btn").forEach(btn => {
        btn.addEventListener("click", () => activateCategory(btn));
    });

    // "i" info buttons toggle their sibling help popover (bound once per page).
    if (!window._settingsInfoBound) {
        window._settingsInfoBound = true;
        document.addEventListener("click", e => {
            const btn = e.target.closest ? e.target.closest(".settings_info_btn") : null;
            if (btn) {
                const pop = btn.parentElement.querySelector(".settings_info_pop");
                if (pop) pop.classList.toggle("open");
            } else if (!(e.target.closest && e.target.closest(".settings_info_pop"))) {
                document.querySelectorAll("#settingsEditor .settings_info_pop.open").forEach(p => p.classList.remove("open"));
            }
        });
    }

    // The Modal class has no built-in Esc handling, so add our own keydown
    // listener (removed in the close callback above). ↑/↓ move the category
    // highlight, Enter opens it, Esc closes the dialog — but never hijack
    // arrows while an input/dropdown has focus.
    window._settingsKeyHandler = e => {
        const m = window._settingsModal;
        if (!m || !m.id || !window.modals[m.id]) return;
        if (e.key === "Escape") { e.preventDefault(); window.modals[m.id].close(); return; }
        const ae = document.activeElement;
        const editable = ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.tagName === "SELECT"
            || (ae.closest && ae.closest(".mod_loc_dd, .settings_dd")));
        if (editable && (e.key === "ArrowUp" || e.key === "ArrowDown")) return;
        if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            const btns = Array.from(document.querySelectorAll("#settingsSide .settings_cat_btn"));
            if (!btns.length) return;
            const cur = btns.indexOf(document.activeElement);
            const next = e.key === "ArrowDown"
                ? (cur < 0 ? 0 : (cur + 1) % btns.length)
                : (cur < 0 ? btns.length - 1 : (cur - 1 + btns.length) % btns.length);
            btns[next].focus();
        } else if (e.key === "Enter") {
            const btn = ae && ae.closest ? ae.closest(".settings_cat_btn") : null;
            if (btn) { e.preventDefault(); activateCategory(btn); }
        }
    };
    document.addEventListener("keydown", window._settingsKeyHandler);

    // Native <select> popups do not render well in this fullscreen HUD, so swap
    // them for theme-styled custom dropdowns once the modal is in the DOM. Focus
    // the active category button so the keyboard can drive the sidebar.
    setTimeout(() => {
        window.setupSettingsDropdowns();
        window.populatePowerControls();
        // The provider <select> is replaced by a custom dropdown (above); hook
        // its 'change' event here to auto-fill the URL + models. Fires from the
        // dropdown's list click via the change dispatch in setupSettingsDropdowns.
        const claudeProvider = document.getElementById("settingsEditor-claude-provider");
        if (claudeProvider) claudeProvider.addEventListener("change", () => window.sysCmd.applyClaudeProvider());
        // Same pattern for the showGui toggle: its <select> is replaced by the
        // custom dropdown (hidden input keeps the id), so an inline onchange on
        // the original select would be lost and showGui would never persist
        // (reverting to false on restart). Bind the real change listener here.
        const showGuiSel = document.getElementById("settingsEditor-showGui");
        if (showGuiSel) showGuiSel.addEventListener("change", () => window.showGui.apply());
        // The model combo boxes are bound here too (open/close, pick, keyboard).
        // Then re-sync everything from the saved provider (fill defaults only
        // where a field is still empty, so a saved custom model name is not
        // clobbered).
        if (window.setupSettingsComboboxes) window.setupSettingsComboboxes();
        if (window.sysCmd.applyClaudeProvider) window.sysCmd.applyClaudeProvider(false);
        if (window.sysCmd.refreshLlmStatus) window.sysCmd.refreshLlmStatus();
        // #151/#161 AI-chat category bindings: TTS status + the chat-history
        // popup (opened from settings; the log itself is a standalone modal).
        if (window.sysCmd.refreshAiTtsStatus) window.sysCmd.refreshAiTtsStatus();
        const bindAi = (id, fn) => {
            const el = document.getElementById(id);
            if (el) el.addEventListener("click", fn);
        };
        bindAi("settingsAiHistoryOpen", () => { if (window.aiHistoryPanel) window.aiHistoryPanel.open(); });
        // Clash category bindings: the enabled toggle is live (applies the
        // system proxy now AND persists so boot auto-start sees it); the action
        // buttons map straight onto window.clash; then pull current daemon state.
        const clashEnabled = document.getElementById("settingsClashEnabled");
        if (clashEnabled) clashEnabled.addEventListener("change", () => window.clash.applyEnabled());
        const bindClash = (id, fn) => {
            const el = document.getElementById(id);
            if (el) el.addEventListener("click", fn);
        };
        bindClash("settingsClashStart", () => window.clash.start());
        bindClash("settingsClashStop", () => window.clash.stop());
        bindClash("settingsClashSubFetch", () => window.clash.fetchSub());
        bindClash("settingsClashImportFile", () => window.clash.importFile());
        const clashTransfer = document.getElementById("settingsClashTransfer");
        if (clashTransfer) clashTransfer.addEventListener("change", () => window.clash.transferToggle());
        bindClash("settingsClashGroupsRefresh", () => { window.clash.refreshGroups(); window.clash.refreshRules(); });
        const clashMode = document.getElementById("settingsClashMode");
        if (clashMode) clashMode.addEventListener("change", () => window.clash.setMode());
        if (window.clash) window.clash.refreshStatus();
        // SSH toggle (in the network category): live apply + sync the switch to
        // the real service state (off by default on fresh installs).
        const sshEnabled = document.getElementById("settingsSshEnabled");
        if (sshEnabled) sshEnabled.addEventListener("change", () => window.ssh.applyEnabled());
        if (window.ssh) window.ssh.refreshStatus();
        // Custom desktop background (settings → 背景图片): pick opens a native
        // file dialog, clear resets to the theme background. Live preview while
        // the dialog is open; the path persists in settings.backgroundImage on
        // Save. Mirrors the theme dropdown's "apply on the spot" behaviour.
        const bindBg = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener("click", fn); };
        bindBg("settingsBgPick", () => window.bgPick());
        bindBg("settingsBgClear", () => window.bgClear());
        // Background-source mode buttons (主题默认 / 点阵 / 等高线·军事地图 / 图片).
        document.querySelectorAll("#settingsBgModes .settings_bg_mode").forEach(b => {
            if (b.dataset.bgBound) return;
            b.dataset.bgBound = "1";
            b.addEventListener("click", () => window.bgSetMode(b.dataset.mode));
        });
        // Initialise from the saved values: highlight the active mode, show/hide
        // the image actions, and set the preview/status line.
        const bgm = window.settings.backgroundMode || "theme";
        window._settingsBgMode = bgm;
        window._settingsBgValue = window.settings.backgroundImage || "";
        document.querySelectorAll("#settingsBgModes .settings_bg_mode").forEach(b => b.classList.toggle("active", b.dataset.mode === bgm));
        const bgActions = document.getElementById("settingsBgActions");
        if (bgActions) bgActions.style.display = bgm === "image" ? "flex" : "none";
        const bgStatus = document.getElementById("settingsBgStatus");
        const bgPrev = document.getElementById("settingsBgPreview");
        if (window.settings.backgroundImage) {
            if (bgStatus) bgStatus.textContent = window.settings.backgroundImage.split(/[\\/]/).pop();
            if (bgPrev) {
                try { bgPrev.style.backgroundImage = `url("${require("url").pathToFileURL(window.settings.backgroundImage).href}")`; } catch (e) {}
                bgPrev.classList.add("show");
            }
        } else {
            if (bgStatus) bgStatus.textContent = t("settings.backgroundImage.none");
            if (bgPrev) bgPrev.classList.remove("show");
        }
        // Updates category bindings: app check/update, apt system update,
        // mihomo check/update — then pull all the statuses once. Each check
        // button doubles as the update button once a newer version is known.
        const bindUpd = (id, fn) => {
            const el = document.getElementById(id);
            if (el) el.addEventListener("click", fn);
        };
        bindUpd("settingsUpAppCheck", () => {
            if (window.updates._appUpdatable) window.updates.updateApp();
            else window.updates.checkApp(true);
        });
        bindUpd("settingsUpSystemBtn", () => { window.eventPlay("apt_check"); window.updates.systemUpdate(); });
        bindUpd("settingsUpClashCheck", () => {
            if (window.updates._clashUpdatable) window.updates.updateClash();
            else window.updates.checkClashUpdate(true);
        });
        if (window.updates) window.updates.refresh();
        const active = document.querySelector("#settingsSide .settings_cat_btn.active");
        if (active) active.focus();
        // Lock passcode field: digits only, 4-8 characters. Fewer than 4 turns
        // the input border red and disables the Save button; at 8 digits another
        // keystroke is rejected with a red flash + shake and is not recorded.
        // Non-digit characters are dropped silently (typed or pasted) (#94).
        const lockInput = document.getElementById("settingsEditor-lockCode");
        if (lockInput) {
            const saveLabel = t("settings.btn.save");
            const findSaveBtn = () => {
                const m = window._settingsModal;
                if (!m || !m.id) return null;
                const el = document.getElementById("modal_" + m.id);
                if (!el) return null;
                return Array.from(el.querySelectorAll("button")).find(b => b.textContent.trim() === saveLabel) || null;
            };
            const updateLockState = () => {
                const len = lockInput.value.length;
                const valid = len >= 4 && len <= 8;
                lockInput.classList.toggle("settings_invalid", !valid);
                const btn = findSaveBtn();
                if (btn) {
                    btn.disabled = !valid;
                    btn.classList.toggle("settings_btn_disabled", !valid);
                }
            };
            const shakeInvalid = () => {
                lockInput.classList.add("settings_invalid");
                lockInput.classList.remove("settings_shake");
                void lockInput.offsetWidth; // restart the animation
                lockInput.classList.add("settings_shake");
                setTimeout(() => {
                    lockInput.classList.remove("settings_shake");
                    updateLockState();
                }, 430);
            };
            lockInput.addEventListener("keydown", e => {
                // Keep copy/paste/select-all (and other shortcuts) working.
                if (e.ctrlKey || e.metaKey || e.altKey) return;
                if (e.key.length === 1 && !/^[0-9]$/.test(e.key)) { e.preventDefault(); return; }
                if (/^[0-9]$/.test(e.key) && lockInput.value.length >= 8) { e.preventDefault(); shakeInvalid(); return; }
            });
            lockInput.addEventListener("input", () => {
                const clean = lockInput.value.replace(/[^0-9]/g, "");
                if (clean !== lockInput.value) lockInput.value = clean;
                if (lockInput.value.length > 8) lockInput.value = lockInput.value.slice(0, 8);
                updateLockState();
            });
            lockInput.addEventListener("blur", () => updateLockState());
            updateLockState();
        }
        // Screen-off timeout must stay at or above the screensaver timeout —
        // flag the field red while it violates that (the saved value is still
        // clamped up to the screensaver value on save).
        const screenOffInput = document.getElementById("settingsEditor-screenOffIdle");
        const screensaverIdleInput = document.getElementById("settingsEditor-screensaverIdle");
        const checkScreenOff = () => {
            const so = Number(screenOffInput ? screenOffInput.value : 0);
            const sv = Number(screensaverIdleInput ? screensaverIdleInput.value : 300);
            if (screenOffInput) screenOffInput.classList.toggle("settings_invalid", !(so >= sv));
        };
        if (screenOffInput) {
            screenOffInput.addEventListener("input", checkScreenOff);
            if (screensaverIdleInput) screensaverIdleInput.addEventListener("input", checkScreenOff);
            checkScreenOff();
        }
    }, 50);
};

// Convert every native <select> in the settings editor into a theme-styled
// custom dropdown. A hidden <input> keeps the original id and current value, so
// the save code that reads `document.getElementById("settingsEditor-X").value`
// keeps working unchanged.
// Embedded performance controller (#37): fill the 省电/平衡/性能 buttons with
// the CPU's actual available governors, highlight the active one, and apply
// the choice on click. Persists the mode so the next boot re-applies it.
window.populatePowerControls = () => {
    const wrap = document.getElementById("settingsPowerModes");
    const readout = document.getElementById("settingsPowerReadout");
    if (!wrap) return;
    const setActive = current => {
        wrap.querySelectorAll("button[data-gov]").forEach(b => {
            b.classList.toggle("active", b.dataset.gov === current);
        });
    };
    ipc.invoke("power:governor").then(info => {
        if (!info || !info.ok) return;
        if (readout) readout.textContent = info.freqMHz != null ? info.freqMHz + " MHz" : "–";
        const avail = info.available || [];
        wrap.querySelectorAll("button[data-gov]").forEach(b => {
            b.style.display = avail.includes(b.dataset.gov) ? "" : "none";
        });
        setActive(info.current);
        wrap.onclick = e => {
            const btn = e.target.closest ? e.target.closest("button[data-gov]") : null;
            if (!btn) return;
            setActive(btn.dataset.gov);
            ipc.invoke("power:governor", { governor: btn.dataset.gov }).then(r => {
                if (r && r.freqMHz != null && readout) readout.textContent = r.freqMHz + " MHz";
            });
            window.settings.performanceMode = btn.dataset.gov;
            if (typeof window.writeSettingsFile === "function") window.writeSettingsFile();
        };
    }).catch(() => {});

    // Brightness + volume dropdowns (immediate system effect, debounced). The
    // selects were already converted to .settings_dd dropdowns by
    // setupSettingsDropdowns, so `el` is the hidden input that holds the value;
    // apply on option click, and sync the visible selection from the system.
    const slider = (id, invoke) => {
        const el = document.getElementById(id);
        if (!el) return;
        const wrap = el.closest ? el.closest(".settings_dd") : null;
        let debounce = null;
        const apply = val => {
            if (debounce) clearTimeout(debounce);
            debounce = setTimeout(() => ipc.invoke(invoke, { set: val }).catch(() => {}), 120);
        };
        if (wrap) {
            // Capture phase: the list's own click handler calls stopPropagation()
            // before a bubble-phase listener on wrap would run. Read the clicked
            // option's value directly so apply() sees the NEW selection (the list
            // handler's setValue() runs after this, in bubble phase).
            wrap.addEventListener("click", e => {
                const opt = e.target.closest ? e.target.closest(".mod_loc_opt") : null;
                if (!opt) return;
                apply(Number(opt.dataset.value));
            }, true);
            ipc.invoke(invoke).then(r => {
                if (!r || !r.ok || r.percent == null) return;
                const v = String(Math.round(r.percent / 5) * 5);
                el.value = v;
                wrap.querySelectorAll(".mod_loc_opt").forEach(o =>
                    o.classList.toggle("mod_loc_opt_active", o.dataset.value === v));
                const btn = wrap.querySelector(".mod_loc_btn");
                const cur = wrap.querySelector(".mod_loc_opt_active");
                if (btn && cur) btn.textContent = cur.textContent;
            }).catch(() => {});
        }
    };
    slider("settingsPowerBrightness", "power:brightness");
    slider("settingsPowerVolume", "power:volume");

    // Discrete-state dropdowns (keyboard backlight 0..2, touchpad tap on/off).
    // Same immediate-effect + debounce + visible-sync shape as slider(), but the
    // values are real state integers (0..max), not percentages.
    const stateSlider = (id, invoke, max) => {
        const el = document.getElementById(id);
        if (!el) return;
        const wrap = el.closest ? el.closest(".settings_dd") : null;
        let debounce = null;
        const apply = val => {
            if (debounce) clearTimeout(debounce);
            debounce = setTimeout(() => ipc.invoke(invoke, { set: val }).catch(() => {}), 120);
        };
        if (wrap) {
            wrap.addEventListener("click", e => {
                const opt = e.target.closest ? e.target.closest(".mod_loc_opt") : null;
                if (!opt) return;
                apply(Number(opt.dataset.value));
            }, true);
            ipc.invoke(invoke).then(r => {
                if (!r || !r.ok || r.level == null) return;
                const v = String(Math.max(0, Math.min(max, Math.round(r.level))));
                el.value = v;
                wrap.querySelectorAll(".mod_loc_opt").forEach(o =>
                    o.classList.toggle("mod_loc_opt_active", o.dataset.value === v));
                const btn = wrap.querySelector(".mod_loc_btn");
                const cur = wrap.querySelector(".mod_loc_opt_active");
                if (btn && cur) btn.textContent = cur.textContent;
            }).catch(() => {});
        }
    };
    stateSlider("settingsKbdBacklight", "kbd:backlight", 2);
    stateSlider("settingsTouchpadTap", "touchpad:tap", 1);

    // Time & Date (#14): NTP sync toggle + manual date/time apply. On open the
    // status row, the NTP dropdown and the date/time dropdowns are filled from
    // `time:get` (live system state, not a persisted setting); the dropdowns and
    // the Apply button push back through `time:set`. Toggling NTP and setting
    // the time are both immediate system effects, so nothing needs
    // writeSettingsFile.
    const timeStatus = document.getElementById("settingsTimeStatus");
    const timeNtp = document.getElementById("settingsTimeNtp");
    const timeYear = document.getElementById("settingsTimeYear");
    const timeMonth = document.getElementById("settingsTimeMonth");
    const timeDay = document.getElementById("settingsTimeDay");
    const timeHour = document.getElementById("settingsTimeHour");
    const timeMinute = document.getElementById("settingsTimeMinute");
    const timeApply = document.getElementById("settingsTimeApply");
    const pad2 = n => String(n).padStart(2, "0");

    const notify = msg => {
        if (window.appmonitorA && typeof window.appmonitorA._notify === "function") {
            window.appmonitorA._notify(msg);
            return;
        }
        // Fallback: create the shared toast element ourselves when the app-monitor
        // panels are not ready yet (mirrors the battery notifyToast pattern).
        let t = document.getElementById("edex_toast");
        if (!t) {
            t = document.createElement("div");
            t.id = "edex_toast";
            t.className = "browser_toast";
            document.body.appendChild(t);
        }
        t.textContent = msg;
        t.classList.add("show");
        clearTimeout(notify._timer);
        notify._timer = setTimeout(() => t.classList.remove("show"), 2200);
    };
    // Set a converted .settings_dd dropdown's hidden value + visible selection.
    const setDd = (el, value) => {
        if (!el) return;
        el.value = String(value);
        const wrap = el.closest ? el.closest(".settings_dd") : null;
        if (!wrap) return;
        wrap.querySelectorAll(".mod_loc_opt").forEach(o =>
            o.classList.toggle("mod_loc_opt_active", o.dataset.value === String(value)));
        const btn = wrap.querySelector(".mod_loc_btn");
        const active = wrap.querySelector(".mod_loc_opt_active");
        if (btn && active) btn.textContent = active.textContent;
    };
    // Rebuild a converted dropdown's option list (used to clamp the day list to
    // the selected month's length). options: [{value, text}].
    const rebuildDd = (el, options, value) => {
        if (!el) return;
        el.value = String(value);
        const wrap = el.closest ? el.closest(".settings_dd") : null;
        if (!wrap) return;
        const list = wrap.querySelector(".mod_loc_list");
        if (!list) return;
        list.innerHTML = "";
        options.forEach(o => {
            const d = document.createElement("div");
            d.className = "mod_loc_opt" + (String(o.value) === String(value) ? " mod_loc_opt_active" : "");
            d.dataset.value = String(o.value);
            d.textContent = o.text;
            list.appendChild(d);
        });
        const btn = wrap.querySelector(".mod_loc_btn");
        const active = list.querySelector(".mod_loc_opt_active");
        if (btn && active) btn.textContent = active.textContent;
    };
    const daysInMonth = (y, m) => new Date(y, m, 0).getDate(); // m is 1..12
    const clampDay = () => {
        const y = Number(timeYear && timeYear.value) || new Date().getFullYear();
        const m = Number(timeMonth && timeMonth.value) || 1;
        const max = daysInMonth(y, m);
        const cur = Math.min(Number(timeDay && timeDay.value) || 1, max);
        rebuildDd(timeDay, Array.from({ length: max }, (_, i) => ({ value: i + 1, text: pad2(i + 1) })), cur);
    };
    // Sync the visible NTP dropdown selection (bool state stored as "1"/"0", so
    // the dropdown keeps its 开/关 text — a bool-valued select would render as
    // TRUE/FALSE via setupSettingsDropdowns).
    const syncNtpVisible = on => {
        if (!timeNtp) return;
        setDd(timeNtp, on ? "1" : "0");
    };
    const refreshTime = () => {
        ipc.invoke("time:get").then(r => {
            if (!r || !r.ok) {
                if (timeStatus) timeStatus.textContent = "–";
                return;
            }
            if (timeStatus) timeStatus.textContent = (r.local || "") + (r.timezone ? " · " + r.timezone : "");
            if (r.date && /^\d{4}-\d{2}-\d{2}$/.test(r.date)) {
                setDd(timeYear, String(Number(r.date.slice(0, 4))));
                setDd(timeMonth, String(Number(r.date.slice(5, 7))));
                setDd(timeDay, String(Number(r.date.slice(8, 10))));
            }
            if (r.clock && /^\d{2}:\d{2}$/.test(r.clock)) {
                setDd(timeHour, String(Number(r.clock.slice(0, 2))));
                setDd(timeMinute, String(Number(r.clock.slice(3, 5))));
            }
            if (r.ntp != null) syncNtpVisible(r.ntp);
        }).catch(() => {});
    };
    if (timeNtp) {
        const wrap = timeNtp.closest ? timeNtp.closest(".settings_dd") : null;
        if (wrap) {
            wrap.addEventListener("click", e => {
                const opt = e.target.closest ? e.target.closest(".mod_loc_opt") : null;
                if (!opt) return;
                const on = opt.dataset.value === "1";
                ipc.invoke("time:set", { ntp: on }).then(r => {
                    if (!r || !r.ok) { refreshTime(); return; }
                    syncNtpVisible(on);
                    notify(on ? t("settings.time.ntp.notifyOn") : t("settings.time.ntp.notifyOff"));
                }).catch(() => {});
            }, true);
        }
    }
    // Changing the year or month re-clamps the day dropdown to that month's real
    // number of days (Feb → 28/29), so an impossible date can never be sent.
    [timeYear, timeMonth].forEach(el => {
        if (!el) return;
        const wrap = el.closest ? el.closest(".settings_dd") : null;
        if (!wrap) return;
        wrap.addEventListener("click", e => {
            const opt = e.target.closest ? e.target.closest(".mod_loc_opt") : null;
            if (!opt) return;
            setDd(el, opt.dataset.value);
            clampDay();
        }, true);
    });
    if (timeApply) {
        timeApply.addEventListener("click", () => {
            const y = Number(timeYear && timeYear.value), m = Number(timeMonth && timeMonth.value);
            const d = Number(timeDay && timeDay.value), h = Number(timeHour && timeHour.value);
            const mi = Number(timeMinute && timeMinute.value);
            const dt = new Date(y, m - 1, d, h, mi, 0);
            if (!Number.isFinite(y + m + d + h + mi) ||
                dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d ||
                h < 0 || h > 23 || mi < 0 || mi > 59) {
                notify(t("settings.time.invalid"));
                return;
            }
            const dateStr = y + "-" + pad2(m) + "-" + pad2(d);
            const timeStr = pad2(h) + ":" + pad2(mi);
            ipc.invoke("time:set", { date: dateStr, time: timeStr }).then(r => {
                notify(r && r.ok ? t("settings.time.applied") : t("settings.time.failed"));
                // Manual time and NTP are mutually exclusive: a successful set
                // also disables the sync in the back-end, so flip the dropdown
                // to OFF right away (refreshTime would read it back on Linux;
                // this covers the preview and keeps the two controls in sync).
                if (r && r.ok) syncNtpVisible(false);
                refreshTime();
            }).catch(() => {});
        });
    }
    refreshTime();

    // ---- Network category: WiFi (macOS-style: radio, status, IP/router/DNS
    // info, available list, saved list + auto-join, proxy) and Bluetooth
    // (power, device list, pair/connect/disconnect/forget). All live system
    // state over IPC; none of it is persisted to settings.json. ----
    const netWifiPower = document.getElementById("settingsNetWifiPower");
    const netWifiStatus = document.getElementById("settingsNetWifiStatus");
    const netWifiInfo = document.getElementById("settingsNetWifiInfo");
    const netWifiList = document.getElementById("settingsNetWifiList");
    const netWifiPassword = document.getElementById("settingsNetWifiPassword");
    const netWifiSaved = document.getElementById("settingsNetWifiSaved");
    const netBtPower = document.getElementById("settingsNetBtPower");
    const netBtStatus = document.getElementById("settingsNetBtStatus");
    const netBtList = document.getElementById("settingsNetBtList");
    const netSelected = { value: "" };
    const ddWrap = el => (el && el.closest ? el.closest(".settings_dd") : null);
    const escHtml = s => String(s == null ? "" : s).replace(/[<>&"]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));

    const renderWifiList = networks => {
        if (!netWifiList) return;
        if (!networks.length) { netWifiList.innerHTML = "<div class='settings_net_empty'>" + t("settings.network.empty") + "</div>"; return; }
        netWifiList.innerHTML = networks.map(n => {
            const bars = n.signal >= 75 ? "▅▅▅" : n.signal >= 50 ? "▅▅▂" : n.signal >= 25 ? "▅▂▂" : "▂▂▂";
            const sel = netSelected.value === n.ssid;
            return `<button type="button" class="settings_net_row${sel ? " selected" : ""}" data-ssid="${escHtml(n.ssid)}">
                <span class="settings_net_bars">${bars}</span>
                <span class="settings_net_name">${escHtml(n.ssid)}</span>
                ${n.security ? "<span class='settings_net_lock'>◆</span>" : ""}
            </button>`;
        }).join("");
        netWifiList.querySelectorAll(".settings_net_row").forEach(row => {
            row.addEventListener("click", () => {
                netSelected.value = row.dataset.ssid;
                netWifiList.querySelectorAll(".settings_net_row").forEach(r => r.classList.toggle("selected", r === row));
                if (netWifiPassword) { netWifiPassword.value = ""; netWifiPassword.placeholder = t("settings.network.pwPh") + " — " + row.dataset.ssid; }
            });
        });
    };
    const renderWifiSaved = saved => {
        if (!netWifiSaved) return;
        if (!saved.length) { netWifiSaved.innerHTML = "<div class='settings_net_empty'>" + t("settings.network.empty") + "</div>"; return; }
        netWifiSaved.innerHTML = saved.map(s => `
            <div class="settings_net_saved">
                <span class="settings_net_name">${escHtml(s.name)}</span>
                <button type="button" class="settings_net_btn settings_net_mini" data-act="auto" data-name="${escHtml(s.name)}">${s.autoconnect ? t("settings.network.autoOn") : t("settings.network.autoOff")}</button>
                <button type="button" class="settings_net_btn settings_net_mini" data-act="forget" data-name="${escHtml(s.name)}">${t("settings.network.forget")}</button>
            </div>`).join("");
        netWifiSaved.querySelectorAll("button[data-act]").forEach(btn => {
            btn.addEventListener("click", () => {
                const name = btn.dataset.name;
                if (btn.dataset.act === "forget") {
                    ipc.invoke("wifi:forget", { name }).then(r => {
                        notify(r && r.ok ? t("settings.network.forgot") + " " + name : t("settings.network.failed"));
                        refreshWifi();
                    }).catch(() => {});
                } else {
                    const cur = (saved.find(s => s.name === name) || {}).autoconnect;
                    ipc.invoke("wifi:set-autoconnect", { name, auto: !cur }).then(r => {
                        notify(r && r.ok ? t("settings.network.autoSet") : t("settings.network.failed"));
                        refreshWifi();
                    }).catch(() => {});
                }
            });
        });
    };
    const refreshWifi = () => {
        ipc.invoke("wifi:status").then(r => {
            if (!r || !r.ok) { if (netWifiStatus) netWifiStatus.textContent = t("settings.network.unavail"); return; }
            if (netWifiStatus) netWifiStatus.textContent = r.connected
                ? t("settings.network.connectedTo") + " " + (r.ssid || "")
                : t("settings.network.notConnected");
        }).catch(() => {});
        ipc.invoke("wifi:detail").then(r => {
            if (!netWifiInfo) return;
            if (r && r.ok && r.connected) {
                const parts = ["IP " + (r.ip || "–")];
                if (r.gateway) parts.push(t("settings.network.router") + " " + r.gateway);
                if (r.mask) parts.push(t("settings.network.mask") + " " + r.mask);
                if (r.dns && r.dns.length) parts.push("DNS " + r.dns.join(", "));
                netWifiInfo.textContent = parts.join(" · ");
            } else {
                netWifiInfo.textContent = "";
            }
        }).catch(() => {});
        ipc.invoke("wifi:list").then(r => { if (r && r.ok) renderWifiList(r.networks || []); }).catch(() => {});
        ipc.invoke("wifi:saved").then(r => { if (r && r.ok) renderWifiSaved(r.saved || []); }).catch(() => {});
    };
    // WiFi / Bluetooth list rows were replaced by "open panel" buttons — the
    // old list elements are gone, so refreshWifi/renderWifiList/renderWifiSaved
    // all hit their `if (!container) return` guards and become no-ops.
    const netWifiOpen = document.getElementById("settingsNetWifiOpen");
    if (netWifiOpen) netWifiOpen.addEventListener("click", () => { if (window.wifiPanel) window.wifiPanel.open(); });
    const netBtOpen = document.getElementById("settingsNetBtOpen");
    if (netBtOpen) netBtOpen.addEventListener("click", () => { if (window.btPanel) window.btPanel.open(); });
    if (netWifiPower) {
        const w = ddWrap(netWifiPower);
        if (w) {
            w.addEventListener("click", e => {
                const opt = e.target.closest ? e.target.closest(".mod_loc_opt") : null;
                if (!opt) return;
                const on = opt.dataset.value === "1";
                ipc.invoke("wifi:radio", on).then(r => {
                    notify(r && r.ok ? (on ? t("settings.network.wifiOn") : t("settings.network.wifiOff")) : t("settings.network.failed"));
                    refreshWifi();
                }).catch(() => {});
            }, true);
        }
        ipc.invoke("wifi:radio").then(r => { if (r && r.ok) setDd(netWifiPower, r.enabled ? "1" : "0"); }).catch(() => {});
    }
    const netWifiConnect = document.getElementById("settingsNetWifiConnect");
    if (netWifiConnect) netWifiConnect.addEventListener("click", () => {
        if (!netSelected.value) { notify(t("settings.network.pickFirst")); return; }
        const password = netWifiPassword ? netWifiPassword.value : "";
        netWifiConnect.disabled = true;
        ipc.invoke("wifi:connect", { ssid: netSelected.value, password }).then(r => {
            netWifiConnect.disabled = false;
            notify(r && r.ok ? t("settings.network.connected") + " " + netSelected.value
                             : t("settings.network.failed") + (r && r.error ? " — " + r.error : ""));
            refreshWifi();
        }).catch(() => { netWifiConnect.disabled = false; });
    });
    const netWifiScan = document.getElementById("settingsNetWifiScan");
    if (netWifiScan) netWifiScan.addEventListener("click", () => { if (netWifiList) netWifiList.innerHTML = "<div class='settings_net_empty'>…</div>"; refreshWifi(); });
    const netWifiDisc = document.getElementById("settingsNetWifiDisconnect");
    if (netWifiDisc) netWifiDisc.addEventListener("click", () => {
        ipc.invoke("wifi:disconnect").then(r => {
            notify(r && r.ok ? t("settings.network.disconnected") : t("settings.network.failed"));
            refreshWifi();
        }).catch(() => {});
    });
    // Wired / ethernet: device state + IP/router/DNS info + connect/disconnect
    // toggle. eth:status is a single call (macOS preview returns mock data).
    const netEthStatus = document.getElementById("settingsNetEthStatus");
    const netEthInfo = document.getElementById("settingsNetEthInfo");
    const netEthConnect = document.getElementById("settingsNetEthConnect");
    let netEthDevice = null, netEthConnected = false;
    const refreshEth = () => {
        if (!netEthStatus) return;
        ipc.invoke("eth:status").then(r => {
            if (!r || !r.ok || !r.device) {
                netEthDevice = null; netEthConnected = false;
                netEthStatus.textContent = t("settings.network.ethUnavail");
                if (netEthInfo) netEthInfo.textContent = "";
                return;
            }
            netEthDevice = r.device;
            netEthConnected = r.state === "connected";
            netEthStatus.textContent = r.device + " — " + (netEthConnected
                ? t("settings.network.ethConnected")
                : r.state === "disconnected" ? t("settings.network.ethOffline") : r.state);
            if (netEthInfo) {
                if (netEthConnected) {
                    const parts = [];
                    if (r.ip) parts.push("IP " + r.ip);
                    if (r.gateway) parts.push(t("settings.network.router") + " " + r.gateway);
                    if (r.dns && r.dns.length) parts.push("DNS " + r.dns.join(", "));
                    netEthInfo.textContent = parts.join(" · ");
                } else {
                    netEthInfo.textContent = "";
                }
            }
            if (netEthConnect) {
                netEthConnect.textContent = netEthConnected ? t("settings.network.ethDisc") : t("settings.network.ethConnect");
                netEthConnect.disabled = false;
            }
        }).catch(() => {});
    };
    if (netEthConnect) netEthConnect.addEventListener("click", () => {
        if (!netEthDevice) { refreshEth(); return; }
        netEthConnect.disabled = true;
        ipc.invoke(netEthConnected ? "eth:disconnect" : "eth:connect", { device: netEthDevice }).then(r => {
            netEthConnect.disabled = false;
            notify(r && r.ok ? t("settings.network.btDone")
                             : t("settings.network.failed") + (r && r.error ? " — " + r.error : ""));
            refreshEth();
        }).catch(() => { netEthConnect.disabled = false; });
    });
    if (netEthStatus) refreshEth();
    // Proxy of the active connection (auto / none / manual + HTTP/HTTPS).
    const netProxyMethod = document.getElementById("settingsNetWifiProxyMethod");
    const netProxyHttp = document.getElementById("settingsNetWifiProxyHttp");
    const netProxyHttps = document.getElementById("settingsNetWifiProxyHttps");
    ipc.invoke("wifi:proxy").then(r => {
        if (!r || !r.ok) return;
        if (netProxyMethod) setDd(netProxyMethod, r.method || "auto");
        if (netProxyHttp) netProxyHttp.value = r.http || "";
        if (netProxyHttps) netProxyHttps.value = r.https || "";
    }).catch(() => {});
    const netProxyApply = document.getElementById("settingsNetProxyApply");
    if (netProxyApply) netProxyApply.addEventListener("click", () => {
        ipc.invoke("wifi:proxy", { method: netProxyMethod ? netProxyMethod.value : "auto",
                                   http: netProxyHttp ? netProxyHttp.value : "",
                                   https: netProxyHttps ? netProxyHttps.value : "" }).then(r => {
            notify(r && r.ok ? t("settings.network.proxyApplied") : t("settings.network.failed"));
        }).catch(() => {});
    });

    // ---- Bluetooth ----
    const renderBtList = devices => {
        if (!netBtList) return;
        if (!devices.length) { netBtList.innerHTML = "<div class='settings_net_empty'>" + t("settings.network.btEmpty") + "</div>"; return; }
        netBtList.innerHTML = devices.map(d => {
            const badge = d.connected ? " · " + t("settings.network.btConnected") : d.paired ? " · " + t("settings.network.btPaired") : "";
            let btns = "";
            if (d.connected) {
                btns = `<button type="button" class="settings_net_btn settings_net_mini" data-bt="disc" data-addr="${d.address}">${t("settings.network.btDisc")}</button>`;
            } else {
                if (!d.paired) btns += `<button type="button" class="settings_net_btn settings_net_mini" data-bt="pair" data-addr="${d.address}">${t("settings.network.btPair")}</button>`;
                btns += `<button type="button" class="settings_net_btn settings_net_mini" data-bt="conn" data-addr="${d.address}">${t("settings.network.btConn")}</button>`;
            }
            btns += `<button type="button" class="settings_net_btn settings_net_mini" data-bt="forget" data-addr="${d.address}">${t("settings.network.forget")}</button>`;
            return `<div class="settings_net_bt"><span class="settings_net_name">${escHtml(d.name || d.address)}</span><span class="settings_net_badge">${badge}</span><span class="settings_net_actions">${btns}</span></div>`;
        }).join("");
        netBtList.querySelectorAll("button[data-bt]").forEach(btn => {
            btn.addEventListener("click", () => {
                const act = btn.dataset.bt, addr = btn.dataset.addr;
                const map = { pair: "bluetooth:pair", conn: "bluetooth:connect", disc: "bluetooth:disconnect", forget: "bluetooth:forget" };
                ipc.invoke(map[act] || "bluetooth:pair", { address: addr }).then(r => {
                    notify(r && r.ok ? t("settings.network.btDone") : t("settings.network.failed") + (r && r.error ? " — " + r.error : ""));
                    refreshBt();
                }).catch(() => {});
            });
        });
    };
    const refreshBt = () => {
        ipc.invoke("bluetooth:status").then(r => {
            if (!r || !r.ok) { if (netBtStatus) netBtStatus.textContent = t("settings.network.btUnavail"); return; }
            if (netBtStatus) netBtStatus.textContent = r.name + " (" + (r.address || "") + ")" + (r.powered ? "" : " · " + t("settings.network.btPoweredOff"));
            if (netBtPower) setDd(netBtPower, r.powered ? "1" : "0");
        }).catch(() => {});
        ipc.invoke("bluetooth:devices").then(r => { if (r && r.ok) renderBtList(r.devices || []); }).catch(() => {});
    };
    if (netBtPower) {
        const w = ddWrap(netBtPower);
        if (w) {
            w.addEventListener("click", e => {
                const opt = e.target.closest ? e.target.closest(".mod_loc_opt") : null;
                if (!opt) return;
                const on = opt.dataset.value === "1";
                ipc.invoke("bluetooth:set-power", on).then(r => {
                    notify(r && r.ok ? (on ? t("settings.network.btOn") : t("settings.network.btOff")) : t("settings.network.failed"));
                    refreshBt();
                }).catch(() => {});
            }, true);
        }
    }
    const netBtScan = document.getElementById("settingsNetBtScan");
    if (netBtScan) netBtScan.addEventListener("click", () => {
        ipc.invoke("bluetooth:scan", 8).then(() => {
            notify(t("settings.network.btScanning"));
            let n = 0;
            const timer = setInterval(() => { refreshBt(); if (++n >= 6) clearInterval(timer); }, 1500);
        }).catch(() => {});
    });
    // ---- Downloads (#45) ----
    // The input value is set here (not in the CATS html template) so the path
    // never needs HTML-escaping and stays readable even with odd characters.
    const dlDirInput = document.getElementById("settingsDlDir");
    if (dlDirInput) dlDirInput.value = (window.settings && window.settings.downloadDir) || require("os").homedir() + "/Downloads";
    const dlApply = document.getElementById("settingsDlApply");
    if (dlApply) dlApply.addEventListener("click", () => {
        const dir = (dlDirInput ? dlDirInput.value : "").trim();
        if (!dir) { notify(t("settings.download.badDir")); return; }
        ipc.invoke("dl:setDir", { dir }).then(r => {
            if (window.settings && r && r.ok) window.settings.downloadDir = dir;
            notify(r && r.ok ? t("settings.download.saved") + " " + dir
                             : t("settings.download.failed") + (r && r.error ? " — " + r.error : ""));
        }).catch(() => {});
    });
    // #8 AXEL: start-download button + kick off the live task list.
    const dlAdd = document.getElementById("settingsDlAdd");
    if (dlAdd) dlAdd.addEventListener("click", () => window.axel.add());
    if (window.axel) window.axel.startPoll();

    // ---- System sources (apt mirrors) (#130) ----
    // Built-in presets + a free-form custom URL. Lives in the 通用 section, so
    // it is rendered with the category but only queries the backend on open.
    const srcMirror = document.getElementById("settingsSrcMirror");
    const srcCustom = document.getElementById("settingsSrcCustom");
    const srcApply = document.getElementById("settingsSrcApply");
    // Show the custom-URL row only when "自定义" is chosen.
    const toggleSrcCustom = () => {
        if (!srcCustom || !srcMirror) return;
        const row = srcCustom.closest ? srcCustom.closest(".settings_row") : null;
        if (row) row.style.display = srcMirror.value === "custom" ? "" : "none";
    };
    const applySrc = () => {
        const mirror = srcMirror ? srcMirror.value : "custom";
        const custom = srcCustom ? srcCustom.value.trim() : "";
        ipc.invoke("apt:setMirror", { mirror, custom }).then(r => {
            notify(r && r.ok ? t("settings.sources.applied")
                             : t("settings.sources.failed") + (r && r.error ? " — " + r.error : ""));
        }).catch(() => notify(t("settings.sources.failed")));
    };
    if (srcMirror) {
        srcMirror.addEventListener("change", toggleSrcCustom);
        ipc.invoke("apt:getMirror").then(r => {
            if (!r || !r.ok) {
                // Preview / non-Linux build: read-only, Apply is explained by the
                // failure toast. Keeps the row visible so the layout is stable.
                if (srcApply) srcApply.disabled = true;
                if (srcCustom) srcCustom.disabled = true;
                return;
            }
            if (r.mirror) srcMirror.value = r.mirror;
            if (r.custom) srcCustom.value = r.custom;
            toggleSrcCustom();
        }).catch(() => {});
    }
    if (srcApply) srcApply.addEventListener("click", applySrc);
    toggleSrcCustom();

    // Arrow-key navigation across the list rows (up/down/Home/End), Enter works
    // natively on the <button> rows.
    const wireListKeys = container => {
        if (!container) return;
        container.addEventListener("keydown", e => {
            const rows = Array.from(container.querySelectorAll("button.settings_net_row, button[data-bt], button[data-act]"));
            if (!rows.length) return;
            const idx = rows.indexOf(document.activeElement);
            if (e.key === "ArrowDown") { e.preventDefault(); rows[Math.min(rows.length - 1, idx + 1)].focus(); }
            else if (e.key === "ArrowUp") { e.preventDefault(); rows[Math.max(0, idx - 1)].focus(); }
            else if (e.key === "Home") { e.preventDefault(); rows[0].focus(); }
            else if (e.key === "End") { e.preventDefault(); rows[rows.length - 1].focus(); }
        });
    };
    wireListKeys(netWifiList);
    wireListKeys(netWifiSaved);
    wireListKeys(netBtList);
    refreshWifi();
    refreshBt();
};

window.setupSettingsDropdowns = () => {
    document.querySelectorAll("#settingsEditor select").forEach(sel => {
        let wrap = document.createElement("div");
        wrap.className = "mod_loc_dd settings_dd";
        wrap.innerHTML = `
            <button type="button" class="mod_loc_btn"></button>
            <div class="mod_loc_list"></div>
            <input type="hidden" id="${sel.id}" value="">`;

        let input = wrap.querySelector("input");
        let btn = wrap.querySelector("button");
        let list = wrap.querySelector(".mod_loc_list");
        // Each option keeps its VALUE (the persisted string) and displays its
        // TEXT. Value-attribute selects (language, appSort, appMonitor-mock)
        // must persist the `value`, not the visible label — e.g. the language
        // dropdown shows "中文" but saves "zh".
        let options = Array.from(sel.options).map(o => ({ value: o.value, text: o.text }));
        let isBool = options.length === 2 && options.every(o => o.value === "true" || o.value === "false");
        let label = v => (isBool ? (v === "true" ? "TRUE" : "FALSE") : v);
        let show = o => (isBool ? label(o.value) : o.text);
        let value = sel.value;

        let render = () => {
            let cur = options.find(o => o.value === value) || { value, text: value };
            btn.textContent = show(cur);
            list.innerHTML = "";
            options.forEach(o => {
                let d = document.createElement("div");
                d.className = "mod_loc_opt" + (o.value === value ? " mod_loc_opt_active" : "");
                d.dataset.value = o.value;
                d.textContent = show(o);
                list.appendChild(d);
            });
        };
        let setValue = v => { value = v; input.value = v; render(); };

        btn.addEventListener("click", e => {
            e.stopPropagation();
            let isOpen = !list.classList.contains("mod_loc_open");
            document.querySelectorAll("#settingsEditor .mod_loc_list.mod_loc_open").forEach(l => l.classList.remove("mod_loc_open"));
            list.classList.toggle("mod_loc_open", isOpen);
            if (isOpen) {
                let active = list.querySelector(".mod_loc_opt_active");
                if (active) active.scrollIntoView({ block: "nearest" });
            }
        });
        list.addEventListener("click", e => {
            let opt = e.target.closest(".mod_loc_opt");
            if (!opt) return;
            e.stopPropagation();
            setValue(opt.dataset.value);
            // A native <select> fires 'change' on user selection; this custom
            // replacement must too, so onchange-style hooks (e.g. the Claude
            // provider auto-fill) keep working.
            input.dispatchEvent(new Event("change", { bubbles: true }));
            list.classList.remove("mod_loc_open");
        });

        setValue(sel.value);
        sel.replaceWith(wrap);
    });

    // Close any open settings dropdown when clicking outside them (bound once)
    if (!window._settingsDropdownCloseBound) {
        window._settingsDropdownCloseBound = true;
        document.addEventListener("click", e => {
            if (e.target.closest && e.target.closest(".settings_dd, .settings_combobox")) return;
            document.querySelectorAll("#settingsEditor .mod_loc_list.mod_loc_open").forEach(l => l.classList.remove("mod_loc_open"));
        });
    }
};

// Claude model fields are editable combo boxes: the <input> is the real value,
// the arrow button opens a list of the active provider's models (rebuilt by
// applyClaudeProvider) for quick picking. Picking fills the input, which stays
// editable afterwards. Keyboard: Enter/Space on the arrow toggles the list;
// ArrowUp/Down move the highlight, Enter confirms, Esc closes.
window.setupSettingsComboboxes = () => {
    document.querySelectorAll("#settingsEditor .settings_combobox").forEach(box => {
        if (box.dataset.cbxBound) return;
        box.dataset.cbxBound = "1";
        const input = box.querySelector("input");
        const btn = box.querySelector("button");
        const list = box.querySelector(".mod_loc_list");
        const openList = () => {
            const isOpen = !list.classList.contains("mod_loc_open");
            document.querySelectorAll("#settingsEditor .mod_loc_list.mod_loc_open").forEach(l => l.classList.remove("mod_loc_open"));
            list.classList.toggle("mod_loc_open", isOpen);
            if (isOpen) {
                const active = list.querySelector(".mod_loc_opt_active");
                if (active) active.scrollIntoView({ block: "nearest" });
            }
        };
        const closeList = () => list.classList.remove("mod_loc_open");
        const pick = opt => {
            if (!opt) return;
            input.value = opt.dataset.value;
            input.dispatchEvent(new Event("change", { bubbles: true }));
            list.querySelectorAll(".mod_loc_opt").forEach(o => o.classList.toggle("mod_loc_opt_active", o === opt));
            closeList();
        };
        btn.addEventListener("click", e => { e.stopPropagation(); openList(); });
        list.addEventListener("click", e => {
            const opt = e.target.closest(".mod_loc_opt");
            if (!opt) return;
            e.stopPropagation();
            pick(opt);
        });
        box.addEventListener("keydown", e => {
            if (!list.classList.contains("mod_loc_open")) return;
            const opts = Array.from(list.querySelectorAll(".mod_loc_opt"));
            if (!opts.length) return;
            if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeList(); return; }
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault(); e.stopPropagation();
                let idx = opts.findIndex(o => o.classList.contains("mod_loc_opt_active"));
                idx = (idx < 0 ? (e.key === "ArrowDown" ? -1 : 0) : idx);
                idx = e.key === "ArrowDown" ? (idx + 1) % opts.length : (idx - 1 + opts.length) % opts.length;
                opts.forEach((o, i) => o.classList.toggle("mod_loc_opt_active", i === idx));
                opts[idx].scrollIntoView({ block: "nearest" });
                return;
            }
            if (e.key === "Enter") {
                e.preventDefault(); e.stopPropagation();
                pick(opts.find(o => o.classList.contains("mod_loc_opt_active")));
            }
        });
    });
};

window.writeFile = (path) => {
    fs.writeFile(path, document.getElementById("fileEdit").value, "utf-8", () => {
        document.getElementById("fedit-status").innerHTML = "<i>File saved.</i>";
    });
};

window.writeSettingsFile = () => {
    // Passcode must be 4-8 digits to save (the Save button is already disabled
    // while it is short, but guard every path — e.g. the external editor).
    const lockInput = document.getElementById("settingsEditor-lockCode");
    if (lockInput && (lockInput.value.length < 4 || lockInput.value.length > 8)) {
        document.getElementById("settingsEditorStatus").innerText =
            t("settings.lockCode.invalidStatus");
        return;
    }
    // MERGE into the in-memory settings instead of rebuilding them from the form:
    // rebuilding used to silently drop every key without a form control (webapps,
    // weatherLocation, and the settings removed from the UI: port, pingAddr,
    // iface, monitor, keepGeometry, …). Those are still editable via the "open
    // in external editor" button, so they must survive a save.
    const s = Object.assign({}, window.settings);
    s.username = document.getElementById("settingsEditor-username").value;
    s.theme = document.getElementById("settingsEditor-theme").value;
    s.termFontSize = Number(document.getElementById("settingsEditor-termFontSize").value);
    s.audio = (document.getElementById("settingsEditor-audio").value === "true");
    s.audioVolume = Number(document.getElementById("settingsEditor-audioVolume").value);
    s.disableFeedbackAudio = (document.getElementById("settingsEditor-disableFeedbackAudio").value === "true");
    s.eventAudio = (document.getElementById("settingsEditor-eventAudio").value === "true");
    s.clockHours = Number(document.getElementById("settingsEditor-clockHours").value);
    s.nointro = (document.getElementById("settingsEditor-nointro").value === "true");
    s.nocursor = (document.getElementById("settingsEditor-nocursor").value === "true");
    s.hideDotfiles = (document.getElementById("settingsEditor-hideDotfiles").value === "true");
    s.fsListView = (document.getElementById("settingsEditor-fsListView").value === "true");
    s.screensaverEnabled = (document.getElementById("settingsEditor-screensaverEnabled").value === "true");
    s.screensaverIdle = Number(document.getElementById("settingsEditor-screensaverIdle").value);
    // Screen-off must never be shorter than the screensaver timeout — clamp it
    // up to the screensaver value if the user entered something lower (and
    // mirror the clamp into the field so the displayed value stays truthful).
    s.screenOffIdle = Number(document.getElementById("settingsEditor-screenOffIdle").value);
    const minScreenOff = Math.max(Number(s.screensaverIdle) || 300, 0);
    if (!(s.screenOffIdle >= minScreenOff)) {
        s.screenOffIdle = minScreenOff;
        const soInput = document.getElementById("settingsEditor-screenOffIdle");
        if (soInput) soInput.value = String(minScreenOff);
    }
    s.screensaverStyle = document.getElementById("settingsEditor-screensaverStyle").value;
    s.lockCode = document.getElementById("settingsEditor-lockCode").value;
    s.lockOnIdle = (document.getElementById("settingsEditor-lockOnIdle").value === "true");
    s.showKeyboard = (document.getElementById("settingsEditor-showKeyboard").value === "true");
    s.terminalScrollSensitivity = Number(document.getElementById("settingsEditor-terminalScrollSensitivity").value);
    s.terminalScrollDirection = document.getElementById("settingsEditor-terminalScrollDirection").value;
    s.cursorAutoHide = (document.getElementById("settingsEditor-cursorAutoHide").value === "true");
    s.cursorAutoHideDelay = Number(document.getElementById("settingsEditor-cursorAutoHideDelay").value);
    // cursorStyle has no form control anymore (the selector was hidden — the
    // Black-Void pack is the only style shipped); keep whatever value is stored.
    s.cursorSize = Number(document.getElementById("settingsEditor-cursorSize").value);
    s.mouseWheelSpeed = Number(document.getElementById("settingsEditor-mouseWheelSpeed").value);
    s.cursorSpeed = Number(document.getElementById("settingsEditor-cursorSpeed").value);
    s.appSort = document.getElementById("settingsEditor-appSort").value;
    s.language = document.getElementById("settingsEditor-language").value;
    // Desktop background choice (mode + optional image). Defensive defaults keep
    // a saved choice across an unrelated save (e.g. the external-editor path).
    s.backgroundMode = (window._settingsBgMode !== undefined
        ? window._settingsBgMode : (window.settings.backgroundMode || "theme"));
    s.backgroundImage = (window._settingsBgValue !== undefined
        ? window._settingsBgValue : (window.settings.backgroundImage || "")) || "";
    // MERGE over the stored claude block (not a rebuild): a rebuild would
    // drop any claude key without a form control below — e.g. aiWebSearch.
    const awsEl = document.getElementById("settingsEditor-claude-aiWebSearch");
    // #175 英文系统隐藏 AI 分类:claude 表单不渲染,provider 元素缺失时整块跳过,
    // 保留已存 claude 配置(否则 Save 会 TypeError)。
    const cPrEl = document.getElementById("settingsEditor-claude-provider");
    if (cPrEl) {
        s.claude = Object.assign({}, s.claude, {
            enabled: (document.getElementById("settingsEditor-claude-enabled").value === "true"),
            provider: cPrEl.value,
            baseUrl: document.getElementById("settingsEditor-claude-baseUrl").value,
            apiKey: document.getElementById("settingsEditor-claude-apiKey").value,
            model: document.getElementById("settingsEditor-claude-model").value,
            haikuModel: document.getElementById("settingsEditor-claude-haikuModel").value,
            aiWebSearch: awsEl ? (awsEl.value === "true") : (s.claude.aiWebSearch !== false)
        });
    }
    const micModeEl = document.getElementById("settingsEditor-voiceMicMode");
    if (micModeEl) s.voiceMicMode = micModeEl.value;
    // appMonitor is not rebuilt from the form here: the backend server always
    // runs (it powers tab 5's experimental GUI-app entry) and picks up its
    // defaults / stored values from _boot.js on startup. The one UI-editable
    // flag, showGui, is applied immediately by window.showGui.apply() — it
    // mutates window.settings and writes the file itself, so the MERGE spread
    // above carries it through a Save unchanged.
    // #8 AXEL: top-level keys (same style as downloadDir), NOT a
    // settings.download namespace — that would collide with the
    // browser-download save path the main process reads.
    const _dlDirEl = document.getElementById("settingsDlDir");
    const _dlThreadsEl = document.getElementById("settingsDlThreads");
    if (_dlDirEl) s.downloadDir = _dlDirEl.value.trim();
    if (_dlThreadsEl) s.downloadThreads = Math.max(1, Math.min(32, parseInt(_dlThreadsEl.value, 10) || 6));
    s.clash = {
        enabled: (document.getElementById("settingsClashEnabled").value === "true"),
        // No form control for port — the mixed port is fixed by the seeded
        // config; keep whatever is stored (default 7890).
        port: Number((window.settings.clash || {}).port) || 7890,
        controller: document.getElementById("settingsClashController").value,
        secret: document.getElementById("settingsClashSecret").value,
        subUrl: document.getElementById("settingsClashSubUrl").value,
        // preProxy is owned by the main process (captured/restored around
        // system-proxy take-over) — preserve it untouched.
        preProxy: (window.settings.clash && window.settings.clash.preProxy) || null
    };

    Object.keys(s).forEach(key => {
        if (s[key] === "undefined") {
            delete s[key];
        }
    });

    window.settings = s;
    fs.writeFileSync(settingsFile, JSON.stringify(s, "", 4));
    if (window.applyLangHiding) window.applyLangHiding();
    document.getElementById("settingsEditorStatus").innerText = t("settings.savedStatus")+new Date().toTimeString();

    // Pointer look/size changes rebuild the cursor-role style in place (no
    // reload); the wheel multiplier is read live by its listeners.
    if (window._refreshCursor) window._refreshCursor();
    if (window.battery && window.battery.refresh) window.battery.refresh();
    // Cursor speed is an OS-level pointer property — ask the main process to
    // apply it (no-op in the macOS preview, real on the eDEX-OS device).
    try { ipc.invoke("mouse:speed", s.cursorSpeed || 1); } catch (e) {}

    // A language change re-opens the dialog in the new language (no full reload,
    // so the boot animation does not replay).
    if (window._settingsOpenLang && window._settingsOpenLang !== window.settings.language) {
        const m = window._settingsModal;
        if (m && m.id && window.modals[m.id]) {
            window.modals[m.id].close();
            setTimeout(() => window.openSettings(), 160);
        }
    }
};

// First-launch language choice (also reachable from the language dropdown's
// English/中文 values). Persists to settings.json; the rest of the UI stays
// English, so no page reload is needed — just close the bilingual picker.
window.setLanguage = lang => {
    if (lang !== "zh" && lang !== "en") return;
    window.settings.language = lang;
    fs.writeFileSync(settingsFile, JSON.stringify(window.settings, "", 4));
    if (window.applyLangHiding) window.applyLangHiding();
    if (window._langPicker && window._langPicker.id && window.modals[window._langPicker.id]) {
        window.modals[window._langPicker.id].close();
        window._langPicker = null;
    }
};

window.showLanguagePicker = () => {
    if (window.settings.language) return;
    if (window._langPicker && window._langPicker.id && window.modals[window._langPicker.id]) return;
    window._langPicker = new Modal({
        type: "custom",
        title: "Select language / 选择语言",
        closeLabel: "Close / 关闭",
        html: `<p style="margin:0 0 1.2vh">The interface stays English — this picks the language of the settings menu.<br>其余界面保持英文——此处选择设置菜单的语言。</p>`,
        buttons: [
            {label: "中文", action: "window.setLanguage('zh')"},
            {label: "English", action: "window.setLanguage('en')"}
        ]
    });
};

window.toggleFullScreen = () => {
    let useFullscreen = (electronWin.isFullScreen() ? false : true);
    electronWin.setFullScreen(useFullscreen);

    //Update settings
    window.lastWindowState["useFullscreen"] = useFullscreen;

    fs.writeFileSync(lastWindowStateFile, JSON.stringify(window.lastWindowState, "", 4));
};

// Display available keyboard shortcuts and custom shortcuts helper
window.openShortcutsHelp = () => {
    // Avoid duplicate shortcuts modals (may stack on top of the settings editor)
    if (document.getElementById("shortcutsHelpAccordeon1")) return;

    const shortcutsDefinition = {
        "COPY": t("shortcuts.copy"),
        "PASTE": t("shortcuts.paste"),
        "NEXT_TAB": t("shortcuts.nextTab"),
        "PREVIOUS_TAB": t("shortcuts.prevTab"),
        "TAB_X": t("shortcuts.tabX"),
        "SETTINGS": t("shortcuts.settings"),
        "SHORTCUTS": t("shortcuts.shortcuts"),
        "FUZZY_SEARCH": t("shortcuts.fuzzySearch"),
        "FS_LIST_VIEW": t("shortcuts.fsListView"),
        "FS_DOTFILES": t("shortcuts.fsDotfiles"),
        "DEV_DEBUG": t("shortcuts.devDebug"),
        "DEV_RELOAD": t("shortcuts.devReload")
    };

    let appList = "";
    window.shortcuts.filter(e => e.type === "app").forEach(cut => {
        let action = (cut.action.startsWith("TAB_")) ? "TAB_X" : cut.action;

        appList += `<tr>
                        <td>${(cut.enabled) ? t("shortcuts.yes") : t("shortcuts.no")}</td>
                        <td><input disabled type="text" maxlength=25 value="${cut.trigger}"></td>
                        <td>${shortcutsDefinition[action]}</td>
                    </tr>`;
    });

    let customList = "";
    window.shortcuts.filter(e => e.type === "shell").forEach(cut => {
        customList += `<tr>
                            <td>${(cut.enabled) ? t("shortcuts.yes") : t("shortcuts.no")}</td>
                            <td><input disabled type="text" maxlength=25 value="${cut.trigger}"></td>
                            <td>
                                <input disabled type="text" placeholder="${t("shortcuts.cmdPlaceholder")}" value="${cut.action}">
                                <input disabled type="checkbox" name="shortcutsHelpNew_Enter" ${(cut.linebreak) ? 'checked' : ''}>
                                <label for="shortcutsHelpNew_Enter">Enter</label>
                            </td>
                        </tr>`;
    });

    new Modal({
        type: "custom",
        title: `${t("shortcuts.title")} <i>(v${remote.app.getVersion()})</i>`,
        html: `<h5>${t("shortcuts.intro")}</h5>
                <details open id="shortcutsHelpAccordeon1">
                    <summary>${t("shortcuts.simulator")}</summary>
                    <table class="shortcutsHelp">
                        <tr>
                            <th>${t("shortcuts.th.enabled")}</th>
                            <th>${t("shortcuts.th.shortcut")}</th>
                            <th>${t("shortcuts.th.action")}</th>
                        </tr>
                        ${appList}
                    </table>
                </details>
                <br>
                <details id="shortcutsHelpAccordeon2">
                    <summary>${t("shortcuts.custom")}</summary>
                    <table class="shortcutsHelp">
                        <tr>
                            <th>${t("shortcuts.th.enabled")}</th>
                            <th>${t("shortcuts.th.shortcut")}</th>
                            <th>${t("shortcuts.th.command")}</th>
                        <tr>
                       ${customList}
                    </table>
                </details>
                <br>`,
        buttons: [
            {label: t("shortcuts.btn.openFile"), action:`electron.shell.openPath('${shortcutsFile}');electronWin.minimize();`},
            {label: t("shortcuts.btn.reload"), action: "window.location.reload(true);"},
        ]
    }, () => {
        window.term[window.currentTerm].term.focus();
    });

    let wrap1 = document.getElementById('shortcutsHelpAccordeon1');
    let wrap2 = document.getElementById('shortcutsHelpAccordeon2');

    wrap1.addEventListener('toggle', e => {
        wrap2.open = !wrap1.open;
    });

    wrap2.addEventListener('toggle', e => {
        wrap1.open = !wrap2.open;
    });
};

// True while the screen is locked or the first-boot setup is up. The lock and
// the setup screen are the only states where NO keyboard shortcut may act — the
// OS-level hotkeys (globalShortcut) fire outside DOM keydown, so they are gated
// in their dispatcher instead of on the keydown path.
function uiLocked() {
    return Boolean(
        (window.lockScreen && window.lockScreen.active) ||
        (window.firstRun && window.firstRun.active)
    );
}

window.useAppShortcut = action => {
    if (uiLocked()) return false;
    switch(action) {
        case "COPY": {
            // A focused modal field (file-browser rename, settings editor, ...)
            // wins over the terminal: copy ITS selected text. Mirrors the PASTE
            // guard below — without it, Ctrl+Shift+C inside an input runs the
            // terminal copy and the input's selection never reaches the
            // clipboard ("I have to copy several times before paste works").
            const ae = document.activeElement;
            const inModal = ae && ae.closest && ae.closest(".modal_popup");
            const editable = inModal && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA");
            if (editable && ae.selectionStart != null && ae.selectionEnd > ae.selectionStart) {
                try {
                    remote.clipboard.writeText(ae.value.slice(ae.selectionStart, ae.selectionEnd));
                    return true;
                } catch (err) {}
            }
            window.term[window.currentTerm].clipboard.copy();
            return true;
        }
        case "PASTE": {
            // A focused modal field (e.g. the file browser's doc editor) wins
            // over the terminal: paste the clipboard into it instead. Guards
            // against stealing Ctrl+Shift+V from xterm, whose helper textarea
            // would otherwise match the tag check below.
            const ae = document.activeElement;
            const inModal = ae && ae.closest && ae.closest(".modal_popup");
            const editable = inModal && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA");
            if (editable) {
                try {
                    const text = remote.clipboard.readText();
                    // `|| length` would misread a real cursor at position 0 as
                    // "no selection" and shift the insert to the end — then slice
                    // with the two different offsets duplicates the tail. Null-check
                    // instead (#147).
                    const s = ae.selectionStart != null ? ae.selectionStart : ae.value.length;
                    const e = ae.selectionEnd != null ? ae.selectionEnd : s;
                    ae.value = ae.value.slice(0, s) + text + ae.value.slice(e);
                    const at = s + text.length;
                    ae.selectionStart = ae.selectionEnd = at;
                    ae.dispatchEvent(new Event("input", { bubbles: true }));
                } catch (err) {}
                return true;
            }
            window.term[window.currentTerm].clipboard.paste();
            return true;
        }
        case "NEXT_TAB":
                if (window.term[window.currentTerm+1]) {
                    window.focusShellTab(window.currentTerm+1);
                } else if (window.term[window.currentTerm+2]) {
                    window.focusShellTab(window.currentTerm+2);
                } else if (window.term[window.currentTerm+3]) {
                    window.focusShellTab(window.currentTerm+3);
                } else if (window.term[window.currentTerm+4]) {
                    window.focusShellTab(window.currentTerm+4);
                } else {
                    window.focusShellTab(0);
                }
            return true;
        case "PREVIOUS_TAB":
                let i = window.currentTerm || 4;
                if (window.term[i] && i !== window.currentTerm) {
                    window.focusShellTab(i);
                } else if (window.term[i-1]) {
                    window.focusShellTab(i-1);
                } else if (window.term[i-2]) {
                    window.focusShellTab(i-2);
                } else if (window.term[i-3]) {
                    window.focusShellTab(i-3);
                } else if (window.term[i-4]) {
                    window.focusShellTab(i-4);
                }
            return true;
        case "TAB_1":
            window.focusShellTab(0);
            return true;
        case "TAB_2":
            window.focusShellTab(1);
            return true;
        case "TAB_3":
            window.focusShellTab(2);
            return true;
        case "TAB_4":
            window.focusShellTab(3);
            return true;
        case "TAB_5":
            window.focusShellTab(4);
            return true;
        case "SETTINGS":
            window.openSettings();
            return true;
        case "SHORTCUTS":
            window.openShortcutsHelp();
            return true;
        case "FUZZY_SEARCH":
            window.activeFuzzyFinder = new FuzzyFinder();
            return true;
        case "FS_LIST_VIEW":
            window.fsDisp.toggleListview();
            return true;
        case "FS_DOTFILES":
            window.fsDisp.toggleHidedotfiles();
            return true;
        case "DEV_DEBUG":
            if (window.shellSlotKinds[window.currentTerm] === "appmonitor") {
                const p = window.currentTerm === 3 ? window.appmonitorA : window.appmonitorB;
                if (p) p.toggleDevTools();
            } else remote.getCurrentWindow().webContents.toggleDevTools();
            return true;
        case "DEV_RELOAD":
            window.location.reload(true);
            return true;
        default:
            console.warn(`Unknown "${action}" app shortcut action`);
            return false;
    }
};

// Global keyboard shortcuts
const globalShortcut = remote.globalShortcut;
globalShortcut.unregisterAll();

window.registerKeyboardShortcuts = () => {
    window.shortcuts.forEach(cut => {
        if (!cut.enabled) return;

        if (cut.type === "app") {
            if (cut.action === "TAB_X") {
                for (let i = 1; i <= 5; i++) {
                    let trigger = cut.trigger.replace("X", i);
                    let dfn = () => { window.useAppShortcut(`TAB_${i}`) };
                    globalShortcut.register(trigger, dfn);
                }
            } else {
                globalShortcut.register(cut.trigger, () => {
                    window.useAppShortcut(cut.action);
                });
            }
        } else if (cut.type === "shell") {
            globalShortcut.register(cut.trigger, () => {
                if (uiLocked()) return;   // never type into a locked terminal
                let fn = (cut.linebreak) ? "writelr" : "write";
                window.term[window.currentTerm][fn](cut.action);
            });
        } else {
            console.warn(`${cut.trigger} has unknown type`);
        }
    });
};
window.registerKeyboardShortcuts();

// See #361
window.addEventListener("focus", () => {
    window.registerKeyboardShortcuts();
});

window.addEventListener("blur", () => {
    globalShortcut.unregisterAll();
});

// Prevent showing menu, exiting fullscreen or app with keyboard shortcuts
document.addEventListener("keydown", e => {
    // Win+L (super/meta + L): lock the screen — screensaver first, then the
    // lock on dismiss, exactly like the power menu's Lock Screen action.
    if (e.metaKey && (e.key === "l" || e.key === "L")) {
        e.preventDefault();
        if (uiLocked()) return;   // already locked / setting up — don't re-trigger
        if (window.sysCmd && typeof window.sysCmd.startScreensaver === "function") {
            window.sysCmd.startScreensaver(true);
        } else if (window.lockScreen) {
            window.lockScreen.show();
        }
        return;
    }
    if (e.key === "Alt") {
        e.preventDefault();
    }
    if (e.code.startsWith("Alt") && e.ctrlKey && e.shiftKey) {
        e.preventDefault();
    }
    if (e.key === "F11" && !settings.allowWindowed) {
        e.preventDefault();
    }
    // Let Ctrl+A / Ctrl+D behave normally while the browser's address bar (or
    // any input) is focused - select-all and bookmark shortcuts belong there.
    const isInputFocused = document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
    if (e.code === "KeyD" && e.ctrlKey && !isInputFocused) {
        e.preventDefault();
    }
    if (e.code === "KeyA" && e.ctrlKey && !isInputFocused) {
        e.preventDefault();
    }
});

// Fix #265
window.addEventListener("keyup", e => {
    if (require("os").platform() === "win32" && e.key === "F4" && e.altKey === true) {
        remote.app.quit();
    }
});

// Fix double-tap zoom on touchscreens
electron.webFrame.setVisualZoomLevelLimits(1, 1);

// Resize terminal with window
window.onresize = () => {
    if (typeof window.currentTerm !== "undefined") {
        if (typeof window.term[window.currentTerm] !== "undefined") {
            window.term[window.currentTerm].fit();
        }
    }
};

// See #413
window.resizeTimeout = null;
let electronWin = remote.getCurrentWindow();
electronWin.on("resize", () => {
    if (settings.keepGeometry === false) return;
    clearTimeout(window.resizeTimeout);
    window.resizeTimeout = setTimeout(() => {
        let win = remote.getCurrentWindow();
        if (win.isFullScreen()) return false;
        if (win.isMaximized()) {
            win.unmaximize();
            win.setFullScreen(true);
            return false;
        }

        let size = win.getSize();

        if (size[0] >= size[1]) {
            win.setSize(size[0], parseInt(size[0] * 9 / 16));
        } else {
            win.setSize(size[1], parseInt(size[1] * 9 / 16));
        }
    }, 100);
});

electronWin.on("leave-full-screen", () => {
    remote.getCurrentWindow().setSize(960, 540);
});

// Replay the eDEX startup animation (boot log + logo) from a black screen,
// used when waking the Matrix screensaver - feels like relaunching the app.
function replayBoot() {
    let bootScreen = document.getElementById("boot_screen");
    if (!bootScreen) {
        bootScreen = document.createElement("section");
        bootScreen.setAttribute("id", "boot_screen");
        document.body.appendChild(bootScreen);
    }
    bootScreen.setAttribute("style", "z-index: 9999999; background: #05080d;");
    bootScreen.setAttribute("class", "");
    bootScreen.innerHTML = "";
    document.body.setAttribute("class", "solidBackground");
    i = 0;
    window._replayUI = true; // after the logo, re-run the panel entrance
    displayLine();
}

// Re-run the module entrance animation so the panels "load" like a fresh boot,
// WITHOUT recreating anything - terminals keep running and the file browser
// keeps its current directory.
function reRevealUI(onComplete) {
    window._replayUI = false;
    // hide everything, then re-run the entrances
    document.querySelectorAll(".mod_column > div").forEach(d => {
        d.style.animation = "none";
        d.style.opacity = "0";
    });
    void (document.getElementById("mod_column_left") || document.body).offsetWidth; // reflow
    let divs = [...document.querySelectorAll(".mod_column > div")];
    divs.forEach(d => { d.style.animation = ""; d.style.opacity = ""; });
    // The desktop counts as "loaded" once BOTH the module-column stagger and the
    // cyber entrance have kicked off their last animation. Callers (the lock's
    // deferred window restore) wait for this so pre-lock windows never appear
    // before — or over — the loading desktop.
    let pending = 2;
    const maybeDone = () => {
        if (--pending > 0 || typeof onComplete !== "function") return;
        // The stagger only *kicks off* the last animation; give it a beat to
        // play before the desktop is considered fully revealed.
        setTimeout(() => { try { onComplete(); } catch (e) {} }, 400);
    };
    let idx = 0;
    let x = setInterval(() => {
        if (idx >= divs.length) { clearInterval(x); maybeDone(); return; }
        if (divs[idx]) divs[idx].style.animationPlayState = "running";
        idx++;
    }, 400);
    cyberEntrance(maybeDone);
}

// Reveal the cyber panel (DATA STREAM) + radar elements one by one, then the
// outer frame (border) fades in last.
function cyberEntrance(onDone) {
    // Both the panel and the (sibling) radar were kept at opacity:0 during the
    // boot welcome so their frames did not pop out prematurely - reveal them
    // now that the greeting is over, then stage the inner elements one by one.
    let cp = document.getElementById("cyber_panel");
    if (cp) cp.setAttribute("style", "");
    let rr = document.getElementById("cyber_radar");
    if (rr) rr.style.opacity = "1";
    let items = document.querySelectorAll(
        "#cyber_wave_wrap, #cyber_bars, #cyber_extra, #cyber_log, #cyber_radar_canvas_wrap, #cyber_radar_data"
    );
    items.forEach(el => { el.style.opacity = "0"; el.style.animationPlayState = "paused"; });
    let list = [...items];
    let n = 0;
    let t = setInterval(() => {
        if (n >= list.length) {
            clearInterval(t);
            // all content is in - now show the outer frame
            ["cyber_panel", "cyber_radar"].forEach(id => {
                let el = document.getElementById(id);
                if (el) el.style.setProperty("--aug-border-opacity", "0.35");
            });
            if (typeof onDone === "function") { try { onDone(); } catch (e) {} }
            return;
        }
        let el = list[n];
        if (el) { el.style.opacity = ""; el.style.animationPlayState = "running"; }
        n++;
    }, 250);
}

// ---- Hacker-style screensaver ----
// After `screensaverIdle` seconds without any input a screensaver plays in the
// terminal area (not the whole screen); any mouse/keyboard activity dismisses
// it. Two styles selectable in settings:
//   "code"   - scrolling fake "code" written to the xterm buffer (term.write(),
//              nothing sent to the shell - light on CPU)
//   "matrix" - Matrix-rain canvas, fullscreen
window.screensaver = (() => {
    let active = false;

    // ---- cover session: 屏保/锁屏共享一个 CliPanel 真终端会话 ----
    // 旧实现(SSVT 覆盖层)已废弃:独立 xterm div 渲染和真终端不一致,而且
    // show/hide/windDown 还要对 window.term[currentTerm] 做 reset()+writelr("")
    // 清屏 —— 解锁后用户的 CLAUDE 等会话被清空(Bug8)。
    // 现在改为:屏保/锁屏在 CliPanel(tab3,appmonitorA 恒为 CliPanel)里临时建
    // 一个 `__cover__` 会话(真 pty `cat`,muted Terminal wrapper),假代码流进它;
    // 解锁/dismiss 时销毁。用户所有真终端(0/1/2 tab)和已开的 CLI 会话全程不碰,
    // 无需任何缓冲区重放。
    let coverPanel = null;        // hosting CliPanel (always appmonitorA, tab 3)
    const coverTab = 3;           // shell tab the cover session lives on
    let _coverRestoreTab = null;  // tab to return to when the cover lifts
    let coverShim = null;         // the window.term[3] shim the wrapper replaces
    const _pickCoverPanel = () => {
        // appmonitorA is always a CliPanel — a safe cover host even when tab 4
        // is an AppMonitorPanel (showGui). Guarded by _uiReady so the boot-time
        // lock (matrix, never touches the terminal) never reaches here.
        const p = (window._uiReady && window.appmonitorA && typeof window.appmonitorA.beginCoverSession === "function")
            ? window.appmonitorA : null;
        coverPanel = p;
        return p;
    };
    // The Terminal wrapper of the cover session (null until the pty attaches;
    // codeTick and the lock poll / self-heal once it does).
    const coverTerm = () => {
        if (window.screensaverSilent === true && coverPanel && typeof coverPanel.coverTerm === "function") {
            return coverPanel.coverTerm();
        }
        const p = _pickCoverPanel();
        if (!p) return null;
        if (_coverRestoreTab == null) _coverRestoreTab = window.currentTerm;
        window.screensaverSilent = true;
        p.beginCoverSession();
        if (coverTab !== window.currentTerm) {
            try { if (window.focusShellTab) window.focusShellTab(coverTab); } catch (e) {}
        }
        // Route the virtual keyboard to the cover wrapper (the tab shim's write
        // is a no-op), so touch input reaches the lock's _termKey interceptor.
        const w = p.coverTerm ? p.coverTerm() : null;
        if (w && window.term && window.term[coverTab] !== w) {
            if (!coverShim) coverShim = window.term[coverTab];
            window.term[coverTab] = w;
        }
        return w;
    };
    const coverRestoreTab = () => _coverRestoreTab;
    // Destroy the cover session and release the cover's hold on the panel /
    // shim / sound. `keepRestoreTab` preserves _coverRestoreTab across the
    // lock→screensaver idle timeout, so the eventual dismiss still returns to
    // the tab the user was on before the cover started (#88).
    const endCover = keepRestoreTab => {
        const p = coverPanel;
        coverPanel = null;
        if (!keepRestoreTab) _coverRestoreTab = null;
        window.screensaverSilent = false;
        if (coverShim != null && window.term) {
            try { window.term[coverTab] = coverShim; } catch (e) {}
            coverShim = null;
        }
        if (p && typeof p.endCoverSession === "function") {
            try { p.endCoverSession(); } catch (e) {}
        }
    };
    // Direct lock (Win+L, no screensaver first): stream fake code behind the
    // passcode box for ~1.5s before it assembles. Creates the cover session
    // like the screensaver would, but never sets `active` — bumpActivity must
    // keep treating the input that started the lock as a dismiss, not a wake.
    const streamCodeIntoCover = () => {
        coverTerm();
        sessionFirstFile = true;
        sessionUsed.clear();
        winding = false;
        pendingLines = [];
        if (!codeTimer) codeTimer = setInterval(codeTick, 100);
    };
    const stopCodeStream = () => {
        if (codeTimer) { clearInterval(codeTimer); codeTimer = null; }
    };

    // ---- code style (hacktyper-style: streams procedurally generated source
    // code so it never visibly repeats - brace depth and indentation stay
    // coherent for a premium, "real code" look) ----
    let codeTimer = null;
    // Wind-down guard: once set, the generator only serves the closing banner
    // (buildEnding) instead of a fresh collection, so input that dismisses the
    // screensaver mid-transition cannot start new code streaming.
    let winding = false;
    const pick = a => a[Math.floor(Math.random() * a.length)];
    const R = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo));
    // Appearance over rigour: generate the LOOK of a real scientific codebase -
    // long signatures, long physics formulas, long explanatory comments. The
    // stream is divided into collections — each one a substantial algorithm
    // (ballistic trajectory, weapon yield, decoy discrimination, …) of 5-9
    // related functions — so it never reads as a short loop of unrelated scraps.
    const pad = n => "    ".repeat(Math.max(0, n));
    const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
    const GENWORDS = ["state", "vector", "matrix", "delta", "alpha", "beta", "gamma", "coef", "rate", "factor", "index", "buffer", "sample", "offset", "scale", "bound", "residual", "kernel", "envelope", "spectrum", "derivative", "integral"];
    const DOMAINS = [
        { key: "ballistic", nouns: ["apogee", "reentry", "trajectory", "overpressure", "impact", "fallout", "yield", "thrust", "azimuth", "elevation", "payload", "warhead"], verbs: ["compute", "predict", "integrate", "estimate", "assess", "trace", "solve", "model"], note: "three-stage ballistic trajectory and yield model" },
        { key: "radar", nouns: ["track", "doppler", "beam", "clutter", "range_rate", "cross_section", "azimuth", "elevation", "signal", "noise_floor", "coherence"], verbs: ["update", "init", "detect", "fuse", "coast", "handoff", "filter", "gate"], note: "phased-array tracking and CFAR detection" },
        { key: "emp", nouns: ["coupling", "surge", "attenuation", "resonance", "hardening", "induction", "shield", "cable", "impedance", "skin_depth"], verbs: ["compute", "estimate", "assess", "model", "verify", "sweep", "clamp", "measure"], note: "HEMP coupling and circuit hardening" },
        { key: "winter", nouns: ["aerosol", "optical_depth", "insolation", "temperature_drop", "settling", "stratosphere", "soot", "albedo", "tau", "forcing"], verbs: ["inject", "evolve", "transport", "project", "compute", "estimate", "advect", "scatter"], note: "stratospheric aerosol transport and forcing" },
        { key: "uplink", nouns: ["downlink", "carrier", "parity", "ack", "retransmit", "jitter", "sync", "throughput", "channel", "latency"], verbs: ["encrypt", "decode", "verify", "resync", "throttle", "buffer", "handshake", "route"], note: "deep-space uplink and forward error correction" },
        { key: "recon", nouns: ["signature", "sweep", "footprint", "spectrum", "return", "masking", "baseline", "resolution", "aperture", "phase"], verbs: ["scan", "classify", "normalize", "correlate", "lock", "descope", "triangulate", "confirm"], note: "orbital reconnaissance and signature analysis" },
        { key: "sonar", nouns: ["bearing", "beam", "broadside", "reverberation", "clutter", "ping", "doppler", "depth", "sidelobe", "array"], verbs: ["beamform", "normalize", "localize", "classify", "track", "filter", "resolve", "integrate"], note: "passive sonar beamforming and contact localisation" },
        { key: "ecm", nouns: ["jammer", "burnthrough", "standoff", "noise", "deception", "saturation", "retrograde", "pattern", "gate", "decoy"], verbs: ["generate", "modulate", "suppress", "sequence", "cancel", "null", "blank", "deceive"], note: "standoff jamming and ECCM burnthrough" },
        { key: "yield", nouns: ["fission", "fusion", "yield", "compression", "tamp", "neutron", "flux", "burn", "efficiency", "criticality"], verbs: ["scale", "estimate", "model", "compute", "bound", "predict", "assess", "derive"], note: "weapon yield scaling and burn-efficiency model" },
        { key: "orbit", nouns: ["perigee", "apogee", "inclination", "node", "eccentricity", "semi_major", "perturbation", "drag", "sun_sync", "ground_track"], verbs: ["propagate", "fit", "estimate", "correct", "predict", "maintain", "debias", "maneuver"], note: "low-orbit propagation and SGP4-style fitting" },
        { key: "warhead", nouns: ["heat_shield", "ablation", "stagnation", "tps", "reentry", "flux", "char", "blunting", "angle", "corridor"], verbs: ["integrate", "model", "compute", "size", "verify", "cool", "track", "bound"], note: "reentry-vehicle aerothermodynamics and TPS sizing" },
        { key: "decoy", nouns: ["signature", "chaff", "separation", "contrast", "screening", "kinematics", "mass_ratio", "precession", "midcourse", "target"], verbs: ["discriminate", "compare", "identify", "track", "measure", "classify", "score", "gate"], note: "midcourse decoy discrimination and target scoring" },
        { key: "booster", nouns: ["stage", "thrust", "mass_fraction", "isp", "burntime", "nozzle", "chamber", "dynes", "propellant", "trajectory"], verbs: ["model", "compute", "optimize", "simulate", "budget", "constrain", "throttle", "stage"], note: "solid-rocket staging and ascent performance" },
        { key: "fuze", nouns: ["arming", "detonation", "timing", "standoff", "proximity", "safety", "interlock", "range_gate", "airburst", "contact"], verbs: ["schedule", "verify", "authorize", "delay", "sync", "monitor", "rearm", "clear"], note: "fuze arming chain and airburst timing" },
        { key: "guidance", nouns: ["inertial", "misalignment", "drift", "accelerometer", "gyro", "navigation", "correction", "bias", "alignment", "reset"], verbs: ["filter", "estimate", "update", "correct", "align", "fuse", "compensate", "recalibrate"], note: "inertial navigation and INS/GPS fusion" },
        { key: "c2", nouns: ["tasking", "latency", "handover", "bandwidth", "picture", "engagement", "deconfliction", "priority", "slot", "sector"], verbs: ["schedule", "assign", "deconflict", "queue", "rank", "handoff", "reallocate", "filter"], note: "command-and-control tasking and engagement scheduling" },
        { key: "drone", nouns: ["waypoint", "swarm", "separation", "battery", "loiter", "path", "obstacle", "handoff", "station", "relay"], verbs: ["plan", "route", "deconflict", "assign", "replan", "monitor", "sync", "recover"], note: "autonomous swarm routing and collision avoidance" },
        { key: "cyber", nouns: ["intrusion", "anomaly", "signature", "flow", "baseline", "threshold", "beacon", "exfil", "protocol", "session"], verbs: ["detect", "score", "correlate", "flag", "cluster", "alert", "verify", "suppress"], note: "network intrusion detection and anomaly scoring" }
    ];

    // The names of every function the generator has emitted this session. Each
    // screensaver run (show → hide) is one session; names are minted from the
    // current domain but kept unique session-wide, so a verb_noun pair never
    // repeats and the stream cannot visibly cycle (#28 / #89).
    const sessionUsed = new Set();
    let cur = null; // { S }
    const varName = S => pick(S.nouns.concat(GENWORDS)) + (Math.random() < 0.45 ? "_" + R(0, 100) : "");
    const num = () => {
        const t = Math.floor(Math.random() * 4);
        if (t === 0) return String(R(1, 999));
        if (t === 1) return (Math.random() * 100).toFixed(2);
        if (t === 2) return R(1, 9) + "." + R(0, 9) + "e" + (Math.random() < 0.5 ? "+" : "-") + R(1, 8);
        return (Math.random() * 10).toFixed(1);
    };
    // Fourteen formula shapes so expressions keep varying well past a minute.
    const E = S => {
        const a = varName(S), b = varName(S), c = varName(S);
        const t = Math.floor(Math.random() * 14);
        if (t === 0) return a + " * " + b + " + " + num();
        if (t === 1) return "(" + a + " + " + b + ") * " + num();
        if (t === 2) return a + " / (" + b + " + " + num() + ")";
        if (t === 3) return "sqrt(" + a + " * " + a + " + " + b + " * " + b + ")";
        if (t === 4) return a + " * " + b + " * " + num();
        if (t === 5) return "fmax(" + a + ", " + b + " * " + num() + ")";
        if (t === 6) return "pow(" + a + ", " + num() + ") + " + b;
        if (t === 7) return "sin(" + a + " * " + num() + ") * " + b;
        if (t === 8) return a + " * " + num() + " - " + b;
        if (t === 9) return "fmin((" + a + " + " + b + "), " + c + " * " + num() + ")";
        if (t === 10) return "log1p(" + a + " * " + b + ") + " + c;
        if (t === 11) return "cos(" + b + " * " + num() + ") * " + a + " + " + c;
        if (t === 12) return "exp(-" + a + " / (" + b + " + 1e-9)) * " + c;
        return "clamp(" + a + " * " + b + " - " + num() + ", 0.0, " + c + ")";
    };
    // Fourteen comment templates; all draw on the current domain's vocabulary.
    const C = S => {
        const a = pick(S.nouns), b = pick(S.nouns), c = pick(S.nouns);
        const t = Math.floor(Math.random() * 14);
        if (t === 0) return "Recompute the " + a + " from the current " + b + " state and the residual " + c + " history.";
        if (t === 1) return "Bound the " + a + " against the worst-case " + b + " transient seen at the " + c + " boundary.";
        if (t === 2) return "The " + a + " scales with the cube root of the " + b + ", attenuated by the " + c + " factor.";
        if (t === 3) return "Integrate the " + a + " with an RK4 step and the " + b + " fixed at the " + c + " timestep.";
        if (t === 4) return "Reject returns below the " + a + " threshold and keep the " + b + " rate bounded across the " + c + ".";
        if (t === 5) return "Cache the " + a + " across calls to avoid recomputing the " + b + " on every " + c + " update.";
        if (t === 6) return "The " + a + " dominates once the " + b + " exceeds the " + c + " reference, so clamp early.";
        if (t === 7) return "Normalise the " + a + " by the running mean of the " + b + " to keep the " + c + " stable.";
        if (t === 8) return "First pass converges on the " + a + "; a second pass tightens the " + b + " past the " + c + ".";
        if (t === 9) return "Cross-check the " + a + " against the " + b + " telemetry before trusting the " + c + ".";
        if (t === 10) return "Dead-reckon the " + a + " while the " + b + " link is dark, then reconcile on the " + c + ".";
        if (t === 11) return "Weight the " + a + " observation by its " + b + " confidence so the " + c + " does not skew.";
        if (t === 12) return "The " + a + " budget leaves no margin, so fold the " + b + " back into the " + c + " reserve.";
        return "Revisit the " + a + " once the " + b + " settles, or the " + c + " report will mislead.";
    };
    const SIGS = [
        "const SimConfig& cfg, const StateVector& s, double dt, int mode",
        "const TrackState& t, const Measurement& m, const Matrix& Q, const Matrix& R",
        "double target_range, double target_velocity, double elevation, int mode, bool strict",
        "const Config& cfg, const array<double, 6>& state, double t0, double t1, double eps",
        "const RadarSweep& sweep, const GateList& gates, size_t beam_idx, double scale",
        "const Vector3& pos, const Vector3& vel, const double* coeffs, size_t n, int iter",
        "double temperature, double pressure, double humidity, bool saturated, int pass",
        "const PlatformState& p, const ThreatList& threats, double horizon, double dt",
        "const double* observed, const double* predicted, size_t n, double tol, bool adapt",
        "const CommsFrame& frame, const Codec& codec, int priority, bool encrypt, uint8_t chan"
    ];
    const OP = ["<", ">", "<=", ">=", "==", "!="];

    // One function body: 24-36 statements with locals, branches, loops and a
    // switch, so each function reads as a real subroutine. `name` and the domain
    // S come from the current collection.
    const buildFunction = (name, S) => {
        const lines = [];
        lines.push(pad(0) + pick(["double ", "static double ", "float ", "double "]) + name + "(" + pick(SIGS) + ") {");
        lines.push(pad(1) + "double result = " + E(S) + " + " + E(S) + ";");
        const locals = [];
        for (let i = 0, n = R(3, 6); i < n; i++) {
            const lv = varName(S);
            locals.push(lv);
            lines.push(pad(1) + "const double " + lv + " = " + E(S) + " + " + E(S) + ";");
        }
        const use = () => pick(locals);
        for (let i = 0, n = R(24, 36); i < n; i++) {
            const t = Math.random();
            if (t < 0.20) lines.push(pad(1) + "result += " + use() + " * " + E(S) + " + " + E(S) + ";");
            else if (t < 0.36) lines.push(pad(1) + "// " + C(S));
            else if (t < 0.50) {
                lines.push(pad(1) + "if (" + use() + " " + pick(OP) + " " + E(S) + " + " + E(S) + ") {");
                lines.push(pad(2) + "result += " + use() + " * " + E(S) + ";");
                lines.push(pad(1) + "}");
            } else if (t < 0.62) {
                lines.push(pad(1) + "for (size_t k = 0; k < " + R(4, 64) + "; ++k) {");
                lines.push(pad(2) + "result += " + use() + " * " + E(S) + ";");
                lines.push(pad(1) + "}");
            } else if (t < 0.72) lines.push(pad(1) + "result = fmax(result, " + use() + " * " + E(S) + " + " + E(S) + ");");
            else if (t < 0.82) lines.push(pad(1) + "samples.push_back(" + use() + " * " + E(S) + " + " + E(S) + ");");
            else if (t < 0.92) {
                lines.push(pad(1) + "switch (mode) {");
                lines.push(pad(2) + "case " + R(0, 4) + ": result = " + E(S) + "; break;");
                lines.push(pad(2) + "case " + R(4, 8) + ": result = " + E(S) + "; break;");
                lines.push(pad(2) + "default: result = " + E(S) + "; break;");
                lines.push(pad(1) + "}");
            } else {
                // A stray domain constant, inlined per call so it can't recur.
                lines.push(pad(1) + pick(S.nouns) + "_0 = " + num() + " * " + pick(S.nouns) + "_1;");
            }
        }
        lines.push(pad(1) + "return result;");
        lines.push(pad(0) + "}");
        lines.push("");
        return lines;
    };

    // One collection = one long algorithm: 5-9 related functions drawn from a
    // single randomly chosen domain, streamed as a continuous module with NO
    // term.reset() between collections — the buffer trims itself at the
    // scrollback limit, so the code just keeps scrolling past naturally (#89).
    const buildCollection = () => {
        const S = pick(DOMAINS);
        cur = { S };
        const funcs = [];
        const target = R(5, 10);
        // Bounded uniqueness: a domain has only verbs×nouns (≈80-100) names, and
        // sessionUsed grows across collections. Late in a long session a domain
        // can be nearly exhausted, and blindly re-picking until a fresh name
        // appears would spin the thread (freezing the stream). After a bounded
        // number of draws, top the collection up with reused names — they are
        // far from the earlier use, so no visible loop (#89).
        let attempts = 0;
        while (funcs.length < target && attempts++ < 40) {
            const f = pick(S.verbs) + "_" + pick(S.nouns);
            if (!sessionUsed.has(f)) { sessionUsed.add(f); funcs.push(f); }
        }
        while (funcs.length < target) {
            funcs.push(pick(S.verbs) + "_" + pick(S.nouns));
        }
        const lines = [];
        lines.push("/* ---- " + S.note + " ---- */");
        lines.push("");
        funcs.forEach(fn => lines.push(...buildFunction(fn, S)));
        return lines;
    };

    // The opening banner plays exactly once per screensaver run, when the code
    // first appears: a compile invocation, the includes, and the namespace that
    // every collection lives inside (#89). The matching close only appears when
    // the code disappears (buildEnding, during wind-down).
    const buildOpening = () => {
        const lines = [];
        lines.push("\r\nroot@kali:~# g++ -O3 -march=native -std=c++20 edex_phase_" + R(2, 9999) + ".cpp -lm -o sim");
        lines.push("");
        lines.push("/* eDEX OS - subsystem " + cap(pick(["telemetry", "analysis", "guidance", "detection", "warhead", "uplink", "defense", "recon", "propagation", "tracking"])) + " phase " + R(1, 9) + "." + R(0, 9) + " */");
        lines.push("/* " + pick(["no warranty - research use only", "declassified reference model", "internal audit build", "classified - export controlled", "nightly integration build"]) + " */");
        lines.push("#include <cmath>");
        lines.push("#include <vector>");
        lines.push("#include <array>");
        lines.push("#include <iostream>");
        lines.push("#include <random>");
        lines.push("using namespace std;");
        lines.push("");
        lines.push("namespace edex {");
        lines.push("");
        return lines;
    };

    // The closing banner plays exactly once, when the code disappears.
    const buildEnding = () => {
        const lines = [];
        lines.push("} // namespace edex");
        lines.push("");
        lines.push("[ OK ] all processes finished - exit code 0");
        return lines;
    };

    // The whole file (header + program) streams one line per tick: no bursts,
    // so the code never visibly "jumps" to something unrelated. Every file is
    // generated fresh; when one finishes the terminal is reset so the buffer
    // never grows past a single file (no long-session scrollback lag).
    // One-column right indent for the whole fake-code block: the passcode box
    // is drawn over this terminal, and code starting at column 0 read too far
    // left. A leading "\r\n" (opening banner) is a line-break, not a column,
    // so the space goes after it — not before.
    const indentCode = l => (l[0] === "\r" ? "\r\n " + l.slice(2) : " " + l);
    let pendingLines = [];
    let sessionFirstFile = true;
    const nextLine = () => {
        if (!pendingLines.length) {
            if (sessionFirstFile) {
                // Opening banner — only when the code first appears.
                sessionFirstFile = false;
                pendingLines = buildOpening();
            } else if (winding) {
                // Closing banner — only when the code disappears (wind-down).
                winding = false;
                pendingLines = buildEnding();
            } else {
                // Another random algorithm collection; the buffer trims itself
                // at the scrollback limit, no reset, so the code flows on.
                pendingLines = buildCollection();
            }
        }
        return pendingLines.shift();
    };

    let codeTickCount = 0;
    const codeTick = () => {
        // Stream into the cover session (real pty on the CLI panel tab). The
        // pty attaches asynchronously, so the wrapper can be null at first —
        // skip the tick and self-heal on the next one. The user's real
        // terminals (0-2) and running CLI sessions are never touched, so a
        // boot-time code lock (before _uiReady) simply no-ops, not crashes
        // (#50).
        const w = coverTerm();
        if (!w || !w.term || typeof w.term.write !== "function") return;
        w.term.write(indentCode(nextLine()) + "\r\n");
        // Once a second, force a full repaint from the buffer. The diff renderer
        // only repaints cells it saw change, so when a wrapped long line is
        // overwritten by a shorter one it can leave a stale glyph in the last
        // column that the compositor then carries into the lock screen (#82).
        // term.refresh() alone is not enough: it skips cells whose render cache
        // already matches the buffer even when the canvas still shows the stale
        // pixel — so clear the renderer's cache first, which makes the next
        // pass repaint the whole grid from the buffer and wipes the remnant.
        // Cheap: one 154×31 grid, and it only ever touches the fake code, never
        // the real terminal.
        if (++codeTickCount % 10 === 0) {
            try {
                const rs = w.term._core && w.term._core._renderService;
                if (rs && typeof rs.clear === "function") rs.clear();
                w.term.refresh(0, w.term.rows - 1);
            } catch (e) {}
        }
    };


    // ---- matrix style (fullscreen) ----
    let canvas = null, ctx = null, cols = 0, drops = [], mTimer = null;
    let fading = false, fadeTail = 0;
    const GRID = 22;
    const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#$%&@アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホ";
    const mResize = () => {
        if (!canvas) return;   // adopted by the lock (canvas/ctx reset) — nothing to size here
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        cols = Math.floor(canvas.width / GRID);
        drops = Array.from({ length: cols }, () => Math.floor(Math.random() * -canvas.height / GRID));
    };
    const mDraw = () => {
        ctx.fillStyle = "rgba(5, 8, 13, 0.08)";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.font = (GRID - 3) + "px 'Fira Mono', monospace";
        let remaining = 0;
        for (let i = 0; i < drops.length; i++) {
            // -99999 marks a drop that is gone for good; drops still start at
            // negative y (above the screen) and must keep falling into view
            if (drops[i] < -10000) continue;
            let ch = CHARS[Math.floor(Math.random() * CHARS.length)];
            ctx.fillStyle = "rgb(" + window.theme.r + "," + window.theme.g + "," + window.theme.b + ")";
            ctx.fillText(ch, i * GRID, drops[i] * GRID);
            if (drops[i] * GRID > canvas.height + 30) {
                // during wind-down, a drop that falls off stays off (rain drains);
                // normally it regenerates at the top
                if (fading) drops[i] = -99999;
                else if (Math.random() > 0.975) drops[i] = 0;
            } else {
                remaining++;
            }
            // wind-down: characters visibly thin out as some vanish each frame
            if (fading && Math.random() < 0.10) drops[i] = -99999;
            drops[i]++;
        }
        // wind-down: once every drop is gone, let the trailing fade settle, then
        // hide the canvas and play the eDEX boot animation
        if (fading && remaining === 0) { fading = false; fadeTail = 10; }
        if (fadeTail > 0 && --fadeTail === 0) {
            clearInterval(mTimer); mTimer = null;
            canvas.style.display = "none";
            if (typeof replayBoot === "function") replayBoot();
        }
    };

    return {
        show() {
            // The boot phase owns the screen completely: the boot lock (or the
            // first-run setup) is up before initUI, and a screensaver must never
            // cover it — otherwise a dismiss would raise a second, latch lock
            // (double password) and the boot screen would wrongly blank out of
            // the boot auth flow. Gate every entry point on _uiReady; the boot
            // lock and the session lock already gate themselves the same way.
            if (!window._uiReady) return;
            if (active) {
                // Already showing but the cover identity was lost — re-assert it.
                if (window.cover && !window.cover.isActive()) window.cover.set(true);
                return;
            }
            active = true;
            // User event sound on screensaver entry (#190: 矩阵屏保只留短音效
            // 不播人声;code 风格保留原语音)。
            window.eventPlay(window.settings.screensaverStyle === "matrix" ? "screensaver_fx" : "screensaver");
            // Timestamp so bumpActivity can tell input that STARTED this
            // screensaver (power-menu "Lock Screen", Win+L) apart from input
            // that comes later to dismiss it into the lock (#73).
            this.shownAt = Date.now();
            fading = false;
            fadeTail = 0;
            // Body marker so CSS can drop the terminal frame's left hairline
            // while the screensaver is up (the code style has no overlay element
            // to key off, and that line floats next to the lock box).
            document.body.classList.add("screensaver_on");
            if (window.cursorTrap) window.cursorTrap.hide();
            if (window.settings.screensaverStyle === "matrix") {
                // A stale canvas can survive DETACHED: after the lock adopts it
                // into #lock_screen, the lock's teardown removes that element
                // (and the canvas with it) without telling this module. A
                // detached canvas still "draws", so the rain runs but never
                // shows — the screensaver looks like fake panels with no rain.
                // Rebuild on any missing-or-detached canvas (#177).
                if (!canvas || !canvas.isConnected) {
                    if (canvas && canvas.remove) { try { canvas.remove(); } catch (e) {} }
                    canvas = document.createElement("canvas");
                    canvas.id = "screensaver_canvas";
                    canvas.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;z-index:9999;background:#05080d;display:none;";
                    document.body.appendChild(canvas);
                    ctx = canvas.getContext("2d");
                    mResize();
                    window.addEventListener("resize", mResize);
                }
                canvas.style.display = "block";
                mTimer = setInterval(mDraw, 50);
            } else {
                // Fresh code session: opening banner plays once, collections
                // stream until wind-down. Cleared so the same cover session can
                // be re-entered (timeout back to screensaver) with a fresh
                // opening.
                sessionFirstFile = true;
                sessionUsed.clear();
                winding = false;
                pendingLines = [];
                // Ensure the cover session exists and the shell is on its tab
                // before the fake identity (cover.set) paints over the labels.
                // The user's real terminals (0-2) and running CLI sessions are
                // never touched, so there is nothing to snapshot or replay on
                // unlock (#50).
                coverTerm();
                codeTimer = setInterval(codeTick, 100);
            }
            // The code screensaver draws NO covering overlay (the fake code
            // streams into the real terminal), so a body-level app-monitor
            // dropdown or a fullscreen webapp (z 9000) would float over it.
            // Close those. Open MODALS are intentionally left as they are: the
            // screensaver SHOWS popups — only the lock hides them, via its own
            // _snapshotWindows which owns modal hiding/restoring (#162).
            [window.appmonitorA, window.appmonitorB].forEach(p => {
                if (p && typeof p.closeMenu === "function") { try { p.closeMenu(); } catch (e) {} }
            });
            // A fullscreen webapp / browser / app-monitor native app (z 9000)
            // sits ABOVE the code screensaver — drop it so the screensaver
            // shows the panels, not the fullscreen app.
            if (window.webViewFullscreen && window.webViewFullscreen.el) {
                try { window.webViewFullscreen.exit(); } catch (e) {}
            }
            if (window.appmonitorApi && typeof window.appmonitorApi.exitFullscreen === "function") {
                try { window.appmonitorApi.exitFullscreen(); } catch (e) {}
            }
            if (document.fullscreenElement && typeof document.exitFullscreen === "function") {
                try { document.exitFullscreen(); } catch (e) {}
            }
            // While the screensaver plays, eDEX wears its cover identity (fake
            // tabs / filesystem / IP / process list).
            if (window.cover) window.cover.set(true);
        },
        hide(immediate, keepCover, keepMatrixRain, keepCodeStream) {
            if (!active) return;
            active = false;
            document.body.classList.remove("screensaver_on");
            if (window.cursorTrap) window.cursorTrap.show();
            // Leave cover mode: restore the real tabs / filesystem / IP / procs.
            // When dismissing straight into the lock (keepCover), the lock
            // re-engages the SAME fake identity a moment later — skipping the
            // restore here avoids the file browser churning real→fake while it
            // shows the same fake files either way.
            if (window.cover && !keepCover) window.cover.set(false);
            if (immediate) {
                // Used when dismissing straight into the lock screen: stop
                // cleanly, no wind-down animation and no boot replay. The lock
                // borrows the cover session and redraws it with the passcode
                // box, so it survives when keepCover is set; any other dismissal
                // destroys it and returns to the pre-cover tab (#50).
                // keepCodeStream (code → lock handover): keep the code timer
                // running so the stream continues behind the lock box until it
                // assembles — the code analogue of keepMatrixRain (#89).
                if (codeTimer && !keepCodeStream) { clearInterval(codeTimer); codeTimer = null; }
                if (mTimer && !keepMatrixRain) { clearInterval(mTimer); mTimer = null; }
                fading = false; fadeTail = 0;
                if (canvas && !keepMatrixRain) canvas.style.display = "none";
                if (!keepCover) {
                    const backTo = _coverRestoreTab;
                    endCover();
                    if (backTo != null && backTo !== window.currentTerm) {
                        try { if (window.focusShellTab) window.focusShellTab(backTo); } catch (e) {}
                    }
                }
                return;
            }
            if (canvas) {
                // Matrix wind-down: stop generating new characters so the rain
                // drains out naturally; when the fade settles (in mDraw) the eDEX
                // boot animation plays. No flash and no instant cut.
                fading = true;
            }
            if (codeTimer) {
                clearInterval(codeTimer);
                codeTimer = null;
                // Natural wind-down for the code style: stop generating, write a
                // completion line, then scroll the code up one line at a time so
                // the visible code gradually decreases; once it's scrolled off,
                // the cover session is destroyed and the pre-cover tab restored.
                // The user's real terminals were never touched, so no reset or
                // prompt replay is needed (#50).
                const w = coverTerm();
                const backTo = _coverRestoreTab;
                const finishCover = () => {
                    endCover();
                    if (backTo != null && backTo !== window.currentTerm) {
                        try { if (window.focusShellTab) window.focusShellTab(backTo); } catch (e) {}
                    }
                };
                if (w && w.term && typeof w.term.write === "function") {
                    // Closing banner — the fake ending plays only when the
                    // code disappears (#89).
                    buildEnding().forEach(l => w.term.write(indentCode(l) + "\r\n"));
                    let rows = w.term.rows || 24;
                    let scrolled = 0;
                    let scroller = setInterval(() => {
                        if (typeof w.term.write === "function") w.term.write("\n");
                        scrolled++;
                        if (scrolled >= rows) {
                            clearInterval(scroller);
                            finishCover();
                        }
                    }, 45);
                } else {
                    finishCover();
                }
            }
        },
        isActive() { return active; },
        // True while the Matrix-rain screensaver is actually running (canvas up
        // and the draw timer alive). Used by bumpActivity to decide whether the
        // rain can be handed to the lock screen instead of being torn down.
        isMatrixActive() { return active && mTimer !== null && !!canvas; },
        // Hand the running Matrix rain to the lock screen: return the canvas,
        // its context and the live drop state plus the running draw timer, so
        // the lock can keep the waterfall going where it was instead of
        // restarting fresh (#86). The caller owns the timer from here on.
        adoptMatrixRain() {
            if (!canvas || mTimer === null) return null;
            // Stop the module's own draw loop here: mDraw is closure-bound to
            // this canvas/ctx, and the lock is about to move both into its own
            // overlay and tear that overlay down on unlock. Handing the running
            // interval to the lock would keep firing mDraw against the nulled
            // ctx below — a crash per frame. The lock drives the adopted canvas
            // with its OWN timer (lockScreen._showFullscreen), so no interval
            // is transferred.
            clearInterval(mTimer);
            mTimer = null;
            const adopted = { canvas, ctx, drops, cols, GRID, mTimer: null };
            // The lock now owns this canvas (it moves it inside #lock_screen and
            // tears that element down on unlock, detaching the canvas). Forget
            // the reference so the NEXT screensaver start builds a fresh,
            // attached canvas — otherwise show() keeps drawing to the detached
            // one and the rain silently stops appearing after the first
            // screensaver→lock→unlock cycle (#177).
            canvas = null;
            ctx = null;
            return adopted;
        },
        // Expose the procedural code generator so the lock screen can stream
        // the same sci-fi C++ onto its own fullscreen canvas.
        getCodeLine() { return nextLine(); },
        // Code-mode dismissal into the lock (#89): stop streaming, write the
        // closing banner, then accelerate-scroll the code away (~1s), so the
        // passcode box assembles in over a terminal that has visibly "finished".
        windDownCodeToLock(cb) {
            if (!active || winding) { if (cb) cb(); return; }
            winding = true;
            if (codeTimer) { clearInterval(codeTimer); codeTimer = null; }
            const w = coverTerm();
            if (!w || !w.term || typeof w.term.write !== "function") { winding = false; if (cb) cb(); return; }
            buildEnding().forEach(l => w.term.write(indentCode(l) + "\r\n"));
            let ticks = 0;
            const accel = setInterval(() => {
                try {
                    for (let i = 0; i < 4; i++) w.term.write("\n");
                } catch (e) {}
                if (++ticks >= 30) {
                    clearInterval(accel);
                    clearTimeout(safety);
                    winding = false;
                    if (cb) cb();
                }
            }, 32);
            // Safety net: if a terminal write ever wedges the interval, never
            // leave the state wound — force the handover through after 2.5s.
            const safety = setTimeout(() => {
                if (winding) { clearInterval(accel); winding = false; if (cb) cb(); }
            }, 2500);
        },
        isWindingDown() { return winding; },
        // True while the code stream is actually running (timer alive), even if
        // the screensaver has already been hidden into the lock. Used by the
        // lock screen to tell a screensaver → lock handover (stream kept alive,
        // box assembles over it) apart from a direct lock (needs a fresh stream
        // started first) (#89).
        isCodeStreaming() { return !!codeTimer; },
        // 30s idle timeout back to the screensaver (matrix style): the lock hands
        // its (adopted or own) canvas and drop positions back and the rain picks
        // up where it fell. No timer is passed — a fresh draw timer starts here,
        // and the lock's own timer is cleared by its teardown (#88).
        returnMatrixRain(cv, dropState) {
            if (cv) {
                canvas = cv;
                ctx = cv.getContext("2d");
                if (dropState && dropState.length) drops = dropState;
                cols = drops.length;
                // The lock moved the canvas inside its overlay; move it back to
                // <body> before the lock element is removed, or the rain dies
                // with it.
                if (canvas.parentNode && canvas.parentNode !== document.body) {
                    document.body.appendChild(canvas);
                }
                canvas.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;z-index:9999;background:#05080d;display:block;";
            }
            fading = false;
            fadeTail = 0;
            active = true;
            document.body.classList.add("screensaver_on");
            if (window.cursorTrap) window.cursorTrap.hide();
            if (window.cover && !window.cover.isActive()) window.cover.set(true);
            if (!mTimer) mTimer = setInterval(mDraw, 50);
        },
        // 30s idle timeout back to the screensaver (code style): restart the
        // streamer on the terminal the lock just blanked, with a fresh session
        // so the opening banner replays as the code "appears" again (#88).
        resumeCode() {
            if (active || window.settings.screensaverStyle !== "code") return;
            active = true;
            document.body.classList.add("screensaver_on");
            if (window.cursorTrap) window.cursorTrap.hide();
            if (window.cover && !window.cover.isActive()) window.cover.set(true);
            sessionFirstFile = true;
            sessionUsed.clear();
            winding = false;
            pendingLines = [];
            // Rebuild the cover session synchronously so the resumed stream does
            // not flash the user's CLI app for a frame (#88 / #50).
            coverTerm();
            if (!codeTimer) codeTimer = setInterval(codeTick, 100);
        },
        // Cover-session API shared with the lock screen (#50). The lock borrows
        // the same real pty the code screensaver streams into, so a screensaver
        // → lock handover is seamless, and a direct lock (Win+L) creates one.
        coverTerm,
        coverRestoreTab,
        endCover,
        streamCodeIntoCover,
        stopCodeStream
    };
})();

// Auto-hide the cursor: shown on movement, hidden again after a quiet period
// (default 10 s), and hidden outright while the screensaver/lock is up.
// Global mouse-wheel speed multiplier (settings.mouseWheelSpeed, 0.25x-4x).
// Terminals own their wheel handling (terminal.class.js multiplies the same
// setting); every other scrollable (settings modal, file browser, …) gets its
// delta scaled here in the capture phase. Reads the setting live, so a save
// takes effect immediately with no re-registration.
window.addEventListener("wheel", e => {
    const spd = Number(window.settings.mouseWheelSpeed);
    if (!isFinite(spd) || spd <= 0 || spd === 1) return;
    if (e.target && e.target.closest && e.target.closest(".xterm")) return; // terminals handle themselves
    let el = e.target;
    while (el && el !== document.body && el !== document.documentElement) {
        if (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1) break;
        el = el.parentElement;
    }
    if (!el || el === document.body || el === document.documentElement) return;
    e.preventDefault();
    el.scrollTop += e.deltaY * spd;
    el.scrollLeft += e.deltaX * spd;
}, { capture: true, passive: false });

// Honors settings.cursorAutoHide (false disables) / cursorAutoHideDelay (s).
window.cursorTrap = (() => {
    let timer = null;
    let disabled = window.settings.cursorAutoHide === false;
    const hide = () => { if (!disabled) document.body.classList.add("cursor_hidden"); };
    const show = () => {
        document.body.classList.remove("cursor_hidden");
        if (disabled) return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(hide, (Number(window.settings.cursorAutoHideDelay) || 10) * 1000);
    };
    const off = () => { disabled = true; document.body.classList.remove("cursor_hidden"); };
    const on = () => { disabled = false; show(); };
    if (!disabled) {
        window.addEventListener("mousemove", () => show(), { passive: true });
        show();
    }
    return { show, hide, off, on };
})();

// ---- Software screen-off ----
// After `screenOffIdle` seconds without input the display is blanked with a
// fullscreen black overlay (#93) AND the panel is powered down for real via
// xset DPMS (power:screen) — the overlay alone would leave the backlight lit,
// which on an LCD reads as "black, not off". It engages even while the
// screensaver plays (the timeout is clamped to be ≥ screensaverIdle, so the
// screensaver always starts first) and any input wakes it: DPMS auto-wakes on
// input and hideScreenOff() sends the matching force-on. The overlay fades
// away and the normal screensaver / lock flow continues underneath.
const screenOffEl = () => document.getElementById("screen_off");
// True while the real panel has been powered down (screen:power off) — set on
// show, cleared on hide so the matching force-on is sent exactly once.
let screenOffPowered = false;
// Keyboard-backlight level captured when the screen blanks, restored on wake so
// the keys go dark with the panel (#89). Refreshed every off-cycle; `null` when
// the capture read hasn't landed yet.
let screenOffKbdLevel = null;
const showScreenOff = () => {
    if (screenOffEl()) return;
    const el = document.createElement("div");
    el.id = "screen_off";
    el.className = "screen_off";
    document.body.appendChild(el);
    // #93: mark true invisibility on <body> so __uiCovered and the screen_off
    // CSS (animation freeze) can key off it. The screensaver/lock body class
    // screensaver_on is NOT this — those keep the display on and animated.
    document.body.classList.add("screen_off");
    // The custom pointer pack would glow through the black — hide the cursor
    // exactly like the screensaver does.
    if (window.cursorTrap) window.cursorTrap.hide();
    // Power the panel down for real. Non-Linux previews have no panel to turn
    // off — the handler returns a mock and only the overlay blanks.
    if (!screenOffPowered) {
        screenOffPowered = true;
        ipc.invoke("power:screen", { action: "off" }).catch(() => {});
    }
    // Dim the keyboard backlight with the panel, capturing the live level so
    // wake restores it (the saved setting is only the boot default — the
    // dropdown may have changed it since).
    ipc.invoke("kbd:backlight", {}).then(r => {
        if (r && r.ok && r.level != null) screenOffKbdLevel = r.level;
    }).catch(() => {});
    ipc.invoke("kbd:backlight", { set: 0 }).catch(() => {});
};
window.hideScreenOff = () => {
    const el = screenOffEl();
    if (!el) return;
    document.body.classList.remove("screen_off");
    if (screenOffPowered) {
        screenOffPowered = false;
        ipc.invoke("power:screen", { action: "on" }).catch(() => {});
    }
    // Bring the keyboard backlight back with the panel. If the capture read
    // hadn't landed yet, fall back to the saved boot value.
    const lv = screenOffKbdLevel;
    screenOffKbdLevel = null;
    ipc.invoke("kbd:backlight", { set: (lv != null ? lv : (window.settings.kbdBacklight ?? 1)) }).catch(() => {});
    el.classList.add("screen_off_fade_out");
    // Disable pointer capture immediately: the overlay is invisible by now and
    // must never swallow clicks, even if the removal timeout below is delayed
    // by a throttled/frozen renderer — an opacity-0 click-eater is the "can't
    // click anything after waking" bug (#163). Inline style beats the CSS
    // animation's fade-out state.
    el.style.pointerEvents = "none";
    setTimeout(() => { if (el.isConnected) el.remove(); }, 420);
    // Reveal the cursor unless the screensaver is still running — it manages
    // the cursor itself and is about to take over (or dismiss into a lock).
    if (!(window.screensaver && window.screensaver.isActive())) {
        if (window.cursorTrap) window.cursorTrap.show();
    }
};

// Idle tracking: any input wakes the screensaver and re-arms the idle timer.
let lastActivity = Date.now();
// Exposed for the lock screen's 30s idle timeout — the lock needs to know the
// last real interaction (mouse/keyboard) so it can drop back to the screensaver
// when the user stops typing without unlocking (#88).
window._lastActivityTime = () => lastActivity;
const bumpActivity = () => {
    lastActivity = Date.now();
    // Any input wakes the display if it was blanked by the screen-off timeout.
    window.hideScreenOff();
    if (window.screensaver.isActive()) {
        // Grace window: the very click/keydown that starts the screensaver
        // (power menu "Lock Screen", Win+L) bubbles up to this document-level
        // handler; dismissing on it would skip the screensaver entirely and
        // jump straight into the passcode box. Ignore any input for the first
        // ~400ms of a screensaver run — the next real interaction dismisses it.
        if (Date.now() - (window.screensaver.shownAt || 0) < 400) return;
        // The POWER menu can be open over the screensaver (OS power button
        // while idle). While it is up, input must NOT dismiss the screensaver
        // into the passcode box — that would cover the menu mid-use. Stay in
        // the screensaver until the menu closes; the next input then dismisses
        // normally into the lock.
        const powerMenuOpen = Object.values(window.modals || {}).some(m => m && m.title === "POWER");
        if (powerMenuOpen) return;
        // Dismissing the screensaver leads into the lock screen when a passcode
        // is configured (lockOnIdle + non-empty lockCode), or when the
        // screensaver was started from the power menu's Lock Screen button
        // (forceLockOnDismiss) — that flow is screensaver-then-lock by design.
        const forceLock = window.screensaver.forceLockOnDismiss === true;
        window.screensaver.forceLockOnDismiss = false;
        // willLock is gated on `_uiReady`: dismissing a screensaver must never
        // create a fresh session lock while eDEX is still booting. The boot lock
        // owns the screen until the boot password unlocks into initUI, so a
        // dismiss over the boot screen only wakes the display (hideScreenOff) —
        // it must not raise a second, latch lock that asks for the code again.
        const willLock = (forceLock || (window.settings.lockOnIdle !== false && String(window.settings.lockCode || "").length > 0))
            && window.lockScreen && !window.lockScreen.active && window._uiReady;
        // keepCover: both the screensaver and the lock wear the same fake
        // identity, so don't drop it (and re-render the file browser) just to
        // re-assert it a frame later.
        // Matrix → matrix lock: don't tear the rain down at all. hide() keeps
        // the canvas + draw timer alive (keepMatrixRain), and the lock adopts
        // them in _showFullscreen so the waterfall continues where it was (#86).
        const matrixToMatrix = willLock
            && window.settings.screensaverStyle === "matrix"
            && window.screensaver.isMatrixActive && window.screensaver.isMatrixActive();
        if (willLock && window.settings.screensaverStyle === "code") {
            // Code → lock: keep the fake code streaming and let the passcode box
            // assemble right over it — no wind-down, no restart (#89). The lock
            // reuses the very cover session the code writes into, and stops the
            // stream once the box is drawn (they share the terminal grid, so new
            // lines would otherwise scroll the box away), so the handover reads
            // as "the lock appears over the running code" — the code analogue of
            // the matrix keepRain path above (#86). Edge: if the stream isn't up,
            // fall back to the wind-down handover so the lock never assembles
            // over a dead terminal.
            if (window.screensaver.isCodeStreaming()) {
                window.screensaver.hide(true, true, false, true);
                window.eventPlay("lock_show");
                window.lockScreen.show();
            } else if (!window.screensaver.isWindingDown()) {
                window.screensaver.windDownCodeToLock(() => {
                    window.screensaver.hide(true, true, false);
                    window.eventPlay("lock_show");
                    window.lockScreen.show();
                });
            }
            return;
        }
        window.screensaver.hide(true, willLock, matrixToMatrix);
        // #190 矩阵锁密码框出现只播音效;code 锁路径(上方 6471/6476)保持原语音。
        if (willLock) {
            window.eventPlay(window.settings.screensaverStyle === "matrix" ? "lock_show_fx" : "lock_show");
            window.lockScreen.show();
        }
    }
};
["mousemove", "mousedown", "keydown", "wheel", "touchstart", "click"].forEach(ev =>
    window.addEventListener(ev, bumpActivity, { passive: true })
);
setInterval(() => {
    const idleMs = Date.now() - lastActivity;
    const locked = window.lockScreen && window.lockScreen.active;
    const screensaverOn = window.screensaver.isActive();
    // Boot phase (before initUI): even if the boot lock's `active` flag is not
    // yet set (older flows), the display must never hand the screen to the
    // screensaver — the boot password unlocks straight into eDEX. Blanking is
    // still honoured at the screen-off timeout, and a wake keypress returns to
    // the very same boot screen. This is what keeps "sit on the boot password"
    // from ever producing a screensaver-then-lock double prompt.
    const bootPhase = !window._uiReady;
    const screenOffIdle = (Number(window.settings.screenOffIdle) || 1800) * 1000;
    const screensaverIdle = (Number(window.settings.screensaverIdle) || 300) * 1000;
    const shouldLockOnIdle = window.settings.lockOnIdle !== false
        && String(window.settings.lockCode || "").length > 0;

    if (screensaverOn || locked || bootPhase) {
        // Established screensaver or lock: after screenOffIdle the display blanks
        // OVER it. The overlay only ever covers a screensaver that is already
        // running (never the tick it starts on), so a wake keypress always has an
        // active screensaver to dismiss into the lock — not "real UI, no lock".
        // Blanking a locked screen is safe too: bumpActivity hides the overlay and
        // the lock reads the passcode off a window-level keydown.
        if (!screenOffEl() && idleMs >= screenOffIdle) showScreenOff();
        return;
    }

    // Idle with the screensaver animation disabled must still honor the lock
    // timeout. Turning off 屏保 while keeping 空闲自动锁定 used to mean idle
    // NEVER locked — the screen just blanked at screenOffIdle and a wake
    // keypress (bumpActivity) found no active screensaver to dismiss, landing
    // on the real UI. Lock straight at screensaverIdle; blanking follows one
    // tick later once locked (handled above). Nothing below gates on modalUp:
    // a stray modal (auto update notice, settings) must never pin the display
    // on forever.
    if (!window.settings.screensaverEnabled) {
        if (shouldLockOnIdle && idleMs >= screensaverIdle
            && window.lockScreen && !window.lockScreen.active) {
            window.lockScreen.show();
            return;
        }
        if (!screenOffEl() && idleMs >= screenOffIdle) showScreenOff();
        return;
    }

    // Screensaver first, blanking one tick later over the established
    // screensaver (screenOffIdle is clamped >= screensaverIdle in settings, so
    // the screensaver always wins the boundary tick and the black never covers
    // a bare desktop). The lock screen appears on dismiss (bumpActivity) when
    // a passcode is configured.
    if (idleMs >= screensaverIdle) {
        // A stray modal (auto update notice, settings) left open would cover
        // the screensaver animation and pin the display awake forever. Close
        // every open modal first (same idiom as sysCmd.startScreensaver), then
        // let the animation take over.
        const ks = Object.keys(window.modals);
        for (let i = 0; i < ks.length; i++) {
            try { window.modals[ks[i]].close(); } catch (e) {}
        }
        window.screensaver.show();
    } else if (!screenOffEl() && idleMs >= screenOffIdle) {
        showScreenOff();
    }
}, 1000);

// Suspend/resume (laptop lid close): after the system wakes, a full-screen
// overlay frozen mid-suspend (screensaver canvas or lock block) would sit on
// top and swallow every click — the "lid closed, can't click anything" bug.
// Tear all overlays down, un-hide the cursor, re-fit the terminals, and
// re-lock when a passcode is configured. The whole body is fenced: a throw
// mid-teardown leaves the cursor hidden and the overlay stuck — exactly the
// "dead keyboard/touchpad after lid-open" the resume path used to produce.
const resumeFromSuspend = () => {
    try {
        lastActivity = Date.now();
        window.hideScreenOff();
        if (window.screensaver) window.screensaver.hide(true);
        if (window.cursorTrap) window.cursorTrap.show();
        if (window.lockScreen && !window.lockScreen.active
            && window.settings.lockOnIdle !== false
            && String(window.settings.lockCode || "").length > 0) {
            window.lockScreen.engage();
        }
        Object.keys(window.term || {}).forEach(k => {
            const t = window.term[k];
            if (t && t.term && typeof t.fit === "function") t.fit();
            // The ws may have died during suspend; force a fresh connection
            // instead of waiting for the next silent-failed send (#67).
            if (t && typeof t.reconnectNow === "function") t.reconnectNow();
        });
    } catch (e) {
        try { console.error("resumeFromSuspend failed:", e && e.stack || e); } catch (_) {}
    }
};
ipc.on("pm:resume", resumeFromSuspend);
// Lid closing / system suspending: engage the lock NOW so the frame buffer that
// survives the sleep is the lock, not the live desktop. On wake the lock is
// already active, so resumeFromSuspend only restores cursor + terminals and the
// user types the PIN — no flash of the real UI before the screensaver.
ipc.on("pm:suspend", () => {
    try {
        if (window.lockScreen && !window.lockScreen.active
            && window.settings && String(window.settings.lockCode || "").length > 0
            && window.settings.lockOnIdle !== false) {
            window.lockScreen.engage();
        }
    } catch (e) {
        try { console.error("pm:suspend handler failed:", e && e.stack || e); } catch (_) {}
    }
});
// A lid close that only blanks the display (no full suspend) arrives as a
// visibility change instead — run the same recovery.
document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") resumeFromSuspend();
});

// ---- Self-heal watchdog: a long session accumulates JS heap in the decorative
// panels / live charts, and the UI degrades (stutter/“越用越卡”). Silently
// reload the renderer when the heap grows too large. A renderer reload is fast
// and keeps the main process + the real pty terminals, so the sci-fi desktop
// comes back smooth instead of progressively freezing. Guarded against reload-
// loops. Threshold: settings.edexHeapGuardMB (default 700 MB).
setInterval(() => {
    try {
        const m = (typeof performance !== "undefined" && performance.memory) ? performance.memory : null;
        if (!m || !m.usedJSHeapSize) return;
        const limitMB = Number(window.settings && window.settings.edexHeapGuardMB) || 700;
        if (m.usedJSHeapSize > limitMB * 1024 * 1024) {
            const now = Date.now();
            if (!window._lastHeapReload || (now - window._lastHeapReload) > 45000) {
                window._lastHeapReload = now;
                try { console.warn("[edex-heal] heap high (" + (m.usedJSHeapSize / 1048576).toFixed(0) + " MB) — reloading renderer"); } catch (_) {}
                setTimeout(() => { try { window.location.reload(); } catch (e) {} }, 250);
            }
        }
    } catch (e) {}
}, 5000);
