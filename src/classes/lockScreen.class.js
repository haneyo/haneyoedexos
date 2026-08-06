// LockScreen — two sci-fi lock modes that follow screensaverStyle:
//   "code"   → a command-line passcode prompt shown over the terminal area.
//              A full-screen overlay blocks every other control (only the clock
//              stays interactive for power options). Entering the passcode is
//              the only way back.
//   "matrix" → the original fullscreen matrix-rain canvas + passcode panel.
//              Unlocking plays the eDEX startup animation (replayBoot).
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
            // The CLOCK & POWER menu is transient — locking from it (its Lock
            // Screen button) must not bring it back on unlock. Hide it like
            // everything else, but leave it out of the restore list.
            if (window.modals[id] && window.modals[id].title === "CLOCK & POWER") {
                el.style.display = "none";
                return;
            }
            this._hiddenModals.push(id);
            el.style.display = "none";
        });
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
            if (!m || m.title !== "CLOCK & POWER") return;
            const el = document.getElementById("modal_" + id);
            if (el) el.remove();
            if (typeof m.onclose === "function") { try { m.onclose(); } catch (e) {} }
            delete window.modals[id];
        });
    }

    show() {
        if (this.active) {
            // Already locked but the cover identity was lost (e.g. a screensaver
            // was dismissed while the lock was up) — re-assert it.
            if (window.cover && !window.cover.isActive()) window.cover.set(true);
            return;
        }
        // Remember where the user was: the tab they were on and every window
        // they had open. The lock itself runs on tab 0 and hides those windows,
        // and unlock must put everything back exactly as it was.
        this._prevTerm = window.currentTerm;
        this._snapshotWindows();
        this.active = true;
        const style = window.settings.screensaverStyle || "code";
        if (style === "matrix") this._showFullscreen();
        else this._showTerminalLock();
        // While locked, eDEX wears its cover identity (fake tabs / filesystem /
        // IP / process list) — a launch device doesn't show real data.
        if (window.cover) window.cover.set(true);
    }

    hide() {
        if (!this.active) return;
        this.active = false;
        clearInterval(this._timer);
        clearInterval(this._focusRet);
        clearInterval(this._matrixTimer);
        clearInterval(this._lockAnim);
        this._lockAnim = null;
        clearTimeout(this._shakeTimer);
        this._shakeTimer = null;
        const clock = document.getElementById("mod_clock");
        if (clock) {
            clock.style.zIndex = "";
            clock.style.position = this._origClockPos || "";
        }
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
        // restore the terminal's pty send (physical keys + virtual keyboard both
        // flowed through it while locked), reset the display and show the cursor
        if (this._term) {
            try {
                if (this._origSend) this._term.socket.send = this._origSend;
                if (this._term.term) {
                    this._term.term.reset();
                    this._term.term.write("\x1b[?25h");
                }
            } catch (e) {}
        }
        this._term = null;
        // restore the virtual keyboard to the user's setting
        this._restoreKeyboard();
        const el = document.getElementById("lock_screen");
        if (el) el.remove();
        const block = document.getElementById("lock_block");
        if (block) block.remove();
        this._canvas = null; this._ctx = null;
        // Put back every window that was open before the lock (settings editor,
        // CLOCK & POWER, …) in its exact spot — the lock only hid them.
        this._restoreWindows();
        // Leave cover mode: restore the real tabs / filesystem / IP / procs.
        if (window.cover) window.cover.set(false);
        // Return to the tab the user was on before the lock. The lock ran on
        // tab 0, so currentTerm differs whenever the user was elsewhere; leave
        // it alone otherwise (matrix mode never switched tabs).
        if (this._prevTerm != null && this._prevTerm !== window.currentTerm) {
            try { if (window.focusShellTab) window.focusShellTab(this._prevTerm); } catch (e) {}
        }
        this._prevTerm = null;
        try { if (window.term && window.term[window.currentTerm]) window.term[window.currentTerm].term.focus(); } catch (e) {}
    }

    // ---- code mode: the lock is drawn entirely by the real terminal ----
    _showTerminalLock() {
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

        // Switch to the main terminal and draw the command-line lock UI in it.
        if (window.focusShellTab) window.focusShellTab(0);
        const t = window.term[0];
        this._term = t;
        this._codeBuf = "";
        if (t) {
            try {
                // Intercept every keystroke that would reach the shell — physical
                // keyboard (xterm onData → socket.send) and the virtual keyboard
                // (term.write → socket.send) both land here while locked.
                this._origSend = t.socket.send.bind(t.socket);
                t.socket.send = data => this._termKey(data);
                this._drawLockBox();
                if (this._lockAnim) clearInterval(this._lockAnim);
                this._lockAnim = setInterval(() => this._lockAnimTick(), 250);
                t.term.focus();
            } catch (e) {}
        }
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
    }

    // Any input typed during the lock (from either input path) lands here.
    _termKey(data) {
        if (!this.active) return;
        const s = String(data == null ? "" : data);
        for (const ch of s) {
            if (ch === "\r" || ch === "\n") { this._codeSubmit(); return; }
            else if (ch === "\x7f" || ch === "\b") { this._codeBuf = this._codeBuf.slice(0, -1); this._codeRedraw(); }
            else if (ch >= " " && ch !== "\x1b") { this._codeBuf += ch; this._codeRedraw(); }
        }
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

    // Draw the sci-fi lock banner centered in the terminal window.
    _drawLockBox() {
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
        for (let i = 0; i < topPad; i++) term.write("\r\n");
        L.forEach(l => term.write(" ".repeat(leftPad) + l + "\r\n"));
        // passcode input sits on the "    PASSCODE:  " line (0-based 16)
        this._codeRow = topPad + 17;   // 1-based row
        this._codeCol = leftPad + 17;  // 1-based col after "    PASSCODE:  "
        // animated handshake line (0-based 18)
        this._codeAnimRow = topPad + 19;   // 1-based row
        this._codeAnimCol = leftPad + 17;  // 1-based col where the hex starts
        // ASCII padlock lines (L indices 6..10 → 1-based rows), swept by the
        // scan animation in _padlockTick.
        this._padRows = [7, 8, 9, 10, 11].map(n => topPad + n);
        // draw the passcode input through the same in-place line writer so the
        // framed entry (and its right border) matches what typing redraws
        this._codeRedraw();
        // Hide the xterm cursor: every in-place line write leaves it sitting
        // right after the box's right border, where it would blink visibly.
        term.write("\x1b[?25l");
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
            term.write(`\x1b[${r};${clearCol}H` + " ".repeat(W + 4));
            term.write(`\x1b[${r};${col}H` + rows[i]);
        }
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
        term.write(`\x1b[${row};${leftPad + 1}H`);
        term.write("║" + pad(content) + "║");
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
        const code = String(window.settings.lockCode || "0000");
        const term = this._term && this._term.term;
        if (this._codeBuf === code) {
            this._codeBuf = "";
            if (window.audioManager) window.audioManager.granted.play();
            if (term) this._redrawBox(0, false, "ACCESS GRANTED");
            setTimeout(() => this.hide(), 500);
        } else {
            this._codeDenied();
        }
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
            <canvas id="lock_canvas"></canvas>
            <div class="lock_panel">
                <div class="lock_title">SYSTEM LOCKED</div>
                <div class="lock_sub">ENTER PIN TO RESUME</div>
                <input id="lock_pass" type="password" inputmode="numeric" pattern="[0-9]*"
                       autocomplete="off" maxlength="16" placeholder="····">
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
        this._canvas = el.querySelector("#lock_canvas");
        this._ctx = this._canvas.getContext("2d");
        this._resize();
        window.addEventListener("resize", this._resizeBound = () => this._resize());
        this._startMatrix();
        const input = el.querySelector("#lock_pass");
        input.focus();
        input.onkeydown = e => { if (e.key === "Enter") this.unlock(); };
        this._focusRet = setInterval(() => {
            if (this.active && document.activeElement !== input) input.focus();
        }, 500);
    }

    unlock() {
        const input = document.getElementById("lock_pass");
        if (!input) return;
        const code = String(window.settings.lockCode || "0000");
        const err = document.getElementById("lock_err");
        if (input.value === code) {
            if (window.audioManager) window.audioManager.granted.play();
            const matrix = this._matrixTimer !== null;
            this.hide();
            // matrix mode plays the eDEX startup animation after unlock (unless
            // the user disabled "play boot animation" in settings).
            if (matrix && window.settings.bootAnimAfterUnlock !== false && typeof window.replayBoot === "function") {
                setTimeout(() => window.replayBoot(), 300);
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
