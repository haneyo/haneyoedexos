// LockScreen — the fullscreen sci-fi lock. A streaming-code canvas (reusing the
// screensaver's procedural C++ generator) with a password prompt. Unlocks with
// the configured passcode (settings.lockCode, default "0000").
//
// Entry points: the gear menu's 锁屏 button, Ctrl+Shift+O, or idle when
// settings.lockOnIdle is on. It covers the whole eDEX UI, so "unlock" is the
// only way back.

class LockScreen {
    constructor() {
        this.active = false;
        this._timer = null;
        this._focusRet = null;
        this._canvas = null;
        this._ctx = null;
        this._buffer = [];
    }

    show() {
        if (this.active) return;
        this.active = true;
        const el = document.createElement("div");
        el.id = "lock_screen";
        // Numeric PIN keypad — feature-phone 9-grid (3×3 digits + ⌫/0/↵), digits
        // shuffled each lock so touch users can unlock without a physical keyboard.
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
        this._startStream();
        const input = el.querySelector("#lock_pass");
        input.focus();
        input.onkeydown = e => { if (e.key === "Enter") this.unlock(); };
        // keep focus on the passcode field so typing always lands there
        this._focusRet = setInterval(() => {
            if (this.active && document.activeElement !== input) input.focus();
        }, 500);
    }

    hide() {
        if (!this.active) return;
        this.active = false;
        clearInterval(this._timer);
        clearInterval(this._focusRet);
        const el = document.getElementById("lock_screen");
        if (el) el.remove();
        this._canvas = null; this._ctx = null;
        try { if (window.term && window.term[window.currentTerm]) window.term[window.currentTerm].term.focus(); } catch (e) {}
    }

    unlock() {
        const input = document.getElementById("lock_pass");
        if (!input) return;
        const code = String(window.settings.lockCode || "0000");
        const err = document.getElementById("lock_err");
        if (input.value === code) {
            this.hide();
        } else {
            input.value = "";
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

    _resize() {
        if (!this._canvas) return;
        this._canvas.width = window.innerWidth;
        this._canvas.height = window.innerHeight;
        this._charW = 7.2;                            // 12px Fira Mono ≈ 7.2px/char
        this._charsPerRow = Math.max(60, Math.floor(window.innerWidth / this._charW));
        this._rowH = 22;                              // generous spacing → no overlap
        this._rows = Math.max(6, Math.floor(window.innerHeight / this._rowH));
    }

    _startStream() {
        // ONE continuous ultra-wide stream: every row spans the full screen
        // width (built from concatenated code fragments), so there are no
        // columns and no empty right strip. Slower scroll + strong fade keeps
        // the trail clean instead of overlapping.
        this._rowsArr = [];
        for (let i = 0; i < this._rows; i++) this._rowsArr.push(this._fullRow());
        this._timer = setInterval(() => this._draw(), 130);
    }

    _genLine(maxLen) {
        let line = "";
        if (window.screensaver && typeof window.screensaver.getCodeLine === "function") {
            line = window.screensaver.getCodeLine();
        } else {
            line = "    result += state_vector * " + (0.1 + Math.random()).toFixed(4) + ";";
        }
        const short = String(line).replace(/\s+/g, " ").trim();
        return short.length > maxLen ? short.slice(0, maxLen) : short;
    }

    // Build one row that fills the whole width with code fragments.
    _fullRow() {
        const target = this._charsPerRow;
        let s = "";
        while (s.length < target) {
            s += this._genLine(180);
            if (s.length < target) s += "   ";
        }
        return s.slice(0, target);
    }

    _draw() {
        const ctx = this._ctx, w = this._canvas.width, h = this._canvas.height;
        if (!ctx) return;
        // SOLID clear every frame: no persistence, so rows can never overlap.
        // Depth comes from a position-based brightness gradient instead.
        ctx.fillStyle = "#05080d";
        ctx.fillRect(0, 0, w, h);
        ctx.font = "12px 'Fira Mono', monospace";
        const r = window.theme.r, g = window.theme.g, b = window.theme.b;
        this._rowsArr.push(this._fullRow());
        if (this._rowsArr.length > this._rows) this._rowsArr.shift();
        const startY = h - 18;
        for (let i = 0; i < this._rowsArr.length; i++) {
            const y = startY - i * this._rowH;
            if (y < -14) break;
            // Newest rows (bottom) are bright; older rows dim out smoothly.
            const alpha = 0.14 + 0.86 * Math.pow(i / this._rowsArr.length, 1.5);
            ctx.fillStyle = "rgba(" + r + "," + g + "," + b + "," + alpha + ")";
            ctx.fillText(this._rowsArr[i], 8, y);
        }
    }
}

module.exports = { LockScreen };
