// FirstRun — the in-app first-boot setup screen. Runs once, before the desktop
// is built, when the seeded settings.json carries no lockCode yet. It replaces
// the old OS-level xterm wizard (packaging/install/install-edex.sh used to bake
// edex-first-setup.sh and gate it behind /etc/edex-setup-done).
//
// Look: the same fullscreen dot-grid backdrop and centered ASCII terminal box as
// the boot/code lock, but with SETUP copy — "SYSTEM INITIALIZATION · FIRST BOOT",
// "SETUP TERMINAL", status lines, step prompts — never the lock's "SYSTEM
// LOCKED / NUCLEAR ARSENAL / PASSCODE" text. English-only, like the lock.
//
// Steps: interface language → timezone → unlock PIN (set + confirm). On finish it
// writes lockCode / lockOnIdle / language into settings.json (same mechanism the
// settings editor uses) and applies the timezone via `sudo timedatectl` (the
// appliance gives the user passwordless sudo). The screen is keyboard-only:
// digits / letters / Enter / Backspace, with every modifier combo swallowed so
// no global shortcut leaks through (the OS-level shortcuts are additionally
// gated by the "edex-lock-state" IPC this class pushes on show).

class FirstRun {
    constructor(opts = {}) {
        this.active = false;
        this.onDone = opts.onDone || null;
        this._step = 0;            // 0 language, 1 timezone, 2 pin, 3 confirm
        this._input = "";
        this._lang = "en";
        this._tz = "Asia/Shanghai";
        this._pin = "";
        this._err = "";
        this._el = null;
        this._pre = null;
        this._handler = null;
        this._finishTimer = null;
    }

    // ---- DOM -------------------------------------------------------------

    show() {
        if (this.active) return;
        this.active = true;
        // Main-process global hotkeys (Ctrl+Shift+Q/W/O) bypass DOM keydown, so
        // tell the main side we own the screen (see edex-lock-state in _boot.js).
        this._pushLockState(true);
        const el = document.createElement("div");
        el.id = "setup_screen";
        el.innerHTML = '<pre id="setup_box"></pre>';
        document.body.appendChild(el);
        this._el = el;
        this._pre = el.querySelector("#setup_box");
        this._handler = e => this._onKey(e);
        // Capture phase: run before every other keydown listener and swallow the
        // setup keys so none leak into the desktop (none exists yet, but the
        // renderer's OS-level shortcuts are already registered by this point).
        window.addEventListener("keydown", this._handler, true);
        if (window.cursorTrap) window.cursorTrap.hide();
        this._render();
    }

    _remove() {
        if (this._finishTimer) { clearTimeout(this._finishTimer); this._finishTimer = null; }
        if (this._handler) window.removeEventListener("keydown", this._handler, true);
        this._handler = null;
        if (this._el && this._el.parentNode) this._el.parentNode.removeChild(this._el);
        this._el = null;
        this._pre = null;
    }

    _pushLockState(locked) {
        try { require("electron").ipcRenderer.send("edex-lock-state", !!locked); } catch (e) {}
    }

    // ---- ASCII box ---------------------------------------------------------

    _box(lines) {
        const W = 58;
        const rows = [];
        rows.push("╔" + "═".repeat(W) + "╗");
        for (const l of lines) {
            if (typeof l === "string" && (l[0] === "║" || l[0] === "╚")) {
                rows.push(l);          // pre-bordered line (separator)
            } else {
                const s = String(l);
                // Pad to DISPLAY width, not string length: CJK glyphs render two
                // cells but String#length counts one, so padEnd alone would pull
                // the right border 2 columns in on any line containing 中文.
                rows.push("║" + s + " ".repeat(Math.max(0, W - this._visWidth(s))) + "║");
            }
        }
        rows.push("╚" + "═".repeat(W) + "╝");
        return rows.join("\n");
    }

