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

    /* auto-hide the cursor after a quiet period — see cursorTrap below */
    .cursor_hidden, .cursor_hidden * { cursor: none !important; }

    ${window._purifyCSS(theme.injectCSS || "")}
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
function initSystemInformationProxy() {
    const { nanoid } = require("nanoid/non-secure");

    window.si = new Proxy({}, {
        apply: () => {throw new Error("Cannot use sysinfo proxy directly as a function")},
        set: () => {throw new Error("Cannot set a property on the sysinfo proxy")},
        get: (target, prop, receiver) => {
            return function(...args) {
                let callback = (typeof args[args.length - 1] === "function") ? true : false;

                return new Promise((resolve, reject) => {
                    let id = nanoid();
                    ipc.once("systeminformation-reply-"+id, (e, res) => {
                        if (callback) {
                            args[args.length - 1](res);
                        }
                        resolve(res);
                    });
                    ipc.send("systeminformation-call", prop, id, ...args);
                });
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
        setTimeout(displayTitleScreen, 300);
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
            <li id="shell_tab4" onclick="window.focusShellTab(4);"><p>${(window.settings.appMonitor||{}).showGui?'<button class="appmonitor_fs_tab" title="Fullscreen" onclick="event.stopPropagation();window.appmonitorB.fullscreenButton()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M2 2h20L2 22z"/></svg></button>':''}<span id="shell_tab4_label">APP</span> <span class="webapp_chevron" title="Switch app" onclick="event.stopPropagation();window.appmonitorB.toggleMenu(event);">${Icons.chevronDown}</span></p></li>
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
        window.eventPlay("power_cancel");
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
    // (claude, links2, aerc, btop, musicfox) run in a real terminal session, and
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
        openConfig() {
            const st = this.status;
            if (!st || !st.configPath) return;
            // Open the directory the config lives in (so the user can edit
            // config.yaml by hand); shell.openPath on the file itself works too.
            const dir = st.configPath.replace(/[^/]+\.yaml$/, "");
            require("electron").shell.openPath(dir);
        },
        openDashboard() {
            const ctrl = (this.status && this.status.controller) || "127.0.0.1:9090";
            // metacubexd serves /ui/ from the controller; fullscreen overlay
            // because the multi-tab browser was retired (see webViewFullscreen).
            window.webViewFullscreen.enter("http://" + ctrl + "/ui/", "persist:edex-browser");
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
                set("settingsUpLinks2Ver", (st.links2 && st.links2.installed) ? (st.links2.version ? "v" + st.links2.version : "installed") : "–");
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
window.BG_CONTOUR = "url('data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%221920%22%20height%3D%221080%22%20viewBox%3D%220%200%201920%201080%22%3E%3Cdefs%3E%3ClinearGradient%20id%3D%22bg%22%20x1%3D%220%22%20y1%3D%220%22%20x2%3D%221%22%20y2%3D%221%22%3E%3Cstop%20offset%3D%220%22%20stop-color%3D%22%23131410%22%2F%3E%3Cstop%20offset%3D%220.55%22%20stop-color%3D%22%230e0f0e%22%2F%3E%3Cstop%20offset%3D%221%22%20stop-color%3D%22%230b0c0b%22%2F%3E%3C%2FlinearGradient%3E%3C%2Fdefs%3E%3Crect%20width%3D%221920%22%20height%3D%221080%22%20fill%3D%22url(%23bg)%22%2F%3E%3Cg%20fill%3D%22none%22%20stroke%3D%22%23f2e05e%22%20stroke-width%3D%221%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%20stroke-opacity%3D%220.15%22%3E%3Cpath%20d%3D%22M%201530%20209%20Q%201526%20210%201523%20210%20Q%201520%20211%201515%20215%20Q%201510%20218%201509%20219%20Q%201508%20220%201504%20225%20Q%201501%20230%201500%20231%20Q%201500%20233%201499%20236%20Q%201498%20240%201498%20245%20Q%201497%20250%201498%20255%20Q%201499%20260%201499%20260%20Q%201500%20260%201502%20265%20Q%201505%20270%201507%20272%20Q%201510%20275%201512%20277%20Q%201514%20280%201517%20281%20Q%201520%20283%201525%20286%20Q%201530%20288%201535%20288%20Q%201540%20289%201545%20288%20Q%201550%20288%201555%20285%20Q%201560%20283%201561%20281%20Q%201563%20280%201566%20276%20Q%201570%20272%201570%20271%20Q%201571%20270%201572%20265%20Q%201574%20260%201574%20255%20Q%201574%20250%201574%20245%20Q%201573%20240%201571%20235%20Q%201570%20231%201569%20230%20Q%201569%20230%201565%20225%20Q%201561%20220%201560%20219%20Q%201560%20218%201555%20215%20Q%201550%20212%201546%20211%20Q%201542%20210%201541%20209%20Q%201540%20209%201535%20209%20Q%201540%20209%201530%20209%20Z%22%2F%3E%3Cpath%20d%3D%22M%201090%20228%20Q%201080%20230%201080%20230%20Q%201080%20230%201075%20231%20Q%201070%20233%201065%20235%20Q%201060%20237%201058%20238%20Q%201056%20240%201053%20241%20Q%201050%20243%201046%20246%20Q%201042%20250%201041%20251%20Q%201040%20252%201036%20256%20Q%201032%20260%201031%20261%20Q%201030%20263%201027%20266%20Q%201025%20270%201022%20274%20Q%201020%20278%201019%20279%20Q%201018%20280%201016%20285%20Q%201013%20290%201011%20294%20Q%201010%20298%201009%20299%20Q%201009%20300%201007%20305%20Q%201005%20310%201003%20315%20Q%201002%20320%201001%20323%20Q%201000%20327%20999%20328%20Q%20999%20330%20997%20335%20Q%20995%20340%20993%20345%20Q%20992%20350%20991%20352%20Q%20990%20354%20987%20357%20Q%20985%20360%20982%20362%20Q%20980%20364%20975%20365%20Q%20970%20367%20965%20367%20Q%20960%20368%20955%20369%20Q%20950%20370%20950%20370%20Q%20950%20370%20945%20370%20Q%20940%20371%20935%20372%20Q%20930%20373%20925%20374%20Q%20920%20375%20915%20377%20Q%20910%20378%20908%20379%20Q%20906%20380%20903%20381%20Q%20900%20382%20895%20385%20Q%20890%20387%20888%20388%20Q%20886%20390%20883%20392%20Q%20880%20394%20876%20397%20Q%20873%20400%20871%20401%20Q%20870%20403%20867%20406%20Q%20864%20410%20862%20413%20Q%20860%20416%20859%20418%20Q%20858%20420%20856%20425%20Q%20854%20430%20853%20435%20Q%20852%20440%20853%20445%20Q%20853%20450%20854%20455%20Q%20855%20460%20857%20464%20Q%20860%20468%20860%20469%20Q%20860%20470%20865%20474%20Q%20870%20479%20870%20479%20Q%20870%20480%20875%20483%20Q%20880%20486%20885%20487%20Q%20890%20489%20890%20489%20Q%20891%20490%20895%20490%20Q%20900%20491%20905%20491%20Q%20910%20490%20912%20490%20Q%20914%20490%20917%20489%20Q%20920%20488%20925%20486%20Q%20930%20484%20934%20482%20Q%20938%20480%20939%20479%20Q%20940%20479%20945%20475%20Q%20950%20471%20950%20470%20Q%20951%20470%20955%20465%20Q%20960%20460%20960%20460%20Q%20960%20460%20963%20455%20Q%20967%20450%20968%20447%20Q%20970%20445%20971%20442%20Q%20972%20440%20975%20435%20Q%20977%20430%20978%20427%20Q%20980%20424%20981%20422%20Q%20982%20420%20983%20415%20Q%20985%20410%20987%20405%20Q%20989%20400%20989%20399%20Q%20990%20399%20992%20394%20Q%20994%20390%20997%20386%20Q%201000%20382%201002%20381%20Q%201004%20380%201007%20378%20Q%201010%20377%201015%20376%20Q%201020%20375%201025%20375%20Q%201030%20374%201035%20374%20Q%201040%20374%201045%20373%20Q%201050%20373%201055%20373%20Q%201060%20372%201065%20371%20Q%201070%20371%201073%20370%20Q%201077%20370%201078%20369%20Q%201080%20369%201085%20368%20Q%201090%20367%201095%20365%20Q%201100%20363%201105%20362%20Q%201110%20360%201110%20360%20Q%201110%20360%201115%20357%20Q%201120%20354%201123%20352%20Q%201127%20350%201128%20349%20Q%201130%20348%201134%20344%20Q%201139%20340%201139%20339%20Q%201140%20339%201143%20334%20Q%201146%20330%201148%20327%20Q%201150%20324%201151%20322%20Q%201152%20320%201154%20315%20Q%201156%20310%201158%20305%20Q%201159%20300%201159%20297%20Q%201160%20295%201160%20292%20Q%201160%20290%201160%20286%20Q%201160%20282%201159%20281%20Q%201159%20280%201158%20275%20Q%201157%20270%201155%20265%20Q%201152%20260%201151%20257%20Q%201150%20255%201147%20252%20Q%201145%20250%201142%20246%20Q%201140%20243%201137%20241%20Q%201134%20240%201132%20238%20Q%201130%20236%201125%20234%20Q%201120%20232%201116%20231%20Q%201112%20230%201111%20229%20Q%201110%20229%201105%20228%20Q%201100%20228%201095%20228%20Q%201100%20228%201090%20228%20Z%22%2F%3E%3Cpath%20d%3D%22M%201510%20167%20Q%201502%20170%201501%20170%20Q%201500%20171%201495%20173%20Q%201490%20176%201487%20178%20Q%201485%20180%201482%20182%20Q%201480%20184%201477%20187%20Q%201474%20190%201472%20192%20Q%201470%20195%201468%20197%20Q%201466%20200%201463%20205%20Q%201461%20210%201460%20211%20Q%201460%20213%201458%20216%20Q%201457%20220%201456%20225%20Q%201455%20230%201454%20235%20Q%201454%20240%201454%20245%20Q%201454%20250%201455%20255%20Q%201456%20260%201457%20265%20Q%201458%20270%201459%20271%20Q%201460%20273%201461%20276%20Q%201462%20280%201465%20285%20Q%201468%20290%201469%20291%20Q%201470%20292%201472%20296%20Q%201475%20300%201477%20302%20Q%201480%20305%201482%20307%20Q%201484%20310%201487%20312%20Q%201490%20315%201493%20317%20Q%201496%20320%201498%20321%20Q%201500%20322%201505%20325%20Q%201510%20328%201512%20329%20Q%201514%20330%201517%20331%20Q%201520%20332%201525%20333%20Q%201530%20335%201535%20336%20Q%201540%20337%201545%20337%20Q%201550%20337%201555%20337%20Q%201560%20337%201565%20335%20Q%201570%20334%201575%20332%20Q%201580%20330%201580%20330%20Q%201581%20330%201585%20327%20Q%201590%20324%201592%20322%20Q%201595%20320%201597%20317%20Q%201600%20315%201601%20312%20Q%201603%20310%201606%20305%20Q%201610%20300%201610%20300%20Q%201610%20300%201612%20295%20Q%201614%20290%201615%20285%20Q%201616%20280%201617%20275%20Q%201618%20270%201618%20265%20Q%201619%20260%201618%20255%20Q%201618%20250%201617%20245%20Q%201617%20240%201615%20235%20Q%201614%20230%201612%20225%20Q%201611%20220%201610%20218%20Q%201610%20217%201608%20213%20Q%201606%20210%201603%20205%20Q%201600%20200%201599%20200%20Q%201599%20200%201595%20195%20Q%201591%20190%201590%20189%20Q%201590%20188%201585%20184%20Q%201580%20180%201579%20180%20Q%201579%20180%201574%20176%20Q%201570%20173%201565%20171%20Q%201561%20170%201560%20169%20Q%201560%20169%201555%20167%20Q%201550%20166%201545%20165%20Q%201540%20164%201535%20164%20Q%201530%20164%201525%20164%20Q%201520%20165%201515%20166%20Q%201520%20165%201510%20167%20Z%22%2F%3E%3Cpath%20d%3D%22M%201080%20188%20Q%201073%20190%201071%20190%20Q%201070%20190%201065%20192%20Q%201060%20193%201055%20196%20Q%201050%20198%201048%20199%20Q%201046%20200%201043%20201%20Q%201040%20203%201035%20206%20Q%201030%20210%201030%20210%20Q%201030%20210%201025%20213%20Q%201020%20216%201017%20218%20Q%201015%20220%201012%20222%20Q%201010%20224%201007%20227%20Q%201004%20230%201002%20232%20Q%201000%20234%20997%20237%20Q%20995%20240%20992%20243%20Q%20990%20246%20988%20248%20Q%20987%20250%20983%20254%20Q%20980%20259%20979%20259%20Q%20979%20260%20975%20265%20Q%20972%20270%20971%20271%20Q%20970%20273%20967%20276%20Q%20964%20280%20962%20283%20Q%20960%20286%20958%20288%20Q%20956%20290%20953%20293%20Q%20950%20297%20948%20298%20Q%20947%20300%20943%20303%20Q%20940%20307%20938%20308%20Q%20936%20310%20933%20312%20Q%20930%20314%20926%20317%20Q%20922%20320%20921%20320%20Q%20920%20321%20915%20324%20Q%20910%20327%20907%20328%20Q%20904%20330%20902%20331%20Q%20900%20332%20895%20335%20Q%20890%20337%20887%20338%20Q%20885%20340%20882%20341%20Q%20880%20343%20875%20345%20Q%20870%20348%20869%20349%20Q%20868%20350%20864%20352%20Q%20860%20355%20856%20357%20Q%20853%20360%20851%20361%20Q%20850%20362%20845%20366%20Q%20841%20370%20840%20370%20Q%20840%20371%20837%20375%20Q%20834%20380%20832%20383%20Q%20830%20386%20828%20388%20Q%20826%20390%20823%20395%20Q%20820%20400%20820%20400%20Q%20820%20400%20817%20405%20Q%20814%20410%20812%20415%20Q%20811%20420%20810%20422%20Q%20810%20424%20809%20427%20Q%20808%20430%20807%20435%20Q%20807%20440%20807%20445%20Q%20807%20450%20807%20455%20Q%20808%20460%20809%20462%20Q%20810%20465%20810%20467%20Q%20811%20470%20813%20475%20Q%20815%20480%20817%20484%20Q%20820%20488%20820%20489%20Q%20820%20490%20824%20495%20Q%20828%20500%20829%20500%20Q%20830%20501%20834%20505%20Q%20838%20510%20839%20510%20Q%20840%20510%20845%20514%20Q%20850%20517%20852%20518%20Q%20854%20520%20857%20521%20Q%20860%20522%20865%20524%20Q%20870%20525%20875%20526%20Q%20880%20528%20885%20528%20Q%20890%20529%20895%20529%20Q%20900%20529%20905%20529%20Q%20910%20528%20915%20527%20Q%20920%20527%20925%20525%20Q%20930%20524%20935%20522%20Q%20940%20520%20940%20520%20Q%20941%20520%20945%20517%20Q%20950%20515%20954%20512%20Q%20959%20510%20959%20509%20Q%20960%20509%20965%20506%20Q%20970%20502%20971%20501%20Q%20972%20500%20976%20496%20Q%20980%20493%20981%20491%20Q%20983%20490%20986%20486%20Q%20990%20483%20991%20481%20Q%20993%20480%20996%20476%20Q%201000%20472%201001%20471%20Q%201002%20470%201006%20465%20Q%201010%20461%201010%20460%20Q%201011%20460%201015%20455%20Q%201020%20450%201020%20450%20Q%201020%20450%201025%20445%20Q%201030%20440%201030%20440%20Q%201031%20440%201035%20436%20Q%201040%20432%201042%20431%20Q%201044%20430%201047%20428%20Q%201050%20426%201055%20423%20Q%201060%20420%201061%20420%20Q%201062%20420%201066%20418%20Q%201070%20416%201075%20414%20Q%201080%20412%201083%20411%20Q%201086%20410%201088%20409%20Q%201090%20408%201095%20406%20Q%201100%20404%201105%20402%20Q%201110%20400%201110%20400%20Q%201111%20400%201115%20398%20Q%201120%20396%201125%20393%20Q%201130%20391%201131%20390%20Q%201132%20390%201136%20387%20Q%201140%20385%201143%20382%20Q%201146%20380%201148%20378%20Q%201150%20376%201154%20373%20Q%201159%20370%201159%20369%20Q%201160%20369%201165%20365%20Q%201170%20360%201170%20360%20Q%201170%20360%201175%20355%20Q%201179%20350%201179%20349%20Q%201180%20349%201183%20344%20Q%201186%20340%201188%20337%20Q%201190%20334%201191%20332%20Q%201192%20330%201194%20325%20Q%201196%20320%201198%20315%20Q%201199%20310%201199%20309%20Q%201200%20308%201200%20304%20Q%201201%20300%201202%20295%20Q%201203%20290%201203%20285%20Q%201203%20280%201202%20275%20Q%201202%20270%201201%20265%20Q%201200%20260%201200%20259%20Q%201200%20258%201198%20254%20Q%201197%20250%201195%20245%20Q%201193%20240%201191%20237%20Q%201190%20234%201188%20232%20Q%201187%20230%201183%20225%20Q%201180%20220%201179%20220%20Q%201179%20220%201174%20215%20Q%201170%20210%201169%20210%20Q%201169%20210%201164%20206%20Q%201160%20203%201157%20201%20Q%201154%20200%201152%20198%20Q%201150%20197%201145%20195%20Q%201140%20193%201135%20191%20Q%201130%20190%201129%20190%20Q%201129%20190%201124%20188%20Q%201120%20187%201115%20187%20Q%201110%20186%201105%20186%20Q%201100%20186%201095%20186%20Q%201090%20187%201085%20187%20Q%201090%20187%201080%20188%20Z%22%2F%3E%3Cpath%20d%3D%22M%201650%20916%20Q%201643%20920%201641%20921%20Q%201640%20922%201635%20926%20Q%201630%20930%201630%20930%20Q%201630%20930%201625%20935%20Q%201621%20940%201620%20940%20Q%201620%20941%201617%20945%20Q%201615%20950%201612%20955%20Q%201610%20960%201610%20960%20Q%201610%20960%201608%20965%20Q%201607%20970%201606%20975%20Q%201605%20980%201605%20985%20Q%201605%20990%201605%20995%20Q%201606%201000%201607%201005%20Q%201609%201010%201609%201011%20Q%201610%201012%201611%201016%20Q%201613%201020%201616%201024%20Q%201620%201029%201620%201029%20Q%201620%201030%201625%201034%20Q%201630%201039%201630%201039%20Q%201630%201040%201635%201042%20Q%201640%201045%201645%201047%20Q%201650%201049%201651%201049%20Q%201653%201050%201656%201050%20Q%201660%201051%201665%201051%20Q%201670%201051%201673%201050%20Q%201676%201050%201678%201049%20Q%201680%201049%201685%201047%20Q%201690%201045%201694%201042%20Q%201698%201040%201699%201039%20Q%201700%201038%201704%201034%20Q%201708%201030%201709%201028%20Q%201710%201027%201712%201023%20Q%201714%201020%201716%201015%20Q%201719%201010%201719%201008%20Q%201720%201007%201720%201003%20Q%201721%201000%201722%20995%20Q%201723%20990%201723%20985%20Q%201723%20980%201723%20975%20Q%201722%20970%201721%20965%20Q%201720%20960%201720%20958%20Q%201720%20957%201718%20953%20Q%201717%20950%201715%20945%20Q%201712%20940%201711%20937%20Q%201710%20935%201708%20932%20Q%201706%20930%201703%20926%20Q%201700%20923%201697%20921%20Q%201695%20920%201692%20918%20Q%201690%20916%201685%20914%20Q%201680%20912%201675%20911%20Q%201670%20911%201665%20912%20Q%201660%20912%201655%20914%20Q%201660%20912%201650%20916%20Z%22%2F%3E%3Cpath%20d%3D%22M%20700%201080%20Q%20704%201070%20707%201065%20Q%20710%201061%20710%201060%20Q%20711%201060%20715%201055%20Q%20720%201051%20721%201050%20Q%20722%201050%20726%201047%20Q%20730%201045%20735%201042%20Q%20740%201040%20740%201040%20Q%20740%201040%20745%201038%20Q%20750%201036%20755%201035%20Q%20760%201033%20765%201033%20Q%20770%201032%20775%201031%20Q%20780%201030%20785%201030%20Q%20790%201030%20795%201030%20Q%20800%201031%20805%201031%20Q%20810%201032%20815%201033%20Q%20820%201034%20825%201035%20Q%20830%201037%20833%201038%20Q%20836%201040%20838%201040%20Q%20840%201041%20845%201044%20Q%20850%201047%20852%201048%20Q%20854%201050%20857%201052%20Q%20860%201054%20862%201057%20Q%20865%201060%20867%201063%20Q%20870%201066%20871%201068%20Q%20872%201070%20874%201075%20Q%20872%201070%20877%201080%20Z%22%2F%3E%3Cpath%20d%3D%22M%201623%201080%20Q%201620%201077%201615%201074%20Q%201610%201070%201609%201070%20Q%201609%201070%201604%201065%20Q%201600%201060%201600%201059%20Q%201600%201059%201596%201054%20Q%201592%201050%201591%201047%20Q%201590%201045%201588%201042%20Q%201586%201040%201584%201035%20Q%201582%201030%201581%201027%20Q%201580%201024%201579%201022%20Q%201578%201020%201577%201015%20Q%201576%201010%201575%201005%20Q%201574%201000%201574%20995%20Q%201574%20990%201574%20985%20Q%201574%20980%201575%20975%20Q%201576%20970%201577%20965%20Q%201578%20960%201579%20957%20Q%201580%20954%201580%20952%20Q%201581%20950%201583%20945%20Q%201585%20940%201587%20935%20Q%201589%20930%201589%20929%20Q%201590%20929%201592%20924%20Q%201595%20920%201597%20916%20Q%201600%20913%201601%20911%20Q%201602%20910%201606%20905%20Q%201610%20900%201610%20900%20Q%201610%20900%201614%20895%20Q%201618%20890%201619%20889%20Q%201620%20888%201624%20884%20Q%201628%20880%201629%20879%20Q%201630%20878%201634%20874%20Q%201638%20870%201639%20869%20Q%201640%20868%201645%20864%20Q%201650%20860%201650%20860%20Q%201650%20860%201655%20855%20Q%201660%20851%201660%20850%20Q%201661%20850%201665%20846%20Q%201670%20842%201671%20841%20Q%201673%20840%201676%20836%20Q%201680%20833%201682%20831%20Q%201685%20830%201687%20827%20Q%201690%20824%201692%20822%20Q%201695%20820%201697%20816%20Q%201700%20812%201701%20811%20Q%201703%20810%201705%20805%20Q%201706%20800%201706%20795%20Q%201706%20790%201705%20785%20Q%201704%20780%201704%20775%20Q%201703%20770%201701%20768%20Q%201700%20767%201696%20763%20Q%201692%20760%201691%20755%20Q%201691%20750%201691%20745%20Q%201691%20740%201695%20735%20Q%201699%20730%201699%20728%20Q%201700%20726%201700%20723%20Q%201700%20720%201703%20715%20Q%201705%20710%201707%20707%20Q%201710%20705%201715%20703%20Q%201720%20702%201725%20704%20Q%201730%20706%201731%20708%20Q%201733%20710%201736%20714%20Q%201740%20719%201740%20719%20Q%201740%20720%201741%20725%20Q%201742%20730%201745%20735%20Q%201748%20740%201748%20745%20Q%201748%20750%201747%20755%20Q%201746%20760%201743%20763%20Q%201740%20766%201737%20768%20Q%201734%20770%201733%20775%20Q%201731%20780%201730%20782%20Q%201730%20784%201728%20787%20Q%201726%20790%201723%20795%20Q%201721%20800%201720%20804%20Q%201720%20808%201719%20809%20Q%201719%20810%201719%20811%20Q%201720%20813%201720%20816%20Q%201720%20820%201721%20825%20Q%201722%20830%201724%20835%20Q%201726%20840%201728%20844%20Q%201730%20849%201730%20849%20Q%201730%20850%201731%20855%20Q%201733%20860%201735%20865%20Q%201737%20870%201738%20872%20Q%201740%20875%201740%20877%20Q%201741%20880%201743%20885%20Q%201745%20890%201746%20895%20Q%201748%20900%201749%20902%20Q%201750%20904%201750%20907%20Q%201751%20910%201753%20915%20Q%201754%20920%201755%20925%20Q%201757%20930%201758%20935%20Q%201759%20940%201759%20941%20Q%201760%20942%201760%20946%20Q%201761%20950%201762%20955%20Q%201762%20960%201763%20965%20Q%201763%20970%201764%20975%20Q%201764%20980%201764%20985%20Q%201764%20990%201763%20995%20Q%201763%201000%201763%201005%20Q%201762%201010%201761%201015%20Q%201760%201020%201760%201020%20Q%201760%201021%201758%201025%20Q%201757%201030%201755%201035%20Q%201753%201040%201751%201043%20Q%201750%201047%201749%201048%20Q%201748%201050%201745%201055%20Q%201742%201060%201741%201061%20Q%201740%201063%201736%201066%20Q%201733%201070%201731%201071%20Q%201730%201073%201725%201076%20Q%201730%201073%201721%201080%20Z%22%2F%3E%3Cpath%20d%3D%22M%201520%20118%20Q%201510%20120%201510%20120%20Q%201510%20120%201505%20120%20Q%201500%20121%201495%20123%20Q%201490%20124%201485%20126%20Q%201480%20128%201478%20129%20Q%201477%20130%201473%20132%20Q%201470%20134%201465%20137%20Q%201460%20140%201460%20140%20Q%201460%20140%201455%20144%20Q%201450%20148%201449%20149%20Q%201448%20150%201444%20154%20Q%201440%20158%201439%20159%20Q%201438%20160%201434%20165%20Q%201430%20170%201430%20170%20Q%201430%20171%201427%20175%20Q%201424%20180%201422%20184%20Q%201420%20189%201419%20189%20Q%201419%20190%201418%20195%20Q%201416%20200%201414%20205%20Q%201413%20210%201412%20215%20Q%201411%20220%201411%20225%20Q%201411%20230%201411%20235%20Q%201411%20240%201411%20245%20Q%201411%20250%201412%20255%20Q%201413%20260%201414%20265%20Q%201415%20270%201417%20275%20Q%201419%20280%201419%20280%20Q%201420%20281%201421%20285%20Q%201423%20290%201426%20295%20Q%201428%20300%201429%20301%20Q%201430%20302%201432%20306%20Q%201434%20310%201437%20313%20Q%201440%20317%201441%20318%20Q%201442%20320%201446%20324%20Q%201450%20329%201450%20329%20Q%201450%20330%201455%20334%20Q%201460%20339%201460%20339%20Q%201460%20340%201465%20344%20Q%201470%20348%201470%20349%20Q%201471%20350%201475%20353%20Q%201480%20357%201481%20358%20Q%201483%20360%201486%20362%20Q%201490%20364%201494%20367%20Q%201498%20370%201499%20370%20Q%201500%20371%201505%20373%20Q%201510%20376%201513%20378%20Q%201517%20380%201518%20380%20Q%201520%20381%201525%20383%20Q%201530%20385%201535%20387%20Q%201540%20389%201541%20389%20Q%201543%20390%201546%20391%20Q%201550%20392%201555%20393%20Q%201560%20394%201565%20394%20Q%201570%20395%201575%20395%20Q%201580%20395%201585%20395%20Q%201590%20395%201595%20393%20Q%201600%20392%201603%20391%20Q%201607%20390%201608%20389%20Q%201610%20388%201615%20385%20Q%201620%20382%201621%20381%20Q%201623%20380%201626%20376%20Q%201630%20373%201631%20371%20Q%201633%20370%201636%20365%20Q%201640%20360%201640%20360%20Q%201640%20360%201640%20359%20Q%201640%20358%201639%20354%20Q%201638%20350%201639%20348%20Q%201640%20347%201642%20343%20Q%201644%20340%201646%20335%20Q%201649%20330%201649%20329%20Q%201650%20328%201651%20324%20Q%201652%20320%201654%20315%20Q%201655%20310%201656%20305%20Q%201657%20300%201658%20295%20Q%201659%20290%201659%20285%20Q%201660%20280%201660%20280%20Q%201660%20280%201660%20275%20Q%201660%20270%201660%20267%20Q%201660%20264%201659%20262%20Q%201659%20260%201659%20255%20Q%201658%20250%201658%20245%20Q%201657%20240%201656%20235%20Q%201655%20230%201654%20225%20Q%201652%20220%201651%20215%20Q%201650%20211%201649%20210%20Q%201649%20210%201647%20205%20Q%201645%20200%201643%20195%20Q%201640%20190%201640%20189%20Q%201640%20188%201637%20184%20Q%201634%20180%201632%20176%20Q%201630%20172%201628%20171%20Q%201627%20170%201623%20165%20Q%201620%20160%201619%20160%20Q%201619%20160%201614%20155%20Q%201610%20150%201609%20150%20Q%201609%20150%201604%20145%20Q%201600%20141%201598%20140%20Q%201597%20140%201593%20137%20Q%201590%20135%201585%20132%20Q%201580%20130%201579%20130%20Q%201579%20130%201574%20127%20Q%201570%20125%201565%20124%20Q%201560%20122%201555%20121%20Q%201550%20120%201548%20120%20Q%201547%20120%201543%20119%20Q%201540%20118%201535%20118%20Q%201530%20118%201525%20118%20Q%201530%20118%201520%20118%20Z%22%2F%3E%3Cpath%20d%3D%22M%201060%20149%20Q%201059%20150%201054%20151%20Q%201050%20152%201045%20154%20Q%201040%20156%201036%20158%20Q%201032%20160%201031%20160%20Q%201030%20161%201025%20163%20Q%201020%20166%201017%20168%20Q%201014%20170%201012%20171%20Q%201010%20172%201005%20176%20Q%201000%20179%20999%20179%20Q%20999%20180%20994%20183%20Q%20990%20187%20988%20188%20Q%20987%20190%20983%20193%20Q%20980%20197%20978%20198%20Q%20977%20200%20973%20203%20Q%20970%20207%20969%20208%20Q%20968%20210%20964%20212%20Q%20960%20215%20957%20217%20Q%20954%20220%20952%20222%20Q%20950%20224%20947%20227%20Q%20944%20230%20942%20232%20Q%20940%20235%20937%20237%20Q%20935%20240%20932%20243%20Q%20930%20246%20928%20248%20Q%20926%20250%20923%20253%20Q%20920%20256%20918%20258%20Q%20916%20260%20913%20262%20Q%20910%20265%20907%20267%20Q%20905%20270%20902%20272%20Q%20900%20274%20896%20277%20Q%20892%20280%20891%20280%20Q%20890%20281%20885%20284%20Q%20880%20288%20878%20289%20Q%20877%20290%20873%20292%20Q%20870%20294%20865%20297%20Q%20861%20300%20860%20300%20Q%20860%20301%20855%20304%20Q%20850%20307%20847%20308%20Q%20845%20310%20842%20311%20Q%20840%20313%20837%20316%20Q%20834%20320%20832%20322%20Q%20830%20325%20826%20327%20Q%20823%20330%20821%20331%20Q%20820%20332%20815%20336%20Q%20810%20339%20809%20339%20Q%20809%20340%20804%20344%20Q%20800%20348%20799%20349%20Q%20799%20350%20796%20355%20Q%20793%20360%20791%20363%20Q%20790%20366%20788%20368%20Q%20787%20370%20784%20375%20Q%20781%20380%20780%20381%20Q%20780%20382%20778%20386%20Q%20776%20390%20774%20395%20Q%20771%20400%20770%20402%20Q%20770%20405%20769%20407%20Q%20768%20410%20766%20415%20Q%20765%20420%20764%20425%20Q%20763%20430%20762%20435%20Q%20761%20440%20761%20445%20Q%20761%20450%20761%20455%20Q%20761%20460%20761%20465%20Q%20762%20470%20763%20475%20Q%20764%20480%20765%20485%20Q%20767%20490%20768%20493%20Q%20770%20496%20770%20498%20Q%20771%20500%20774%20505%20Q%20777%20510%20778%20511%20Q%20780%20513%20782%20516%20Q%20785%20520%20787%20522%20Q%20790%20524%20792%20527%20Q%20794%20530%20797%20532%20Q%20800%20534%20803%20537%20Q%20807%20540%20808%20540%20Q%20810%20541%20815%20544%20Q%20820%20547%20822%20548%20Q%20825%20550%20827%20551%20Q%20830%20552%20835%20553%20Q%20840%20555%20845%20557%20Q%20850%20558%20852%20559%20Q%20854%20560%20857%20560%20Q%20860%20561%20865%20561%20Q%20870%20562%20875%20563%20Q%20880%20563%20885%20563%20Q%20890%20563%20895%20563%20Q%20900%20563%20905%20562%20Q%20910%20562%20915%20561%20Q%20920%20560%20920%20560%20Q%20920%20560%20925%20558%20Q%20930%20557%20935%20556%20Q%20940%20554%20945%20552%20Q%20950%20551%20951%20550%20Q%20952%20550%20956%20548%20Q%20960%20546%20965%20543%20Q%20970%20541%20970%20540%20Q%20971%20540%20975%20537%20Q%20980%20534%20983%20532%20Q%20986%20530%20988%20528%20Q%20990%20527%20994%20523%20Q%20999%20520%20999%20519%20Q%201000%20519%201005%20515%20Q%201010%20511%201010%20510%20Q%201011%20510%201015%20505%20Q%201020%20501%201021%20500%20Q%201022%20500%201026%20496%20Q%201030%20492%201031%20491%20Q%201032%20490%201036%20486%20Q%201040%20483%201042%20481%20Q%201044%20480%201047%20477%20Q%201050%20475%201053%20472%20Q%201056%20470%201058%20468%20Q%201060%20467%201065%20464%20Q%201070%20460%201070%20460%20Q%201071%20460%201075%20457%20Q%201080%20454%201084%20452%20Q%201088%20450%201089%20449%20Q%201090%20449%201095%20446%20Q%201100%20444%201104%20442%20Q%201109%20440%201109%20439%20Q%201110%20439%201115%20437%20Q%201120%20435%201125%20432%20Q%201130%20430%201130%20430%20Q%201130%20430%201135%20427%20Q%201140%20425%201143%20422%20Q%201146%20420%201148%20418%20Q%201150%20417%201155%20414%20Q%201160%20412%201161%20411%20Q%201163%20410%201166%20408%20Q%201170%20406%201174%20403%20Q%201179%20400%201179%20399%20Q%201180%20399%201185%20395%20Q%201190%20391%201190%20390%20Q%201191%20390%201195%20386%20Q%201200%20382%201201%20381%20Q%201202%20380%201206%20375%20Q%201210%20371%201210%20370%20Q%201211%20370%201215%20365%20Q%201218%20360%201219%20359%20Q%201220%20358%201222%20354%20Q%201225%20350%201227%20345%20Q%201230%20341%201230%20340%20Q%201231%20340%201233%20335%20Q%201235%20330%201237%20325%20Q%201239%20320%201239%20319%20Q%201240%20319%201241%20314%20Q%201243%20310%201244%20305%20Q%201245%20300%201246%20295%20Q%201247%20290%201248%20285%20Q%201248%20280%201249%20275%20Q%201249%20270%201249%20265%20Q%201249%20260%201248%20255%20Q%201248%20250%201247%20245%20Q%201246%20240%201245%20235%20Q%201243%20230%201242%20225%20Q%201240%20220%201240%20219%20Q%201240%20219%201237%20214%20Q%201235%20210%201232%20205%20Q%201230%20200%201229%20200%20Q%201229%20200%201226%20195%20Q%201222%20190%201221%20188%20Q%201220%20187%201216%20183%20Q%201213%20180%201211%20178%20Q%201210%20177%201205%20173%20Q%201201%20170%201200%20169%20Q%201200%20169%201195%20165%20Q%201190%20162%201187%20161%20Q%201185%20160%201182%20158%20Q%201180%20157%201175%20155%20Q%201170%20152%201165%20151%20Q%201161%20150%201160%20149%20Q%201160%20149%201155%20148%20Q%201150%20146%201145%20145%20Q%201140%20144%201135%20143%20Q%201130%20143%201125%20142%20Q%201120%20142%201115%20142%20Q%201110%20142%201105%20142%20Q%201100%20142%201095%20143%20Q%201090%20143%201085%20144%20Q%201080%20144%201075%20145%20Q%201070%20147%201065%20148%20Q%201070%20147%201060%20149%20Z%22%2F%3E%3Cpath%20d%3D%22M%201454%200%20Q%201450%201%201445%203%20Q%201440%205%201435%207%20Q%201430%209%201429%209%20Q%201429%2010%201424%2012%20Q%201420%2014%201415%2016%20Q%201410%2018%201407%2019%20Q%201405%2020%201402%2020%20Q%201400%2021%201395%2022%20Q%201390%2023%201385%2025%20Q%201380%2026%201375%2027%20Q%201370%2029%201369%2029%20Q%201368%2030%201364%2031%20Q%201360%2033%201355%2035%20Q%201350%2037%201345%2038%20Q%201340%2039%201339%2039%20Q%201339%2040%201334%2042%20Q%201330%2044%201325%2046%20Q%201320%2048%201318%2049%20Q%201316%2050%201313%2051%20Q%201310%2052%201305%2053%20Q%201300%2055%201295%2056%20Q%201290%2058%201285%2059%20Q%201281%2060%201280%2060%20Q%201280%2060%201275%2061%20Q%201270%2062%201265%2063%20Q%201260%2064%201255%2065%20Q%201250%2066%201245%2066%20Q%201240%2067%201235%2067%20Q%201230%2067%201225%2068%20Q%201220%2068%201215%2068%20Q%201210%2069%201205%2069%20Q%201200%2069%201197%2069%20Q%201194%2070%201192%2070%20Q%201190%2070%201185%2070%20Q%201180%2070%201175%2071%20Q%201170%2071%201165%2071%20Q%201160%2072%201155%2072%20Q%201150%2073%201145%2073%20Q%201140%2074%201135%2074%20Q%201130%2075%201125%2076%20Q%201120%2076%201115%2077%20Q%201110%2078%201105%2079%20Q%201101%2080%201100%2080%20Q%201100%2080%201095%2081%20Q%201090%2082%201085%2083%20Q%201080%2084%201075%2085%20Q%201070%2087%201065%2088%20Q%201061%2090%201060%2090%20Q%201060%2090%201055%2091%20Q%201050%2093%201045%2095%20Q%201040%2096%201036%2098%20Q%201032%20100%201031%20100%20Q%201030%20100%201025%20102%20Q%201020%20105%201015%20107%20Q%201010%20109%201009%20109%20Q%201009%20110%201004%20112%20Q%201000%20114%20995%20117%20Q%20990%20119%20989%20119%20Q%20989%20120%20984%20122%20Q%20980%20125%20976%20127%20Q%20973%20130%20971%20130%20Q%20970%20131%20965%20135%20Q%20960%20138%20958%20139%20Q%20957%20140%20953%20142%20Q%20950%20145%20947%20147%20Q%20944%20150%20942%20151%20Q%20940%20153%20935%20156%20Q%20931%20160%20930%20160%20Q%20930%20161%20925%20165%20Q%20920%20169%20919%20169%20Q%20919%20170%20914%20174%20Q%20910%20178%20909%20179%20Q%20908%20180%20904%20184%20Q%20900%20188%20899%20189%20Q%20898%20190%20894%20194%20Q%20890%20198%20889%20199%20Q%20888%20200%20884%20204%20Q%20880%20208%20879%20209%20Q%20878%20210%20874%20211%20Q%20870%20213%20865%20215%20Q%20860%20217%20856%20218%20Q%20852%20220%20851%20220%20Q%20850%20221%20845%20225%20Q%20840%20228%20839%20229%20Q%20839%20230%20835%20235%20Q%20832%20240%20831%20241%20Q%20830%20243%20825%20245%20Q%20820%20247%20817%20248%20Q%20815%20250%20812%20251%20Q%20810%20252%20805%20254%20Q%20800%20257%20798%20258%20Q%20797%20260%20794%20265%20Q%20790%20270%20790%20270%20Q%20790%20270%20785%20275%20Q%20780%20280%20780%20280%20Q%20780%20280%20775%20285%20Q%20770%20290%20770%20290%20Q%20770%20291%20766%20295%20Q%20763%20300%20761%20302%20Q%20760%20304%20758%20307%20Q%20756%20310%20753%20315%20Q%20750%20320%20750%20320%20Q%20750%20320%20747%20325%20Q%20745%20330%20743%20335%20Q%20740%20340%20740%20341%20Q%20740%20342%20738%20346%20Q%20736%20350%20734%20355%20Q%20731%20360%20730%20362%20Q%20730%20364%20728%20367%20Q%20727%20370%20725%20375%20Q%20723%20380%20721%20384%20Q%20720%20388%20719%20389%20Q%20719%20390%20717%20395%20Q%20715%20400%20713%20405%20Q%20710%20410%20710%20411%20Q%20710%20412%20708%20416%20Q%20706%20420%20704%20425%20Q%20702%20430%20701%20433%20Q%20700%20436%20699%20438%20Q%20698%20440%20696%20445%20Q%20694%20450%20692%20454%20Q%20690%20459%20689%20459%20Q%20689%20460%20687%20465%20Q%20685%20470%20682%20475%20Q%20680%20480%20680%20480%20Q%20680%20480%20677%20485%20Q%20674%20490%20672%20494%20Q%20670%20498%20669%20499%20Q%20669%20500%20667%20505%20Q%20666%20510%20664%20515%20Q%20663%20520%20661%20525%20Q%20660%20530%20660%20530%20Q%20660%20531%20655%20534%20Q%20650%20537%20647%20538%20Q%20645%20540%20642%20541%20Q%20640%20542%20635%20544%20Q%20630%20546%20625%20548%20Q%20620%20549%20619%20549%20Q%20618%20550%20614%20551%20Q%20610%20552%20605%20553%20Q%20600%20554%20595%20554%20Q%20590%20555%20585%20555%20Q%20580%20556%20575%20556%20Q%20570%20556%20565%20556%20Q%20560%20557%20555%20556%20Q%20550%20556%20545%20556%20Q%20540%20556%20535%20556%20Q%20530%20555%20525%20555%20Q%20520%20554%20515%20554%20Q%20510%20553%20505%20552%20Q%20500%20551%20495%20550%20Q%20490%20550%20490%20549%20Q%20490%20549%20485%20549%20Q%20480%20548%20475%20547%20Q%20470%20546%20465%20545%20Q%20460%20544%20455%20542%20Q%20450%20541%20445%20545%20Q%20441%20550%20440%20551%20Q%20440%20552%20435%20552%20Q%20430%20553%20425%20554%20Q%20420%20555%20415%20556%20Q%20410%20558%20408%20559%20Q%20406%20560%20403%20562%20Q%20400%20564%20396%20567%20Q%20393%20570%20391%20571%20Q%20390%20573%20387%20576%20Q%20385%20580%20382%20585%20Q%20380%20590%20380%20590%20Q%20380%20590%20376%20595%20Q%20372%20600%20371%20605%20Q%20370%20610%20370%20613%20Q%20370%20617%20369%20618%20Q%20369%20620%20369%20625%20Q%20369%20630%20369%20635%20Q%20369%20640%20369%20643%20Q%20370%20646%20370%20648%20Q%20370%20650%20371%20655%20Q%20372%20660%20373%20665%20Q%20375%20670%20377%20675%20Q%20379%20680%20379%20680%20Q%20380%20680%20384%20685%20Q%20388%20690%20389%20690%20Q%20390%20691%20395%20693%20Q%20400%20696%20405%20697%20Q%20410%20698%20415%20698%20Q%20420%20699%20425%20698%20Q%20430%20698%20435%20697%20Q%20440%20696%20440%20698%20Q%20441%20700%20445%20705%20Q%20449%20710%20449%20710%20Q%20450%20710%20450%20710%20Q%20451%20710%20455%20707%20Q%20460%20705%20464%20702%20Q%20469%20700%20469%20699%20Q%20470%20699%20475%20696%20Q%20480%20694%20483%20692%20Q%20487%20690%20488%20689%20Q%20490%20688%20495%20685%20Q%20500%20683%20502%20681%20Q%20505%20680%20507%20678%20Q%20510%20677%20515%20674%20Q%20520%20672%20522%20671%20Q%20524%20670%20527%20668%20Q%20530%20666%20535%20663%20Q%20540%20661%20541%20660%20Q%20542%20660%20546%20657%20Q%20550%20655%20555%20652%20Q%20560%20650%20560%20650%20Q%20560%20650%20565%20647%20Q%20570%20644%20574%20642%20Q%20578%20640%20579%20639%20Q%20580%20639%20585%20636%20Q%20590%20633%20593%20631%20Q%20596%20630%20598%20629%20Q%20600%20628%20605%20625%20Q%20610%20622%20612%20621%20Q%20614%20620%20617%20618%20Q%20620%20617%20625%20614%20Q%20630%20611%20631%20610%20Q%20633%20610%20636%20608%20Q%20640%20606%20645%20603%20Q%20650%20600%20650%20600%20Q%20651%20600%20650%20598%20Q%20650%20597%20646%20593%20Q%20642%20590%20646%20587%20Q%20650%20584%20654%20582%20Q%20658%20580%20659%20579%20Q%20660%20579%20660%20579%20Q%20660%20580%20665%20583%20Q%20670%20586%20675%20585%20Q%20680%20584%20685%20584%20Q%20690%20584%20695%20584%20Q%20700%20584%20705%20584%20Q%20710%20584%20715%20584%20Q%20720%20585%20725%20585%20Q%20730%20586%20735%20587%20Q%20740%20588%20745%20588%20Q%20750%20589%20750%20589%20Q%20751%20590%20755%20590%20Q%20760%20591%20765%20592%20Q%20770%20593%20775%20594%20Q%20780%20595%20785%20596%20Q%20790%20597%20795%20598%20Q%20800%20599%20802%20599%20Q%20805%20600%20807%20600%20Q%20810%20600%20815%20601%20Q%20820%20601%20825%20602%20Q%20830%20603%20835%20603%20Q%20840%20603%20845%20604%20Q%20850%20604%20855%20604%20Q%20860%20604%20865%20604%20Q%20870%20604%20875%20604%20Q%20880%20604%20885%20603%20Q%20890%20603%20895%20602%20Q%20900%20601%20905%20601%20Q%20910%20600%20910%20600%20Q%20910%20600%20915%20599%20Q%20920%20598%20925%20596%20Q%20930%20595%20935%20593%20Q%20940%20592%20943%20591%20Q%20946%20590%20948%20589%20Q%20950%20588%20955%20586%20Q%20960%20584%20964%20582%20Q%20969%20580%20969%20579%20Q%20970%20579%20975%20577%20Q%20980%20574%20983%20572%20Q%20987%20570%20988%20569%20Q%20990%20568%20995%20564%20Q%201000%20561%201000%20560%20Q%201001%20560%201005%20557%20Q%201010%20555%201014%20552%20Q%201019%20550%201019%20549%20Q%201020%20549%201025%20546%20Q%201030%20542%201031%20541%20Q%201032%20540%201036%20537%20Q%201040%20534%201042%20532%20Q%201045%20530%201047%20528%20Q%201050%20526%201054%20523%20Q%201058%20520%201059%20519%20Q%201060%20518%201065%20514%20Q%201070%20510%201070%20510%20Q%201071%20510%201075%20506%20Q%201080%20503%201082%20501%20Q%201085%20500%201087%20498%20Q%201090%20497%201095%20494%20Q%201100%20491%201101%20490%20Q%201102%20490%201106%20487%20Q%201110%20485%201115%20483%20Q%201120%20480%201120%20480%20Q%201120%20480%201125%20477%20Q%201130%20475%201135%20472%20Q%201140%20470%201140%20470%20Q%201140%20470%201145%20465%20Q%201150%20461%201151%20460%20Q%201153%20460%201156%20458%20Q%201160%20457%201165%20454%20Q%201170%20452%201172%20451%20Q%201174%20450%201177%20448%20Q%201180%20447%201185%20444%20Q%201190%20441%201191%20440%20Q%201192%20440%201196%20437%20Q%201200%20435%201203%20432%20Q%201207%20430%201208%20429%20Q%201210%20428%201215%20424%20Q%201220%20420%201220%20420%20Q%201220%20420%201225%20416%20Q%201230%20412%201231%20411%20Q%201232%20410%201236%20406%20Q%201240%20402%201241%20401%20Q%201243%20400%201246%20396%20Q%201250%20392%201253%20391%20Q%201256%20390%201258%20389%20Q%201260%20388%201264%20384%20Q%201268%20380%201269%20379%20Q%201270%20378%201274%20374%20Q%201278%20370%201279%20369%20Q%201280%20368%201283%20364%20Q%201287%20360%201288%20358%20Q%201290%20357%201293%20353%20Q%201296%20350%201298%20348%20Q%201300%20346%201302%20343%20Q%201305%20340%201307%20337%20Q%201310%20335%201312%20332%20Q%201315%20330%201317%20327%20Q%201320%20324%201325%20325%20Q%201330%20325%201335%20324%20Q%201340%20323%201345%20323%20Q%201350%20323%201355%20325%20Q%201360%20327%201365%20325%20Q%201370%20323%201373%20326%20Q%201376%20330%201378%20331%20Q%201380%20333%201383%20336%20Q%201386%20340%201388%20341%20Q%201390%20343%201393%20346%20Q%201396%20350%201398%20351%20Q%201400%20353%201403%20356%20Q%201406%20360%201408%20361%20Q%201410%20363%201413%20366%20Q%201417%20370%201418%20371%20Q%201420%20372%201424%20376%20Q%201428%20380%201429%20380%20Q%201430%20381%201435%20385%20Q%201440%20389%201440%20389%20Q%201440%20390%201445%20393%20Q%201450%20397%201451%20398%20Q%201453%20400%201456%20402%20Q%201460%20405%201463%20407%20Q%201466%20410%201468%20411%20Q%201470%20412%201475%20415%20Q%201480%20419%201480%20419%20Q%201480%20420%201485%20423%20Q%201490%20426%201492%20428%20Q%201495%20430%201497%20431%20Q%201500%20433%201505%20436%20Q%201510%20439%201510%20439%20Q%201510%20440%201515%20442%20Q%201520%20445%201523%20447%20Q%201526%20450%201528%20450%20Q%201530%20451%201535%20453%20Q%201540%20455%201545%20457%20Q%201550%20459%201550%20459%20Q%201551%20460%201555%20462%20Q%201560%20465%201564%20467%20Q%201568%20470%201569%20470%20Q%201570%20470%201575%20473%20Q%201580%20475%201584%20477%20Q%201588%20480%201589%20480%20Q%201590%20480%201595%20482%20Q%201600%20484%201605%20486%20Q%201610%20487%201614%20488%20Q%201619%20490%201619%20490%20Q%201620%20490%201625%20490%20Q%201630%20490%201632%20490%20Q%201635%20490%201637%20489%20Q%201640%20489%201645%20487%20Q%201650%20485%201653%20482%20Q%201656%20480%201658%20478%20Q%201660%20476%201662%20473%20Q%201665%20470%201667%20467%20Q%201670%20464%201671%20462%20Q%201672%20460%201675%20455%20Q%201679%20450%201679%20449%20Q%201680%20449%201682%20444%20Q%201684%20440%201686%20435%20Q%201688%20430%201689%20428%20Q%201690%20427%201691%20423%20Q%201692%20420%201694%20415%20Q%201696%20410%201697%20405%20Q%201699%20400%201699%20399%20Q%201700%20398%201701%20394%20Q%201702%20390%201703%20385%20Q%201704%20380%201705%20375%20Q%201706%20370%201707%20365%20Q%201708%20360%201705%20355%20Q%201702%20350%201703%20345%20Q%201705%20340%201706%20335%20Q%201707%20330%201708%20325%20Q%201709%20320%201709%20317%20Q%201710%20314%201710%20312%20Q%201710%20310%201710%20305%20Q%201711%20300%201711%20295%20Q%201711%20290%201711%20285%20Q%201711%20280%201711%20275%20Q%201711%20270%201710%20265%20Q%201710%20260%201710%20258%20Q%201710%20257%201709%20253%20Q%201709%20250%201708%20245%20Q%201707%20240%201706%20235%20Q%201706%20230%201705%20225%20Q%201704%20220%201702%20215%20Q%201701%20210%201700%20206%20Q%201700%20202%201699%20201%20Q%201699%20200%201697%20195%20Q%201696%20190%201695%20185%20Q%201693%20180%201691%20175%20Q%201690%20170%201690%20169%20Q%201690%20168%201688%20164%20Q%201687%20160%201686%20155%20Q%201685%20150%201684%20145%20Q%201683%20140%201683%20135%20Q%201682%20130%201681%20125%20Q%201680%20120%201680%20115%20Q%201680%20110%201679%20110%20Q%201679%20110%201678%20105%20Q%201677%20100%201675%2095%20Q%201674%2090%201673%2085%20Q%201672%2080%201672%2075%20Q%201671%2070%201671%2065%20Q%201671%2060%201671%2055%20Q%201671%2050%201672%2045%20Q%201673%2040%201671%2035%20Q%201670%2031%201669%2030%20Q%201669%2030%201664%2028%20Q%201660%2027%201655%2025%20Q%201650%2024%201645%2023%20Q%201640%2022%201635%2021%20Q%201630%2020%201627%2020%20Q%201625%2020%201627%2018%20Q%201630%2016%201634%2013%20Q%201639%2010%201639%209%20Q%201640%209%201645%205%20Q%201650%201%201651%200%20Q%201650%201%201652%200%20Z%22%2F%3E%3Cpath%20d%3D%22M%20632%201080%20Q%20633%201070%20634%201065%20Q%20635%201060%20637%201055%20Q%20639%201050%20639%201049%20Q%20640%201048%20642%201044%20Q%20644%201040%20647%201035%20Q%20650%201031%20650%201030%20Q%20651%201030%20655%201025%20Q%20660%201020%20660%201020%20Q%20660%201020%20665%201015%20Q%20670%201011%20671%201010%20Q%20672%201010%20676%201007%20Q%20680%201004%20684%201002%20Q%20688%201000%20689%20999%20Q%20690%20999%20695%20997%20Q%20700%20994%20705%20993%20Q%20710%20991%20711%20990%20Q%20713%20990%20716%20989%20Q%20720%20988%20725%20986%20Q%20730%20985%20735%20984%20Q%20740%20983%20745%20983%20Q%20750%20982%20755%20982%20Q%20760%20981%20765%20981%20Q%20770%20981%20775%20980%20Q%20780%20980%20785%20981%20Q%20790%20981%20795%20981%20Q%20800%20981%20805%20982%20Q%20810%20983%20815%20983%20Q%20820%20984%20825%20985%20Q%20830%20986%20835%20988%20Q%20840%20989%20840%20989%20Q%20840%20990%20845%20991%20Q%20850%20993%20855%20995%20Q%20860%20997%20862%20998%20Q%20865%201000%20867%201001%20Q%20870%201002%20875%201005%20Q%20880%201008%20881%201009%20Q%20882%201010%20886%201012%20Q%20890%201015%20892%201017%20Q%20895%201020%20897%201022%20Q%20900%201024%20902%201027%20Q%20905%201030%20907%201032%20Q%20910%201035%20911%201037%20Q%20913%201040%20916%201045%20Q%20919%201050%20919%201050%20Q%20920%201050%20922%201055%20Q%20924%201060%20926%201065%20Q%20928%201070%20929%201072%20Q%20930%201075%20930%201077%20Q%20930%201075%20931%201080%20Z%22%2F%3E%3Cpath%20d%3D%22M%201575%201080%20Q%201570%201072%201569%201071%20Q%201568%201070%201566%201065%20Q%201563%201060%201561%201056%20Q%201560%201052%201559%201051%20Q%201558%201050%201557%201045%20Q%201555%201040%201553%201035%20Q%201552%201030%201551%201025%20Q%201550%201020%201550%201018%20Q%201550%201017%201549%201013%20Q%201548%201010%201548%201005%20Q%201548%201000%201548%20995%20Q%201548%20990%201548%20985%20Q%201548%20980%201549%20975%20Q%201549%20970%201549%20969%20Q%201550%20968%201550%20964%20Q%201551%20960%201552%20955%20Q%201554%20950%201555%20945%20Q%201557%20940%201558%20935%20Q%201560%20931%201560%20930%20Q%201560%20930%201562%20925%20Q%201564%20920%201567%20915%20Q%201569%20910%201569%20909%20Q%201570%20908%201572%20904%20Q%201574%20900%201577%20895%20Q%201580%20890%201580%20890%20Q%201580%20890%201583%20885%20Q%201586%20880%201588%20876%20Q%201590%20873%201591%20871%20Q%201592%20870%201595%20865%20Q%201598%20860%201599%20858%20Q%201600%20856%201601%20853%20Q%201603%20850%201606%20845%20Q%201608%20840%201609%20838%20Q%201610%20837%201611%20833%20Q%201613%20830%201615%20825%20Q%201617%20820%201618%20815%20Q%201620%20811%201620%20810%20Q%201620%20810%201621%20805%20Q%201622%20800%201623%20795%20Q%201624%20790%201625%20785%20Q%201625%20780%201626%20775%20Q%201626%20770%201625%20765%20Q%201623%20760%201623%20755%20Q%201623%20750%201623%20745%20Q%201623%20740%201624%20735%20Q%201626%20730%201626%20725%20Q%201625%20720%201625%20715%20Q%201625%20710%201625%20705%20Q%201625%20700%201625%20695%20Q%201626%20690%201626%20685%20Q%201627%20680%201628%20675%20Q%201628%20670%201629%20666%20Q%201630%20663%201630%20661%20Q%201630%20660%201634%20655%20Q%201637%20650%201638%20645%20Q%201639%20640%201639%20639%20Q%201640%20639%201641%20634%20Q%201643%20630%201645%20625%20Q%201647%20620%201648%20617%20Q%201650%20614%201651%20612%20Q%201652%20610%201656%20605%20Q%201659%20600%201659%20599%20Q%201660%20599%201665%20595%20Q%201670%20590%201671%20590%20Q%201672%20590%201676%20588%20Q%201680%20586%201685%20586%20Q%201690%20585%201695%20586%20Q%201700%20587%201704%20588%20Q%201708%20590%201709%20590%20Q%201710%20590%201715%20592%20Q%201720%20594%201724%20597%20Q%201729%20600%201729%20600%20Q%201730%20600%201735%20603%20Q%201740%20607%201741%20608%20Q%201743%20610%201746%20612%20Q%201750%20614%201752%20617%20Q%201755%20620%201757%20621%20Q%201760%20623%201763%20626%20Q%201766%20630%201768%20631%20Q%201770%20633%201772%20636%20Q%201775%20640%201777%20643%20Q%201780%20646%201781%20648%20Q%201782%20650%201786%20653%20Q%201790%20657%201791%20658%20Q%201792%20660%201795%20665%20Q%201798%20670%201799%20671%20Q%201800%20672%201801%20676%20Q%201803%20680%201805%20685%20Q%201807%20690%201808%20693%20Q%201810%20697%201810%20698%20Q%201810%20700%201812%20705%20Q%201813%20710%201814%20715%20Q%201815%20720%201815%20725%20Q%201816%20730%201816%20735%20Q%201817%20740%201817%20745%20Q%201817%20750%201817%20755%20Q%201817%20760%201816%20765%20Q%201815%20770%201814%20775%20Q%201814%20780%201813%20785%20Q%201812%20790%201811%20795%20Q%201810%20800%201810%20801%20Q%201810%20803%201809%20806%20Q%201808%20810%201807%20815%20Q%201806%20820%201805%20825%20Q%201804%20830%201803%20835%20Q%201802%20840%201801%20845%20Q%201801%20850%201800%20854%20Q%201800%20859%201799%20859%20Q%201799%20860%201799%20865%20Q%201799%20870%201799%20875%20Q%201798%20880%201798%20885%20Q%201799%20890%201799%20895%20Q%201799%20900%201799%20904%20Q%201800%20908%201800%20909%20Q%201800%20910%201800%20915%20Q%201800%20920%201801%20925%20Q%201801%20930%201802%20935%20Q%201803%20940%201803%20945%20Q%201804%20950%201804%20955%20Q%201805%20960%201805%20965%20Q%201805%20970%201806%20975%20Q%201806%20980%201806%20985%20Q%201806%20990%201806%20995%20Q%201806%201000%201806%201005%20Q%201806%201010%201806%201015%20Q%201806%201020%201805%201025%20Q%201805%201030%201804%201035%20Q%201803%201040%201802%201045%20Q%201801%201050%201800%201053%20Q%201800%201056%201799%201058%20Q%201799%201060%201797%201065%20Q%201795%201070%201793%201075%20Q%201795%201070%201791%201080%20Z%22%2F%3E%3Cpath%20d%3D%22M%201035%200%20Q%201030%202%201025%205%20Q%201020%207%201018%208%20Q%201016%2010%201013%2011%20Q%201010%2013%201005%2015%20Q%201000%2018%20998%2019%20Q%20996%2020%20993%2021%20Q%20990%2023%20985%2025%20Q%20980%2028%20978%2029%20Q%20976%2030%20973%2030%20Q%20970%2031%20965%2033%20Q%20960%2035%20955%2037%20Q%20950%2038%20948%2039%20Q%20946%2040%20943%2041%20Q%20940%2043%20935%2046%20Q%20930%2048%20928%2049%20Q%20927%2050%20923%2052%20Q%20920%2054%20915%2056%20Q%20910%2059%20909%2059%20Q%20908%2060%20904%2062%20Q%20900%2064%20895%2067%20Q%20890%2070%20890%2070%20Q%20890%2070%20885%2072%20Q%20880%2075%20875%2077%20Q%20871%2080%20870%2080%20Q%20870%2080%20865%2083%20Q%20860%2086%20856%2088%20Q%20852%2090%20851%2090%20Q%20850%2091%20845%2094%20Q%20840%2096%20837%2098%20Q%20835%20100%20832%20101%20Q%20830%20103%20825%20106%20Q%20820%20108%20818%20109%20Q%20817%20110%20813%20111%20Q%20810%20113%20805%20116%20Q%20800%20119%20799%20119%20Q%20798%20120%20794%20122%20Q%20790%20125%20785%20127%20Q%20780%20130%20780%20130%20Q%20780%20130%20775%20133%20Q%20770%20136%20766%20138%20Q%20763%20140%20761%20141%20Q%20760%20142%20755%20145%20Q%20750%20148%20749%20149%20Q%20749%20150%20747%20155%20Q%20745%20160%20744%20165%20Q%20742%20170%20741%20172%20Q%20740%20175%20738%20177%20Q%20736%20180%20733%20184%20Q%20730%20188%20729%20189%20Q%20729%20190%20726%20195%20Q%20723%20200%20721%20202%20Q%20720%20205%20719%20207%20Q%20718%20210%20715%20215%20Q%20712%20220%20711%20223%20Q%20710%20227%20709%20228%20Q%20709%20230%20707%20235%20Q%20705%20240%20704%20245%20Q%20703%20250%20702%20255%20Q%20701%20260%20700%20262%20Q%20700%20264%20699%20267%20Q%20698%20270%20698%20275%20Q%20697%20280%20696%20285%20Q%20695%20290%20694%20295%20Q%20693%20300%20692%20305%20Q%20691%20310%20690%20313%20Q%20690%20316%20689%20318%20Q%20689%20320%20688%20325%20Q%20686%20330%20685%20335%20Q%20684%20340%20682%20345%20Q%20681%20350%20680%20352%20Q%20680%20354%20679%20357%20Q%20678%20360%20676%20365%20Q%20674%20370%20672%20375%20Q%20670%20380%20670%20380%20Q%20670%20380%20668%20385%20Q%20666%20390%20664%20395%20Q%20662%20400%20661%20402%20Q%20660%20404%20658%20407%20Q%20656%20410%20653%20414%20Q%20650%20418%20649%20419%20Q%20648%20420%20644%20424%20Q%20640%20429%20639%20429%20Q%20639%20430%20634%20434%20Q%20630%20439%20629%20439%20Q%20629%20440%20624%20443%20Q%20620%20447%20618%20448%20Q%20616%20450%20613%20452%20Q%20610%20454%20605%20457%20Q%20600%20460%20600%20460%20Q%20600%20460%20595%20462%20Q%20590%20465%20585%20467%20Q%20580%20469%20578%20469%20Q%20577%20470%20573%20471%20Q%20570%20472%20565%20473%20Q%20560%20474%20555%20475%20Q%20550%20476%20545%20476%20Q%20540%20477%20535%20477%20Q%20530%20477%20525%20477%20Q%20520%20477%20515%20477%20Q%20510%20476%20505%20476%20Q%20500%20475%20495%20474%20Q%20490%20473%20485%20472%20Q%20480%20471%20478%20470%20Q%20476%20470%20473%20469%20Q%20470%20468%20465%20466%20Q%20460%20464%20455%20462%20Q%20450%20460%20448%20460%20Q%20446%20460%20443%20459%20Q%20440%20458%20435%20456%20Q%20430%20454%20425%20452%20Q%20421%20450%20420%20449%20Q%20420%20449%20415%20446%20Q%20410%20444%20405%20442%20Q%20401%20440%20400%20439%20Q%20400%20439%20395%20436%20Q%20390%20433%20386%20431%20Q%20382%20430%20381%20429%20Q%20380%20428%20375%20426%20Q%20370%20423%20365%20421%20Q%20361%20420%20360%20419%20Q%20360%20419%20355%20417%20Q%20350%20416%20345%20415%20Q%20340%20414%20335%20413%20Q%20330%20413%20325%20414%20Q%20320%20415%20315%20416%20Q%20310%20418%20308%20419%20Q%20307%20420%20303%20422%20Q%20300%20424%20297%20427%20Q%20294%20430%20292%20432%20Q%20290%20434%20285%20435%20Q%20280%20435%20279%20437%20Q%20278%20440%20276%20445%20Q%20274%20450%20272%20455%20Q%20271%20460%20270%20462%20Q%20270%20464%20269%20467%20Q%20268%20470%20267%20475%20Q%20266%20480%20265%20485%20Q%20264%20490%20263%20495%20Q%20263%20500%20262%20505%20Q%20261%20510%20261%20515%20Q%20260%20520%20260%20523%20Q%20260%20526%20259%20528%20Q%20259%20530%20259%20535%20Q%20258%20540%20258%20545%20Q%20257%20550%20257%20555%20Q%20256%20560%20256%20565%20Q%20255%20570%20255%20575%20Q%20254%20580%20253%20585%20Q%20253%20590%20252%20595%20Q%20251%20600%20250%20605%20Q%20250%20610%20250%20610%20Q%20250%20610%20249%20615%20Q%20248%20620%20247%20625%20Q%20246%20630%20245%20635%20Q%20243%20640%20242%20645%20Q%20241%20650%20240%20652%20Q%20240%20654%20239%20657%20Q%20238%20660%20236%20665%20Q%20235%20670%20233%20675%20Q%20231%20680%20230%20681%20Q%20230%20683%20228%20686%20Q%20227%20690%20225%20695%20Q%20222%20700%20221%20702%20Q%20220%20705%20218%20707%20Q%20217%20710%20214%20715%20Q%20211%20720%20210%20721%20Q%20210%20722%20207%20726%20Q%20205%20730%20202%20733%20Q%20200%20737%20198%20738%20Q%20197%20740%20193%20744%20Q%20190%20749%20189%20749%20Q%20189%20750%20184%20754%20Q%20180%20759%20179%20759%20Q%20179%20760%20174%20764%20Q%20170%20768%20168%20769%20Q%20167%20770%20163%20772%20Q%20160%20775%20156%20777%20Q%20152%20780%20151%20780%20Q%20150%20781%20145%20784%20Q%20140%20787%20136%20788%20Q%20133%20790%20131%20790%20Q%20130%20791%20125%20793%20Q%20120%20795%20115%20796%20Q%20110%20798%20105%20799%20Q%20101%20800%20100%20800%20Q%20100%20800%2095%20801%20Q%2090%20802%2085%20802%20Q%2080%20803%2075%20803%20Q%2070%20803%2065%20803%20Q%2060%20803%2055%20803%20Q%2050%20803%2045%20802%20Q%2040%20802%2035%20801%20Q%2030%20801%2027%20800%20Q%2024%20800%2022%20799%20Q%2020%20799%2015%20798%20Q%2010%20797%205%20795%20Q%2010%20797%200%20794%20Z%22%2F%3E%3Cpath%20d%3D%22M%201774%200%20Q%201770%207%201769%208%20Q%201768%2010%201765%2015%20Q%201762%2020%201761%2023%20Q%201760%2026%201759%2028%20Q%201759%2030%201756%2035%20Q%201754%2040%201753%2045%20Q%201751%2050%201750%2052%20Q%201750%2055%201749%2057%20Q%201748%2060%201747%2065%20Q%201746%2070%201745%2075%20Q%201744%2080%201744%2085%20Q%201743%2090%201743%2095%20Q%201743%20100%201743%20105%20Q%201743%20110%201743%20115%20Q%201743%20120%201744%20125%20Q%201744%20130%201745%20135%20Q%201745%20140%201746%20145%20Q%201747%20150%201748%20155%20Q%201749%20160%201749%20161%20Q%201750%20163%201750%20166%20Q%201751%20170%201752%20175%20Q%201754%20180%201755%20185%20Q%201756%20190%201758%20194%20Q%201760%20199%201760%20199%20Q%201760%20200%201761%20205%20Q%201762%20210%201764%20215%20Q%201765%20220%201767%20225%20Q%201768%20230%201769%20233%20Q%201770%20237%201770%20238%20Q%201770%20240%201771%20245%20Q%201772%20250%201772%20255%20Q%201773%20260%201773%20265%20Q%201774%20270%201774%20275%20Q%201774%20280%201774%20285%20Q%201773%20290%201774%20295%20Q%201775%20300%201774%20305%20Q%201773%20310%201772%20315%20Q%201771%20320%201770%20322%20Q%201770%20325%201769%20327%20Q%201768%20330%201767%20335%20Q%201766%20340%201764%20345%20Q%201763%20350%201766%20355%20Q%201769%20360%201768%20365%20Q%201768%20370%201767%20375%20Q%201766%20380%201765%20385%20Q%201764%20390%201763%20395%20Q%201762%20400%201762%20405%20Q%201761%20410%201760%20413%20Q%201760%20417%201759%20418%20Q%201759%20420%201758%20425%20Q%201757%20430%201757%20435%20Q%201756%20440%201755%20445%20Q%201755%20450%201754%20455%20Q%201754%20460%201754%20465%20Q%201753%20470%201753%20475%20Q%201753%20480%201754%20485%20Q%201754%20490%201755%20495%20Q%201756%20500%201757%20505%20Q%201758%20510%201759%20512%20Q%201760%20515%201760%20517%20Q%201761%20520%201763%20525%20Q%201765%20530%201767%20534%20Q%201770%20539%201770%20539%20Q%201770%20540%201773%20545%20Q%201776%20550%201778%20552%20Q%201780%20555%201781%20557%20Q%201782%20560%201785%20565%20Q%201789%20570%201789%20570%20Q%201790%20570%201793%20575%20Q%201796%20580%201798%20582%20Q%201800%20585%201801%20587%20Q%201803%20590%201806%20594%20Q%201810%20599%201810%20599%20Q%201810%20600%201813%20605%20Q%201816%20610%201818%20612%20Q%201820%20615%201821%20617%20Q%201822%20620%201825%20625%20Q%201828%20630%201829%20631%20Q%201830%20632%201832%20636%20Q%201834%20640%201836%20645%20Q%201838%20650%201839%20650%20Q%201840%20651%201842%20655%20Q%201845%20660%201847%20665%20Q%201849%20670%201849%20670%20Q%201850%20671%201851%20675%20Q%201853%20680%201854%20685%20Q%201856%20690%201857%20695%20Q%201858%20700%201859%20702%20Q%201860%20705%201860%20707%20Q%201860%20710%201861%20715%20Q%201862%20720%201863%20725%20Q%201864%20730%201864%20735%20Q%201865%20740%201865%20745%20Q%201865%20750%201865%20755%20Q%201865%20760%201865%20765%20Q%201864%20770%201864%20775%20Q%201864%20780%201864%20785%20Q%201863%20790%201863%20795%20Q%201862%20800%201862%20805%20Q%201861%20810%201861%20815%20Q%201860%20820%201860%20821%20Q%201860%20823%201859%20826%20Q%201859%20830%201858%20835%20Q%201857%20840%201857%20845%20Q%201856%20850%201855%20855%20Q%201855%20860%201854%20865%20Q%201854%20870%201854%20875%20Q%201853%20880%201853%20885%20Q%201853%20890%201853%20895%20Q%201853%20900%201853%20905%20Q%201853%20910%201853%20915%20Q%201854%20920%201854%20925%20Q%201854%20930%201855%20935%20Q%201855%20940%201856%20945%20Q%201856%20950%201857%20955%20Q%201858%20960%201858%20965%20Q%201859%20970%201859%20970%20Q%201860%20971%201860%20975%20Q%201861%20980%201862%20985%20Q%201862%20990%201863%20995%20Q%201864%201000%201865%201005%20Q%201866%201010%201867%201015%20Q%201867%201020%201868%201025%20Q%201869%201030%201869%201031%20Q%201870%201032%201870%201036%20Q%201870%201040%201871%201045%20Q%201871%201050%201872%201055%20Q%201872%201060%201873%201065%20Q%201873%201070%201874%201075%20Q%201873%201070%201874%201080%20Z%22%2F%3E%3Cpath%20d%3D%22M%200%20257%20Q%201%20260%203%20265%20Q%204%20270%206%20275%20Q%207%20280%208%20285%20Q%208%20290%208%20295%20Q%208%20300%208%20305%20Q%207%20310%206%20315%20Q%205%20320%204%20325%20Q%202%20330%201%20332%20Q%202%20330%200%20335%20Z%22%2F%3E%3Cpath%20d%3D%22M%200%201021%20Q%207%201030%208%201031%20Q%2010%201033%2013%201036%20Q%2016%201040%2018%201041%20Q%2020%201043%2024%201046%20Q%2028%201050%2029%201050%20Q%2030%201051%2035%201054%20Q%2040%201056%2041%201058%20Q%2042%201060%2045%201065%20Q%2047%201070%2048%201071%20Q%2050%201073%2053%201071%20Q%2056%201070%2058%201069%20Q%2060%201068%2065%201065%20Q%2070%201062%2072%201061%20Q%2075%201060%2077%201058%20Q%2080%201057%2085%201055%20Q%2090%201052%2092%201051%20Q%2094%201050%2097%201048%20Q%20100%201047%20105%201044%20Q%20110%201041%20111%201040%20Q%20113%201040%20116%201038%20Q%20120%201036%20125%201034%20Q%20130%201031%20131%201030%20Q%20132%201030%20136%201028%20Q%20140%201026%20145%201023%20Q%20150%201021%20151%201020%20Q%20152%201020%20156%201017%20Q%20160%201015%20165%201013%20Q%20170%201010%20170%201010%20Q%20171%201010%20172%201005%20Q%20174%201000%20177%20998%20Q%20180%20996%20185%20994%20Q%20190%20991%20191%20990%20Q%20192%20990%20196%20987%20Q%20200%20985%20205%20983%20Q%20210%20980%20210%20980%20Q%20210%20980%20215%20977%20Q%20220%20975%20224%20972%20Q%20229%20970%20229%20969%20Q%20230%20969%20235%20967%20Q%20240%20964%20244%20962%20Q%20248%20960%20249%20959%20Q%20250%20959%20255%20956%20Q%20260%20954%20264%20952%20Q%20268%20950%20269%20949%20Q%20270%20949%20275%20946%20Q%20280%20944%20284%20942%20Q%20288%20940%20289%20939%20Q%20290%20939%20295%20936%20Q%20300%20934%20304%20932%20Q%20309%20930%20309%20929%20Q%20310%20929%20315%20927%20Q%20320%20924%20324%20922%20Q%20329%20920%20329%20919%20Q%20330%20919%20335%20917%20Q%20340%20915%20345%20912%20Q%20350%20910%20351%20910%20Q%20353%20910%20356%20909%20Q%20360%20909%20365%20907%20Q%20370%20905%20375%20902%20Q%20380%20900%20381%20900%20Q%20382%20900%20386%20898%20Q%20390%20896%20395%20894%20Q%20400%20892%20403%20891%20Q%20406%20890%20408%20889%20Q%20410%20888%20415%20886%20Q%20420%20884%20425%20882%20Q%20430%20880%20430%20880%20Q%20431%20880%20435%20878%20Q%20440%20876%20445%20875%20Q%20450%20874%20455%20872%20Q%20460%20870%20460%20870%20Q%20461%20870%20465%20868%20Q%20470%20866%20475%20863%20Q%20480%20861%20481%20860%20Q%20483%20860%20486%20858%20Q%20490%20857%20495%20855%20Q%20500%20852%20502%20851%20Q%20505%20850%20507%20849%20Q%20510%20848%20515%20845%20Q%20520%20843%20523%20841%20Q%20526%20840%20528%20839%20Q%20530%20838%20535%20835%20Q%20540%20833%20545%20831%20Q%20550%20830%20550%20830%20Q%20550%20830%20555%20827%20Q%20560%20824%20564%20822%20Q%20568%20820%20569%20819%20Q%20570%20819%20575%20816%20Q%20580%20813%20583%20811%20Q%20586%20810%20588%20808%20Q%20590%20807%20595%20804%20Q%20600%20801%20601%20800%20Q%20603%20800%20606%20797%20Q%20610%20795%20614%20792%20Q%20619%20790%20619%20789%20Q%20620%20789%20625%20786%20Q%20630%20783%20632%20781%20Q%20635%20780%20634%20775%20Q%20633%20770%20636%20767%20Q%20640%20765%20643%20762%20Q%20647%20760%20648%20759%20Q%20650%20758%20655%20756%20Q%20660%20753%20663%20751%20Q%20666%20750%20668%20749%20Q%20670%20748%20675%20745%20Q%20680%20743%20682%20741%20Q%20685%20740%20687%20738%20Q%20690%20737%20695%20735%20Q%20700%20732%20702%20731%20Q%20704%20730%20707%20728%20Q%20710%20727%20715%20724%20Q%20720%20722%20721%20721%20Q%20723%20720%20726%20718%20Q%20730%20716%20735%20714%20Q%20740%20711%20741%20710%20Q%20742%20710%20746%20708%20Q%20750%20706%20755%20703%20Q%20760%20700%20760%20700%20Q%20761%20700%20765%20698%20Q%20770%20696%20775%20694%20Q%20780%20693%20784%20691%20Q%20789%20690%20789%20689%20Q%20790%20689%20795%20688%20Q%20800%20686%20805%20684%20Q%20810%20682%20813%20681%20Q%20817%20680%20818%20679%20Q%20820%20679%20825%20677%20Q%20830%20675%20835%20674%20Q%20840%20672%20844%20671%20Q%20849%20670%20849%20669%20Q%20850%20669%20855%20668%20Q%20860%20667%20865%20665%20Q%20870%20664%20875%20663%20Q%20880%20661%20882%20660%20Q%20885%20660%20887%20659%20Q%20890%20658%20895%20657%20Q%20900%20656%20905%20654%20Q%20910%20653%20914%20651%20Q%20919%20650%20919%20649%20Q%20920%20649%20925%20648%20Q%20930%20646%20935%20644%20Q%20940%20643%20944%20641%20Q%20948%20640%20949%20639%20Q%20950%20639%20955%20637%20Q%20960%20635%20965%20633%20Q%20970%20631%20971%20630%20Q%20972%20630%20976%20628%20Q%20980%20626%20985%20624%20Q%20990%20621%20991%20620%20Q%20992%20620%20996%20618%20Q%201000%20616%201005%20613%20Q%201010%20610%201010%20610%20Q%201011%20610%201015%20607%20Q%201020%20604%201023%20602%20Q%201027%20600%201028%20599%20Q%201030%20598%201035%20594%20Q%201040%20591%201040%20590%20Q%201041%20590%201045%20587%20Q%201050%20584%201052%20582%20Q%201055%20580%201057%20578%20Q%201060%20576%201064%20573%20Q%201068%20570%201069%20569%20Q%201070%20568%201075%20564%20Q%201080%20560%201080%20560%20Q%201080%20560%201085%20558%20Q%201090%20556%201095%20554%20Q%201100%20552%201103%20551%20Q%201107%20550%201108%20549%20Q%201110%20548%201115%20545%20Q%201120%20542%201122%20541%20Q%201124%20540%201127%20538%20Q%201130%20536%201135%20534%20Q%201140%20531%201140%20530%20Q%201141%20530%201145%20525%20Q%201150%20521%201152%20520%20Q%201154%20520%201157%20518%20Q%201160%20517%201165%20515%20Q%201170%20513%201173%20511%20Q%201176%20510%201178%20509%20Q%201180%20508%201185%20506%20Q%201190%20503%201193%20501%20Q%201197%20500%201198%20499%20Q%201200%20498%201205%20495%20Q%201210%20493%201212%20491%20Q%201215%20490%201217%20488%20Q%201220%20487%201225%20484%20Q%201230%20481%201231%20480%20Q%201232%20480%201236%20477%20Q%201240%20475%201244%20472%20Q%201248%20470%201249%20469%20Q%201250%20469%201255%20469%20Q%201260%20468%201265%20466%20Q%201270%20463%201273%20461%20Q%201277%20460%201278%20459%20Q%201280%20458%201285%20456%20Q%201290%20454%201295%20452%20Q%201300%20450%201300%20450%20Q%201300%20450%201305%20448%20Q%201310%20446%201315%20445%20Q%201320%20443%201325%20442%20Q%201330%20441%201335%20441%20Q%201340%20440%201344%20440%20Q%201348%20440%201349%20439%20Q%201350%20439%201350%20439%20Q%201350%20440%201355%20441%20Q%201360%20442%201365%20441%20Q%201370%20441%201375%20442%20Q%201380%20444%201385%20446%20Q%201390%20448%201392%20449%20Q%201394%20450%201397%20450%20Q%201400%20451%201405%20453%20Q%201410%20455%201415%20457%20Q%201420%20459%201420%20459%20Q%201420%20460%201425%20462%20Q%201430%20465%201434%20467%20Q%201438%20470%201439%20470%20Q%201440%20471%201445%20474%20Q%201450%20477%201452%20478%20Q%201454%20480%201457%20481%20Q%201460%20483%201465%20486%20Q%201470%20489%201470%20489%20Q%201470%20490%201475%20493%20Q%201480%20496%201482%20498%20Q%201484%20500%201487%20501%20Q%201490%20503%201494%20506%20Q%201498%20510%201499%20510%20Q%201500%20510%201505%20514%20Q%201510%20518%201510%20519%20Q%201511%20520%201515%20523%20Q%201520%20527%201521%20528%20Q%201523%20530%201526%20533%20Q%201530%20536%201531%20538%20Q%201533%20540%201536%20543%20Q%201540%20546%201541%20548%20Q%201542%20550%201546%20554%20Q%201550%20559%201550%20559%20Q%201550%20560%201553%20565%20Q%201556%20570%201558%20573%20Q%201560%20576%201560%20578%20Q%201561%20580%201563%20585%20Q%201565%20590%201567%20595%20Q%201568%20600%201569%20602%20Q%201570%20604%201570%20607%20Q%201571%20610%201572%20615%20Q%201573%20620%201573%20625%20Q%201574%20630%201574%20635%20Q%201575%20640%201575%20645%20Q%201576%20650%201575%20655%20Q%201574%20660%201574%20665%20Q%201574%20670%201575%20675%20Q%201575%20680%201575%20685%20Q%201575%20690%201576%20695%20Q%201576%20700%201577%20705%20Q%201577%20710%201577%20715%20Q%201578%20720%201579%20725%20Q%201579%20730%201578%20735%20Q%201577%20740%201578%20745%20Q%201578%20750%201578%20755%20Q%201578%20760%201579%20762%20Q%201580%20764%201580%20767%20Q%201581%20770%201581%20775%20Q%201580%20780%201580%20784%20Q%201580%20789%201579%20789%20Q%201579%20790%201579%20795%20Q%201578%20800%201577%20805%20Q%201576%20810%201575%20815%20Q%201574%20820%201573%20825%20Q%201571%20830%201570%20832%20Q%201570%20835%201569%20837%20Q%201568%20840%201566%20845%20Q%201564%20850%201562%20855%20Q%201560%20860%201560%20860%20Q%201560%20861%201558%20865%20Q%201556%20870%201554%20875%20Q%201552%20880%201551%20882%20Q%201550%20884%201548%20887%20Q%201547%20890%201545%20895%20Q%201543%20900%201541%20904%20Q%201540%20908%201539%20909%20Q%201539%20910%201537%20915%20Q%201535%20920%201534%20925%20Q%201532%20930%201531%20934%20Q%201530%20938%201529%20939%20Q%201529%20940%201528%20945%20Q%201527%20950%201525%20955%20Q%201524%20960%201524%20965%20Q%201523%20970%201522%20975%20Q%201522%20980%201521%20985%20Q%201521%20990%201521%20995%20Q%201521%201000%201521%201005%20Q%201521%201010%201521%201015%20Q%201522%201020%201522%201025%20Q%201523%201030%201524%201035%20Q%201525%201040%201526%201045%20Q%201527%201050%201528%201055%20Q%201529%201060%201529%201060%20Q%201530%201060%201531%201065%20Q%201533%201070%201534%201075%20Q%201533%201070%201536%201080%20Z%22%2F%3E%3Cpath%20d%3D%22M%20575%201080%20Q%20574%201070%20573%201065%20Q%20573%201060%20573%201055%20Q%20573%201050%20574%201045%20Q%20574%201040%20575%201035%20Q%20576%201030%20577%201025%20Q%20578%201020%20579%201017%20Q%20580%201015%20580%201012%20Q%20581%201010%20583%201005%20Q%20585%201000%20587%20995%20Q%20590%20991%20590%20990%20Q%20591%20990%20594%20985%20Q%20597%20980%20598%20978%20Q%20600%20976%20602%20973%20Q%20605%20970%20607%20967%20Q%20610%20965%20613%20962%20Q%20616%20960%20618%20958%20Q%20620%20956%20624%20953%20Q%20629%20950%20629%20949%20Q%20630%20949%20635%20946%20Q%20640%20944%20644%20942%20Q%20649%20940%20649%20939%20Q%20650%20939%20655%20937%20Q%20660%20935%20665%20934%20Q%20670%20933%20675%20931%20Q%20680%20930%20682%20930%20Q%20684%20930%20687%20929%20Q%20690%20928%20695%20928%20Q%20700%20927%20705%20927%20Q%20710%20926%20715%20926%20Q%20720%20925%20725%20925%20Q%20730%20925%20735%20925%20Q%20740%20925%20745%20925%20Q%20750%20925%20755%20926%20Q%20760%20926%20765%20926%20Q%20770%20927%20775%20927%20Q%20780%20928%20785%20928%20Q%20790%20929%20791%20929%20Q%20792%20930%20796%20930%20Q%20800%20931%20805%20931%20Q%20810%20932%20815%20934%20Q%20820%20935%20825%20936%20Q%20830%20937%20833%20938%20Q%20837%20940%20838%20940%20Q%20840%20940%20845%20942%20Q%20850%20944%20855%20945%20Q%20860%20947%20862%20948%20Q%20864%20950%20867%20951%20Q%20870%20952%20875%20954%20Q%20880%20957%20882%20958%20Q%20885%20960%20887%20961%20Q%20890%20962%20895%20965%20Q%20900%20969%20900%20969%20Q%20901%20970%20905%20973%20Q%20910%20976%20912%20978%20Q%20914%20980%20917%20982%20Q%20920%20984%20922%20987%20Q%20925%20990%20927%20992%20Q%20930%20994%20932%20997%20Q%20935%201000%20937%201002%20Q%20940%201005%20941%201007%20Q%20943%201010%20946%201014%20Q%20950%201018%20950%201019%20Q%20950%201020%20953%201025%20Q%20956%201030%20958%201033%20Q%20960%201036%20960%201038%20Q%20961%201040%20963%201045%20Q%20965%201050%20967%201055%20Q%20969%201060%20969%201061%20Q%20970%201063%20970%201066%20Q%20971%201070%20972%201075%20Q%20971%201070%20973%201080%20Z%22%2F%3E%3Cpath%20d%3D%22M%20767%200%20Q%20760%203%20755%206%20Q%20750%208%20749%209%20Q%20749%2010%20747%2015%20Q%20745%2020%20743%2025%20Q%20741%2030%20740%2031%20Q%20740%2033%20736%2036%20Q%20733%2040%20731%2042%20Q%20730%2044%20727%2047%20Q%20724%2050%20722%2052%20Q%20720%2055%20718%2057%20Q%20716%2060%20713%2064%20Q%20710%2068%20709%2069%20Q%20708%2070%20705%2075%20Q%20701%2080%20700%2081%20Q%20700%2082%20698%2086%20Q%20696%2090%20693%2095%20Q%20690%20100%20690%20100%20Q%20690%20100%20687%20105%20Q%20685%20110%20682%20114%20Q%20680%20119%20679%20119%20Q%20679%20120%20677%20125%20Q%20674%20130%20672%20134%20Q%20670%20139%20669%20139%20Q%20669%20140%20667%20145%20Q%20665%20150%20663%20155%20Q%20661%20160%20660%20162%20Q%20660%20164%20659%20167%20Q%20658%20170%20656%20175%20Q%20655%20180%20654%20185%20Q%20653%20190%20652%20195%20Q%20651%20200%20650%20203%20Q%20650%20207%20649%20208%20Q%20649%20210%20649%20215%20Q%20648%20220%20648%20225%20Q%20648%20230%20648%20235%20Q%20648%20240%20648%20245%20Q%20648%20250%20648%20255%20Q%20648%20260%20648%20265%20Q%20648%20270%20648%20275%20Q%20648%20280%20648%20285%20Q%20648%20290%20648%20295%20Q%20648%20300%20647%20305%20Q%20647%20310%20647%20315%20Q%20646%20320%20645%20325%20Q%20644%20330%20643%20335%20Q%20642%20340%20641%20344%20Q%20640%20349%20639%20349%20Q%20639%20350%20638%20355%20Q%20636%20360%20634%20365%20Q%20631%20370%20630%20371%20Q%20630%20373%20628%20376%20Q%20626%20380%20623%20384%20Q%20620%20389%20619%20389%20Q%20619%20390%20615%20395%20Q%20611%20400%20610%20400%20Q%20610%20401%20605%20404%20Q%20600%20408%20599%20409%20Q%20598%20410%20594%20413%20Q%20590%20416%20586%20418%20Q%20583%20420%20581%20421%20Q%20580%20422%20575%20424%20Q%20570%20426%20565%20428%20Q%20560%20430%20560%20430%20Q%20560%20430%20555%20431%20Q%20550%20432%20545%20433%20Q%20540%20434%20535%20434%20Q%20530%20434%20525%20434%20Q%20520%20434%20515%20433%20Q%20510%20433%20505%20432%20Q%20500%20431%20497%20430%20Q%20495%20430%20492%20429%20Q%20490%20428%20485%20426%20Q%20480%20424%20475%20422%20Q%20470%20420%20470%20419%20Q%20470%20419%20465%20416%20Q%20460%20414%20457%20412%20Q%20454%20410%20452%20409%20Q%20450%20408%20445%20406%20Q%20440%20405%20435%20403%20Q%20430%20400%20428%20400%20Q%20427%20400%20423%20397%20Q%20420%20394%20417%20392%20Q%20414%20390%20412%20388%20Q%20410%20386%20406%20383%20Q%20402%20380%20401%20378%20Q%20400%20377%20395%20373%20Q%20390%20370%20390%20369%20Q%20390%20369%20385%20365%20Q%20380%20361%20378%20360%20Q%20377%20360%20373%20357%20Q%20370%20354%20366%20352%20Q%20362%20350%20361%20349%20Q%20360%20348%20355%20345%20Q%20350%20342%20347%20341%20Q%20344%20340%20342%20338%20Q%20340%20337%20335%20335%20Q%20330%20333%20325%20331%20Q%20320%20330%20319%20330%20Q%20318%20330%20314%20328%20Q%20310%20327%20305%20326%20Q%20300%20325%20295%20324%20Q%20290%20324%20287%20322%20Q%20284%20320%20282%20318%20Q%20280%20316%20275%20316%20Q%20270%20317%20265%20317%20Q%20260%20318%20255%20319%20Q%20251%20320%20250%20320%20Q%20250%20320%20245%20321%20Q%20240%20322%20235%20323%20Q%20230%20325%20225%20327%20Q%20220%20329%20218%20329%20Q%20217%20330%20213%20331%20Q%20210%20333%20205%20336%20Q%20200%20340%20200%20340%20Q%20200%20340%20195%20344%20Q%20190%20348%20189%20349%20Q%20188%20350%20184%20355%20Q%20180%20360%20180%20360%20Q%20180%20360%20177%20365%20Q%20174%20370%20172%20374%20Q%20170%20379%20169%20379%20Q%20169%20380%20168%20385%20Q%20166%20390%20165%20395%20Q%20164%20400%20163%20405%20Q%20162%20410%20162%20415%20Q%20162%20420%20162%20425%20Q%20163%20430%20163%20435%20Q%20164%20440%20164%20445%20Q%20165%20450%20166%20455%20Q%20167%20460%20168%20465%20Q%20168%20470%20169%20472%20Q%20170%20475%20170%20477%20Q%20170%20480%20171%20485%20Q%20172%20490%20173%20495%20Q%20174%20500%20174%20505%20Q%20175%20510%20176%20515%20Q%20177%20520%20177%20525%20Q%20178%20530%20178%20535%20Q%20179%20540%20179%20545%20Q%20179%20550%20179%20555%20Q%20179%20560%20179%20565%20Q%20179%20570%20179%20575%20Q%20179%20580%20179%20585%20Q%20178%20590%20177%20595%20Q%20177%20600%20176%20605%20Q%20175%20610%20174%20615%20Q%20173%20620%20171%20625%20Q%20170%20630%20170%20630%20Q%20170%20630%20168%20635%20Q%20166%20640%20164%20645%20Q%20162%20650%20161%20652%20Q%20160%20654%20158%20657%20Q%20157%20660%20153%20665%20Q%20150%20670%20150%20670%20Q%20150%20671%20146%20675%20Q%20143%20680%20141%20681%20Q%20140%20683%20137%20686%20Q%20134%20690%20132%20691%20Q%20130%20693%20126%20696%20Q%20122%20700%20121%20700%20Q%20120%20701%20115%20705%20Q%20110%20708%20108%20709%20Q%20107%20710%20103%20711%20Q%20100%20713%2095%20715%20Q%2090%20717%2086%20718%20Q%2083%20720%2081%20720%20Q%2080%20721%2075%20722%20Q%2070%20723%2065%20723%20Q%2060%20724%2055%20724%20Q%2050%20725%2045%20725%20Q%2040%20725%2035%20724%20Q%2030%20724%2025%20723%20Q%2020%20722%2015%20721%20Q%2010%20720%208%20720%20Q%207%20720%203%20718%20Q%207%20720%200%20717%20Z%22%2F%3E%3Cpath%20d%3D%22M%201817%200%20Q%201810%208%201809%209%20Q%201808%2010%201804%2015%20Q%201801%2020%201800%2021%20Q%201800%2022%201797%2026%20Q%201795%2030%201793%2035%20Q%201790%2040%201790%2041%20Q%201790%2042%201788%2046%20Q%201786%2050%201785%2055%20Q%201783%2060%201782%2065%20Q%201781%2070%201780%2074%20Q%201780%2079%201779%2079%20Q%201779%2080%201779%2085%20Q%201779%2090%201778%2095%20Q%201778%20100%201779%20105%20Q%201779%20110%201779%20112%20Q%201780%20115%201780%20117%20Q%201780%20120%201781%20125%20Q%201782%20130%201783%20135%20Q%201784%20140%201786%20145%20Q%201787%20150%201788%20152%20Q%201790%20155%201790%20157%20Q%201791%20160%201793%20165%20Q%201795%20170%201797%20174%20Q%201800%20178%201800%20179%20Q%201800%20180%201803%20185%20Q%201806%20190%201808%20193%20Q%201810%20196%201811%20198%20Q%201812%20200%201815%20205%20Q%201818%20210%201819%20211%20Q%201820%20212%201822%20216%20Q%201825%20220%201827%20223%20Q%201830%20227%201830%20228%20Q%201831%20230%201834%20235%20Q%201837%20240%201838%20242%20Q%201840%20244%201841%20247%20Q%201842%20250%201845%20255%20Q%201847%20260%201848%20265%20Q%201849%20270%201849%20270%20Q%201850%20270%201850%20275%20Q%201851%20280%201851%20285%20Q%201851%20290%201855%20295%20Q%201859%20300%201856%20305%20Q%201853%20310%201851%20313%20Q%201850%20317%201849%20318%20Q%201848%20320%201846%20325%20Q%201843%20330%201841%20333%20Q%201840%20337%201839%20338%20Q%201838%20340%201836%20345%20Q%201834%20350%201836%20355%20Q%201838%20360%201836%20365%20Q%201835%20370%201833%20375%20Q%201832%20380%201831%20384%20Q%201830%20388%201829%20389%20Q%201829%20390%201828%20395%20Q%201827%20400%201826%20405%20Q%201825%20410%201824%20415%20Q%201823%20420%201822%20425%20Q%201821%20430%201821%20435%20Q%201820%20440%201820%20442%20Q%201820%20444%201819%20447%20Q%201819%20450%201819%20455%20Q%201819%20460%201819%20465%20Q%201819%20470%201819%20474%20Q%201820%20479%201820%20479%20Q%201820%20480%201820%20485%20Q%201821%20490%201822%20495%20Q%201823%20500%201824%20505%20Q%201825%20510%201827%20515%20Q%201828%20520%201829%20521%20Q%201830%20523%201831%20526%20Q%201832%20530%201834%20535%20Q%201836%20540%201838%20543%20Q%201840%20546%201840%20548%20Q%201841%20550%201843%20555%20Q%201846%20560%201848%20563%20Q%201850%20567%201850%20568%20Q%201851%20570%201854%20575%20Q%201856%20580%201858%20583%20Q%201860%20586%201861%20588%20Q%201862%20590%201864%20595%20Q%201867%20600%201868%20602%20Q%201870%20605%201871%20607%20Q%201872%20610%201874%20615%20Q%201877%20620%201878%20623%20Q%201880%20626%201880%20628%20Q%201881%20630%201883%20635%20Q%201886%20640%201888%20644%20Q%201890%20649%201890%20649%20Q%201890%20650%201892%20655%20Q%201895%20660%201896%20665%20Q%201898%20670%201899%20671%20Q%201900%20673%201900%20676%20Q%201901%20680%201903%20685%20Q%201904%20690%201906%20695%20Q%201907%20700%201908%20705%20Q%201909%20710%201909%20710%20Q%201910%20710%201910%20715%20Q%201911%20720%201912%20725%20Q%201913%20730%201914%20735%20Q%201915%20740%201915%20745%20Q%201916%20750%201916%20755%20Q%201917%20760%201917%20765%20Q%201917%20770%201918%20775%20Q%201918%20780%201918%20785%20Q%201919%20790%201919%20795%20Q%201919%20800%201919%20805%20Q%201919%20810%201919%20815%20Q%201919%20820%201919%20821%20Q%201919%20820%201920%20823%20Z%22%2F%3E%3Cpath%20d%3D%22M%200%20195%20Q%206%20200%208%20201%20Q%2010%20203%2013%20206%20Q%2017%20210%2018%20211%20Q%2020%20212%2023%20216%20Q%2026%20220%2028%20221%20Q%2030%20223%2032%20226%20Q%2035%20230%2036%20235%20Q%2037%20240%2038%20242%20Q%2040%20244%2041%20247%20Q%2043%20250%2045%20255%20Q%2048%20260%2049%20262%20Q%2050%20265%2051%20267%20Q%2052%20270%2053%20275%20Q%2055%20280%2056%20285%20Q%2057%20290%2058%20295%20Q%2059%20300%2059%20304%20Q%2060%20308%2060%20309%20Q%2060%20310%2060%20311%20Q%2060%20313%2059%20316%20Q%2059%20320%2059%20325%20Q%2058%20330%2057%20335%20Q%2056%20340%2053%20345%20Q%2051%20350%2050%20351%20Q%2050%20352%2048%20356%20Q%2046%20360%2043%20364%20Q%2040%20368%2039%20369%20Q%2038%20370%2034%20374%20Q%2030%20379%2029%20379%20Q%2029%20380%2024%20384%20Q%2020%20388%2019%20389%20Q%2018%20390%2014%20393%20Q%2010%20396%207%20398%20Q%205%20400%202%20401%20Q%205%20400%200%20403%20Z%22%2F%3E%3Cpath%20d%3D%22M%20248%201080%20Q%20250%201079%20255%201076%20Q%20260%201073%20263%201071%20Q%20267%201070%20268%201069%20Q%20270%201068%20275%201066%20Q%20280%201063%20283%201061%20Q%20286%201060%20288%201059%20Q%20290%201058%20295%201055%20Q%20300%201053%20303%201051%20Q%20306%201050%20308%201048%20Q%20310%201047%20315%201045%20Q%20320%201042%20322%201041%20Q%20325%201040%20327%201038%20Q%20330%201037%20335%201035%20Q%20340%201032%20342%201031%20Q%20344%201030%20347%201028%20Q%20350%201027%20353%201028%20Q%20356%201030%20358%201030%20Q%20360%201031%20362%201030%20Q%20364%201030%20367%201029%20Q%20370%201028%20375%201026%20Q%20380%201025%20385%201024%20Q%20390%201022%20395%201022%20Q%20400%201021%20403%201020%20Q%20407%201020%20408%201019%20Q%20410%201019%20415%201019%20Q%20420%201018%20425%201018%20Q%20430%201018%20435%201019%20Q%20440%201019%20440%201019%20Q%20440%201020%20445%201020%20Q%20450%201021%20455%201023%20Q%20460%201025%20464%201027%20Q%20468%201030%20469%201030%20Q%20470%201031%20475%201035%20Q%20480%201039%20480%201039%20Q%20480%201040%20485%201045%20Q%20489%201050%20489%201050%20Q%20490%201050%20493%201055%20Q%20497%201060%20498%201062%20Q%20500%201064%20501%201067%20Q%20503%201070%20506%201075%20Q%20503%201070%20509%201080%20Z%22%2F%3E%3Cpath%20d%3D%22M%201014%201080%20Q%201013%201070%201012%201065%20Q%201011%201060%201010%201055%20Q%201010%201050%201009%201050%20Q%201009%201050%201008%201045%20Q%201006%201040%201005%201035%20Q%201003%201030%201001%201026%20Q%201000%201022%20999%201021%20Q%20999%201020%20996%201015%20Q%20994%201010%20992%201005%20Q%20990%201001%20989%201000%20Q%20989%201000%20986%20995%20Q%20983%20990%20981%20987%20Q%20980%20985%20978%20982%20Q%20976%20980%20973%20975%20Q%20970%20970%20969%20970%20Q%20969%20970%20965%20965%20Q%20961%20960%20960%20959%20Q%20960%20958%20956%20954%20Q%20952%20950%20951%20948%20Q%20950%20946%20946%20943%20Q%20943%20940%20941%20938%20Q%20940%20936%20936%20933%20Q%20933%20930%20931%20928%20Q%20930%20927%20926%20923%20Q%20922%20920%20921%20919%20Q%20920%20918%20915%20914%20Q%20910%20910%20910%20909%20Q%20910%20909%20905%20905%20Q%20900%20901%20899%20900%20Q%20898%20900%20894%20896%20Q%20890%20893%20887%20891%20Q%20885%20890%20882%20887%20Q%20880%20885%20876%20882%20Q%20873%20880%20871%20878%20Q%20870%20876%20866%20873%20Q%20862%20870%20861%20868%20Q%20860%20867%20856%20863%20Q%20852%20860%20851%20857%20Q%20850%20855%20847%20852%20Q%20845%20850%20843%20845%20Q%20841%20840%20840%20835%20Q%20840%20830%20839%20830%20Q%20839%20830%20839%20829%20Q%20840%20828%20840%20824%20Q%20841%20820%20842%20815%20Q%20844%20810%20847%20805%20Q%20850%20800%20850%20800%20Q%20850%20800%20854%20795%20Q%20858%20790%20859%20789%20Q%20860%20788%20863%20784%20Q%20867%20780%20868%20778%20Q%20870%20776%20872%20773%20Q%20874%20770%20872%20767%20Q%20870%20764%20868%20762%20Q%20866%20760%20868%20759%20Q%20870%20758%20875%20755%20Q%20880%20752%20882%20751%20Q%20885%20750%20887%20748%20Q%20890%20747%20895%20745%20Q%20900%20742%20902%20741%20Q%20904%20740%20907%20738%20Q%20910%20737%20915%20734%20Q%20920%20732%20922%20731%20Q%20924%20730%20927%20728%20Q%20930%20726%20935%20724%20Q%20940%20721%20941%20720%20Q%20943%20720%20946%20718%20Q%20950%20716%20955%20713%20Q%20960%20711%20961%20710%20Q%20962%20710%20966%20708%20Q%20970%20706%20975%20703%20Q%20980%20700%20980%20700%20Q%20981%20700%20985%20698%20Q%20990%20697%20995%20695%20Q%201000%20694%201005%20692%20Q%201010%20690%201010%20690%20Q%201011%20690%201015%20687%20Q%201020%20685%201025%20682%20Q%201030%20680%201030%20680%20Q%201030%20680%201035%20677%20Q%201040%20675%201044%20672%20Q%201049%20670%201049%20669%20Q%201050%20669%201055%20666%20Q%201060%20664%201063%20662%20Q%201067%20660%201068%20659%20Q%201070%20658%201075%20656%20Q%201080%20653%201083%20651%20Q%201086%20650%201088%20648%20Q%201090%20647%201095%20645%20Q%201100%20642%201101%20641%20Q%201103%20640%201106%20638%20Q%201110%20636%201115%20633%20Q%201120%20631%201120%20630%20Q%201121%20630%201125%20627%20Q%201130%20625%201134%20622%20Q%201139%20620%201139%20619%20Q%201140%20619%201145%20616%20Q%201150%20612%201152%20611%20Q%201155%20610%201157%20608%20Q%201160%20607%201165%20604%20Q%201170%20602%201172%20601%20Q%201174%20600%201177%20598%20Q%201180%20597%201185%20594%20Q%201190%20591%201191%20590%20Q%201193%20590%201196%20588%20Q%201200%20586%201205%20584%20Q%201210%20581%201211%20580%20Q%201213%20580%201216%20578%20Q%201220%20576%201225%20573%20Q%201230%20571%201231%20570%20Q%201232%20570%201236%20567%20Q%201240%20565%201245%20563%20Q%201250%20560%201255%20560%20Q%201260%20560%201260%20560%20Q%201260%20560%201265%20558%20Q%201270%20557%201275%20555%20Q%201280%20553%201285%20552%20Q%201290%20550%201291%20550%20Q%201292%20550%201296%20548%20Q%201300%20547%201305%20545%20Q%201310%20544%201315%20542%20Q%201320%20541%201323%20540%20Q%201326%20540%201328%20539%20Q%201330%20539%201335%20538%20Q%201340%20537%201345%20536%20Q%201350%20535%201354%20537%20Q%201359%20540%201359%20540%20Q%201360%20540%201365%20540%20Q%201370%20540%201375%20541%20Q%201380%20541%201385%20542%20Q%201390%20543%201395%20544%20Q%201400%20545%201405%20547%20Q%201410%20548%201411%20549%20Q%201413%20550%201416%20551%20Q%201420%20552%201425%20554%20Q%201430%20556%201433%20558%20Q%201437%20560%201438%20560%20Q%201440%20561%201445%20564%20Q%201450%20567%201452%20568%20Q%201454%20570%201457%20571%20Q%201460%20573%201463%20576%20Q%201467%20580%201468%20580%20Q%201470%20581%201474%20585%20Q%201478%20590%201479%20590%20Q%201480%20591%201483%20595%20Q%201487%20600%201488%20601%20Q%201490%20602%201492%20606%20Q%201495%20610%201497%20613%20Q%201500%20617%201500%20618%20Q%201501%20620%201504%20625%20Q%201506%20630%201508%20633%20Q%201510%20636%201510%20638%20Q%201511%20640%201513%20645%20Q%201515%20650%201515%20655%20Q%201516%20660%201517%20665%20Q%201519%20670%201519%20671%20Q%201520%20673%201520%20676%20Q%201521%20680%201522%20685%20Q%201523%20690%201524%20695%20Q%201525%20700%201526%20705%20Q%201527%20710%201528%20715%20Q%201529%20720%201529%20720%20Q%201530%20721%201530%20725%20Q%201531%20730%201531%20735%20Q%201531%20740%201531%20745%20Q%201532%20750%201532%20755%20Q%201533%20760%201534%20765%20Q%201536%20770%201536%20775%20Q%201536%20780%201536%20785%20Q%201536%20790%201535%20795%20Q%201535%20800%201534%20805%20Q%201534%20810%201533%20815%20Q%201533%20820%201532%20825%20Q%201531%20830%201530%20832%20Q%201530%20835%201529%20837%20Q%201528%20840%201527%20845%20Q%201526%20850%201524%20855%20Q%201523%20860%201521%20865%20Q%201520%20870%201520%20870%20Q%201520%20870%201518%20875%20Q%201516%20880%201515%20885%20Q%201513%20890%201512%20895%20Q%201510%20900%201510%20900%20Q%201510%20901%201508%20905%20Q%201507%20910%201505%20915%20Q%201504%20920%201502%20925%20Q%201501%20930%201500%20933%20Q%201500%20936%201499%20938%20Q%201498%20940%201497%20945%20Q%201496%20950%201495%20955%20Q%201494%20960%201493%20965%20Q%201493%20970%201492%20975%20Q%201491%20980%201491%20985%20Q%201490%20990%201490%20995%20Q%201490%201000%201490%201003%20Q%201490%201007%201489%201008%20Q%201489%201010%201489%201015%20Q%201489%201020%201489%201022%20Q%201490%201024%201490%201027%20Q%201490%201030%201490%201035%20Q%201490%201040%201491%201045%20Q%201491%201050%201492%201055%20Q%201492%201060%201493%201065%20Q%201493%201070%201494%201075%20Q%201493%201070%201495%201080%20Z%22%2F%3E%3Cpath%20d%3D%22M%20655%200%20Q%20653%2010%20651%2015%20Q%20650%2020%20650%2021%20Q%20650%2022%20649%2026%20Q%20648%2030%20646%2035%20Q%20645%2040%20644%2045%20Q%20642%2050%20641%2054%20Q%20640%2058%20639%2059%20Q%20639%2060%20638%2065%20Q%20636%2070%20634%2075%20Q%20632%2080%20632%2085%20Q%20632%2090%20631%2093%20Q%20630%2096%20629%2098%20Q%20628%20100%20627%20105%20Q%20625%20110%20624%20115%20Q%20622%20120%20621%20124%20Q%20620%20128%20619%20129%20Q%20619%20130%20617%20135%20Q%20616%20140%20614%20145%20Q%20613%20150%20612%20155%20Q%20610%20160%20610%20161%20Q%20610%20162%20609%20166%20Q%20608%20170%20607%20175%20Q%20606%20180%20605%20185%20Q%20604%20190%20603%20195%20Q%20603%20200%20603%20205%20Q%20602%20210%20602%20215%20Q%20602%20220%20602%20225%20Q%20603%20230%20603%20235%20Q%20603%20240%20604%20245%20Q%20604%20250%20605%20255%20Q%20605%20260%20606%20265%20Q%20607%20270%20607%20275%20Q%20608%20280%20608%20285%20Q%20608%20290%20608%20295%20Q%20608%20300%20608%20305%20Q%20608%20310%20608%20315%20Q%20607%20320%20606%20325%20Q%20605%20330%20604%20335%20Q%20602%20340%20601%20343%20Q%20600%20347%20599%20348%20Q%20599%20350%20596%20355%20Q%20593%20360%20591%20362%20Q%20590%20365%20588%20367%20Q%20586%20370%20583%20373%20Q%20580%20377%20578%20378%20Q%20576%20380%20573%20382%20Q%20570%20385%20565%20387%20Q%20561%20390%20560%20390%20Q%20560%20390%20555%20392%20Q%20550%20394%20545%20396%20Q%20540%20397%20535%20397%20Q%20530%20398%20525%20398%20Q%20520%20398%20515%20397%20Q%20510%20397%20505%20395%20Q%20500%20394%20495%20392%20Q%20490%20390%20488%20390%20Q%20487%20390%20483%20388%20Q%20480%20386%20475%20383%20Q%20470%20380%20469%20380%20Q%20469%20380%20464%20376%20Q%20460%20372%20458%20371%20Q%20456%20370%20453%20367%20Q%20450%20364%20447%20362%20Q%20444%20360%20442%20357%20Q%20440%20355%20437%20352%20Q%20434%20350%20432%20347%20Q%20430%20345%20427%20342%20Q%20424%20340%20422%20337%20Q%20420%20334%20417%20332%20Q%20415%20330%20412%20327%20Q%20410%20324%20407%20322%20Q%20405%20320%20402%20317%20Q%20400%20315%20396%20312%20Q%20393%20310%20391%20308%20Q%20390%20307%20385%20303%20Q%20380%20300%20380%20299%20Q%20380%20299%20375%20296%20Q%20370%20293%20366%20291%20Q%20363%20290%20361%20288%20Q%20360%20287%20355%20285%20Q%20350%20282%20346%20281%20Q%20343%20280%20341%20279%20Q%20340%20278%20335%20276%20Q%20330%20274%20325%20272%20Q%20320%20270%20319%20270%20Q%20319%20270%20314%20268%20Q%20310%20266%20305%20264%20Q%20300%20262%20296%20261%20Q%20293%20260%20291%20259%20Q%20290%20258%20285%20255%20Q%20280%20251%20276%20250%20Q%20273%20250%20271%20249%20Q%20270%20248%20265%20247%20Q%20260%20245%20255%20244%20Q%20250%20242%20246%20241%20Q%20243%20240%20241%20239%20Q%20240%20238%20235%20235%20Q%20230%20233%20226%20231%20Q%20223%20230%20221%20229%20Q%20220%20228%20215%20226%20Q%20210%20224%20205%20222%20Q%20200%20220%20199%20220%20Q%20198%20220%20194%20218%20Q%20190%20216%20185%20214%20Q%20180%20212%20175%20211%20Q%20171%20210%20170%20209%20Q%20170%20209%20165%20208%20Q%20160%20206%20155%20205%20Q%20150%20203%20145%20202%20Q%20140%20201%20135%20201%20Q%20130%20200%20129%20200%20Q%20129%20200%20125%20195%20Q%20121%20190%20120%20189%20Q%20120%20188%20115%20186%20Q%20110%20184%20105%20182%20Q%20100%20180%20100%20179%20Q%20100%20179%2097%20174%20Q%2094%20170%2092%20165%20Q%2090%20160%2090%20159%20Q%2090%20159%2085%20158%20Q%2080%20157%2075%20155%20Q%2070%20154%2065%20152%20Q%2060%20150%2059%20150%20Q%2058%20150%2054%20148%20Q%2050%20146%2045%20144%20Q%2040%20142%2037%20141%20Q%2035%20140%2032%20138%20Q%2030%20137%2025%20135%20Q%2020%20132%2016%20131%20Q%2013%20130%2011%20129%20Q%2010%20128%205%20126%20Q%2010%20128%200%20123%20Z%22%2F%3E%3Cpath%20d%3D%22M%201856%200%20Q%201850%204%201846%207%20Q%201842%2010%201841%2011%20Q%201840%2012%201835%2016%20Q%201831%2020%201830%2021%20Q%201830%2022%201827%2026%20Q%201824%2030%201822%2033%20Q%201820%2036%201819%2038%20Q%201818%2040%201815%2045%20Q%201813%2050%201811%2054%20Q%201810%2058%201809%2059%20Q%201809%2060%201808%2065%20Q%201806%2070%201805%2075%20Q%201805%2080%201804%2085%20Q%201804%2090%201804%2095%20Q%201804%20100%201804%20105%20Q%201805%20110%201806%20115%20Q%201807%20120%201808%20124%20Q%201810%20129%201810%20129%20Q%201810%20130%201811%20135%20Q%201813%20140%201816%20145%20Q%201818%20150%201819%20151%20Q%201820%20152%201822%20156%20Q%201824%20160%201827%20164%20Q%201830%20168%201830%20169%20Q%201831%20170%201835%20175%20Q%201839%20180%201839%20180%20Q%201840%20180%201844%20185%20Q%201849%20190%201849%20190%20Q%201850%20190%201855%20195%20Q%201860%20199%201860%20199%20Q%201861%20200%201865%20203%20Q%201870%20206%201873%20208%20Q%201876%20210%201878%20211%20Q%201880%20212%201885%20215%20Q%201890%20217%201893%20218%20Q%201896%20220%201898%20220%20Q%201900%20221%201905%20223%20Q%201910%20225%201915%20226%20Q%201910%20225%201920%20228%20Z%22%2F%3E%3Cpath%20d%3D%22M%201920%20391%20Q%201915%20400%201913%20405%20Q%201910%20410%201910%20411%20Q%201910%20412%201908%20416%20Q%201907%20420%201905%20425%20Q%201903%20430%201902%20435%20Q%201900%20440%201900%20442%20Q%201900%20444%201899%20447%20Q%201898%20450%201898%20455%20Q%201897%20460%201897%20465%20Q%201896%20470%201896%20475%20Q%201896%20480%201897%20485%20Q%201897%20490%201897%20495%20Q%201898%20500%201899%20504%20Q%201900%20508%201900%20509%20Q%201900%20510%201901%20515%20Q%201902%20520%201903%20525%20Q%201905%20530%201906%20535%20Q%201908%20540%201909%20542%20Q%201910%20544%201911%20547%20Q%201912%20550%201914%20555%20Q%201915%20560%201917%20565%20Q%201919%20570%201919%20570%20Q%201919%20570%201920%20570%20Z%22%2F%3E%3Cpath%20d%3D%22M%200%20504%20Q%2010%20500%2011%20500%20Q%2012%20500%2016%20499%20Q%2020%20498%2025%20498%20Q%2030%20498%2034%20499%20Q%2038%20500%2039%20500%20Q%2040%20500%2045%20502%20Q%2050%20504%2054%20507%20Q%2059%20510%2059%20510%20Q%2060%20510%2065%20514%20Q%2070%20518%2070%20519%20Q%2071%20520%2074%20525%20Q%2078%20530%2079%20531%20Q%2080%20533%2081%20536%20Q%2082%20540%2084%20545%20Q%2086%20550%2087%20555%20Q%2088%20560%2089%20564%20Q%2090%20568%2090%20569%20Q%2090%20570%2090%20575%20Q%2090%20580%2090%20580%20Q%2090%20580%2089%20585%20Q%2088%20590%2086%20595%20Q%2085%20600%2082%20605%20Q%2080%20610%2080%20610%20Q%2080%20610%2076%20615%20Q%2072%20620%2071%20620%20Q%2070%20621%2065%20625%20Q%2060%20628%2058%20629%20Q%2056%20630%2053%20631%20Q%2050%20632%2045%20632%20Q%2040%20633%2035%20633%20Q%2030%20632%2025%20631%20Q%2020%20630%2018%20630%20Q%2017%20630%2013%20628%20Q%2010%20626%205%20623%20Q%2010%20626%200%20620%20Z%22%2F%3E%3Cpath%20d%3D%22M%201066%201080%20Q%201064%201070%201063%201065%20Q%201062%201060%201061%201055%20Q%201060%201050%201060%201049%20Q%201060%201048%201058%201044%20Q%201057%201040%201056%201035%20Q%201055%201030%201053%201025%20Q%201051%201020%201050%201017%20Q%201050%201014%201049%201012%20Q%201048%201010%201046%201005%20Q%201044%201000%201042%20995%20Q%201041%20990%201040%20988%20Q%201040%20987%201038%20983%20Q%201036%20980%201034%20975%20Q%201032%20970%201031%20967%20Q%201030%20964%201029%20962%20Q%201028%20960%201025%20955%20Q%201023%20950%201021%20945%20Q%201020%20941%201019%20940%20Q%201019%20940%201017%20935%20Q%201015%20930%201014%20925%20Q%201012%20920%201011%20915%20Q%201010%20911%201009%20910%20Q%201009%20910%201007%20905%20Q%201005%20900%201004%20895%20Q%201002%20890%201001%20885%20Q%201000%20880%201000%20875%20Q%201000%20871%20999%20870%20Q%20999%20870%20999%20866%20Q%201000%20863%201000%20861%20Q%201000%20860%201000%20855%20Q%201001%20850%201003%20845%20Q%201005%20840%201007%20835%20Q%201010%20830%201010%20830%20Q%201010%20830%201013%20825%20Q%201016%20820%201018%20817%20Q%201020%20815%201022%20812%20Q%201024%20810%201027%20807%20Q%201030%20805%201032%20802%20Q%201035%20800%201037%20798%20Q%201040%20796%201044%20793%20Q%201048%20790%201049%20789%20Q%201050%20788%201055%20785%20Q%201060%20781%201061%20780%20Q%201062%20780%201066%20777%20Q%201070%20775%201074%20772%20Q%201078%20770%201079%20769%20Q%201080%20768%201084%20764%20Q%201089%20760%201089%20759%20Q%201090%20759%201095%20757%20Q%201100%20754%201104%20752%20Q%201109%20750%201109%20749%20Q%201110%20749%201115%20747%20Q%201120%20744%201124%20742%20Q%201129%20740%201129%20739%20Q%201130%20739%201135%20737%20Q%201140%20734%201144%20732%20Q%201148%20730%201149%20729%20Q%201150%20729%201155%20726%20Q%201160%20724%201164%20722%20Q%201168%20720%201169%20719%20Q%201170%20719%201175%20716%20Q%201180%20714%201184%20712%20Q%201188%20710%201189%20709%20Q%201190%20709%201195%20706%20Q%201200%20704%201204%20702%20Q%201208%20700%201209%20699%20Q%201210%20699%201215%20696%20Q%201220%20693%201223%20691%20Q%201227%20690%201228%20689%20Q%201230%20688%201235%20686%20Q%201240%20683%201243%20681%20Q%201247%20680%201248%20679%20Q%201250%20678%201255%20676%20Q%201260%20675%201265%20672%20Q%201270%20670%201270%20670%20Q%201270%20670%201275%20667%20Q%201280%20665%201285%20663%20Q%201290%20661%201291%20660%20Q%201293%20660%201296%20658%20Q%201300%20657%201305%20654%20Q%201310%20652%201313%20651%20Q%201317%20650%201318%20649%20Q%201320%20648%201325%20647%20Q%201330%20645%201335%20643%20Q%201340%20641%201342%20640%20Q%201345%20640%201347%20639%20Q%201350%20638%201350%20639%20Q%201351%20640%201355%20645%20Q%201359%20650%201359%20650%20Q%201360%20650%201365%20650%20Q%201370%20650%201375%20651%20Q%201380%20651%201385%20652%20Q%201390%20653%201395%20655%20Q%201400%20657%201402%20658%20Q%201405%20660%201407%20660%20Q%201410%20661%201415%20665%20Q%201420%20668%201421%20669%20Q%201422%20670%201426%20673%20Q%201430%20676%201431%20678%20Q%201433%20680%201436%20683%20Q%201440%20686%201441%20688%20Q%201442%20690%201446%20695%20Q%201449%20700%201449%20700%20Q%201450%20700%201452%20705%20Q%201455%20710%201457%20714%20Q%201460%20718%201460%20719%20Q%201460%20720%201462%20725%20Q%201464%20730%201466%20735%20Q%201467%20740%201468%20743%20Q%201470%20746%201470%20748%20Q%201470%20750%201472%20755%20Q%201473%20760%201476%20765%20Q%201478%20770%201479%20774%20Q%201480%20779%201480%20779%20Q%201480%20780%201480%20785%20Q%201480%20790%201481%20795%20Q%201481%20800%201481%20805%20Q%201481%20810%201481%20815%20Q%201481%20820%201481%20825%20Q%201480%20830%201480%20833%20Q%201480%20837%201479%20838%20Q%201479%20840%201479%20845%20Q%201478%20850%201477%20855%20Q%201476%20860%201475%20865%20Q%201474%20870%201473%20875%20Q%201472%20880%201471%20885%20Q%201470%20890%201470%20890%20Q%201470%20890%201468%20895%20Q%201467%20900%201466%20905%20Q%201465%20910%201464%20915%20Q%201462%20920%201461%20925%20Q%201460%20930%201460%20931%20Q%201460%20932%201459%20936%20Q%201458%20940%201457%20945%20Q%201456%20950%201455%20955%20Q%201454%20960%201453%20965%20Q%201452%20970%201451%20975%20Q%201450%20980%201450%20981%20Q%201450%20983%201449%20986%20Q%201448%20990%201448%20995%20Q%201447%201000%201446%201005%20Q%201446%201010%201445%201015%20Q%201444%201020%201444%201025%20Q%201443%201030%201442%201035%20Q%201442%201040%201441%201045%20Q%201441%201050%201440%201054%20Q%201440%201059%201439%201059%20Q%201439%201060%201439%201065%20Q%201438%201070%201437%201075%20Q%201438%201070%201436%201080%20Z%22%2F%3E%3Cpath%20d%3D%22M%20194%200%20Q%20191%2010%20190%2012%20Q%20190%2014%20189%2017%20Q%20188%2020%20187%2025%20Q%20187%2030%20186%2035%20Q%20186%2040%20186%2045%20Q%20185%2050%20186%2055%20Q%20186%2060%20187%2065%20Q%20187%2070%20188%2075%20Q%20189%2080%20189%2080%20Q%20190%2081%20191%2085%20Q%20192%2090%20193%2095%20Q%20195%20100%20197%20105%20Q%20199%20110%20199%20110%20Q%20200%20110%20202%20115%20Q%20204%20120%20207%20124%20Q%20210%20129%20210%20129%20Q%20210%20130%20213%20135%20Q%20216%20140%20218%20141%20Q%20220%20143%20222%20146%20Q%20224%20150%20227%20153%20Q%20230%20156%20231%20158%20Q%20233%20160%20236%20163%20Q%20240%20167%20241%20168%20Q%20242%20170%20246%20173%20Q%20250%20176%20252%20178%20Q%20254%20180%20257%20182%20Q%20260%20184%20263%20187%20Q%20266%20190%20268%20191%20Q%20270%20192%20275%20195%20Q%20280%20198%20280%20199%20Q%20281%20200%20285%20203%20Q%20290%20206%20292%20208%20Q%20295%20210%20297%20211%20Q%20300%20212%20305%20215%20Q%20310%20217%20311%20218%20Q%20313%20220%20316%20221%20Q%20320%20223%20325%20225%20Q%20330%20227%20332%20228%20Q%20334%20230%20337%20231%20Q%20340%20232%20345%20235%20Q%20350%20237%20352%20238%20Q%20355%20240%20357%20240%20Q%20360%20241%20365%20244%20Q%20370%20246%20374%20248%20Q%20378%20250%20379%20250%20Q%20380%20250%20385%20253%20Q%20390%20255%20394%20257%20Q%20399%20260%20399%20260%20Q%20400%20260%20405%20263%20Q%20410%20265%20413%20267%20Q%20416%20270%20418%20271%20Q%20420%20272%20425%20275%20Q%20430%20279%20430%20279%20Q%20430%20280%20435%20284%20Q%20440%20288%20441%20289%20Q%20442%20290%20446%20293%20Q%20450%20297%20451%20298%20Q%20452%20300%20456%20304%20Q%20460%20308%20460%20309%20Q%20461%20310%20465%20314%20Q%20470%20319%20470%20319%20Q%20470%20320%20475%20324%20Q%20480%20329%20480%20329%20Q%20480%20330%20485%20334%20Q%20490%20338%20491%20339%20Q%20492%20340%20496%20342%20Q%20500%20344%20505%20346%20Q%20510%20348%20515%20349%20Q%20520%20349%20525%20349%20Q%20530%20349%20535%20347%20Q%20540%20345%20543%20342%20Q%20547%20340%20548%20338%20Q%20550%20337%20552%20333%20Q%20555%20330%20557%20325%20Q%20560%20320%20560%20320%20Q%20560%20320%20561%20315%20Q%20562%20310%20562%20305%20Q%20563%20300%20563%20295%20Q%20563%20290%20562%20285%20Q%20562%20280%20561%20275%20Q%20561%20270%20560%20265%20Q%20560%20260%20559%20260%20Q%20559%20260%20559%20255%20Q%20558%20250%20558%20245%20Q%20557%20240%20557%20235%20Q%20557%20230%20557%20225%20Q%20557%20220%20557%20215%20Q%20558%20210%20559%20205%20Q%20559%20200%20559%20199%20Q%20560%20198%20560%20194%20Q%20561%20190%20562%20185%20Q%20564%20180%20565%20175%20Q%20566%20170%20568%20165%20Q%20569%20160%20569%20159%20Q%20570%20158%20571%20154%20Q%20572%20150%20574%20145%20Q%20575%20140%20577%20135%20Q%20578%20130%20579%20127%20Q%20580%20125%20580%20122%20Q%20581%20120%20582%20115%20Q%20584%20110%20585%20105%20Q%20586%20100%20588%2095%20Q%20589%2090%20588%2085%20Q%20588%2080%20589%2077%20Q%20590%2074%20590%2072%20Q%20591%2070%20592%2065%20Q%20593%2060%20593%2055%20Q%20594%2050%20594%2045%20Q%20595%2040%20595%2035%20Q%20595%2030%20595%2025%20Q%20596%2020%20595%2015%20Q%20595%2010%20595%205%20Q%20595%2010%20594%200%20Z%22%2F%3E%3Cpath%20d%3D%22M%201920%207%20Q%201910%206%201905%207%20Q%201900%207%201895%208%20Q%201890%209%201888%209%20Q%201887%2010%201883%2011%20Q%201880%2012%201875%2014%20Q%201870%2016%201867%2018%20Q%201864%2020%201862%2021%20Q%201860%2023%201856%2026%20Q%201852%2030%201851%2031%20Q%201850%2032%201846%2036%20Q%201843%2040%201841%2042%20Q%201840%2045%201838%2047%20Q%201837%2050%201834%2055%20Q%201832%2060%201831%2063%20Q%201830%2067%201829%2068%20Q%201829%2070%201828%2075%20Q%201827%2080%201826%2085%20Q%201826%2090%201826%2095%20Q%201826%20100%201827%20105%20Q%201828%20110%201829%20112%20Q%201830%20115%201830%20117%20Q%201831%20120%201833%20125%20Q%201835%20130%201837%20134%20Q%201840%20139%201840%20139%20Q%201840%20140%201844%20145%20Q%201847%20150%201848%20151%20Q%201850%20152%201853%20156%20Q%201857%20160%201858%20161%20Q%201860%20162%201864%20166%20Q%201869%20170%201869%20170%20Q%201870%20170%201875%20173%20Q%201880%20176%201884%20178%20Q%201889%20180%201889%20180%20Q%201890%20180%201895%20181%20Q%201900%20183%201905%20184%20Q%201910%20185%201915%20185%20Q%201910%20185%201920%20185%20Z%22%2F%3E%3Cpath%20d%3D%22M%201195%201080%20Q%201190%201076%201185%201073%20Q%201181%201070%201180%201069%20Q%201180%201068%201176%201064%20Q%201173%201060%201171%201057%20Q%201170%201054%201168%201052%20Q%201167%201050%201164%201045%20Q%201162%201040%201161%201037%20Q%201160%201035%201158%201032%20Q%201157%201030%201155%201025%20Q%201154%201020%201152%201015%20Q%201150%201010%201150%201008%20Q%201150%201006%201149%201003%20Q%201148%201000%201147%20995%20Q%201146%20990%201145%20985%20Q%201144%20980%201144%20975%20Q%201143%20970%201143%20965%20Q%201143%20960%201143%20955%20Q%201144%20950%201144%20945%20Q%201145%20940%201146%20935%20Q%201148%20930%201149%20927%20Q%201150%20925%201151%20922%20Q%201152%20920%201155%20915%20Q%201157%20910%201158%20908%20Q%201160%20906%201162%20903%20Q%201165%20900%201167%20897%20Q%201170%20894%201172%20892%20Q%201174%20890%201177%20887%20Q%201180%20885%201183%20882%20Q%201186%20880%201188%20878%20Q%201190%20877%201195%20873%20Q%201200%20870%201200%20870%20Q%201200%20870%201204%20865%20Q%201209%20860%201209%20859%20Q%201210%20859%201215%20856%20Q%201220%20854%201224%20852%20Q%201229%20850%201229%20849%20Q%201230%20849%201235%20847%20Q%201240%20845%201245%20842%20Q%201250%20840%201250%20840%20Q%201250%20840%201255%20837%20Q%201260%20835%201265%20833%20Q%201270%20830%201270%20830%20Q%201271%20830%201275%20828%20Q%201280%20826%201285%20823%20Q%201290%20821%201291%20820%20Q%201292%20820%201296%20818%20Q%201300%20816%201305%20814%20Q%201310%20812%201312%20811%20Q%201314%20810%201317%20808%20Q%201320%20807%201325%20807%20Q%201330%20808%201335%20806%20Q%201340%20804%201345%20803%20Q%201350%20801%201351%20805%20Q%201352%20810%201353%20815%20Q%201355%20820%201356%20825%20Q%201357%20830%201358%20834%20Q%201360%20838%201360%20839%20Q%201361%20840%201365%20844%20Q%201370%20849%201370%20849%20Q%201370%20850%201372%20855%20Q%201375%20860%201377%20865%20Q%201379%20870%201379%20870%20Q%201380%20871%201380%20875%20Q%201381%20880%201382%20885%20Q%201382%20890%201383%20895%20Q%201383%20900%201383%20905%20Q%201382%20910%201382%20915%20Q%201381%20920%201380%20924%20Q%201380%20929%201379%20929%20Q%201379%20930%201378%20935%20Q%201377%20940%201375%20945%20Q%201374%20950%201372%20955%20Q%201370%20960%201370%20960%20Q%201370%20961%201368%20965%20Q%201366%20970%201363%20975%20Q%201361%20980%201360%20981%20Q%201360%20982%201358%20986%20Q%201357%20990%201354%20995%20Q%201352%201000%201351%201002%20Q%201350%201004%201347%201007%20Q%201345%201010%201342%201013%20Q%201340%201016%201338%201018%20Q%201337%201020%201333%201024%20Q%201330%201028%201329%201029%20Q%201329%201030%201327%201035%20Q%201325%201040%201324%201045%20Q%201322%201050%201321%201052%20Q%201320%201055%201316%201057%20Q%201312%201060%201311%201060%20Q%201310%201061%201305%201064%20Q%201300%201066%201297%201068%20Q%201294%201070%201292%201071%20Q%201290%201072%201285%201075%20Q%201280%201078%201278%201079%20Q%201280%201078%201276%201080%20Z%22%2F%3E%3Cpath%20d%3D%22M%20264%200%20Q%20260%209%20259%209%20Q%20259%2010%20258%2015%20Q%20256%2020%20255%2025%20Q%20253%2030%20252%2035%20Q%20252%2040%20251%2045%20Q%20250%2050%20250%2055%20Q%20250%2060%20250%2065%20Q%20251%2070%20251%2075%20Q%20252%2080%20253%2085%20Q%20254%2090%20255%2095%20Q%20257%20100%20258%20103%20Q%20260%20107%20260%20108%20Q%20260%20110%20263%20115%20Q%20265%20120%20267%20123%20Q%20270%20127%20270%20128%20Q%20271%20130%20274%20135%20Q%20278%20140%20279%20141%20Q%20280%20142%20282%20146%20Q%20285%20150%20287%20152%20Q%20290%20154%20292%20157%20Q%20294%20160%20297%20162%20Q%20300%20164%20303%20167%20Q%20306%20170%20308%20171%20Q%20310%20173%20314%20176%20Q%20319%20180%20319%20180%20Q%20320%20180%20325%20183%20Q%20330%20186%20332%20188%20Q%20335%20190%20337%20191%20Q%20340%20192%20345%20195%20Q%20350%20197%20352%20198%20Q%20354%20200%20357%20201%20Q%20360%20202%20365%20204%20Q%20370%20206%20374%20208%20Q%20379%20210%20379%20210%20Q%20380%20210%20385%20212%20Q%20390%20213%20395%20215%20Q%20400%20216%20405%20218%20Q%20410%20219%20410%20219%20Q%20411%20220%20415%20221%20Q%20420%20222%20425%20223%20Q%20430%20224%20435%20225%20Q%20440%20226%20445%20226%20Q%20450%20227%20455%20227%20Q%20460%20227%20465%20227%20Q%20470%20227%20475%20225%20Q%20480%20224%20484%20222%20Q%20488%20220%20489%20219%20Q%20490%20218%20494%20214%20Q%20499%20210%20499%20209%20Q%20500%20209%20503%20204%20Q%20507%20200%20508%20198%20Q%20510%20196%20511%20193%20Q%20513%20190%20516%20185%20Q%20519%20180%20519%20179%20Q%20520%20179%20522%20174%20Q%20524%20170%20527%20165%20Q%20529%20160%20529%20159%20Q%20530%20159%20532%20154%20Q%20534%20150%20536%20145%20Q%20538%20140%20539%20137%20Q%20540%20135%20540%20132%20Q%20541%20130%20543%20125%20Q%20545%20120%20546%20115%20Q%20548%20110%20549%20106%20Q%20550%20103%20550%20101%20Q%20551%20100%20552%2095%20Q%20553%2090%20552%2085%20Q%20552%2080%20553%2075%20Q%20554%2070%20554%2065%20Q%20555%2060%20555%2055%20Q%20555%2050%20555%2045%20Q%20555%2040%20555%2035%20Q%20555%2030%20554%2025%20Q%20553%2020%20552%2015%20Q%20551%2010%20550%207%20Q%20550%205%20549%202%20Q%20550%205%20548%200%20Z%22%2F%3E%3Cpath%20d%3D%22M%201920%2029%20Q%201910%2029%201905%2029%20Q%201900%2029%201899%2029%20Q%201899%2030%201894%2031%20Q%201890%2032%201885%2034%20Q%201880%2036%201877%2038%20Q%201875%2040%201872%2041%20Q%201870%2043%201866%2046%20Q%201863%2050%201861%2052%20Q%201860%2055%201858%2057%20Q%201856%2060%201854%2065%20Q%201852%2070%201851%2074%20Q%201850%2079%201849%2079%20Q%201849%2080%201849%2085%20Q%201848%2090%201849%2095%20Q%201849%20100%201849%20100%20Q%201850%20101%201851%20105%20Q%201852%20110%201854%20115%20Q%201856%20120%201858%20123%20Q%201860%20126%201861%20128%20Q%201862%20130%201866%20134%20Q%201870%20138%201871%20139%20Q%201872%20140%201876%20142%20Q%201880%20145%201883%20147%20Q%201887%20150%201888%20150%20Q%201890%20151%201895%20152%20Q%201900%20154%201905%20154%20Q%201910%20155%201915%20155%20Q%201910%20155%201920%20155%20Z%22%2F%3E%3Cpath%20d%3D%22M%20318%200%20Q%20311%2010%20310%2011%20Q%20310%2012%20308%2016%20Q%20306%2020%20304%2025%20Q%20302%2030%20301%2033%20Q%20300%2037%20299%2038%20Q%20299%2040%20298%2045%20Q%20297%2050%20297%2055%20Q%20296%2060%20296%2065%20Q%20296%2070%20297%2075%20Q%20297%2080%20298%2085%20Q%20299%2090%20299%2090%20Q%20300%2091%20301%2095%20Q%20302%20100%20304%20105%20Q%20306%20110%20308%20112%20Q%20310%20115%20311%20117%20Q%20312%20120%20316%20125%20Q%20319%20130%20319%20130%20Q%20320%20130%20324%20135%20Q%20328%20140%20329%20140%20Q%20330%20141%20334%20145%20Q%20339%20150%20339%20150%20Q%20340%20150%20345%20154%20Q%20350%20157%20351%20158%20Q%20353%20160%20356%20161%20Q%20360%20163%20365%20166%20Q%20370%20168%20371%20169%20Q%20373%20170%20376%20171%20Q%20380%20172%20385%20174%20Q%20390%20175%20395%20177%20Q%20400%20178%20404%20179%20Q%20409%20180%20409%20180%20Q%20410%20180%20415%20180%20Q%20420%20181%20425%20181%20Q%20430%20181%20435%20180%20Q%20440%20180%20440%20180%20Q%20440%20180%20445%20178%20Q%20450%20177%20455%20175%20Q%20460%20174%20463%20172%20Q%20467%20170%20468%20169%20Q%20470%20168%20475%20164%20Q%20480%20160%20480%20160%20Q%20480%20160%20485%20155%20Q%20490%20150%20490%20150%20Q%20490%20150%20493%20145%20Q%20497%20140%20498%20138%20Q%20500%20136%20501%20133%20Q%20503%20130%20505%20125%20Q%20508%20120%20509%20118%20Q%20510%20116%20511%20113%20Q%20512%20110%20514%20105%20Q%20515%20100%20516%2095%20Q%20518%2090%20517%2085%20Q%20517%2080%20518%2075%20Q%20518%2070%20519%2065%20Q%20519%2060%20519%2055%20Q%20519%2050%20518%2045%20Q%20518%2040%20517%2035%20Q%20516%2030%20514%2025%20Q%20513%2020%20511%2016%20Q%20510%2012%20509%2011%20Q%20508%2010%20506%205%20Q%20508%2010%20503%200%20Z%22%2F%3E%3Cpath%20d%3D%22M%201920%2059%20Q%201910%2057%201905%2057%20Q%201900%2058%201898%2059%20Q%201896%2060%201893%2061%20Q%201890%2063%201886%2066%20Q%201883%2070%201881%2073%20Q%201880%2076%201879%2078%20Q%201878%2080%201878%2085%20Q%201877%2090%201878%2095%20Q%201878%20100%201879%20101%20Q%201880%20102%201882%20106%20Q%201884%20110%201887%20112%20Q%201890%20115%201893%20117%20Q%201896%20120%201898%20120%20Q%201900%20121%201905%20122%20Q%201910%20123%201915%20122%20Q%201910%20123%201920%20121%20Z%22%2F%3E%3Cpath%20d%3D%22M%20397%200%20Q%20390%202%20385%204%20Q%20380%206%20377%208%20Q%20374%2010%20372%2011%20Q%20370%2012%20365%2016%20Q%20361%2020%20360%2021%20Q%20360%2022%20356%2026%20Q%20353%2030%20351%2033%20Q%20350%2036%20349%2038%20Q%20348%2040%20346%2045%20Q%20344%2050%20343%2055%20Q%20342%2060%20342%2065%20Q%20342%2070%20343%2075%20Q%20343%2080%20345%2085%20Q%20346%2090%20348%2094%20Q%20350%2098%20350%2099%20Q%20350%20100%20353%20105%20Q%20357%20110%20358%20111%20Q%20360%20113%20363%20116%20Q%20367%20120%20368%20121%20Q%20370%20122%20375%20125%20Q%20380%20128%20381%20129%20Q%20382%20130%20386%20131%20Q%20390%20133%20395%20134%20Q%20400%20136%20405%20137%20Q%20410%20137%20415%20138%20Q%20420%20138%20425%20137%20Q%20430%20136%20435%20134%20Q%20440%20133%20443%20131%20Q%20446%20130%20448%20128%20Q%20450%20127%20454%20123%20Q%20459%20120%20459%20119%20Q%20460%20119%20463%20114%20Q%20467%20110%20468%20108%20Q%20470%20106%20471%20103%20Q%20473%20100%20475%2095%20Q%20477%2090%20477%2085%20Q%20476%2080%20477%2075%20Q%20478%2070%20478%2065%20Q%20478%2060%20478%2055%20Q%20477%2050%20476%2045%20Q%20474%2040%20472%2035%20Q%20470%2030%20469%2030%20Q%20469%2030%20466%2025%20Q%20462%2020%20461%2018%20Q%20460%2017%20455%2013%20Q%20451%2010%20450%209%20Q%20450%209%20445%206%20Q%20440%203%20435%202%20Q%20430%200%20429%200%20Q%20430%200%20428%200%20Z%22%2F%3E%3C%2Fg%3E%3Cpath%20d%3D%22M%20250.26221595704556%20572.870578346774%20L%20238.1951653305441%20321.36612272355705%22%20stroke%3D%22%23a99a72%22%20stroke-width%3D%221%22%20stroke-dasharray%3D%224%205%22%20stroke-opacity%3D%220.12%22%20fill%3D%22none%22%2F%3E%3Cpath%20d%3D%22M%201435.4607488773763%20280.0661302730441%20L%201594.1707454016432%20624.4945498276502%22%20stroke%3D%22%23a99a72%22%20stroke-width%3D%221%22%20stroke-dasharray%3D%224%205%22%20stroke-opacity%3D%220.12%22%20fill%3D%22none%22%2F%3E%3Cpath%20d%3D%22M%201562.6211115904152%20316.1939147254452%20L%20981.232691751793%20697.1556943003088%22%20stroke%3D%22%23a99a72%22%20stroke-width%3D%221%22%20stroke-dasharray%3D%224%205%22%20stroke-opacity%3D%220.12%22%20fill%3D%22none%22%2F%3E%3Cpath%20d%3D%22M%20238.1951653305441%20321.36612272355705%20L%201111.9143705256283%20891.3980784919113%22%20stroke%3D%22%23a99a72%22%20stroke-width%3D%221%22%20stroke-dasharray%3D%224%205%22%20stroke-opacity%3D%220.12%22%20fill%3D%22none%22%2F%3E%3Cpath%20d%3D%22M%201594.1707454016432%20624.4945498276502%20L%20514.5423643989488%20559.043917232193%22%20stroke%3D%22%23a99a72%22%20stroke-width%3D%221%22%20stroke-dasharray%3D%224%205%22%20stroke-opacity%3D%220.12%22%20fill%3D%22none%22%2F%3E%3Cpath%20d%3D%22M%20981.232691751793%20697.1556943003088%20L%20352.54609377589077%20133.75305091962218%22%20stroke%3D%22%23a99a72%22%20stroke-width%3D%221%22%20stroke-dasharray%3D%224%205%22%20stroke-opacity%3D%220.12%22%20fill%3D%22none%22%2F%3E%3Cpath%20d%3D%22M%201111.9143705256283%20891.3980784919113%20L%201011.0795498127118%20203.51042753085494%22%20stroke%3D%22%23a99a72%22%20stroke-width%3D%221%22%20stroke-dasharray%3D%224%205%22%20stroke-opacity%3D%220.12%22%20fill%3D%22none%22%2F%3E%3Cpath%20d%3D%22M%20514.5423643989488%20559.043917232193%20L%201026.648548268713%20951.3388810772449%22%20stroke%3D%22%23a99a72%22%20stroke-width%3D%221%22%20stroke-dasharray%3D%224%205%22%20stroke-opacity%3D%220.12%22%20fill%3D%22none%22%2F%3E%3Crect%20x%3D%22244%22%20y%3D%22567%22%20width%3D%2211%22%20height%3D%2211%22%20fill%3D%22none%22%20stroke%3D%22%23c98f5c%22%20stroke-width%3D%221%22%20stroke-opacity%3D%220.22%22%2F%3E%3Ctext%20x%3D%22250%22%20y%3D%22593%22%20font-size%3D%229%22%20fill%3D%22%23e2dbc6%22%20opacity%3D%220.30%22%20font-family%3D%22monospace%22%20text-anchor%3D%22middle%22%3EB01%3C%2Ftext%3E%3Crect%20x%3D%221427%22%20y%3D%22272%22%20width%3D%2215%22%20height%3D%2215%22%20fill%3D%22none%22%20stroke%3D%22%23c98f5c%22%20stroke-width%3D%221%22%20stroke-opacity%3D%220.22%22%2F%3E%3Ctext%20x%3D%221435%22%20y%3D%22304%22%20font-size%3D%229%22%20fill%3D%22%23e2dbc6%22%20opacity%3D%220.30%22%20font-family%3D%22monospace%22%20text-anchor%3D%22middle%22%3EB02%3C%2Ftext%3E%3Crect%20x%3D%221555%22%20y%3D%22308%22%20width%3D%2214%22%20height%3D%2214%22%20fill%3D%22none%22%20stroke%3D%22%23c98f5c%22%20stroke-width%3D%221%22%20stroke-opacity%3D%220.22%22%2F%3E%3Ctext%20x%3D%221562%22%20y%3D%22339%22%20font-size%3D%229%22%20fill%3D%22%23e2dbc6%22%20opacity%3D%220.30%22%20font-family%3D%22monospace%22%20text-anchor%3D%22middle%22%3EB03%3C%2Ftext%3E%3Crect%20x%3D%22232%22%20y%3D%22315%22%20width%3D%2211%22%20height%3D%2211%22%20fill%3D%22none%22%20stroke%3D%22%23c98f5c%22%20stroke-width%3D%221%22%20stroke-opacity%3D%220.22%22%2F%3E%3Ctext%20x%3D%22238%22%20y%3D%22341%22%20font-size%3D%229%22%20fill%3D%22%23e2dbc6%22%20opacity%3D%220.30%22%20font-family%3D%22monospace%22%20text-anchor%3D%22middle%22%3EB04%3C%2Ftext%3E%3Crect%20x%3D%221587%22%20y%3D%22617%22%20width%3D%2214%22%20height%3D%2214%22%20fill%3D%22none%22%20stroke%3D%22%23c98f5c%22%20stroke-width%3D%221%22%20stroke-opacity%3D%220.22%22%2F%3E%3Ctext%20x%3D%221594%22%20y%3D%22647%22%20font-size%3D%229%22%20fill%3D%22%23e2dbc6%22%20opacity%3D%220.30%22%20font-family%3D%22monospace%22%20text-anchor%3D%22middle%22%3EB05%3C%2Ftext%3E%3Crect%20x%3D%22973%22%20y%3D%22689%22%20width%3D%2215%22%20height%3D%2215%22%20fill%3D%22none%22%20stroke%3D%22%23c98f5c%22%20stroke-width%3D%221%22%20stroke-opacity%3D%220.22%22%2F%3E%3Ctext%20x%3D%22981%22%20y%3D%22722%22%20font-size%3D%229%22%20fill%3D%22%23e2dbc6%22%20opacity%3D%220.30%22%20font-family%3D%22monospace%22%20text-anchor%3D%22middle%22%3EB06%3C%2Ftext%3E%3Crect%20x%3D%221104%22%20y%3D%22883%22%20width%3D%2214%22%20height%3D%2214%22%20fill%3D%22none%22%20stroke%3D%22%23c98f5c%22%20stroke-width%3D%221%22%20stroke-opacity%3D%220.22%22%2F%3E%3Ctext%20x%3D%221111%22%20y%3D%22915%22%20font-size%3D%229%22%20fill%3D%22%23e2dbc6%22%20opacity%3D%220.30%22%20font-family%3D%22monospace%22%20text-anchor%3D%22middle%22%3EB07%3C%2Ftext%3E%3Crect%20x%3D%22510%22%20y%3D%22555%22%20width%3D%227%22%20height%3D%227%22%20fill%3D%22none%22%20stroke%3D%22%23c98f5c%22%20stroke-width%3D%221%22%20stroke-opacity%3D%220.22%22%2F%3E%3Ctext%20x%3D%22514%22%20y%3D%22575%22%20font-size%3D%229%22%20fill%3D%22%23e2dbc6%22%20opacity%3D%220.30%22%20font-family%3D%22monospace%22%20text-anchor%3D%22middle%22%3EB08%3C%2Ftext%3E%3Crect%20x%3D%22347%22%20y%3D%22128%22%20width%3D%229%22%20height%3D%229%22%20fill%3D%22none%22%20stroke%3D%22%23c98f5c%22%20stroke-width%3D%221%22%20stroke-opacity%3D%220.22%22%2F%3E%3Ctext%20x%3D%22352%22%20y%3D%22152%22%20font-size%3D%229%22%20fill%3D%22%23e2dbc6%22%20opacity%3D%220.30%22%20font-family%3D%22monospace%22%20text-anchor%3D%22middle%22%3EB09%3C%2Ftext%3E%3Crect%20x%3D%221003%22%20y%3D%22196%22%20width%3D%2214%22%20height%3D%2214%22%20fill%3D%22none%22%20stroke%3D%22%23c98f5c%22%20stroke-width%3D%221%22%20stroke-opacity%3D%220.22%22%2F%3E%3Ctext%20x%3D%221011%22%20y%3D%22226%22%20font-size%3D%229%22%20fill%3D%22%23e2dbc6%22%20opacity%3D%220.30%22%20font-family%3D%22monospace%22%20text-anchor%3D%22middle%22%3EB10%3C%2Ftext%3E%3Crect%20x%3D%221020%22%20y%3D%22945%22%20width%3D%2212%22%20height%3D%2212%22%20fill%3D%22none%22%20stroke%3D%22%23c98f5c%22%20stroke-width%3D%221%22%20stroke-opacity%3D%220.22%22%2F%3E%3Ctext%20x%3D%221026%22%20y%3D%22972%22%20font-size%3D%229%22%20fill%3D%22%23e2dbc6%22%20opacity%3D%220.30%22%20font-family%3D%22monospace%22%20text-anchor%3D%22middle%22%3EB11%3C%2Ftext%3E%3Crect%20x%3D%22472%22%20y%3D%22347%22%20width%3D%2210%22%20height%3D%2210%22%20fill%3D%22none%22%20stroke%3D%22%23c98f5c%22%20stroke-width%3D%221%22%20stroke-opacity%3D%220.22%22%2F%3E%3Ctext%20x%3D%22478%22%20y%3D%22372%22%20font-size%3D%229%22%20fill%3D%22%23e2dbc6%22%20opacity%3D%220.30%22%20font-family%3D%22monospace%22%20text-anchor%3D%22middle%22%3EB12%3C%2Ftext%3E%3Crect%20x%3D%22888%22%20y%3D%22191%22%20width%3D%229%22%20height%3D%229%22%20fill%3D%22none%22%20stroke%3D%22%23c98f5c%22%20stroke-width%3D%221%22%20stroke-opacity%3D%220.22%22%2F%3E%3Ctext%20x%3D%22893%22%20y%3D%22214%22%20font-size%3D%229%22%20fill%3D%22%23e2dbc6%22%20opacity%3D%220.30%22%20font-family%3D%22monospace%22%20text-anchor%3D%22middle%22%3EB13%3C%2Ftext%3E%3Crect%20x%3D%221643%22%20y%3D%22447%22%20width%3D%228%22%20height%3D%228%22%20fill%3D%22none%22%20stroke%3D%22%23c98f5c%22%20stroke-width%3D%221%22%20stroke-opacity%3D%220.22%22%2F%3E%3Ctext%20x%3D%221647%22%20y%3D%22470%22%20font-size%3D%229%22%20fill%3D%22%23e2dbc6%22%20opacity%3D%220.30%22%20font-family%3D%22monospace%22%20text-anchor%3D%22middle%22%3EB14%3C%2Ftext%3E%3Crect%20x%3D%221158%22%20y%3D%22628%22%20width%3D%2210%22%20height%3D%2210%22%20fill%3D%22none%22%20stroke%3D%22%23c98f5c%22%20stroke-width%3D%221%22%20stroke-opacity%3D%220.22%22%2F%3E%3Ctext%20x%3D%221164%22%20y%3D%22652%22%20font-size%3D%229%22%20fill%3D%22%23e2dbc6%22%20opacity%3D%220.30%22%20font-family%3D%22monospace%22%20text-anchor%3D%22middle%22%3EB15%3C%2Ftext%3E%3Crect%20x%3D%221788%22%20y%3D%22853%22%20width%3D%2213%22%20height%3D%2213%22%20fill%3D%22none%22%20stroke%3D%22%23c98f5c%22%20stroke-width%3D%221%22%20stroke-opacity%3D%220.22%22%2F%3E%3Ctext%20x%3D%221795%22%20y%3D%22882%22%20font-size%3D%229%22%20fill%3D%22%23e2dbc6%22%20opacity%3D%220.30%22%20font-family%3D%22monospace%22%20text-anchor%3D%22middle%22%3EB16%3C%2Ftext%3E%3Crect%20x%3D%221430%22%20y%3D%22306%22%20width%3D%2211%22%20height%3D%2211%22%20fill%3D%22none%22%20stroke%3D%22%23c98f5c%22%20stroke-width%3D%221%22%20stroke-opacity%3D%220.22%22%2F%3E%3Ctext%20x%3D%221436%22%20y%3D%22332%22%20font-size%3D%229%22%20fill%3D%22%23e2dbc6%22%20opacity%3D%220.30%22%20font-family%3D%22monospace%22%20text-anchor%3D%22middle%22%3EB17%3C%2Ftext%3E%3Crect%20x%3D%221379%22%20y%3D%22506%22%20width%3D%2215%22%20height%3D%2215%22%20fill%3D%22none%22%20stroke%3D%22%23c98f5c%22%20stroke-width%3D%221%22%20stroke-opacity%3D%220.22%22%2F%3E%3Ctext%20x%3D%221387%22%20y%3D%22539%22%20font-size%3D%229%22%20fill%3D%22%23e2dbc6%22%20opacity%3D%220.30%22%20font-family%3D%22monospace%22%20text-anchor%3D%22middle%22%3EB18%3C%2Ftext%3E%3Crect%20x%3D%221082%22%20y%3D%22547%22%20width%3D%2211%22%20height%3D%2211%22%20fill%3D%22none%22%20stroke%3D%22%23c98f5c%22%20stroke-width%3D%221%22%20stroke-opacity%3D%220.22%22%2F%3E%3Ctext%20x%3D%221087%22%20y%3D%22574%22%20font-size%3D%229%22%20fill%3D%22%23e2dbc6%22%20opacity%3D%220.30%22%20font-family%3D%22monospace%22%20text-anchor%3D%22middle%22%3EB19%3C%2Ftext%3E%3Crect%20x%3D%22730%22%20y%3D%22964%22%20width%3D%229%22%20height%3D%229%22%20fill%3D%22none%22%20stroke%3D%22%23c98f5c%22%20stroke-width%3D%221%22%20stroke-opacity%3D%220.22%22%2F%3E%3Ctext%20x%3D%22735%22%20y%3D%22988%22%20font-size%3D%229%22%20fill%3D%22%23e2dbc6%22%20opacity%3D%220.30%22%20font-family%3D%22monospace%22%20text-anchor%3D%22middle%22%3EB20%3C%2Ftext%3E%3Crect%20x%3D%22243%22%20y%3D%22302%22%20width%3D%229%22%20height%3D%229%22%20fill%3D%22none%22%20stroke%3D%22%23c98f5c%22%20stroke-width%3D%221%22%20stroke-opacity%3D%220.22%22%2F%3E%3Ctext%20x%3D%22248%22%20y%3D%22326%22%20font-size%3D%229%22%20fill%3D%22%23e2dbc6%22%20opacity%3D%220.30%22%20font-family%3D%22monospace%22%20text-anchor%3D%22middle%22%3EB21%3C%2Ftext%3E%3Crect%20x%3D%221450%22%20y%3D%22501%22%20width%3D%2211%22%20height%3D%2211%22%20fill%3D%22none%22%20stroke%3D%22%23c98f5c%22%20stroke-width%3D%221%22%20stroke-opacity%3D%220.22%22%2F%3E%3Ctext%20x%3D%221456%22%20y%3D%22527%22%20font-size%3D%229%22%20fill%3D%22%23e2dbc6%22%20opacity%3D%220.30%22%20font-family%3D%22monospace%22%20text-anchor%3D%22middle%22%3EB22%3C%2Ftext%3E%3Ccircle%20cx%3D%22270%22%20cy%3D%22580%22%20r%3D%227%22%20fill%3D%22none%22%20stroke%3D%22%23b06b4a%22%20stroke-width%3D%221%22%20stroke-opacity%3D%220.26%22%2F%3E%3Cpath%20d%3D%22M%20266%20580%20L%20274%20580%20M%20270%20576%20L%20270%20584%22%20stroke%3D%22%23b06b4a%22%20stroke-width%3D%221%22%20stroke-opacity%3D%220.26%22%20fill%3D%22none%22%2F%3E%3Ctext%20x%3D%22270%22%20y%3D%22597%22%20font-size%3D%229%22%20fill%3D%22%23e2dbc6%22%20opacity%3D%220.30%22%20font-family%3D%22monospace%22%20text-anchor%3D%22middle%22%3EF1%3C%2Ftext%3E%3Ccircle%20cx%3D%22717%22%20cy%3D%22135%22%20r%3D%227%22%20fill%3D%22none%22%20stroke%3D%22%23b06b4a%22%20stroke-width%3D%221%22%20stroke-opacity%3D%220.26%22%2F%3E%3Cpath%20d%3D%22M%20713%20135%20L%20721%20135%20M%20717%20131%20L%20717%20139%22%20stroke%3D%22%23b06b4a%22%20stroke-width%3D%221%22%20stroke-opacity%3D%220.26%22%20fill%3D%22none%22%2F%3E%3Ctext%20x%3D%22717%22%20y%3D%22152%22%20font-size%3D%229%22%20fill%3D%22%23e2dbc6%22%20opacity%3D%220.30%22%20font-family%3D%22monospace%22%20text-anchor%3D%22middle%22%3EF2%3C%2Ftext%3E%3Ccircle%20cx%3D%22824%22%20cy%3D%22437%22%20r%3D%227%22%20fill%3D%22none%22%20stroke%3D%22%23b06b4a%22%20stroke-width%3D%221%22%20stroke-opacity%3D%220.26%22%2F%3E%3Cpath%20d%3D%22M%20820%20437%20L%20828%20437%20M%20824%20433%20L%20824%20441%22%20stroke%3D%22%23b06b4a%22%20stroke-width%3D%221%22%20stroke-opacity%3D%220.26%22%20fill%3D%22none%22%2F%3E%3Ctext%20x%3D%22824%22%20y%3D%22454%22%20font-size%3D%229%22%20fill%3D%22%23e2dbc6%22%20opacity%3D%220.30%22%20font-family%3D%22monospace%22%20text-anchor%3D%22middle%22%3EF3%3C%2Ftext%3E%3Ccircle%20cx%3D%221038%22%20cy%3D%22227%22%20r%3D%227%22%20fill%3D%22none%22%20stroke%3D%22%23b06b4a%22%20stroke-width%3D%221%22%20stroke-opacity%3D%220.26%22%2F%3E%3Cpath%20d%3D%22M%201034%20227%20L%201042%20227%20M%201038%20223%20L%201038%20231%22%20stroke%3D%22%23b06b4a%22%20stroke-width%3D%221%22%20stroke-opacity%3D%220.26%22%20fill%3D%22none%22%2F%3E%3Ctext%20x%3D%221038%22%20y%3D%22244%22%20font-size%3D%229%22%20fill%3D%22%23e2dbc6%22%20opacity%3D%220.30%22%20font-family%3D%22monospace%22%20text-anchor%3D%22middle%22%3EF4%3C%2Ftext%3E%3Ccircle%20cx%3D%221541%22%20cy%3D%22245%22%20r%3D%227%22%20fill%3D%22none%22%20stroke%3D%22%23b06b4a%22%20stroke-width%3D%221%22%20stroke-opacity%3D%220.26%22%2F%3E%3Cpath%20d%3D%22M%201537%20245%20L%201545%20245%20M%201541%20241%20L%201541%20249%22%20stroke%3D%22%23b06b4a%22%20stroke-width%3D%221%22%20stroke-opacity%3D%220.26%22%20fill%3D%22none%22%2F%3E%3Ctext%20x%3D%221541%22%20y%3D%22262%22%20font-size%3D%229%22%20fill%3D%22%23e2dbc6%22%20opacity%3D%220.30%22%20font-family%3D%22monospace%22%20text-anchor%3D%22middle%22%3EF5%3C%2Ftext%3E%3Cpath%20d%3D%22M%201688%20535%20L%201694%20546%20L%201682%20546%20Z%22%20fill%3D%22none%22%20stroke%3D%22%23a99a72%22%20stroke-width%3D%221%22%20stroke-opacity%3D%220.22%22%2F%3E%3Cpath%20d%3D%22M%201035%20428%20L%201041%20439%20L%201029%20439%20Z%22%20fill%3D%22none%22%20stroke%3D%22%23a99a72%22%20stroke-width%3D%221%22%20stroke-opacity%3D%220.22%22%2F%3E%3Cpath%20d%3D%22M%20395%20139%20L%20401%20150%20L%20389%20150%20Z%22%20fill%3D%22none%22%20stroke%3D%22%23a99a72%22%20stroke-width%3D%221%22%20stroke-opacity%3D%220.22%22%2F%3E%3Cpath%20d%3D%22M%20774%20505%20L%20780%20516%20L%20768%20516%20Z%22%20fill%3D%22none%22%20stroke%3D%22%23a99a72%22%20stroke-width%3D%221%22%20stroke-opacity%3D%220.22%22%2F%3E%3Cpath%20d%3D%22M%20360%20696%20L%20366%20707%20L%20354%20707%20Z%22%20fill%3D%22none%22%20stroke%3D%22%23a99a72%22%20stroke-width%3D%221%22%20stroke-opacity%3D%220.22%22%2F%3E%3Cpath%20d%3D%22M%201696%20765%20L%201702%20776%20L%201690%20776%20Z%22%20fill%3D%22none%22%20stroke%3D%22%23a99a72%22%20stroke-width%3D%221%22%20stroke-opacity%3D%220.22%22%2F%3E%3Ccircle%20cx%3D%221283%22%20cy%3D%22313%22%20r%3D%225%22%20fill%3D%22none%22%20stroke%3D%22%23f2e05e%22%20stroke-width%3D%221%22%20stroke-opacity%3D%220.30%22%2F%3E%3Ctext%20x%3D%221283%22%20y%3D%22328%22%20font-size%3D%229%22%20fill%3D%22%23f2e05e%22%20opacity%3D%220.32%22%20font-family%3D%22monospace%22%20text-anchor%3D%22middle%22%3ES1%3C%2Ftext%3E%3Ccircle%20cx%3D%22344%22%20cy%3D%22594%22%20r%3D%225%22%20fill%3D%22none%22%20stroke%3D%22%23f2e05e%22%20stroke-width%3D%221%22%20stroke-opacity%3D%220.30%22%2F%3E%3Ctext%20x%3D%22344%22%20y%3D%22609%22%20font-size%3D%229%22%20fill%3D%22%23f2e05e%22%20opacity%3D%220.32%22%20font-family%3D%22monospace%22%20text-anchor%3D%22middle%22%3ES2%3C%2Ftext%3E%3Ccircle%20cx%3D%22693%22%20cy%3D%22612%22%20r%3D%225%22%20fill%3D%22none%22%20stroke%3D%22%23f2e05e%22%20stroke-width%3D%221%22%20stroke-opacity%3D%220.30%22%2F%3E%3Ctext%20x%3D%22693%22%20y%3D%22627%22%20font-size%3D%229%22%20fill%3D%22%23f2e05e%22%20opacity%3D%220.32%22%20font-family%3D%22monospace%22%20text-anchor%3D%22middle%22%3ES3%3C%2Ftext%3E%3Ccircle%20cx%3D%22804%22%20cy%3D%22717%22%20r%3D%225%22%20fill%3D%22none%22%20stroke%3D%22%23f2e05e%22%20stroke-width%3D%221%22%20stroke-opacity%3D%220.30%22%2F%3E%3Ctext%20x%3D%22804%22%20y%3D%22732%22%20font-size%3D%229%22%20fill%3D%22%23f2e05e%22%20opacity%3D%220.32%22%20font-family%3D%22monospace%22%20text-anchor%3D%22middle%22%3ES4%3C%2Ftext%3E%3Ccircle%20cx%3D%22718%22%20cy%3D%22552%22%20r%3D%225%22%20fill%3D%22none%22%20stroke%3D%22%23f2e05e%22%20stroke-width%3D%221%22%20stroke-opacity%3D%220.30%22%2F%3E%3Ctext%20x%3D%22718%22%20y%3D%22567%22%20font-size%3D%229%22%20fill%3D%22%23f2e05e%22%20opacity%3D%220.32%22%20font-family%3D%22monospace%22%20text-anchor%3D%22middle%22%3ES5%3C%2Ftext%3E%3Cg%20stroke%3D%22%23ffffff%22%20stroke-width%3D%220.5%22%20stroke-opacity%3D%220.05%22%20fill%3D%22none%22%3E%3Cline%20x1%3D%22160%22%20y1%3D%220%22%20x2%3D%22160%22%20y2%3D%221080%22%2F%3E%3Cline%20x1%3D%22320%22%20y1%3D%220%22%20x2%3D%22320%22%20y2%3D%221080%22%2F%3E%3Cline%20x1%3D%22480%22%20y1%3D%220%22%20x2%3D%22480%22%20y2%3D%221080%22%2F%3E%3Cline%20x1%3D%22640%22%20y1%3D%220%22%20x2%3D%22640%22%20y2%3D%221080%22%2F%3E%3Cline%20x1%3D%22800%22%20y1%3D%220%22%20x2%3D%22800%22%20y2%3D%221080%22%2F%3E%3Cline%20x1%3D%22960%22%20y1%3D%220%22%20x2%3D%22960%22%20y2%3D%221080%22%2F%3E%3Cline%20x1%3D%221120%22%20y1%3D%220%22%20x2%3D%221120%22%20y2%3D%221080%22%2F%3E%3Cline%20x1%3D%221280%22%20y1%3D%220%22%20x2%3D%221280%22%20y2%3D%221080%22%2F%3E%3Cline%20x1%3D%221440%22%20y1%3D%220%22%20x2%3D%221440%22%20y2%3D%221080%22%2F%3E%3Cline%20x1%3D%221600%22%20y1%3D%220%22%20x2%3D%221600%22%20y2%3D%221080%22%2F%3E%3Cline%20x1%3D%221760%22%20y1%3D%220%22%20x2%3D%221760%22%20y2%3D%221080%22%2F%3E%3Cline%20x1%3D%220%22%20y1%3D%22160%22%20x2%3D%221920%22%20y2%3D%22160%22%2F%3E%3Cline%20x1%3D%220%22%20y1%3D%22320%22%20x2%3D%221920%22%20y2%3D%22320%22%2F%3E%3Cline%20x1%3D%220%22%20y1%3D%22480%22%20x2%3D%221920%22%20y2%3D%22480%22%2F%3E%3Cline%20x1%3D%220%22%20y1%3D%22640%22%20x2%3D%221920%22%20y2%3D%22640%22%2F%3E%3Cline%20x1%3D%220%22%20y1%3D%22800%22%20x2%3D%221920%22%20y2%3D%22800%22%2F%3E%3Cline%20x1%3D%220%22%20y1%3D%22960%22%20x2%3D%221920%22%20y2%3D%22960%22%2F%3E%3C%2Fg%3E%3Cg%20font-family%3D%22monospace%22%20font-size%3D%2212%22%20fill%3D%22%23e2dbc6%22%20opacity%3D%220.24%22%3E%3Ctext%20x%3D%2280%22%20y%3D%2218%22%20text-anchor%3D%22middle%22%3EA%3C%2Ftext%3E%3Ctext%20x%3D%22240%22%20y%3D%2218%22%20text-anchor%3D%22middle%22%3EB%3C%2Ftext%3E%3Ctext%20x%3D%22400%22%20y%3D%2218%22%20text-anchor%3D%22middle%22%3EC%3C%2Ftext%3E%3Ctext%20x%3D%22560%22%20y%3D%2218%22%20text-anchor%3D%22middle%22%3ED%3C%2Ftext%3E%3Ctext%20x%3D%22720%22%20y%3D%2218%22%20text-anchor%3D%22middle%22%3EE%3C%2Ftext%3E%3Ctext%20x%3D%22880%22%20y%3D%2218%22%20text-anchor%3D%22middle%22%3EF%3C%2Ftext%3E%3Ctext%20x%3D%221040%22%20y%3D%2218%22%20text-anchor%3D%22middle%22%3EG%3C%2Ftext%3E%3Ctext%20x%3D%221200%22%20y%3D%2218%22%20text-anchor%3D%22middle%22%3EH%3C%2Ftext%3E%3Ctext%20x%3D%221360%22%20y%3D%2218%22%20text-anchor%3D%22middle%22%3EI%3C%2Ftext%3E%3Ctext%20x%3D%221520%22%20y%3D%2218%22%20text-anchor%3D%22middle%22%3EJ%3C%2Ftext%3E%3Ctext%20x%3D%221680%22%20y%3D%2218%22%20text-anchor%3D%22middle%22%3EK%3C%2Ftext%3E%3Ctext%20x%3D%221840%22%20y%3D%2218%22%20text-anchor%3D%22middle%22%3EL%3C%2Ftext%3E%3Ctext%20x%3D%2214%22%20y%3D%2284%22%20text-anchor%3D%22middle%22%3E0%3C%2Ftext%3E%3Ctext%20x%3D%2214%22%20y%3D%22244%22%20text-anchor%3D%22middle%22%3E1%3C%2Ftext%3E%3Ctext%20x%3D%2214%22%20y%3D%22404%22%20text-anchor%3D%22middle%22%3E2%3C%2Ftext%3E%3Ctext%20x%3D%2214%22%20y%3D%22564%22%20text-anchor%3D%22middle%22%3E3%3C%2Ftext%3E%3Ctext%20x%3D%2214%22%20y%3D%22724%22%20text-anchor%3D%22middle%22%3E4%3C%2Ftext%3E%3Ctext%20x%3D%2214%22%20y%3D%22884%22%20text-anchor%3D%22middle%22%3E5%3C%2Ftext%3E%3Ctext%20x%3D%2214%22%20y%3D%221044%22%20text-anchor%3D%22middle%22%3E6%3C%2Ftext%3E%3C%2Fg%3E%3Ctext%20x%3D%22380%22%20y%3D%22260%22%20font-size%3D%2211%22%20fill%3D%22%23f2e05e%22%20opacity%3D%220.30%22%20font-family%3D%22monospace%22%20text-anchor%3D%22middle%22%3E1280m%3C%2Ftext%3E%3Ctext%20x%3D%22720%22%20y%3D%22520%22%20font-size%3D%2211%22%20fill%3D%22%23f2e05e%22%20opacity%3D%220.30%22%20font-family%3D%22monospace%22%20text-anchor%3D%22middle%22%3E1140m%3C%2Ftext%3E%3Ctext%20x%3D%221040%22%20y%3D%22760%22%20font-size%3D%2211%22%20fill%3D%22%23f2e05e%22%20opacity%3D%220.30%22%20font-family%3D%22monospace%22%20text-anchor%3D%22middle%22%3E960m%3C%2Ftext%3E%3Ctext%20x%3D%221420%22%20y%3D%22300%22%20font-size%3D%2211%22%20fill%3D%22%23f2e05e%22%20opacity%3D%220.30%22%20font-family%3D%22monospace%22%20text-anchor%3D%22middle%22%3E1500m%3C%2Ftext%3E%3Ctext%20x%3D%221650%22%20y%3D%22860%22%20font-size%3D%2211%22%20fill%3D%22%23f2e05e%22%20opacity%3D%220.30%22%20font-family%3D%22monospace%22%20text-anchor%3D%22middle%22%3E820m%3C%2Ftext%3E%3Ctext%20x%3D%2228%22%20y%3D%2246%22%20font-size%3D%2216%22%20fill%3D%22%23e2dbc6%22%20opacity%3D%220.36%22%20font-family%3D%22monospace%22%20letter-spacing%3D%222%22%3ETALOS-II%20%2F%2F%20SURVEY%20SHEET%3C%2Ftext%3E%3Ctext%20x%3D%2228%22%20y%3D%2264%22%20font-size%3D%2211%22%20fill%3D%22%23e2dbc6%22%20opacity%3D%220.30%22%20font-family%3D%22monospace%22%3ESECTOR%2007%20%E2%80%94%2075%C2%B0E%2034%C2%B0N%20%E2%80%94%201%3A50%20000%3C%2Ftext%3E%3Cg%20stroke%3D%22%23e2dbc6%22%20stroke-width%3D%221%22%20stroke-opacity%3D%220.28%22%20fill%3D%22none%22%3E%3Cline%20x1%3D%2228%22%20y1%3D%221046%22%20x2%3D%22128%22%20y2%3D%221046%22%2F%3E%3Cline%20x1%3D%2228%22%20y1%3D%221040%22%20x2%3D%2228%22%20y2%3D%221052%22%2F%3E%3Cline%20x1%3D%22128%22%20y1%3D%221040%22%20x2%3D%22128%22%20y2%3D%221052%22%2F%3E%3C%2Fg%3E%3Ctext%20x%3D%22134%22%20y%3D%221050%22%20font-size%3D%2210%22%20fill%3D%22%23e2dbc6%22%20opacity%3D%220.26%22%20font-family%3D%22monospace%22%3E10%20km%3C%2Ftext%3E%3Cg%20stroke%3D%22%23e2dbc6%22%20stroke-opacity%3D%220.20%22%20fill%3D%22none%22%3E%3Crect%20x%3D%2216%22%20y%3D%2216%22%20width%3D%221888%22%20height%3D%221048%22%20stroke-width%3D%221%22%2F%3E%3C%2Fg%3E%3Cpath%20stroke%3D%22%23e2dbc6%22%20stroke-opacity%3D%220.28%22%20stroke-width%3D%222%22%20fill%3D%22none%22%20d%3D%22M16%2058%20L16%2016%20L58%2016%20M1862%2016%20L1904%2016%20L1904%2058%20M16%201022%20L16%201064%20L58%201064%20M1862%201064%20L1904%201064%20L1904%201022%22%2F%3E%3C%2Fsvg%3E')"; // Endfield topo sheet

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

window.bgPick = async () => {
    try {
        const p = await ipc.invoke("settings:pickImage");
        if (!p) return; // user cancelled
        window._settingsBgValue = p;
        window.bgSetMode("image");
        const st = document.getElementById("settingsBgStatus");
        if (st) st.textContent = p.split(/[\\/]/).pop();
        const prev = document.getElementById("settingsBgPreview");
        if (prev) {
            try { prev.style.backgroundImage = `url("${require("url").pathToFileURL(p).href}")`; } catch (e) {}
            prev.classList.add("show");
        }
        if (window.eventPlay) window.eventPlay("settings_save");
    } catch (e) {
        console.warn("bgPick failed:", e);
    }
};

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
            settingsRow("settings.shell", `<input type="text" id="settingsEditor-shell" value="${window.settings.shell}">`, "settings.shell.help"),
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
                `<select id="settingsEditor-showGui" onchange="window.showGui.apply()">
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
                        <button type="button" id="settingsClashOpenConfig" class="settings_net_btn">${t("settings.clash.openConfig")}</button>
                        <button type="button" id="settingsClashOpenDashboard" class="settings_net_btn">${t("settings.clash.openDashboard")}</button>
                    </div>`),
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
            settingsRow("settings.updates.links2", `<span id="settingsUpLinks2Ver" class="settings_net_info">–</span> <span class="settings_net_info">· ${t("settings.updates.apt")}</span>`),
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
            {label: t("settings.btn.openExternal"), action:`electron.shell.openPath('${settingsFile}');electronWin.minimize();`},
            {label: t("settings.btn.save"), action: "window.eventPlay('settings_save');window.writeSettingsFile()"},
            {label: t("settings.btn.shortcuts"), action: "window.openShortcutsHelp()"},
            {label: t("settings.btn.reload"), action: "window.location.reload(true);"},
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
        bindClash("settingsClashOpenConfig", () => window.clash.openConfig());
        bindClash("settingsClashOpenDashboard", () => window.clash.openDashboard());
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
    s.shell = document.getElementById("settingsEditor-shell").value;
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
        // Dismissing the screensaver leads into the lock screen when a passcode
        // is configured (lockOnIdle + non-empty lockCode), or when the
        // screensaver was started from the power menu's Lock Screen button
        // (forceLockOnDismiss) — that flow is screensaver-then-lock by design.
        const forceLock = window.screensaver.forceLockOnDismiss === true;
        window.screensaver.forceLockOnDismiss = false;
        const willLock = (forceLock || (window.settings.lockOnIdle !== false && String(window.settings.lockCode || "").length > 0))
            && window.lockScreen && !window.lockScreen.active;
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
    const screenOffIdle = (Number(window.settings.screenOffIdle) || 1800) * 1000;
    const screensaverIdle = (Number(window.settings.screensaverIdle) || 300) * 1000;
    const shouldLockOnIdle = window.settings.lockOnIdle !== false
        && String(window.settings.lockCode || "").length > 0;

    if (screensaverOn || locked) {
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
