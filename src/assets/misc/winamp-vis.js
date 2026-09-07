// Winamp-style falling-peak spectrum, ported from cliamp's VisClassicLED /
// VisClassicPeak drivers (https://github.com/bjarneo/cliamp, MIT). The look
// that made Winamp's equalizer iconic is really two things the old eDEX bar
// loop skipped:
//
//   1. a bar BODY that rises instantly (fast attack) and settles a frame at a
//      time (slow decay) instead of drawing the raw FFT sample;
//   2. a per-bar PEAK CAP that jumps to the body's high-water mark, holds there
//      briefly, then falls at a constant rate — the little bright caps slowly
//      sinking above the bars.
//
// The rates below match cliamp's classicLED constants (rise 60, fall 16, hold
// 0.45 s, fall-rate 0.55 /s). Each of the two players instantiates one of these
// and feeds it per-bar targets each frame; it keeps the per-bar smoothing/peak
// state across frames so the animation glides between FFT samples.
//
// Targets are normalized [0,1] per bar — the MediaPlayer passes real FFT bytes
// (/255), the mini music widget passes a generated pseudo-spectrum (the system
// player's audio is not sample-accessible from here).

class WinampVis {
    constructor() {
        this.body = null;  // smoothed bar height per bar,   0..1
        this.peak = null;  // falling peak cap position     0..1 (>= body)
        this.hold = null;  // seconds of apex hold remaining per bar
        this.last = null;  // last tick time (ms) for dt
        // fast attack / slow decay (classicLEDRiseRate / FallRate)
        this.rise = 60;
        this.fall = 16;
        // peak cap: hold at apex, then fall at constant normalized units/s.
        this.peakHold = 0.45;
        this.peakFall = 0.55;
    }

    _ensure(n) {
        if (this.body && this.body.length === n) return;
        this.body = new Float32Array(n);
        this.peak = new Float32Array(n);
        this.hold = new Float32Array(n);
    }

    _clamp(dt) {
        if (!(dt > 0)) return 1 / 60;
        if (dt > 0.1) return 1 / 30;      // long gaps step like ~1 frame
        return dt;
    }

    // Advance the simulation one frame toward `targets` (0..1 per bar).
    tick(targets, nowMs) {
        const n = targets.length;
        this._ensure(n);
        const now = nowMs / 1000;
        let dt = this.last === null ? 0 : now - this.last;
        this.last = now;
        dt = this._clamp(dt);
        for (let i = 0; i < n; i++) {
            const t = targets[i];
            const b = this.body[i];
            const rate = t > b ? this.rise : this.fall;      // attack vs decay
            this.body[i] = b + (t - b) * (1 - Math.exp(-rate * dt));
            const nb = this.body[i];
            if (nb >= this.peak[i]) { this.peak[i] = nb; this.hold[i] = this.peakHold; }
            else if (this.hold[i] > 0) this.hold[i] = Math.max(0, this.hold[i] - dt);
            else this.peak[i] = Math.max(nb, this.peak[i] - this.peakFall * dt);
        }
    }

    // Draw the bars + falling peak caps into `ctx`. `cr/cg/cb` is the theme RGB
    // (bar body); the cap is a lightened version so it reads as a distinct
    // "peak" marker above the bar, exactly like the Winamp LED matrix.
    _light(c) { return Math.min(255, Math.round(c * 0.6 + 255 * 0.4)); }

    draw(ctx, w, h, cr, cg, cb) {
        if (!this.body || !this.body.length) return;
        const bars = this.body.length;
        const bw = w / bars;
        const r2 = this._light(cr), g2 = this._light(cg), b2 = this._light(cb);
        const capH = Math.max(1.5, h * 0.02);
        const minGap = 0.5 / h;
        for (let i = 0; i < bars; i++) {
            const bx = i * bw + bw * 0.2;
            const barW = bw * 0.6;
            const b = this.body[i];
            const bh = Math.max(2, b * h);
            ctx.fillStyle = `rgba(${cr}, ${cg}, ${cb}, ${0.35 + 0.65 * b})`;
            ctx.fillRect(bx, h - bh, barW, bh);
            // Only render the cap when it sits clearly above the body (cliamp's
            // showPeak). It merges with the bar otherwise.
            const p = this.peak[i];
            if (p > b + minGap) {
                const py = h - p * h;
                ctx.fillStyle = `rgba(${r2}, ${g2}, ${b2}, 0.95)`;
                ctx.fillRect(bx, py, barW, capH);
            }
        }
    }
}

module.exports = { WinampVis };
