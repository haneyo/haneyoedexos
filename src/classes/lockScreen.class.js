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
        el.innerHTML = `
            <canvas id="lock_canvas"></canvas>
            <div class="lock_panel">
                <div class="lock_title">SYSTEM LOCKED</div>
                <div class="lock_sub">ENTER PASSCODE TO RESUME</div>
                <input id="lock_pass" type="password" autocomplete="off" maxlength="64" placeholder="····">
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

    _resize() {
        if (!this._canvas) return;
        this._canvas.width = window.innerWidth;
        this._canvas.height = window.innerHeight;
        this._charW = 7.8;                            // 13px Fira Mono ≈ 7.8px/char
        this._charsPerRow = Math.max(60, Math.floor(window.innerWidth / this._charW));
        this._rows = Math.max(6, Math.floor(window.innerHeight / 18));
    }

    _startStream() {
        // ONE continuous ultra-wide stream: every row spans the full screen
        // width (built from concatenated code fragments), so there are no
        // columns and no empty right strip.
        this._rowsArr = [];
        for (let i = 0; i < this._rows; i++) this._rowsArr.push(this._fullRow());
        this._timer = setInterval(() => this._draw(), 90);
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
        ctx.fillStyle = "rgba(5, 8, 13, 0.16)";
        ctx.fillRect(0, 0, w, h);
        ctx.font = "13px 'Fira Mono', monospace";
        const r = window.theme.r, g = window.theme.g, b = window.theme.b;
        this._rowsArr.push(this._fullRow());
        if (this._rowsArr.length > this._rows) this._rowsArr.shift();
        const startY = h - 20;
        for (let i = 0; i < this._rowsArr.length; i++) {
            const y = startY - i * 18;
            if (y < -12) break;
            const alpha = 0.10 + 0.85 * (i / this._rowsArr.length);
            ctx.fillStyle = "rgba(" + r + "," + g + "," + b + "," + alpha + ")";
            ctx.fillText(this._rowsArr[i], 8, y);
        }
    }
}

module.exports = { LockScreen };
