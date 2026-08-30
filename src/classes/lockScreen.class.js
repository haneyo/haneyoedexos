// LockScreen — two sci-fi lock modes that follow screensaverStyle:
//   "code"   → a command-line passcode prompt shown over the terminal area.
//              A full-screen overlay blocks every other control (only the clock
//              stays interactive for power options). Entering the passcode is
//              the only way back.
//   "matrix" → the original fullscreen matrix-rain canvas + passcode panel.
//              Unlocking plays the CRT-off animation + "Welcome back" greeting
//              (welcomeBack) and only then reveals the real UI (#80).
//
// Entry points: the gear menu's 锁屏 button, Ctrl+Shift+O, or idle when
// settings.lockOnIdle is on.

class LockScreen {
    constructor() {
        this.active = false;
        this._timer = null;
        this._focusRet = null;
        this._canvas = null;
        this._ctx = null;
        // matrix-rain state
        this._drops = [];
        this._cols = 0;
        this._matrixTimer = null;
        // which lock UI is up ("code" | "matrix"); gates the idle-timeout path
        this._mode = "code";
        // while true, passcode input is dropped — during the box decrypt-in and
        // during any lock→screensaver / lock→greeting transition
        this._boxAnimating = false;
        // 30s-idle timeout back to the screensaver (lockIdleTimeout, default 30)
        this._idleTimer = null;
        // Real unlock defers putting the pre-lock windows back until the UI
        // reveal (matrix entrance / lock_block fade) completes — see
        // _flushDeferredRestore — so they never pop up over the loading desktop.
        this._deferRestore = false;
        this._pendingRestore = false;
    }

    // Locking hides (not destroys) every open window — settings editor, WiFi,
    // system update, CLOCK & POWER, … — so nothing lingers over the lock, yet
    // each window's exact state (form values, scroll position, drag offset)
    // survives and is restored on unlock. The real processes keep running
    // underneath, exactly as before. Not called while already locked: the
    // clock stays interactive for power options.
    _snapshotWindows() {
        this._hiddenModals = [];
        Object.keys(window.modals || {}).forEach(id => {
            const el = document.getElementById("modal_" + id);
            if (!el) return;
            // The POWER menu is transient — locking from it (its Lock Screen
            // button) must not bring it back on unlock. Hide it like
            // everything else, but leave it out of the restore list.
            if (window.modals[id] && window.modals[id].title === "POWER") {
                el.style.display = "none";
                return;
            }
            this._hiddenModals.push(id);
            el.style.display = "none";
        });
        // A fullscreen overlay (browser / webapp / app-monitor web app, z 9000)
        // must not survive the lock: in code mode it sits ABOVE the lock
        // (lock_block z 3000) and after any unlock it would pop back fullscreen.
        // Drop it at lock time so the lock covers the normal panel view and the
        // unlock returns to the virtual-display panels, not the fullscreen app.
        if (window.webViewFullscreen && window.webViewFullscreen.el) {
            try { window.webViewFullscreen.exit(); } catch (e) {}
        }
        // Same for a native app covering the real display via the app-monitor
        // backend, and for any DOM-level fullscreen (e.g. the media player).
        if (window.appmonitorApi && typeof window.appmonitorApi.exitFullscreen === "function") {
            try { window.appmonitorApi.exitFullscreen(); } catch (e) {}
        }
        if (document.fullscreenElement && typeof document.exitFullscreen === "function") {
            try { document.exitFullscreen(); } catch (e) {}
        }
    }

    // Unlock: put every window that was open before the lock back on screen,
    // untouched (same position, same content, same focus order). The CLOCK &
    // POWER menu is the exception — whether it was open at lock time or opened
    // during the lock for power options, it is transient and never restored.
    _restoreWindows() {
        if (this._hiddenModals) {
            // Re-show in the original z-order; focusing each in turn re-stacks
            // them so the window that was on top ends up focused again.
            this._hiddenModals.forEach(id => {
                const el = document.getElementById("modal_" + id);
                if (!el) return;
                el.style.display = "";
                const m = window.modals[id];
                if (m && typeof m.focus === "function") m.focus();
            });
            this._hiddenModals = null;
        }
        Object.keys(window.modals || {}).forEach(id => {
            const m = window.modals[id];
            if (!m || m.title !== "POWER") return;
            const el = document.getElementById("modal_" + id);
            if (el) el.remove();
            if (typeof m.onclose === "function") { try { m.onclose(); } catch (e) {} }
            delete window.modals[id];
        });
    }

    // Tell the main process whether a lock (or first-run setup) owns the screen,
    // so its OS-level hotkeys (Ctrl+Shift+Q/W/O — globalShortcut fires outside
    // DOM keydown) stay inert while locked. The renderer gates its own shortcuts
    // via uiLocked() in _renderer.js.
    _pushLockState() {
        try { require("electron").ipcRenderer.send("edex-lock-state", !!this.active); } catch (e) {}
    }

    show() {
        if (this.active) {
            // Already locked but the cover identity was lost (e.g. a screensaver
            // was dismissed while the lock was up) — re-assert it.
            if (window.cover && !window.cover.isActive()) window.cover.set(true);
            return;
        }
        // Boot-phase guard: before the real UI exists (initUI finished) the only
        // legitimate lock is the boot lock, created by bootLockThenRun → bootShow.
        // Every other pre-uiReady request — idle dismiss, resumeFromSuspend on
        // visibilitychange, a lock-screen IPC during startup — would either build
        // a code lock against a not-yet-created terminal (a broken/empty box) or
        // re-lock during the welcome / UI-build right after the boot unlock.
        // Ignore them all: the boot sequence owns the screen until _uiReady.
        if (!window._uiReady) {
            return;
        }
        // A fresh lock always starts with the restore undelayed / not pending,
        // whatever a previous lock flow left behind.
        this._deferRestore = false;
        this._pendingRestore = false;
        // Remember where the user was: every window they had open, and the tab
        // they were on. _prevTerm is captured AFTER _showTerminalLock below —
        // the cover session lives on a CLI panel tab, and the screensaver /
        // cover module records the pre-cover tab (coverRestoreTab) when it
        // switches there. Unlock restores exactly that tab.
        this._snapshotWindows();
        // The app-monitor dropdowns are body-level menus, not modals — hide
        // them too so no app list lingers over the lock (#22).
        [window.appmonitorA, window.appmonitorB].forEach(p => {
            if (p && typeof p.closeMenu === "function") { try { p.closeMenu(); } catch (e) {} }
        });
        // The lock hides the cursor outright; moving the mouse shows it (see
        // cursorTrap in _renderer.js).
        if (window.cursorTrap) window.cursorTrap.hide();
        this.active = true;
        this._pushLockState();
        const style = window.settings.screensaverStyle || "code";
        this._mode = style;
        if (style === "matrix") this._showFullscreen();
        else this._showTerminalLock();
        // Where the user was before the cover switched tabs. For a screensaver
        // → lock handover this is the pre-screensaver tab; for a direct lock
        // (Win+L) streamCodeIntoCover captured it just now. Matrix mode never
        // switches tabs, so currentTerm is already correct there.
        this._prevTerm = (window.screensaver && typeof window.screensaver.coverRestoreTab === "function"
            && window.screensaver.coverRestoreTab() != null)
            ? window.screensaver.coverRestoreTab() : window.currentTerm;
        // While locked, eDEX wears its cover identity (fake tabs / filesystem /
        // IP / process list) — a launch device doesn't show real data.
        if (window.cover) window.cover.set(true);
    }