    // Defensive: pad by display width so the right border always lines up. The
    // box is English-only by design (CJK glyphs in a fallback font don't render
    // at a clean multiple of the mono cell, which misaligns the frame — the one
    // time 中文 appeared here it was visibly off), so _visWidth is never hit in
    // practice; it guards against someone reintroducing wide characters.
    _visWidth(s) {
        let w = 0;
        for (const ch of s) {
            w += /[ᄀ-ᇿ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(ch) ? 2 : 1;
        }
        return w;
    }

    _sep() { return "║" + "─".repeat(58) + "║"; }

    _render() {
        if (!this._pre) return;
        const lines = [];
        lines.push("      eDEX-OS · SYSTEM INITIALIZATION · FIRST BOOT");
        lines.push("      SETUP TERMINAL v1.0");
        lines.push(this._sep());
        lines.push("   [ OK ]   root filesystem    ······ mounted");
        lines.push("   [ OK ]   network            ······ probed");
        lines.push("   [WAIT]   operator input     ······ required");
        lines.push(this._sep());
        lines.push("");
        if (this._step === 0) {
            lines.push("   SELECT INTERFACE LANGUAGE (default 1 = English)");
            lines.push("      1) ENGLISH");
            lines.push("      2) CHINESE");
            lines.push("");
            lines.push("      > " + this._cursor());
        } else if (this._step === 1) {
            lines.push("   SELECT TIME ZONE (default 1 = Asia/Shanghai)");
            lines.push("      1) Asia/Shanghai        5) Europe/Berlin");
            lines.push("      2) Asia/Tokyo           6) Europe/London");
            lines.push("      3) Asia/Singapore       7) America/New_York");
            lines.push("      4) Asia/Seoul           8) America/Los_Angeles");
            lines.push("");
            lines.push("      > " + this._cursor());
        } else if (this._step === 2) {
            lines.push("   SET UNLOCK PIN (4-8 DIGITS)");
            lines.push("   This PIN unlocks the screensaver / lock screen.");
            lines.push("");
            lines.push("      > " + this._masked() + "█");
        } else if (this._step === 3) {
            lines.push("   CONFIRM UNLOCK PIN");
            lines.push("");
            lines.push("      > " + this._masked() + "█");
        } else if (this._step === 4) {
            lines.push("   [ OK ]  ACCESS GRANTED - SYSTEM INITIALIZED");
            lines.push("   PIN SAVED · LANGUAGE SET · TIMEZONE APPLIED");
            lines.push("");
            lines.push("   STARTING SYSTEM …");
        }
        if (this._err) {
            lines.push("");
            lines.push("   [!!] " + this._err);
        }
        lines.push("");
        lines.push(this._sep());
        lines.push("   UNAUTHORIZED ACCESS WILL BE PROSECUTED");
        this._pre.textContent = this._box(lines);
    }

    _masked() { return "●".repeat(this._input.length); }
    _cursor() { return this._input + "█"; }

    // ---- keyboard ----------------------------------------------------------

    _onKey(e) {
        // Swallow every modifier combo so no global shortcut leaks into the
        // setup screen. (The OS-level ones are inert via edex-lock-state; this
        // also stops Win+L / Alt / F11 / Ctrl+D / Ctrl+A at the DOM level.)
        if (e.metaKey || e.ctrlKey || e.altKey) {
            e.preventDefault();
            e.stopPropagation();
            return;
        }
        if (e.key === "Enter") {
            e.preventDefault(); e.stopPropagation();
            this._submit();
            return;
        }
        if (e.key === "Backspace") {
            e.preventDefault(); e.stopPropagation();
            this._input = this._input.slice(0, -1);
            this._render();
            return;
        }
        // During the PIN steps only digits are meaningful; elsewhere accept
        // digits / letters / space.
        const isPinStep = this._step === 2 || this._step === 3;
        if (e.key.length === 1 && (isPinStep ? /^\d$/.test(e.key) : /^[\dA-Za-z ]$/.test(e.key))) {
            if (this._input.length < 8) this._input += e.key;
            e.preventDefault(); e.stopPropagation();
            this._render();
            return;
        }
        if (e.key === "Alt" || e.code.startsWith("Alt")) {
            e.preventDefault(); e.stopPropagation();
        }
    }

    _submit() {
        const v = this._input.trim();
        this._err = "";
        if (this._step === 0) {
            if (v === "" || v === "1") { this._lang = "en"; this._advance(); return; }
            if (v === "2") { this._lang = "zh"; this._advance(); return; }
            this._err = "INVALID CHOICE - PRESS 1 OR 2";
            this._input = "";
            this._render();
            return;
        }
        if (this._step === 1) {
            const tzs = ["Asia/Shanghai", "Asia/Tokyo", "Asia/Singapore", "Asia/Seoul",
                         "Europe/Berlin", "Europe/London", "America/New_York", "America/Los_Angeles"];
            const n = v === "" ? 1 : parseInt(v, 10);
            if (n >= 1 && n <= 8) { this._tz = tzs[n - 1]; this._advance(); return; }
            this._err = "INVALID CHOICE - PRESS 1-8";
            this._input = "";
            this._render();
            return;
        }
        if (this._step === 2) {
            if (/^\d{4,8}$/.test(this._input)) { this._pin = this._input; this._advance(); return; }
            this._err = "PIN MUST BE 4-8 DIGITS";
            this._input = "";
            this._render();
            return;
        }
        if (this._step === 3) {
            if (this._input === this._pin) {
                this._input = "";
                this._step = 4;
                this._render();                       // ACCESS GRANTED frame
                this._finishTimer = setTimeout(() => this._finish(), 700);
                return;
            }
            this._err = "PINS DO NOT MATCH - TRY AGAIN";
            this._step = 2;
            this._input = "";
            this._render();
            return;
        }
    }

    _advance() {
        this._input = "";
        this._err = "";
        this._step += 1;
        this._render();
    }

    // ---- finish -------------------------------------------------------------

    _finish() {
        // Persist the PIN + lock behaviour + language, keeping everything else in
        // the settings file (the same write the settings editor uses).
        try {
            window.settings.lockCode = this._pin;
            window.settings.lockOnIdle = true;
            window.settings.language = this._lang;
            const file = window.settingsFile || (typeof settingsFile !== "undefined" ? settingsFile : null);
            if (file) require("fs").writeFileSync(file, JSON.stringify(window.settings, "", 4));
        } catch (e) {}
        // Apply the timezone (the appliance user has passwordless sudo). The value
        // comes from the whitelist above, never raw user input.
        try {
            require("child_process").exec("sudo timedatectl set-timezone " + this._tz, () => {});
        } catch (e) {}
        this.active = false;
        this._remove();
        this._pushLockState(false);
        if (typeof this.onDone === "function") {
            try { this.onDone(); } catch (e) {}
        }
    }
}
