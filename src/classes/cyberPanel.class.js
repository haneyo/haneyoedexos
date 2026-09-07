// Cyber Core Radar & Data Panel.
//
// Replaces the removed on-screen keyboard with a left-right split HUD:
//   - Right: square holographic radar sweep (thin glowing lines, rotating beam,
//     fading contacts, pulse waves).
//   - Left: a real disk read/write I/O waveform canvas + 4 tech progress bars
//     (CPU/MEM/DSK/NET) + a single-line auto-scrolling tech log.
//
// Everything is drawn against the active theme (--color_r/g/b) so it blends
// seamlessly with the rest of eDEX-UI.

// Heavy disk I/O threshold (total read+write, MB/s) that flashes the waveform
// red. Tunable per machine — a busy laptop HDD sustains ~50-120MB/s, SSDs far
// more, so raise it if the flash trips too often.
const DSK_OVERLOAD_MB = 50;

class CyberPanel {
    constructor(opts) {
        if (!opts || !opts.container) throw "Missing options";

        this.parent = document.getElementById(opts.container);
        this._buildDOM();

        // Theme color (RGB components) for canvas drawing. Cached once up front
        // (a theme switch reloads the renderer, so this re-runs) instead of being
        // read via getComputedStyle().getPropertyValue() on every draw — that
        // forced a style/layout recalculation dozens of times per frame inside
        // the radar/waveform hot loop, the main source of per-frame jank.
        this._tr = (window.theme && window.theme.r != null) ? window.theme.r : 0;
        this._tg = (window.theme && window.theme.g != null) ? window.theme.g : 255;
        this._tb = (window.theme && window.theme.b != null) ? window.theme.b : 255;

        // Radar state
        this.radar = document.getElementById("cyber_radar_canvas");
        this.radarCtx = this.radar.getContext("2d");
        this.radarAngle = 0;
        this.radarPulses = [];   // { r, maxR, alpha, speed }
        this.radarBlips = [];    // { x, y, angle, dist, r, alpha }
        this._pulseCount = 0;
        // Real telemetry readouts (honest labels, every value a real measurement).
        this._radarData = {
            io: document.getElementById("cyber_radar_io"),
            conn: document.getElementById("cyber_radar_conn"),
            wifi: document.getElementById("cyber_radar_wifi"),
            clk: document.getElementById("cyber_radar_clk"),
            load: document.getElementById("cyber_radar_load"),
            temp: document.getElementById("cyber_radar_temp"),
            events: document.getElementById("cyber_radar_events"),
            threat: document.getElementById("cyber_radar_threat")
        };

        // Waveform state — the canvas now plots REAL disk read/write I/O
        // (sampled every 1s) instead of the old decorative sine wave.
        this.wave = document.getElementById("cyber_waveform_canvas");
        this.waveCtx = this.wave.getContext("2d");
        this._dskHist = [];       // [{ r, w }] MB/s samples, newest last
        this._dskScale = 5;       // y-axis peak MB/s (floor keeps idle near centre)
        this._dskOverload = false; // heavy total I/O → waveform lines flash red

        // Metrics (progress bars)
        this.metrics = {cpu: 0, mem: 0, dsk: 0, net: 0};
        this._lastCPU = 0;

        // Real telemetry state (fed by the si proxy cache + the net:hud IPC).
        // All fields are initialized here so _genLogLine() can run before the
        // first poll without throwing.
        this._conns = 0;              // active TCP/UDP connection count (net:hud)
        this._wifiPct = null;         // 0-100, null = wired / no wifi → show --
        this._lastDskOverload = false;// rising edge: heavy disk burst → pulse
        this._lastNetBurst = 0;       // rising edge: network burst → pulse
        this.cpuTemp = null;          // CPU temp °C, null = unavailable
        this.netRxMbps = 0;           // [NET] log line (split from this.netMbps)
        this.netTxMbps = 0;
        this.swapPct = 0;             // [MEM]/[SYS] log line
        this._topProc = null;         // { name, cpu, mem } — [PROC] log line
        this._battery = null;         // { pct, charging } or null

        // Log (multi-line, code-like stream — every line is now real data)
        this.logLines = document.getElementById("cyber_log_lines");
        this._logQueue = ["[SYS] init ok",
            "[NET] link up",
            "[RDR] radar ready"];

        this._resize();
        window.addEventListener("resize", () => this._resize());
        // Re-size the canvases once the flex layout has fully settled
        if (window.ResizeObserver) {
            this._ro = new ResizeObserver(() => this._resize());
            this._ro.observe(document.getElementById("cyber_wave_wrap"));
            this._ro.observe(document.getElementById("cyber_radar_canvas_wrap"));
        }

        // Data refresh & periodic effects
        setInterval(() => this._updateMetrics(), 2000);
        setInterval(() => this._updateExtra(), 1000);
        // Disk I/O sampler on its own 1s cadence: fsStats() rates come from a
        // running delta (first call is the baseline), and 1s keeps the waveform
        // responsive without a second 500ms process list query.
        setInterval(() => this._sampleDiskIO(), 1000);
        setInterval(() => this._appendLog(), 1200); // code-like stream (throttled 3x for CPU, #92)
        // Real HUD probe (connection count + wifi signal) via the net:hud IPC.
        // Runs immediately so the panel isn't empty at boot, then every 3s.
        this._pollHUD();
        setInterval(() => this._pollHUD(), 3000);

        // Animation loop
        // #92: cap at 10fps (the radar only completes one sweep every ~9s, so
        // 60fps was pure waste). Canvas redraw itself is gated on the UI being
        // visible inside _tick, so a lock/screensaver/hidden window freezes the
        // drawings while the data intervals keep running.
        this._lastTick = 0;
        const loop = now => {
            if (now - this._lastTick >= 1000 / 10) {
                this._lastTick = now;
                this._tick(now);
            }
            requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
    }

    _buildDOM() {
        // Left part of the panel (waveform + progress bars + multi-line log) sits
        // beside the file manager; the radar is a separate element placed below
        // the right-hand network column (see _buildRadar).
        this.parent.innerHTML = `
        <div id="cyber_panel_inner">
            <div class="cyber_panel_section" id="cyber_wave_wrap">
                <h3 class="cyber_panel_title">DISK I/O<i>READ / WRITE</i></h3>
                <canvas id="cyber_waveform_canvas"></canvas>
            </div>
            <div class="cyber_panel_section" id="cyber_bars_wrap">
                <div id="cyber_bars">
                    <div class="cyber_bar">
                        <h4>CPU</h4>
                        <div class="cyber_bar_track"><div class="cyber_bar_fill" id="cyber_bar_cpu"></div></div>
                        <span class="cyber_bar_val" id="cyber_bar_cpu_val">--%</span>
                    </div>
                    <div class="cyber_bar">
                        <h4>MEM</h4>
                        <div class="cyber_bar_track"><div class="cyber_bar_fill" id="cyber_bar_mem"></div></div>
                        <span class="cyber_bar_val" id="cyber_bar_mem_val">--%</span>
                    </div>
                    <div class="cyber_bar">
                        <h4>DSK</h4>
                        <div class="cyber_bar_track"><div class="cyber_bar_fill" id="cyber_bar_dsk"></div></div>
                        <span class="cyber_bar_val" id="cyber_bar_dsk_val">--%</span>
                    </div>
                    <div class="cyber_bar">
                        <h4>NET</h4>
                        <div class="cyber_bar_track"><div class="cyber_bar_fill" id="cyber_bar_net"></div></div>
                        <span class="cyber_bar_val" id="cyber_bar_net_val">--%</span>
                    </div>
                </div>
                <div id="cyber_extra">
                    <div class="cyber_extra_item"><span>UPTIME</span><b id="cyber_uptime">0:00:00</b></div>
                    <div class="cyber_extra_item"><span>PROCESSES</span><b id="cyber_procs">--</b></div>
                    <div class="cyber_extra_item"><span>NET RATE</span><b id="cyber_netrate">--M</b></div>
                    <div class="cyber_extra_item"><span>SWAP</span><b id="cyber_swap">--%</b></div>
                </div>
                <div id="cyber_log"><div id="cyber_log_lines"></div></div>
            </div>
        </div>`;

        // Radar - a flattened element below the right network column: circular
        // sweep + a small data column in the space left over.
        let radar = document.createElement("div");
        radar.id = "cyber_radar";
        radar.setAttribute("augmented-ui", "bl-clip tr-clip exe");
        radar.innerHTML = `<div id="cyber_radar_canvas_wrap"><canvas id="cyber_radar_canvas"></canvas></div>
            <div id="cyber_radar_data">
                <div class="cyber_radar_data_label">TELEMETRY</div>
                <div class="cyber_radar_stat"><span>IO</span><b id="cyber_radar_io">0.0</b></div>
                <div class="cyber_radar_stat"><span>CONN</span><b id="cyber_radar_conn">0</b></div>
                <div class="cyber_radar_stat"><span>WIFI</span><b id="cyber_radar_wifi">--</b></div>
                <div class="cyber_radar_stat"><span>CLK</span><b id="cyber_radar_clk">--</b></div>
                <div class="cyber_radar_stat"><span>LOAD</span><b id="cyber_radar_load">--%</b></div>
                <div class="cyber_radar_stat"><span>TEMP</span><b id="cyber_radar_temp">--°C</b></div>
                <div class="cyber_radar_stat"><span>EVENTS</span><b id="cyber_radar_events">0</b></div>
                <div class="cyber_radar_stat"><span>THREAT</span><b id="cyber_radar_threat">LOW</b></div>
            </div>`;
        // The radar is a sibling of #cyber_panel (appended to <body>), so the
        // panel's hidden state does NOT hide it. Keep it at opacity:0 through
        // the boot welcome; cyberEntrance() reveals it.
        radar.style.opacity = "0";
        document.body.appendChild(radar);

        // Store the metric bar elements
        this._bars = {
            cpu: {fill: document.getElementById("cyber_bar_cpu"), val: document.getElementById("cyber_bar_cpu_val")},
            mem: {fill: document.getElementById("cyber_bar_mem"), val: document.getElementById("cyber_bar_mem_val")},
            dsk: {fill: document.getElementById("cyber_bar_dsk"), val: document.getElementById("cyber_bar_dsk_val")},
            net: {fill: document.getElementById("cyber_bar_net"), val: document.getElementById("cyber_bar_net_val")}
        };
        // Extra live readouts (uptime / processes / net rate / swap)
        this._extra = {
            uptime: document.getElementById("cyber_uptime"),
            procs: document.getElementById("cyber_procs"),
            netrate: document.getElementById("cyber_netrate"),
            swap: document.getElementById("cyber_swap")
        };
    }

    // Theme-aware rgba() helper for the canvas
    _themeColor(alpha) {
        return `rgba(${this._tr}, ${this._tg}, ${this._tb}, ${alpha})`;
    }

    _resize() {
        const dpr = window.devicePixelRatio || 1;

        // Radar - square canvas (sized by CSS via the wrap)
        let rwrap = document.getElementById("cyber_radar_canvas_wrap");
        let rsize = rwrap.clientWidth || 200;
        this.radar.width = Math.round(rsize * dpr);
        this.radar.height = Math.round(rsize * dpr);
        this._radarSize = rsize;
        this._dpr = dpr;

        // Waveform - sized by CSS (100%); only update the backing store.
        // Reading the *canvas* clientWidth here can return a stale value while
        // the flex layout is still settling, so read the wrapper instead and
        // never set an inline px width (ResizeObserver re-runs this later).
        let wwrap = document.getElementById("cyber_wave_wrap");
        let ww = wwrap.clientWidth || 400;
        let wh = wwrap.clientHeight || 120;
        this.wave.width = Math.round(ww * dpr);
        this.wave.height = Math.round(wh * dpr);
        this._waveW = ww;
        this._waveH = wh;
    }

    /* ------------------------------- Radar ------------------------------- */

    // Public: trigger a pulse wave (call on system task / AI response)
    pulse() {
        this.radarPulses.push({
            r: 4,
            maxR: this._radarSize * 0.46,
            alpha: 0.55,
            speed: 0.45 + Math.random() * 0.25
        });
        this._pulseCount++;
    }

    // Reconcile the radar "contacts" to the REAL active connection count
    // (capped at 24 for rendering). Positions stay random/aesthetic — only the
    // count is honest: blips appear as connections open, vanish as they close.
    _syncBlips() {
        let size = this._radarSize;
        if (!size) return;
        const target = Math.min(this._conns, 24);
        while (this.radarBlips.length < target) {
            let angle = Math.random() * Math.PI * 2;
            let dist = (0.15 + Math.random() * 0.6) * size * 0.42;
            this.radarBlips.push({
                x: size / 2 + Math.cos(angle) * dist,
                y: size / 2 + Math.sin(angle) * dist,
                angle,
                r: 1.2 + Math.random() * 1.8,
                alpha: 0
            });
        }
        if (this.radarBlips.length > target) this.radarBlips.splice(target);
    }

    // Poll the real HUD probe (net:hud IPC): active connection count + wifi
    // signal. A rising connection count is a REAL event → radar pulse.
    async _pollHUD() {
        try {
            const r = await require("electron").ipcRenderer.invoke("net:hud");
            if (r && typeof r.conns === "number") {
                if (r.conns > this._conns) this.pulse();
                this._conns = r.conns;
                this._syncBlips();
            }
            if (r && "wifiPct" in r) this._wifiPct = r.wifiPct;
        } catch (e) { /* keep previous values */ }
    }

    _drawRadar() {
        let ctx = this.radarCtx;
        let size = this._radarSize;
        let dpr = this._dpr;
        let cx = size / 2, cy = size / 2;
        let R = size * 0.46;

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, size, size);

        // Outer ring + crosshairs
        ctx.lineWidth = 1;
        ctx.strokeStyle = this._themeColor(0.55);
        ctx.beginPath();
        ctx.arc(cx, cy, R, 0, Math.PI * 2);
        ctx.stroke();

        ctx.strokeStyle = this._themeColor(0.12);
        ctx.beginPath();
        ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy);
        ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R);
        ctx.stroke();

        // Concentric inner rings
        [0.3, 0.6].forEach(k => {
            ctx.strokeStyle = this._themeColor(0.10);
            ctx.beginPath();
            ctx.arc(cx, cy, R * k, 0, Math.PI * 2);
            ctx.stroke();
        });

        // Tick scale around the ring
        for (let i = 0; i < 72; i++) {
            let a = (i / 72) * Math.PI * 2;
            let major = (i % 6 === 0);
            let len = major ? R * 0.10 : R * 0.05;
            let a0 = a - 0.012, a1 = a + 0.012;
            ctx.strokeStyle = this._themeColor(major ? 0.55 : 0.25);
            ctx.lineWidth = major ? 1.2 : 0.7;
            ctx.beginPath();
            ctx.moveTo(cx + Math.cos(a0) * (R - len), cy + Math.sin(a0) * (R - len));
            ctx.lineTo(cx + Math.cos(a1) * R, cy + Math.sin(a1) * R);
            ctx.stroke();
        }

        // Rotating sweep beam (with a fading glow trail behind it)
        let beam = this.radarAngle;
        let trail = 0.5; // radians of glow behind the beam
        let grad = ctx.createLinearGradient(
            cx + Math.cos(beam - trail) * R, cy + Math.sin(beam - trail) * R,
            cx + Math.cos(beam) * R, cy + Math.sin(beam) * R
        );
        grad.addColorStop(0, this._themeColor(0));
        grad.addColorStop(1, this._themeColor(0.32));
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, R, beam - trail, beam);
        ctx.closePath();
        ctx.fill();

        ctx.strokeStyle = this._themeColor(0.9);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(beam) * R, cy + Math.sin(beam) * R);
        ctx.stroke();

        // Blips - brighten when the beam sweeps past them
        this.radarBlips.forEach(b => {
            let dAngle = Math.abs(((b.angle - beam + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
            let sweepBoost = (dAngle < 0.25) ? 0.7 : 0;
            b.alpha = Math.min(1, b.alpha + (sweepBoost > 0 ? 0.35 : 0.006));
            b.alpha -= 0.002;
            if (b.alpha <= 0.02) { b.alpha = 0.02; }
            ctx.fillStyle = this._themeColor(0.15 + b.alpha * 0.7);
            ctx.beginPath();
            ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
            ctx.fill();
        });

        // Pulse waves
        this.radarPulses.forEach(p => {
            p.r += p.speed;
            p.alpha *= 0.965;
            ctx.strokeStyle = this._themeColor(Math.max(0, p.alpha));
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(cx, cy, p.r, 0, Math.PI * 2);
            ctx.stroke();
        });
        this.radarPulses = this.radarPulses.filter(p => p.alpha > 0.01 && p.r < p.maxR);
    }

    /* ------------------------------ Waveform ------------------------------ */

    _drawWaveform() {
        let ctx = this.waveCtx;
        let w = this._waveW, h = this._waveH;
        let dpr = this._dpr;
        let hist = this._dskHist;
        let n = hist.length;

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);

        // Center line
        ctx.strokeStyle = this._themeColor(0.15);
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.moveTo(0, h / 2);
        ctx.lineTo(w, h / 2);
        ctx.stroke();

        // Real disk I/O waveform: READ trace above the centre line, WRITE below
        // it (holographic split, echoing the old mirrored look). Samples arrive
        // every 1s; the newest sits at the right edge and the whole line scrolls
        // left as history fills up.
        if (n < 2) return;

        let scale = Math.max(5, this._dskScale);
        // Overload flash: pulse 0.35..0.95 alpha over ~1s, the same feel as the
        // CPU/MEM/NET edex_overload widgets — the lines themselves blink red.
        let flash = this._dskOverload ? Math.max(0.35, 0.65 + 0.30 * Math.sin(performance.now() / 150)) : 0.9;
        let rgb = this._dskOverload ? "255, 90, 90" : `${this._tr}, ${this._tg}, ${this._tb}`;

        const trace = (key, dir) => {
            // Build the polyline once, stroke it twice: a soft halo pass then the
            // main line. The halo (10fps × 2 traces, a few hundred pts) is cheap
            // and makes the red flash read as a glow instead of a flat recolor.
            let pts = [];
            for (let x = 0; x <= w; x += 2) {
                let f = (x / w) * (n - 1);
                let i = Math.floor(f);
                let j = Math.min(n - 1, i + 1);
                let frac = f - i;
                let v = hist[i][key] + (hist[j][key] - hist[i][key]) * frac;
                let norm = Math.max(0, Math.min(1, v / scale));
                pts.push([x, h / 2 + dir * norm * h * 0.40]);
            }
            const stroke = (lineWidth, alpha) => {
                ctx.strokeStyle = `rgba(${rgb}, ${alpha})`;
                ctx.lineWidth = lineWidth;
                ctx.beginPath();
                pts.forEach((p, idx) => idx ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]));
                ctx.stroke();
            };
            stroke(this._dskOverload ? 3 : 1.2, flash * (this._dskOverload ? 0.22 : 0.08));
            stroke(1, flash);
        };
        trace("r", -1); // READ above centre
        trace("w", 1);  // WRITE below centre
    }

    // Real disk read/write sampler — feeds the waveform. fsStats() reports
    // bytes/sec across all mounted block devices, computed from a running delta
    // (first call is just the baseline, so rates start at 0 and are real after
    // the first 1s tick).
    async _sampleDiskIO() {
        try {
            let s = await window.si.fsStats();
            let rMB = ((s && s.rx_sec) || 0) / 1048576;
            let wMB = ((s && s.wx_sec) || 0) / 1048576;
            this._dskHist.push({ r: rMB, w: wMB });
            if (this._dskHist.length > 120) this._dskHist.shift(); // 2min window

            // Peak-hold y-axis: snap up to any burst, decay slowly on idle, so
            // the auto-range rises instantly but only relaxes gradually.
            let total = rMB + wMB;
            this._dskScale = Math.max(5, Math.max(total, this._dskScale * 0.985));

            this._dskOverload = total >= DSK_OVERLOAD_MB;
            // Real event: heavy disk burst (rising edge — pulses once per burst,
            // not every second of a sustained copy).
            if (this._dskOverload && !this._lastDskOverload) this.pulse();
            this._lastDskOverload = this._dskOverload;
        } catch (e) { /* keep previous values */ }
    }

    /* --------------------------- Metrics & log --------------------------- */

    async _updateMetrics() {
        try {
            let res = await Promise.all([
                window.si.currentLoad(),
                window.si.mem(),
                window.si.fsSize(),
                window.si.cpuTemperature() // cached 1900ms (cpuinfo keeps it warm) → free
            ]);
            this.metrics.cpu = res[0].avgLoad;
            this.memUsed = res[1].used;
            this.memTotal = res[1].total;
            this.metrics.mem = (this.memUsed / this.memTotal) * 100;
            this.cpuTemp = (res[3] && res[3].max) ? res[3].max : null;
            let root = res[2].find(f => f.mount === "/") || res[2][0];
            if (root && root.size > 0) {
                this.metrics.dsk = (root.used / root.size) * 100;
                this.dskUsed = root.used;
                this.dskSize = root.size;
            } else {
                this.metrics.dsk = 0;
                this.dskUsed = this.dskSize = 0;
            }
            // CPU clock speed - refresh occasionally (fairly stable)
            if (!this._cpuSpeedTick || Date.now() - this._cpuSpeedTick > 15000) {
                this._cpuSpeedTick = Date.now();
                let cpu = await window.si.cpu();
                this.cpuSpeed = cpu.speed || 0;
            }
        } catch (e) { /* keep previous values */ }

        try {
            if (window.mods && window.mods.netstat && window.mods.netstat.iface) {
                let ns = await window.si.networkStats(window.mods.netstat.iface);
                if (ns && ns[0]) {
                    this.netRxMbps = (ns[0].rx_sec || 0) / 125000;
                    this.netTxMbps = (ns[0].tx_sec || 0) / 125000;
                    this.netMbps = this.netRxMbps + this.netTxMbps;
                    this.metrics.net = Math.min(100, this.netMbps);
                }
            }
        } catch (e) { /* no network */ }

        // Battery — slow-changing, 30s-throttled. si.battery() is cached 30s and
        // kept warm by sysinfo's 3s poll, so this adds no new subprocess.
        try {
            if (!this._battTick || Date.now() - this._battTick > 30000) {
                this._battTick = Date.now();
                let b = await window.si.battery();
                this._battery = (b && b.hasBattery) ? { pct: Math.round(b.percent), charging: b.isCharging } : null;
            }
        } catch (e) { /* no battery */ }

        // Update DOM bars - percentage + a concrete value
        this._setBar("cpu", this.metrics.cpu, this.cpuSpeed ? this.cpuSpeed.toFixed(1) + "G" : "--");
        this._setBar("mem", this.metrics.mem, `${(this.memUsed / 1e9).toFixed(1)}G/${(this.memTotal / 1e9).toFixed(1)}G`);
        this._setBar("dsk", this.metrics.dsk, `${(this.dskUsed / 1e9).toFixed(0)}G/${(this.dskSize / 1e9).toFixed(0)}G`);
        this._setBar("net", this.metrics.net, (this.netMbps || 0).toFixed(1) + "M");

        // Pulse on real CPU load spikes
        if (this.metrics.cpu - this._lastCPU > 14 && this.metrics.cpu > 30) {
            this.pulse();
        }
        this._lastCPU = this.metrics.cpu;

        // Pulse on a network burst (rising edge above 15 Mbps)
        if (this.netMbps > 15 && this._lastNetBurst <= 15) this.pulse();
        this._lastNetBurst = this.netMbps;
    }

    _setBar(key, value, detail) {
        let bar = this._bars[key];
        if (!bar || !bar.fill) return;
        let v = Math.max(0, Math.min(100, value));
        bar.fill.style.width = v + "%";
        bar.val.innerText = Math.round(v) + "%" + (detail ? " · " + detail : "");
    }

    // Live readouts: uptime / processes / net rate / swap usage
    async _updateExtra() {
        let x = this._extra;
        if (!x || !x.uptime) return;

        // Uptime - always ticking
        let u = require("os").uptime();
        let hh = String(Math.floor(u / 3600)).padStart(2, "0");
        let mm = String(Math.floor((u % 3600) / 60)).padStart(2, "0");
        let ss = String(Math.floor(u % 60)).padStart(2, "0");
        x.uptime.innerText = `${hh}:${mm}:${ss}`;

        // Net rate (Mbps, from the latest networkStats delta)
        if (x.netrate) x.netrate.innerText = this.metrics.net.toFixed(1) + "M";

        // Swap + process count - refreshed a bit less often
        if (!this._extraTick || Date.now() - this._extraTick > 4000) {
            this._extraTick = Date.now();
            try {
                let [mem, procs] = await Promise.all([window.si.mem(), window.si.processes()]);
                this.swapPct = mem.swaptotal > 0 ? (mem.swapused / mem.swaptotal) * 100 : 0;
                if (x.swap) x.swap.innerText = Math.round(this.swapPct) + "%";
                if (x.procs) x.procs.innerText = procs.all;
                // Top process by CPU (for the [PROC] log line). The si proxy
                // clones `processes` before sharing, so sorting is safe.
                if (procs.list && procs.list.length) {
                    let list = procs.list.sort((a, b) => (b.cpu - a.cpu) * 100 + b.mem - a.mem);
                    let t = list[0];
                    this._topProc = { name: t.name, cpu: t.cpu, mem: t.mem };
                } else {
                    this._topProc = null;
                }
            } catch (e) { /* keep previous values */ }
        }
    }

    // Generate a real, code-like log line. Pure sync — reads only this.* fields
    // (fed by the si proxy cache + the net:hud IPC), so no extra system probes.
    // Values sit near the left: .cyber_log_line is nowrap/ellipsis, so the right
    // edge gets truncated.
    _genLogLine() {
        const t = new Date();
        const stamp = `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}:${String(t.getSeconds()).padStart(2, "0")}`;
        const last = this._dskHist[this._dskHist.length - 1];
        const io = last ? (last.r + last.w).toFixed(1) : "0.0";
        const m = this.metrics;
        const top = this._topProc;
        const bat = this._battery;
        const patterns = [
            `[${stamp}] [SYS] cpu=${Math.round(m.cpu)}% load=${require("os").loadavg()[0].toFixed(2)} temp=${this.cpuTemp != null ? Math.round(this.cpuTemp) + "C" : "--"} clk=${this.cpuSpeed ? this.cpuSpeed.toFixed(2) + "G" : "--"}`,
            `[${stamp}] [MEM] used=${((this.memUsed || 0) / 1e9).toFixed(1)}G size=${((this.memTotal || 0) / 1e9).toFixed(0)}G swap=${Math.round(this.swapPct)}%`,
            `[${stamp}] [DSK] / ${Math.round(m.dsk)}% io=${io}MB/s`,
            `[${stamp}] [NET] rx=${this.netRxMbps.toFixed(1)} tx=${this.netTxMbps.toFixed(1)} Mbps conn=${this._conns}`,
            `[${stamp}] [WIFI] sig=${this._wifiPct == null ? "--" : Math.round(this._wifiPct)}%`,
            `[${stamp}] [PROC] ${top ? top.name.slice(0, 10) : "--"} cpu=${top ? top.cpu.toFixed(1) : "0"}% mem=${top ? top.mem.toFixed(1) : "0"}%`,
            `[${stamp}] [BAT] ${bat ? bat.pct + "% " + (bat.charging ? "chg" : "bat") : "--"}`
        ];
        return patterns[Math.floor(Math.random() * patterns.length)];
    }

    _appendLog() {
        // Sometimes burst 2-3 lines at once for a streaming-code feel
        const burst = Math.random() < 0.3 ? 2 : 1;
        for (let i = 0; i < burst; i++) {
            this._logQueue.push(this._genLogLine());
        }
        // Keep the log area full (fits the box height)
        if (this._logQueue.length > 14) this._logQueue.splice(0, this._logQueue.length - 14);
        // Rebuild in one DOM pass via textContent (no innerHTML re-parse).
        const frag = document.createDocumentFragment();
        this._logQueue.forEach(l => {
            const div = document.createElement("div");
            div.className = "cyber_log_line";
            div.textContent = l;
            frag.append(div);
        });
        this.logLines.replaceChildren(frag);
    }

    /* ------------------------------- Main loop ---------------------------- */

    _tick(now) {
        // Slow radar rotation: a full sweep every ~9 seconds
        this.radarAngle += (Math.PI * 2) / (9 * 60);
        if (this.radarAngle > Math.PI * 2) this.radarAngle -= Math.PI * 2;

        if (!this._tickLogged) {
            this._tickLogged = true;
            require("electron").ipcRenderer.send("log", "debug", `CyberPanel active: radar=${this._radarSize}px, wave=${this._waveW}x${this._waveH}px`);
        }

        // #92: don't repaint the canvases while the main UI is covered (lock /
        // screensaver / hidden window) — the radar+waveform were re-rendered at
        // 60fps unconditionally, one of the animation loops that pegged the CPU.
        if (!(typeof window.__uiCovered === "function" ? window.__uiCovered() : false)) {
            this._drawRadar();
            this._drawWaveform();
        }

        // Refresh the radar telemetry column ~5x/sec with REAL live values
        if (!this._dataTick || now - this._dataTick > 200) {
            this._dataTick = now;
            let d = this._radarData;

            // IO — total disk read+write MB/s (newest fsStats sample)
            let last = this._dskHist[this._dskHist.length - 1];
            if (d.io) d.io.innerText = last ? (last.r + last.w).toFixed(1) : "0.0";

            // CONN — real active TCP/UDP connection count (uncapped here; the
            // radar blips are the capped view)
            if (d.conn) d.conn.innerText = String(this._conns);

            // WIFI — real signal %; "--" on wired/no-wifi (never a fake value)
            if (d.wifi) d.wifi.innerText = this._wifiPct == null ? "--" : Math.round(this._wifiPct) + "%";

            // CLK — CPU clock GHz (real, refreshed ~15s)
            if (d.clk) d.clk.innerText = this.cpuSpeed ? this.cpuSpeed.toFixed(2) + "G" : "--";

            // LOAD — real CPU %
            if (d.load) d.load.innerText = Math.round(this.metrics.cpu) + "%";

            // TEMP — real CPU temp, "--°C" when unavailable
            if (d.temp) d.temp.innerText = this.cpuTemp != null ? Math.round(this.cpuTemp) + "°C" : "--°C";

            // EVENTS — cumulative count of REAL pulse triggers
            if (d.events) d.events.innerText = String(this._pulseCount);

            // THREAT — derived from real thresholds
            let threat = "LOW";
            if (this.metrics.cpu > 80 || this.metrics.mem > 85 || this._dskOverload) threat = "HIGH";
            else if (this.metrics.cpu > 50 || this.metrics.mem > 50) threat = "MED";
            if (d.threat) d.threat.innerText = threat;

            this._syncBlips(); // cheap reconcile — no-op when the count matches
        }
    }
}

module.exports = {
    CyberPanel
};