    // Lock with the screensaver-first flow: the screensaver animation plays
    // until any mouse/key activity (bumpActivity) dismisses it into the real
    // password lock. Used by the lock IPC and by resume-from-suspend; the boot
    // lock and the power menu's Lock Screen keep their own flows.
    engage() {
        if (this.active) return;         // password UI already up
        if (!window._uiReady) return;    // boot phase: the boot lock owns the screen
        if (window.screensaver) {
            window.screensaver.forceLockOnDismiss = true;
            if (!window.screensaver.isActive()) window.screensaver.show();
        } else {
            this.show();
        }
    }

    hide() {
        if (!this.active) return;
        this._teardownLock(true);
    }

    // Tear the lock UI down and release every raise the lock applied (clock,
    // shell, DATA panel + keyboard, terminal pty hooks). `restoreWindows` is a
    // REAL unlock: put the windows that were open before the lock back on
    // screen, drop cover mode (which re-lists the real files), return to the
    // pre-lock tab and focus the terminal. `false` is a timeout back to the
    // screensaver: the lock yields the screen to the (re)started screensaver,
    // so windows stay hidden, cover stays on, the cursor stays hidden and the
    // pty is not asked for a fresh prompt — the screensaver re-owns the
    // terminal and streams fresh content anyway (#88).
    _teardownLock(restoreWindows) {
        this.active = false;
        this._pushLockState();
        this._boxAnimating = false;
        clearInterval(this._timer);
        clearInterval(this._focusRet);
        clearInterval(this._matrixTimer);
        if (this._domKeyH) { document.removeEventListener("keydown", this._domKeyH, true); this._domKeyH = null; }
        // Null the handle too: a stale non-null interval id would make the NEXT
        // lock on this instance read as Matrix (unlock() replay-boot, power-key
        // blanking) even when it is a code lock (#148).
        this._matrixTimer = null;
        clearInterval(this._lockAnim);
        this._lockAnim = null;
        clearTimeout(this._shakeTimer);
        this._shakeTimer = null;
        if (this._idleTimer) { clearInterval(this._idleTimer); this._idleTimer = null; }
        if (window.cursorTrap && restoreWindows) window.cursorTrap.show();
        const clock = document.getElementById("mod_clock");
        if (clock) {
            clock.style.zIndex = "";
            clock.style.position = this._origClockPos || "";
        }
        const title = document.getElementById("main_shell_title");
        if (title) title.style.zIndex = this._origTitleZ || "";
        const shell = document.getElementById("main_shell");
        if (shell) {
            shell.style.zIndex = this._origShellZ || "";
            shell.style.clipPath = this._origShellClip || "";
        }
        const inner = document.getElementById("main_shell_innercontainer");
        if (inner) {
            inner.style.zIndex = this._origInnerZ || "";
            inner.style.clipPath = this._origInnerClip || "";
        }
        // lower the DATA panel back under the overlay (it was raised only so the
        // on-screen keyboard could stay visible/interactive while locked)
        const panel = document.getElementById("cyber_panel");
        if (panel) {
            panel.style.zIndex = "";
            if (this._origPanelClip !== undefined) panel.style.clipPath = this._origPanelClip;
            const strip = document.getElementById("cyber_panel_inner");
            if (strip) strip.style.pointerEvents = "";
        }
        // Un-hook the pty send interceptor (physical keys + virtual keyboard
        // both flowed through it while locked) so endCoverSession's socket.close
        // does not route through _termKey. No output interceptor exists on the
        // cover terminal and its cat pty holds no user buffer, so there is
        // nothing to reset, replay or re-prompt — the whole session is destroyed
        // by endCover() below, and the user's real terminals were never touched.
        if (this._term) {
            try {
                if (this._origSend) this._term.socket.send = this._origSend;
                this._suppressOutput = false;
            } catch (e) {}
        }
        this._term = null;
        // A direct lock streams fake code behind the box; stop it if the lock is
        // torn down before the ~1.5s window elapsed (no-op for screensaver locks,
        // whose wind-down already cleared the timer).
        if (window.screensaver && typeof window.screensaver.stopCodeStream === "function") {
            window.screensaver.stopCodeStream();
        }
        // Destroy the cover session (screen session + pty). On a real unlock the
        // restore tab was already captured as _prevTerm; on a timeout back to
        // the screensaver, keepRestoreTab preserves the ORIGINAL pre-cover tab
        // so resumeCode() doesn't re-capture the cover tab itself (#88).
        if (window.screensaver && typeof window.screensaver.endCover === "function") {
            window.screensaver.endCover(!restoreWindows);
        }
        // restore the virtual keyboard to the user's setting
        this._restoreKeyboard();
        const el = document.getElementById("lock_screen");
        if (el) el.remove();
        this._canvas = null; this._ctx = null;
        // Dark overlay: everything above has already been released (shell/panel
        // z-indexes, terminal hooks, windows, cover), so this overlay now dims
        // the REAL UI underneath. Fade it to transparent and only then remove it,
        // so the lock→unlock (and the lock→screensaver idle timeout) brightening
        // is gradual instead of a hard pop. Timing mirrors .lock_panel's
        // lock_fade_out (0.42s) so the whole unlock feels like one motion.
        const block = document.getElementById("lock_block");
        if (block) {
            block.classList.add("lock_block_fade_out");
            clearTimeout(this._fadeTimer);
            this._fadeTimer = setTimeout(() => {
                this._fadeTimer = null;
                if (block.isConnected) block.remove();
                // Code-mode unlock: the UI is fully revealed once the dim has
                // faded — only then put the pre-lock windows back, so they
                // appear after the desktop, not over it.
                if (this._pendingRestore) this._flushDeferredRestore();
            }, 430);
        }
        if (restoreWindows) {
            if (this._deferRestore) {
                // The unlock is mid-reveal (matrix entrance / lock-block fade):
                // hold the pre-lock windows off the screen until the UI has
                // finished loading — they must not pop up over it.
                this._pendingRestore = true;
            } else {
                this._applyRestore();
            }
        }
    }

    // Real unlock: put every window that was open before the lock (settings
    // editor, CLOCK & POWER, …) back in its exact spot, leave cover mode
    // (restore the real tabs / filesystem / IP / procs) and return to the tab
    // the user was on before the lock. Shared by the immediate unlock and the
    // deferred one (which runs after the UI reveal finishes).
    _applyRestore() {
        this._restoreWindows();
        // Leave cover mode: restore the real tabs / filesystem / IP / procs.
        if (window.cover) window.cover.set(false);
        // Return to the tab the user was on before the lock. The lock ran
        // on tab 0, so currentTerm differs whenever the user was elsewhere;
        // leave it alone otherwise (matrix mode never switched tabs).
        if (this._prevTerm != null && this._prevTerm !== window.currentTerm) {
            try { if (window.focusShellTab) window.focusShellTab(this._prevTerm); } catch (e) {}
        }
        this._prevTerm = null;
        try { if (window.term && window.term[window.currentTerm]) window.term[window.currentTerm].term.focus(); } catch (e) {}
    }

    // Run the deferred window restore — called once the UI reveal has finished
    // (matrix entrance via reRevealUI's completion, or the code lock_block
    // fade), so previously-open windows appear AFTER the UI loads, not over it.
    _flushDeferredRestore() {
        if (!this._pendingRestore) return;
        this._pendingRestore = false;
        this._deferRestore = false;
        this._applyRestore();
    }

    // ---- code mode: the lock is drawn entirely by the real terminal ----
    _showTerminalLock() {
        // If a previous lock is mid-fade-out, finish it now so there is exactly
        // one overlay on screen — the new block fades in over the screensaver.
        clearTimeout(this._fadeTimer);
        this._fadeTimer = null;
        const stale = document.getElementById("lock_block");
        if (stale) stale.remove();
        const block = document.createElement("div");
        block.id = "lock_block";
        block.className = "lock_block";
        document.body.appendChild(block);
        // The clock stays interactive so power options (restart / lock / shutdown)
        // remain reachable while locked. It is position:static, so its z-index
        // alone never lifts it above the overlay — give it a position.
        const clock = document.getElementById("mod_clock");
        if (clock) {
            this._origClockPos = clock.style.position;
            clock.style.position = "relative";
            clock.style.zIndex = "3100";
        }
        // The TERMINAL / MAIN SHELL title bar floats above the shell frame (it
        // lives outside #main_shell so the shell's clip-path cannot paint it
        // away, #96). It is not inside the raised shell, so lift it above the
        // blocking overlay while locked — exactly like the clock above — so it
        // stays visible in the lock (and the code screensaver) view.
        const title = document.getElementById("main_shell_title");
        if (title) {
            this._origTitleZ = title.style.zIndex;
            title.style.zIndex = "3100";
        }
        // The terminal is the lock screen — raise it above the blocking overlay
        // so the command-line UI stays fully visible (only the side columns are
        // dimmed/blocked). augmented-ui's clip-path on #main_shell (and on
        // #cyber_panel below) opens a stacking context that pins those elements
        // BELOW the overlay no matter their z-index, so the clip is neutralised
        // while locked and the terminal's corner cut re-applied to the inner
        // container (which now lives inside the lifted, un-clipped shell).
        const shell = document.getElementById("main_shell");
        if (shell) {
            this._origShellClip = shell.style.clipPath;
            this._origShellZ = shell.style.zIndex;
            shell.style.zIndex = "3200";
            shell.style.clipPath = "none";
        }
        const inner = document.getElementById("main_shell_innercontainer");
        if (inner) {
            this._origInnerZ = inner.style.zIndex;
            this._origInnerClip = inner.style.clipPath;
            inner.style.zIndex = "3001";
            inner.style.clipPath = "polygon(0 0, calc(100% - 15px) 0, 100% 15px, 100% 100%, 15px 100%, 0 calc(100% - 15px))";
        }

        // Draw the command-line lock UI on the cover session — a real pty on the
        // CLI panel tab owned by the screensaver module. A screensaver → lock
        // handover reuses the very session the fake code streamed into; a direct
        // lock (Win+L with no screensaver first) streams fake code behind the
        // box for ~1.5s before it assembles. The user's real terminals (0-2) and
        // running CLI sessions are never touched, so nothing needs re-serialising
        // on unlock (#50).
        const direct = !(window.screensaver && window.screensaver.isActive())
            && !(window.screensaver && typeof window.screensaver.isCodeStreaming === "function"
                && window.screensaver.isCodeStreaming());
        if (direct && window.screensaver && typeof window.screensaver.streamCodeIntoCover === "function") {
            window.screensaver.streamCodeIntoCover();
        }
        this._codeBuf = "";
        const grab = () => {
            if (!this.active) return;
            const t = (window.screensaver && typeof window.screensaver.coverTerm === "function")
                ? window.screensaver.coverTerm() : null;
            // The cover pty attaches asynchronously (ttyspawn round-trip) — poll
            // until the wrapper is ready before wiring the box onto it (#50).
            if (!t || !t.term || !t.socket) { setTimeout(grab, 120); return; }
            this._setupTermLock(t, direct);
        };
        grab();
        // Force the on-screen keyboard so the password can be typed on a touch
        // screen even when the user has the virtual keyboard hidden in settings.
        // Physical-key echo is disabled so typing the passcode on a real keyboard
        // does not reveal it on the virtual keys.
        this._keyboardForced = false;
        if (window.ensureKeyboard) {
            if (!document.getElementById("keyboard_layer")) this._keyboardForced = true;
            window.ensureKeyboard();
            const kbLayer = document.getElementById("keyboard_layer");
            if (kbLayer) {
                // The DATA panel's clip-path opens its own stacking context, so
                // a z-index on the keyboard alone can never lift it above the
                // lock overlay. Raise the panel as a whole instead — that brings
                // the keys (and their click/touch reactions) above the dim layer
                // while `#cyber_panel:has(#keyboard_layer)` keeps the waveform
                // hidden and the box in its compact keyboard layout.
                const panel = document.getElementById("cyber_panel");
                if (panel) {
                    // normalize in case a stray state left the layer on <body>
                    if (kbLayer.parentElement !== panel) panel.appendChild(kbLayer);
                    kbLayer.style.position = "";
                    kbLayer.style.left = "";
                    kbLayer.style.top = "";
                    kbLayer.style.width = "";
                    kbLayer.style.height = "";
                    kbLayer.style.zIndex = "3050";
                    // Same augmented-ui clip trap as the shell: neutralise it so
                    // the raised z-index actually beats the dim overlay.
                    if (this._origPanelClip === undefined) this._origPanelClip = panel.style.clipPath;
                    panel.style.clipPath = "none";
                    panel.style.zIndex = "3005";
                    // Only the keys stay clickable — the strip above them must
                    // not open menus while the system is locked.
                    const strip = document.getElementById("cyber_panel_inner");
                    if (strip) strip.style.pointerEvents = "none";
                }
            }
            if (window.keyboard) window.keyboard.echoPhysical = false;
        }
        this._focusRet = setInterval(() => {
            if (this.active && this._term && this._term.term) this._term.term.focus();
        }, 500);
        // 30 s with no passcode input and no mouse/keyboard activity hands the
        // screen back to the screensaver (code box dissolves, then the fake
        // code resumes) (#88).
        this._armIdleTimeout();
    }

    // Wire the lock UI onto the cover terminal: intercept pty sends so every
    // keystroke (physical keyboard xterm onData and the virtual keyboard both
    // reach socket.send) lands in _termKey, then draw the passcode box. No
    // output interceptor is installed on purpose — the cat pty echoes nothing
    // (input is consumed here, never forwarded) and a write interceptor would
    // swallow the fake-code streamer's direct xterm writes during a direct lock
    // (#50).
    _setupTermLock(t, direct) {
        this._term = t;
        if (t.socket && typeof t.socket.send === "function") {
            this._origSend = t.socket.send.bind(t.socket);
            t.socket.send = data => this._termKey(data);
        }
        this._rawWrite = t.term.write.bind(t.term);
        this._suppressOutput = true;
        this._boxAnimating = true;
        if (direct) {
            // Stream fake code behind the box for ~1.5s, then stop the stream
            // and assemble the box over the "still busy" terminal. Input is
            // dropped (boxAnimating) for the whole transition (#50).
            const ss = window.screensaver;
            setTimeout(() => {
                if (!this.active) return;
                if (ss && typeof ss.stopCodeStream === "function") ss.stopCodeStream();
                this._drawLockBox(true);
            }, 1500);
        } else {
            // Screensaver → lock: the fake code is still streaming on the cover
            // session (bumpActivity kept the timer alive). Assemble the box over
            // the running stream, then stop it — they share the terminal grid,
            // so new lines would otherwise scroll the box away (#89).
            this._drawLockBox(true);
            const ss = window.screensaver;
            if (ss && typeof ss.stopCodeStream === "function") ss.stopCodeStream();
        }
    }

    // Any input typed during the lock (from either input path) lands here.
    _termKey(data) {
        if (!this.active || this._boxAnimating) return;
        const s = String(data == null ? "" : data);
        for (const ch of s) {
            if (ch === "\r" || ch === "\n") { this._codeSubmit(); return; }
            else if (ch === "\x7f" || ch === "\b") { this._codeBuf = this._codeBuf.slice(0, -1); this._codeRedraw(); }
            else if (ch >= " " && ch !== "\x1b") { this._codeBuf += ch; this._codeRedraw(); }
        }
    }

    // Draw through the raw xterm writer. Real shell output is dropped by the
    // write interceptor while locked, so the box itself must bypass it — every
    // term.write in the drawing methods below goes through here.
    _w(data) {
        if (this._rawWrite) this._rawWrite(data);
    }

    // Build the 22 lock-box rows. `redFlag` paints the whole outer frame red
    // (the wrong-passcode flash); `passMsg` replaces the PASSCODE field with a
    // grant/denied line. Shared by _drawLockBox and the red/shake redraw so the
    // box can be rebuilt in place at a shifted column.
    _buildBoxRows(redFlag, passMsg) {
        const W = 54;
        // Pad by *visible* width so ANSI colour codes never misalign the frame.
        const vis = s => String(s).replace(/\x1b\[[0-9;]*m/g, "");
        const padv = s => {
            s = String(s == null ? "" : s);
            return s + " ".repeat(Math.max(0, W - 2 - vis(s).length));
        };
        // Vivid 256-colour red for the wrong-passcode flash. Plain ANSI
        // \x1b[31m / \x1b[1;31m is NOT enough here: the tron theme (like most
        // eDEX themes) has no terminal.colorFilter, so terminal.class.js
        // grayscales every ANSI palette colour and mixes it toward the accent
        // — a "red" frame would render as mid-grey. The 256-colour space is
        // left untouched, so 196 is a guaranteed visible alarm red.
        const RED = "\x1b[1;38;5;196m";
        const bc = redFlag ? RED : "";
        const rs = s => bc + s + (bc ? "\x1b[0m" : "");
        const interior = s => rs("║") + padv(s) + rs("║");
        const cy = s => "\x1b[36m" + s + "\x1b[0m";
        const gn = s => "\x1b[32m" + s + "\x1b[0m";
        const ye = s => "\x1b[33m" + s + "\x1b[0m";
        const wh = s => "\x1b[1;37m" + s + "\x1b[0m";
        const dim = s => "\x1b[2m" + s + "\x1b[0m";
        const red = s => "\x1b[31m" + s + "\x1b[0m";
        const top = rs("╔" + "═".repeat(W - 2) + "╗");
        const sep = rs("║" + "═".repeat(W - 2) + "║");
        const bot = rs("╚" + "═".repeat(W - 2) + "╝");
        // badge/state carry ANSI colour codes, so pad by *visible* width —
        // padEnd would count the escape sequences as characters.
        const status = (badge, label, state) =>
            "    " + badge + " ".repeat(Math.max(0, 8 - vis(badge).length))
            + label + " ".repeat(Math.max(0, 18 - vis(label).length))
            + dim("····· ") + state;
        const dots = "●".repeat(this._codeBuf.length);
        const passRow = passMsg != null
            ? interior("    " + (redFlag ? RED : "\x1b[1;32m") + passMsg + "\x1b[0m")
            : interior("    " + wh("PASSCODE:") + "  "
                + "\x1b[1;36m[\x1b[0m" + "\x1b[1;33m" + dots + "█\x1b[0m" + "\x1b[1;36m]\x1b[0m");
        return [
            top,
            interior(cy("  eDEX-OS · NUCLEAR ARSENAL CONTROL · RESTRICTED  ")),
            sep,
            interior(""),
            interior("    " + wh("▁▂▃▄▅▆▇█▇▆▅▄▃▂▁") + dim("  ACCESS TERMINAL v5.2")),
            interior(""),
            interior("    ╔══╗"),
            interior("    ║  ║   " + ye("SYSTEM LOCKED")),
            interior("    ║ ═║   " + dim("ALL LAUNCH PROCEDURES")),
            interior("    ║══║   " + ye("HAVE BEEN HALTED")),
            interior("    ╚══╝"),
            interior(""),
            interior(status(gn("[ OK ]"), "biometric scan", gn("authentic"))),
            interior(status(gn("[ OK ]"), "session key", gn("verified"))),
            interior(status(ye("[ WAIT ]"), "operator clearance", ye("pending"))),
            interior(""),
            passRow,
            interior(""),
            interior("    " + dim("handshake") + "  " + cy("9F2A-44C1-8B07") + "  " + wh("▓")),
            interior(""),
            interior("    " + red("UNAUTHORIZED ACCESS WILL BE PROSECUTED")),
            bot
        ];
    }

    // Draw the sci-fi lock banner centered in the terminal window. `animateIn`
    // decrypts the box from noise one random cell at a time instead of drawing
    // it in one shot — the reverse of the garble-out that plays when the lock
    // times out (#88).
    _drawLockBox(animateIn) {
        const term = this._term && this._term.term;
        if (!term) return;
        const cols = term.cols || 80, rows = term.rows || 24;
        const W = 54;
        const L = this._buildBoxRows(false);
        const H = L.length;
        const topPad = Math.max(0, Math.floor((rows - H) / 2));
        const leftPad = Math.max(0, Math.floor((cols - W) / 2));
        this._lockW = W;
        this._lockLeftPad = leftPad;
        this._boxTop = topPad + 1;   // 1-based row of the box's top border
        term.reset();
        // passcode input sits on the "    PASSCODE:  " line (0-based 16)
        this._codeRow = topPad + 17;   // 1-based row
        this._codeCol = leftPad + 17;  // 1-based col after "    PASSCODE:  "
        // animated handshake line (0-based 18)
        this._codeAnimRow = topPad + 19;   // 1-based row
        this._codeAnimCol = leftPad + 17;  // 1-based col where the hex starts
        // ASCII padlock lines (L indices 6..10 → 1-based rows), swept by the
        // scan animation in _padlockTick.
        this._padRows = [7, 8, 9, 10, 11].map(n => topPad + n);
        // Hide the xterm cursor up front: every in-place line write leaves it
        // sitting right after the box's right border, where it would blink.
        this._w("\x1b[?25l");
        if (animateIn) { this._garbleBoxIn(); return; }
        for (let i = 0; i < topPad; i++) this._w("\r\n");
        L.forEach(l => this._w(" ".repeat(leftPad) + l + "\r\n"));
        // draw the passcode input through the same in-place line writer so the
        // framed entry (and its right border) matches what typing redraws
        this._codeRedraw();
        // The code screensaver streams into this same terminal right up until
        // the lock draws; its last frame can leave stale pixels that xterm's
        // diff renderer skips on refresh (cache == buffer, canvas already stale).
        // Clear the renderer's cell cache and repaint everything from the buffer
        // so the box is guaranteed to sit on a clean canvas (#82).
        this._forceCleanCanvas();
    }

    // Force xterm's canvas layers back in sync with the buffer. The diff
    // renderer keeps a per-cell cache and only repaints cells whose buffer
    // content changed since the last draw — so a stale glyph (canvas pixel
    // where the buffer is now blank) survives term.refresh(). Clearing the
    // renderer's cache makes every layer forget what it drew, and the follow-up
    // refresh repaints the whole grid from the buffer, wiping the remnant.
    // Cheap here: the terminal is one 154×31 grid.
    _forceCleanCanvas() {
        const term = this._term && this._term.term;
        if (!term) return;
        try {
            const rs = term._core && term._core._renderService;
            if (rs && typeof rs.clear === "function") rs.clear();
            if (typeof term.refresh === "function") term.refresh(0, term.rows - 1);
        } catch (e) {}
    }

    // Kick the handshake / padlock animation off and hand the terminal focus to
    // the passcode box — called once the decrypt-in animation has finished so
    // the animation lines never fight the reveal.
    _startLockAnim() {
        this._boxAnimating = false;
        if (this._lockAnim) clearInterval(this._lockAnim);
        this._lockAnim = setInterval(() => this._lockAnimTick(), 250);
        const t = this._term && this._term.term;
        if (t) { try { t.focus(); } catch (e) {} }
    }

    // Decrypt the lock box in from noise, one random cell at a time (#88). The
    // screensaver's fake code scrolled away (accelerated); the box area starts
    // as a dim blob of random glyphs and the real box "materialises" over it as
    // its cells reveal in a shuffled order — the reverse of the garble-out that
    // plays when the lock times out. Revealed cells carry the SGR that produced
    // them, so the box keeps its colours while it assembles.
    _garbleBoxIn() {
        const frame = this;
        const term = this._term && this._term.term;
        const W = this._lockW || 54;
        const left = this._lockLeftPad || 0;
        const top = this._boxTop || 1;
        const rows = this._buildBoxRows(false);
        const H = rows.length;
        const finish = () => { this._forceCleanCanvas(); this._startLockAnim(); };
        if (!term) { finish(); return; }
        try {
            // parse each row into per-cell { ch, sgr } so revealed cells keep colour
            const parse = s => {
                const cells = [];
                let sgr = "";
                const re = /\x1b\[([0-9;]*)m/g;
                let last = 0, m;
                while ((m = re.exec(s))) {
                    for (const ch of s.slice(last, m.index)) cells.push({ ch, sgr });
                    sgr = "\x1b[" + m[1] + "m";
                    last = m.index + m[0].length;
                }
                for (const ch of s.slice(last)) cells.push({ ch, sgr });
                return cells;
            };
            const grid = rows.map(parse);
            const glyphs = "▓▒░#%&+=<>*$@";
            // shuffled order for every box cell — reused by both phases
            const cells = [];
            for (let i = 0; i < H; i++) for (let j = 0; j < W; j++) cells.push([i, j]);
            for (let i = cells.length - 1; i > 0; i--) { const k = Math.floor(Math.random() * (i + 1)); [cells[i], cells[k]] = [cells[k], cells[i]]; }
            // Phase 1 — the static POPULATES gradually instead of painting the
            // whole band at once: it starts with a few dim glyphs and the per-tick
            // batch grows, so the box "fills with noise" from few to many (#95).
            let noiseIdx = 0;
            let batch = 3; // sparse start: 3 glyphs on the first tick
            const noiseTick = () => {
                if (!frame.active) return;
                const end = Math.min(noiseIdx + batch, cells.length);
                for (; noiseIdx < end; noiseIdx++) {
                    const [i, j] = cells[noiseIdx];
                    frame._w(`\x1b[${top + i};${left + 1 + j}H` + "\x1b[2m" + glyphs[Math.floor(Math.random() * glyphs.length)] + "\x1b[0m");
                }
                batch = Math.min(batch + 3, 110); // density ramps up toward full static
                if (noiseIdx < cells.length) setTimeout(noiseTick, 28);
                else reveal();
            };
            // Phase 2 — the real box cells "materialise" over the noise, one
            // random cell at a time, keeping their colours (the reverse of the
            // garble-out that plays when the lock times out / is unlocked).
            let idx = 0;
            const reveal = () => {
                if (!frame.active) return;
                const end = Math.min(idx + 40, cells.length);
                for (; idx < end; idx++) {
                    const [i, j] = cells[idx];
                    const c = (grid[i] && grid[i][j]) || { ch: " ", sgr: "" };
                    frame._w(`\x1b[${top + i};${left + 1 + j}H` + c.sgr + c.ch + "\x1b[0m");
                }
                if (idx < cells.length) setTimeout(reveal, 28);
                else finish();
            };
            noiseTick();
        } catch (e) { finish(); }
    }

    // Scramble the whole lock box away one random cell at a time (#88). First
    // every cell turns to a random glyph (the box "dissolves"), then the glyphs
    // blank out. cb runs once the box band is empty. Shared by the
    // correct-passcode unlock (#87) and by the 30s-idle timeout back to the
    // screensaver — the "characters randomly disappear one by one" effect.
    _garbleBoxOut(cb) {
        const term = this._term && this._term.term;
        const W = this._lockW || 54;
        const left = this._lockLeftPad || 0;
        const top = this._boxTop || 1;
        const H = this._buildBoxRows(false).length;
        if (!term) { if (cb) cb(); return; }
        if (this._lockAnim) { clearInterval(this._lockAnim); this._lockAnim = null; }
        const glyphs = "▓▒░@#$%&*+=?<>0123456789ABCDEF";
        const cells = [];
        for (let i = 0; i < H; i++) for (let j = 0; j < W; j++) cells.push([i, j]);
        for (let i = cells.length - 1; i > 0; i--) { const k = Math.floor(Math.random() * (i + 1)); [cells[i], cells[k]] = [cells[k], cells[i]]; }
        let idx = 0;
        const frame = this;
        const garble = () => {
            if (!frame.active) { if (cb) cb(); return; }
            const end = Math.min(idx + 45, cells.length);
            for (; idx < end; idx++) {
                const [i, j] = cells[idx];
                frame._w(`\x1b[${top + i};${left + 1 + j}H` + "\x1b[2m" + glyphs[Math.floor(Math.random() * glyphs.length)] + "\x1b[0m");
            }
            if (idx < cells.length) setTimeout(garble, 28);
            else { idx = 0; blank(); }
        };
        const blank = () => {
            if (!frame.active) { if (cb) cb(); return; }
            const end = Math.min(idx + 45, cells.length);
            for (; idx < end; idx++) {
                const [i, j] = cells[idx];
                frame._w(`\x1b[${top + i};${left + 1 + j}H` + " ");
            }
            if (idx < cells.length) setTimeout(blank, 22);
            else { frame._forceCleanCanvas(); if (cb) cb(); }
        };
        setTimeout(garble, 120);
    }

    // Rebuild the whole lock box in place (no reset), used to flash the outer
    // frame red and jitter it left/right on a wrong passcode. `off` shifts the
    // box ±1 column; `red` paints the outer frame red; `passMsg` replaces the
    // PASSCODE field with a grant/denied line.
    _redrawBox(off, red, passMsg) {
        const term = this._term && this._term.term;
        if (!term) return;
        const W = this._lockW || 54, leftPad = this._lockLeftPad || 0;
        const top = this._boxTop || 1;
        const col = leftPad + 1 + (off || 0);        // 1-based left border column
        const clearCol = Math.max(1, leftPad - 1);   // wipe the box band + margin
        const rows = this._buildBoxRows(red, passMsg);
        for (let i = 0; i < rows.length; i++) {
            const r = top + i;
            this._w(`\x1b[${r};${clearCol}H` + " ".repeat(W + 4));
            this._w(`\x1b[${r};${col}H` + rows[i]);
        }
        // Same cache/buffer resync as _drawLockBox, so a redraw never leaves a
        // half-erased cell behind either (#82).
        this._forceCleanCanvas();
    }

    // Rewrite one box line in place, keeping both borders intact. (The previous
    // approach cleared to end-of-line with \x1b[K, which erased the right ║ on
    // every animated / typed line.)
    _writeLockLine(row, content) {
        const term = this._term && this._term.term;
        if (!term) return;
        const W = this._lockW || 54, leftPad = this._lockLeftPad || 0;
        const vis = s => String(s).replace(/\x1b\[[0-9;]*m/g, "");
        const pad = s => {
            s = String(s == null ? "" : s);
            return s + " ".repeat(Math.max(0, W - 2 - vis(s).length));
        };
        this._w(`\x1b[${row};${leftPad + 1}H`);
        this._w("║" + pad(content) + "║");
    }

    // Random hex fragment for the animated "handshake" line.
    _randHex() {
        return Array.from({ length: 3 }, () =>
            ("0000" + Math.floor(Math.random() * 0xFFFF).toString(16).toUpperCase()).slice(-4)
        ).join("-");
    }

    // Animate the handshake/checksum line while the lock is up. Rebuilds the
    // whole line so the right border stays closed.
    _lockAnimTick() {
        const term = this._term && this._term.term;
        if (!term || !this.active) return;
        this._animOn = !this._animOn;
        this._writeLockLine(
            this._codeAnimRow,
            "    " + "\x1b[2mhandshake\x1b[0m" + "  "
            + "\x1b[36m" + this._randHex() + "\x1b[0m"
            + "  " + (this._animOn ? "\x1b[1;37m▓\x1b[0m" : " ")
        );
        this._padlockTick();
    }

    // Animate the ASCII padlock's interior only — the 4×5 outline chars are
    // 100% static (no colour pulse, no glyph change), so the frame never
    // flashes. Inside, two moving readouts share the lock's three interior
    // cells:
    //   · hollow body: a rolling 2-char hash with a white "read head" sweeping
    //     left ↔ right across it — the lock is decoding a key fragment
    //   · keyhole: a rotating core that pulses between bright and dim cyan
    _padlockTick() {
        const t = ((this._padTick || 0) + 1);
        this._padTick = t;
        if (t % 2 === 1) {
            const hex = "0123456789ABCDEF";
            this._padFrag = hex[Math.floor(Math.random() * 16)] + hex[Math.floor(Math.random() * 16)];
        }
        const frag = this._padFrag || "00";
        const head = [0, 1, 1, 0][t % 4];            // scan-head position: L R R L
        const w = s => "\x1b[1;37m" + s + "\x1b[0m";  // white = read head on cell
        const ye = s => "\x1b[1;33m" + s + "\x1b[0m"; // yellow = resting hash cell
        const cy = s => "\x1b[1;36m" + s + "\x1b[0m"; // bright cyan
        const cyD = s => "\x1b[36m" + s + "\x1b[0m";  // dim cyan
        const dim = s => "\x1b[2m" + s + "\x1b[0m";
        const c1 = head === 0 ? w(frag[0]) : ye(frag[0]);
        const c2 = head === 1 ? w(frag[1]) : ye(frag[1]);
        // keyhole core rotates while pulsing bright/dim
        const core = t % 2 ? cy(["◉", "◍", "◎", "◍"][t % 4]) : cyD(["◉", "◍", "◎", "◍"][t % 4]);
        const rows = [
            "    ╔══╗",
            "    ║" + c1 + c2 + "║   " + ye("SYSTEM LOCKED"),
            "    ║ " + core + "║   " + dim("ALL LAUNCH PROCEDURES"),
            "    ║══║   " + ye("HAVE BEEN HALTED"),
            "    ╚══╝"
        ];
        for (let i = 0; i < rows.length; i++) this._writeLockLine(this._padRows[i], rows[i]);
    }

    // Redraw the passcode entry — a bright, framed field `[● ● █]` — with both
    // box borders intact.
    _codeRedraw() {
        const term = this._term && this._term.term;
        if (!term) return;
        const dots = "●".repeat(this._codeBuf.length);
        this._writeLockLine(
            this._codeRow,
            "    " + "\x1b[1;37mPASSCODE:\x1b[0m" + "  "
            + "\x1b[1;36m[\x1b[0m"
            + "\x1b[1;33m" + dots + "█\x1b[0m"
            + "\x1b[1;36m]\x1b[0m"
        );
    }

    // Wrong passcode: flash the lock's outer frame red and jitter the whole box
    // left/right a few times, hold "ACCESS DENIED" in the PASSCODE field, then
    // restore the cleared input. The on-screen animation is paused so its lines
    // don't overwrite the red frame mid-flash.
    _codeDenied() {
        const term = this._term && this._term.term;
        if (!term) return;
        // Denied buzz — the audio manager already ships a dedicated denied.wav;
        // the Proxy returns a silent no-op if audio is muted/disabled, so this
        // is safe to fire unconditionally.
        if (window.audioManager) window.audioManager.denied.play();
        clearTimeout(this._shakeTimer);
        if (this._lockAnim) { clearInterval(this._lockAnim); this._lockAnim = null; }
        const steps = [1, -1, 1, -1, 0];
        let i = 0;
        const frame = this;
        const tick = () => {
            if (!frame.active) return;
            frame._redrawBox(steps[i], true);
            i++;
            if (i < steps.length) {
                frame._shakeTimer = setTimeout(tick, 45);
            } else {
                frame._redrawBox(0, true, "ACCESS DENIED");
                frame._shakeTimer = setTimeout(() => {
                    frame._shakeTimer = null;
                    if (!frame.active) return;
                    frame._codeBuf = "";
                    frame._drawLockBox();
                    frame._lockAnim = setInterval(() => frame._lockAnimTick(), 250);
                }, 900);
            }
        };
        tick();
    }

    _codeSubmit() {
        // Unlock in progress — stop the 30s idle timeout so it can't fire
        // mid-garble and race the teardown.
        if (this._idleTimer) { clearInterval(this._idleTimer); this._idleTimer = null; }
        const code = String(window.settings.lockCode || "0000");
        const term = this._term && this._term.term;
        if (this._codeBuf === code) {
            this._codeBuf = "";
            if (window.audioManager) window.audioManager.granted.play();
            window.eventPlay("unlock_ok");
            if (term) this._redrawBox(0, false, "ACCESS GRANTED");
            // Grant animation: the passcode input turns to noise, then the whole
            // box dissolves before the lock is lifted (#87). The pre-lock
            // windows stay hidden until the lock_block has faded out, so they
            // appear after the UI is fully revealed, not over it.
            this._deferRestore = true;
            this._garbleUnlock();
        } else {
            this._codeDenied();
        }
    }

    // Correct passcode in code mode: briefly hold "ACCESS GRANTED", then the
    // lock box's characters scramble away one random cell at a time before
    // hide() drops the lock — the same dissolve the 30s-idle timeout uses, so a
    // successful unlock and a timeout both read as "characters randomly
    // disappear" (#87 / #88).
    _garbleUnlock() {
        const frame = this;
        const term = this._term && this._term.term;
        if (!term || !this.active) { this.hide(); return; }
        // Drop passcode input for the whole grant animation (#87).
        this._boxAnimating = true;
        // Hold "ACCESS GRANTED" ~350 ms, then let the box chars scramble out.
        setTimeout(() => {
            frame._garbleBoxOut(() => {
                frame._w(`\x1b[${frame._boxTop || 1};1H` + " ".repeat((frame._lockW || 54) + 12));
                setTimeout(() => { if (frame.active) frame.hide(); }, 120);
            });
        }, 350);
    }

    // 30s idle timeout (#88): with no passcode typed and no mouse/keyboard
    // activity while the lock is up, hand the screen back to the screensaver —
    // code mode dissolves the box then resumes the fake code, matrix mode fades
    // the passcode panel and lets the (adopted) rain keep falling. The length
    // comes from settings.lockIdleTimeout (seconds), default 30.
    _armIdleTimeout() {
        if (this._idleTimer) clearInterval(this._idleTimer);
        this._idleTimer = setInterval(() => {
            if (!this.active) return;
            const idleMs = (Number(window.settings.lockIdleTimeout) || 30) * 1000;
            const last = (typeof window._lastActivityTime === "function") ? window._lastActivityTime() : Date.now();
            if (Date.now() - last >= idleMs) {
                clearInterval(this._idleTimer);
                this._idleTimer = null;
                // With the screensaver animation disabled the lock can also be
                // reached straight from idle (no screensaver to dismiss); the
                // 30s idle hand-back must then keep the lock up rather than
                // re-awaken a screensaver the user turned off.
                if (window.settings.screensaverEnabled === false) return;
                if (this._mode === "matrix") this._timeoutToScreensaverMatrix();
                else this._timeoutToScreensaverCode();
            }
        }, 1000);
    }

    // Idle timeout, code mode: the box chars scramble away (same dissolve as a
    // successful unlock), then the fake code resumes streaming. Input is dropped
    // for the whole transition.
    _timeoutToScreensaverCode() {
        const frame = this;
        this._boxAnimating = true;
        this._garbleBoxOut(() => {
            frame._teardownLock(false);
            if (window.screensaver && typeof window.screensaver.resumeCode === "function") {
                window.screensaver.resumeCode();
            }
            // The lock hid every open window (_snapshotWindows), but a timeout
            // yields the screen back to the SCREENSAVER, not a real unlock —
            // and the screensaver shows popups. Put the windows back so the
            // resumed fake code has them floating over it again (#162).
            frame._restoreWindows();
        });
    }

    // Idle timeout, matrix mode: the passcode panel fades out, then the rain the
    // lock adopted (or created) is handed back to the screensaver so the
    // waterfall keeps falling where it was, and the lock overlay drops.
    _timeoutToScreensaverMatrix() {
        const frame = this;
        this._boxAnimating = true;
        const panel = document.querySelector("#lock_screen .lock_panel");
        if (panel) panel.classList.add("lock_fade_out");
        setTimeout(() => {
            if (window.screensaver && typeof window.screensaver.returnMatrixRain === "function" && frame._canvas) {
                window.screensaver.returnMatrixRain(frame._canvas, frame._drops);
            }
            frame._teardownLock(false);
            // Same as the code path: the timeout hands the screen back to the
            // screensaver, which shows popups — restore what the lock hid.
            frame._restoreWindows();
        }, 430);
    }

    // The on-screen keyboard was forced for the lock; put it back to the user's
    // setting (hidden → remove it, shown → keep it) so the DATA window returns
    // to its original display.
    _restoreKeyboard() {
        const kbLayer = document.getElementById("keyboard_layer");
        if (kbLayer) kbLayer.style.zIndex = "";
        if (window.keyboard) window.keyboard.echoPhysical = true;
        if (this._keyboardForced && !window.settings.showKeyboard) {
            if (window.destroyKeyboard) window.destroyKeyboard();
        }
        this._keyboardForced = false;
    }

    // ---- matrix mode: fullscreen matrix rain + passcode, boot on unlock ----
    _showFullscreen() {
        const el = document.createElement("div");
        el.id = "lock_screen";
        const digits = this._shuffled();
        el.innerHTML = `
            <div class="lock_panel">
                <div class="lock_title">SYSTEM LOCKED</div>
                <div class="lock_sub">ENTER PIN TO RESUME</div>
                <input id="lock_pass" type="password" inputmode="numeric" pattern="[0-9]*"
                       autocomplete="off" maxlength="16">
                <div class="lock_keypad">
                    ${digits.slice(0, 9).map(d => `<button class="lock_key" data-d="${d}" onclick="window.lockScreen.keypadPress(${d})">${d}</button>`).join("")}
                    <button class="lock_key lock_key_fn" onclick="window.lockScreen.keypadPress(-1)">⌫</button>
                    <button class="lock_key" data-d="${digits[9]}" onclick="window.lockScreen.keypadPress(${digits[9]})">${digits[9]}</button>
                    <button class="lock_key lock_key_fn" onclick="window.lockScreen.unlock()">↵</button>
                </div>
                <button id="lock_unlock" onclick="window.lockScreen.unlock()">UNLOCK</button>
                <div class="lock_err" id="lock_err"></div>
            </div>`;
        document.body.appendChild(el);
        // When the lock is raised straight from the running Matrix screensaver,
        // adopt its canvas + drop state so the waterfall keeps falling where it
        // was instead of restarting fresh (#86). Adoption stops the screensaver's
        // own draw timer (see adoptMatrixRain — it is closure-bound to the module
        // canvas/ctx that get reset on adoption), so the lock drives the adopted
        // canvas with its own _startMatrix()/this._matrixTimer; hide() stops it.
        const adopted = window.screensaver && typeof window.screensaver.adoptMatrixRain === "function"
            ? window.screensaver.adoptMatrixRain() : null;
        if (adopted) {
            this._canvas = adopted.canvas;
            this._ctx = adopted.ctx;
            this._drops = adopted.drops;
            this._cols = adopted.cols;
            this._grid = adopted.GRID;
            // adoptMatrixRain clears the module's draw interval and hands over
            // no timer (#177): _drawMatrix uses this._ctx (null-guarded), so the
            // lock resumes drawing the same waterfall at its own 40ms cadence.
            // this._matrixTimer = adopted.mTimer is always null here.
            this._matrixTimer = adopted.mTimer;
            if (!this._matrixTimer) this._startMatrix();
            // The canvas was appended to <body> by the screensaver (position:
            // fixed, z 9999). Move it inside the lock so it sits above the
            // lock's own dot-grid background but under the passcode panel.
            el.insertBefore(adopted.canvas, el.firstChild);
            adopted.canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;z-index:1;background:#05080d;";
        } else {
            const cv = document.createElement("canvas");
            cv.id = "lock_canvas";
            el.insertBefore(cv, el.firstChild);
            this._canvas = cv;
            this._ctx = cv.getContext("2d");
            this._resize();
            window.addEventListener("resize", this._resizeBound = () => this._resize());
            this._startMatrix();
        }
        const input = el.querySelector("#lock_pass");
        input.focus();
        input.onkeydown = e => { if (e.key === "Enter") this.unlock(); };
        this._bindDomKeyCapture();
        this._focusRet = setInterval(() => {
            if (this.active && document.activeElement !== input) input.focus();
        }, 500);
        // 30s idle timeout: if no passcode is typed and the computer is left
        // untouched, hand back to the screensaver (#88). Only for the lock raised
        // from the screensaver — the boot lock has no screensaver to return to.
        this._armIdleTimeout();
    }

    // ---- boot-time lock: always Matrix-style, never touches the terminal ----
    // At boot the desktop must not show its real face before the passcode is
    // entered, so the boot lock is the Matrix-style fullscreen overlay REGARDLESS
    // of the user's screensaverStyle setting (#60). Drawing the code-mode box
    // into the real terminal let the shell's real prompt bleed in below it, so
    // the boot lock never goes near the terminal — it is an opaque overlay, and
    // the (fake) UI simply lives underneath. The matrix rain is omitted: just
    // the passcode panel on a dark screen. Because the rain timer never starts,
    // this._matrixTimer stays null, which makes unlock() skip the replay-boot
    // animation (the boot animation has already played by the time this lock
    // appears).
    bootShow() {
        if (this.active) return;
        if (window.cursorTrap) window.cursorTrap.hide();
        this.active = true;
        this._pushLockState();
        this._buildBootLock();
        // Boot lock reads as the last line of the boot log scrolling up: roll
        // the passcode panel in from the bottom and let it settle centre-screen
        // (see .lock_panel.lock_roll_in in browser.css).
        const panel = document.querySelector("#lock_screen .lock_panel");
        if (panel) panel.classList.add("lock_roll_in");
        if (window.cover) window.cover.set(true);
    }

    _buildBootLock() {
        const el = document.createElement("div");
        el.id = "lock_screen";
        const digits = this._shuffled();
        el.innerHTML = `
            <div class="lock_panel">
                <div class="lock_title">SYSTEM LOCKED</div>
                <input id="lock_pass" type="password" inputmode="numeric" pattern="[0-9]*"
                       autocomplete="off" maxlength="16">
                <div class="lock_keypad">
                    ${digits.slice(0, 9).map(d => `<button class="lock_key" data-d="${d}" onclick="window.lockScreen.keypadPress(${d})">${d}</button>`).join("")}
                    <button class="lock_key lock_key_fn" onclick="window.lockScreen.keypadPress(-1)">⌫</button>
                    <button class="lock_key" data-d="${digits[9]}" onclick="window.lockScreen.keypadPress(${digits[9]})">${digits[9]}</button>
                    <button class="lock_key lock_key_fn" onclick="window.lockScreen.unlock()">↵</button>
                </div>
                <div class="lock_err" id="lock_err"></div>
            </div>`;
        document.body.appendChild(el);
        const input = el.querySelector("#lock_pass");
        input.focus();
        input.onkeydown = e => { if (e.key === "Enter") this.unlock(); };
        this._bindDomKeyCapture();
        this._focusRet = setInterval(() => {
            if (this.active && document.activeElement !== input) input.focus();
        }, 500);
    }

    // Physical keyboard must work the instant the lock appears. A focus race on
    // boot (the freshly-created <input> not yet the activeElement, or the window
    // settling) made the first keystrokes drop, then replay a beat later. Capture
    // keydowns in the capture phase and route them straight into the keypad/unlock
    // path so input never depends on `document.activeElement`. Guard `_term` so it
    // stays inert for the terminal (code) lock, which routes keys via the pty.
    _bindDomKeyCapture() {
        if (this._domKeyH) return;
        this._domKeyH = e => {
            if (!this.active || this._term) return;
            if (e.ctrlKey || e.metaKey || e.altKey) return;
            if (/^[0-9]$/.test(e.key))              { e.preventDefault(); e.stopPropagation(); this.keypadPress(Number(e.key)); }
            else if (e.key === "Backspace")         { e.preventDefault(); e.stopPropagation(); this.keypadPress(-1); }
            else if (e.key === "Enter")             { e.preventDefault(); e.stopPropagation(); this.unlock(); }
        };
        document.addEventListener("keydown", this._domKeyH, true);
    }

    unlock() {
        // Drop any input while the box is mid-transition (garbling in/out,
        // welcome-back greeting) — unlocking then would double-run hide().
        if (this._boxAnimating) return;
        const input = document.getElementById("lock_pass");
        if (!input) return;
        const code = String(window.settings.lockCode || "0000");
        const err = document.getElementById("lock_err");
        if (input.value === code) {
            // #182 开机解锁只留欢迎词:boot 锁(此锁经 bootLockThenRun 队列,_onUnlocked
            // 直到下方 1200 行才消费)解锁瞬间跳过 granted + unlock_ok——它们同毫秒叠加,
            // 1.5s 后 welcomeBack 还会播 boot_welcome 欢迎词,granted 在 boot 动画也已
            // 播过一次。会话内重新上锁(Win+L / 屏保)再解开时 _onUnlocked 为空,照常播。
            // #190 矩阵锁会话内解锁:语音换成开机问候音频 boot_welcome(与开机 Welcome
            // 同一段人声,非 TTS);code 锁屏保持 unlock_ok 不变。开机锁(_onUnlocked
            // 非空)整块跳过,initUI 下方会播同一段 boot_welcome,不会重复。
            const matrix = this._matrixTimer !== null;
            if (!this._onUnlocked) {
                if (window.audioManager) window.audioManager.granted.play();
                if (matrix) window.eventPlay("boot_welcome");
                else window.eventPlay("unlock_ok");
            }
            // No longer need the 30s idle timeout once the passcode matches.
            if (this._idleTimer) { clearInterval(this._idleTimer); this._idleTimer = null; }
            // CRT-TV power-off after the boot/matrix lock clears. It is a
            // parallel overlay — replayBoot()/initUI() below keep running at
            // their normal pace underneath, so the password→welcome-back time
            // is unchanged. The code-mode lock (_codeSubmit) never reaches here.
            if (typeof window.playCrtShutdown === "function") window.playCrtShutdown();
            // The Matrix lock always replays the welcome-back + desktop entrance
            // on unlock (the old "boot animation after unlock" toggle was
            // removed — this is now fixed behaviour, and it is what lets the
            // pre-lock windows appear only after the UI has loaded).
            if (matrix && typeof window.welcomeBack === "function") {
                try {
                    // The greeting is shown over a dark overlay; only once it has
                    // faded does the real UI start LOADING (its entrance
                    // animation) — the same order as a fresh boot (#81). The lock
                    // itself (and its cover→real-file listing) is also deferred
                    // until the greeting is gone, so the file-browser reload
                    // sound only plays AFTER welcome-back has appeared AND faded
                    // (#90).
                    this._boxAnimating = true;
                    // Keep the pre-lock windows hidden while the UI loads: put
                    // them back only once the entrance (reRevealUI) has finished,
                    // so a settings menu that was open before the lock does not
                    // pop up before — or over — the desktop.
                    this._deferRestore = true;
                    window.welcomeBack(() => {
                        this.hide();
                        // Matrix lock is a fullscreen overlay — there is no
                        // fake-UI lock underneath to stay continuous with, so
                        // release the cover right away: the "loading" entrance
                        // below then animates the REAL panels (tabs / files /
                        // procs) instead of the fake ones. The code lock keeps
                        // its cover until the restore — its dim overlay IS the
                        // fake-UI look the user asked to preserve.
                        if (window.cover) window.cover.set(false);
                        if (typeof window.reRevealUI === "function") {
                            window.reRevealUI(() => this._flushDeferredRestore());
                        } else {
                            this._flushDeferredRestore();
                        }
                    });
                } catch (e) { this.hide(); this._flushDeferredRestore(); }
            } else {
                this.hide();
            }
            // Boot-time lock unlock (queued via bootLockThenRun): the desktop
            // build is deferred until now — run the continuation (initUI), which
            // plays the welcome greeting and then assembles the real desktop.
            if (this._onUnlocked) {
                const cb = this._onUnlocked;
                this._onUnlocked = null;
                cb();
            }
        } else {
            input.value = "";
            if (window.audioManager) window.audioManager.denied.play();
            if (err) err.textContent = "ACCESS DENIED";
            input.classList.remove("shake");
            void input.offsetWidth;
            input.classList.add("shake");
            setTimeout(() => input.classList.remove("shake"), 400);
        }
    }

    // Numeric keypad: press a digit (d>=0) appends it, d=-1 backspaces.
    keypadPress(d) {
        // Drop keypad taps while the box is mid-transition (#88).
        if (this._boxAnimating) return;
        const input = document.getElementById("lock_pass");
        if (!input || !this.active) return;
        if (d === -1) {
            input.value = input.value.slice(0, -1);
        } else if (input.value.length < 16) {
            input.value += String(d);
        }
        const err = document.getElementById("lock_err");
        if (err) err.textContent = "";
        input.focus();
    }

    // Shuffled 0-9 for the scrambled keypad (a fresh order each lock).
    _shuffled() {
        const arr = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    }

    /* ---- matrix-rain canvas ---- */
    _resize() {
        if (!this._canvas) return;
        this._canvas.width = window.innerWidth;
        this._canvas.height = window.innerHeight;
        const GRID = 22;
        this._grid = GRID;
        this._cols = Math.floor(this._canvas.width / GRID);
        this._drops = Array.from({ length: this._cols }, () => Math.floor(Math.random() * -this._canvas.height / GRID));
    }

    _startMatrix() {
        this._matrixTimer = setInterval(() => this._drawMatrix(), 40);
    }

    _drawMatrix() {
        const ctx = this._ctx, w = this._canvas.width, h = this._canvas.height;
        if (!ctx) return;
        ctx.fillStyle = "rgba(5, 8, 13, 0.08)";
        ctx.fillRect(0, 0, w, h);
        ctx.font = (this._grid - 3) + "px 'Fira Mono', monospace";
        const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#$%&@アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホ";
        for (let i = 0; i < this._drops.length; i++) {
            if (this._drops[i] < -10000) continue;
            const ch = CHARS[Math.floor(Math.random() * CHARS.length)];
            ctx.fillStyle = "rgb(" + window.theme.r + "," + window.theme.g + "," + window.theme.b + ")";
            ctx.fillText(ch, i * this._grid, this._drops[i] * this._grid);
            if (this._drops[i] * this._grid > h + 30) {
                if (Math.random() > 0.975) this._drops[i] = 0;
            }
            this._drops[i]++;
        }
    }
}

module.exports = { LockScreen };
