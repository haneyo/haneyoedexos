// Cyber Core Radar & Data Panel.
//
// Replaces the removed on-screen keyboard with a left-right split HUD:
//   - Right: square holographic radar sweep (thin glowing lines, rotating beam,
//     fading contacts, pulse waves).
//   - Left: a live system-waveform canvas + 4 tech progress bars (CPU/MEM/DSK/NET)
//     + a single-line auto-scrolling tech log.
//
// Everything is drawn against the active theme (--color_r/g/b) so it blends
// seamlessly with the rest of eDEX-UI.

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
        this._pulseTimer = null;
        this._pulseCount = 0;
        this._radarData = {
            azm: document.getElementById("cyber_radar_azm"),
            rng: document.getElementById("cyber_radar_rng"),
            contacts: document.getElementById("cyber_radar_contacts"),
            signal: document.getElementById("cyber_radar_signal"),
            freq: document.getElementById("cyber_radar_freq"),
            load: document.getElementById("cyber_radar_load"),
            pulses: document.getElementById("cyber_radar_pulses"),
            threat: document.getElementById("cyber_radar_threat")
        };

        // Waveform state
        this.wave = document.getElementById("cyber_waveform_canvas");
        this.waveCtx = this.wave.getContext("2d");
        this.wavePhase = 0;
        this._load = 0.05;       // smoothed system load 0..1

        // Metrics (progress bars)
        this.metrics = {cpu: 0, mem: 0, dsk: 0, net: 0};
        this._lastCPU = 0;

        // Log (multi-line, fast code-like stream)
        this.logLines = document.getElementById("cyber_log_lines");
        this._logQueue = ["[SYS] boot sequence ok · kernel 2.2.8 · modules 14",
            "[NET] uplink secured · handshake ack · latency 12ms",
            "[CORE] radar sweep nominal · 3 contacts tracked"];

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
        setInterval(() => this._appendLog(), 1200); // code-like stream (throttled 3x for CPU, #92)
        setInterval(() => this._spawnBlip(), 2200);
        this._schedulePulse(4000);

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
                <h3 class="cyber_panel_title">DATA STREAM<i>SYSTEM WAVEFORM</i></h3>
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
                <div class="cyber_radar_stat"><span>AZM</span><b id="cyber_radar_azm">000°</b></div>
                <div class="cyber_radar_stat"><span>RNG</span><b id="cyber_radar_rng">--</b></div>
                <div class="cyber_radar_stat"><span>CONTACTS</span><b id="cyber_radar_contacts">0</b></div>
                <div class="cyber_radar_stat"><span>SIGNAL</span><b id="cyber_radar_signal">--%</b></div>
                <div class="cyber_radar_stat"><span>FREQ</span><b id="cyber_radar_freq">--</b></div>
                <div class="cyber_radar_stat"><span>LOAD</span><b id="cyber_radar_load">--%</b></div>
                <div class="cyber_radar_stat"><span>PULSES</span><b id="cyber_radar_pulses">0</b></div>
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

    _schedulePulse(delay) {
        clearTimeout(this._pulseTimer);
        this._pulseTimer = setTimeout(() => {
            this.pulse();
            this._schedulePulse(5000 + Math.random() * 5000);
        }, delay);
    }

    _spawnBlip() {
        let size = this._radarSize;
        if (!size) return;
        let angle = Math.random() * Math.PI * 2;
        let dist = (0.15 + Math.random() * 0.6) * size * 0.42;
        this.radarBlips.push({
            x: size / 2 + Math.cos(angle) * dist,
            y: size / 2 + Math.sin(angle) * dist,
            angle,
            r: 1.2 + Math.random() * 1.8,
            alpha: 0
        });
        if (this.radarBlips.length > 24) this.radarBlips.shift();
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

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);

        // Center line
        ctx.strokeStyle = this._themeColor(0.15);
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.moveTo(0, h / 2);
        ctx.lineTo(w, h / 2);
        ctx.stroke();

        // #166: the idle floor was 0.08 (~3% of canvas height — nearly
        // invisible). Raise the floor so the DATA STREAM bars stay clearly
        // visible at idle, while still swelling with real CPU load (capped at 1).
        let amp = Math.max(0.34, Math.min(1, this._load * 1.35));
        let phase = this.wavePhase;

        // Main signal
        ctx.strokeStyle = this._themeColor(0.9);
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let x = 0; x <= w; x += 2) {
            let t = x / w;
            let y = h / 2
                + Math.sin(t * 9 + phase) * (h * 0.38) * amp
                + Math.sin(t * 23 + phase * 1.7) * (h * 0.14) * amp
                + Math.sin(t * 47 + phase * 0.7) * (h * 0.06) * amp;
            ctx.lineTo(x, y);
        }
        ctx.stroke();

        // Faint mirrored copy below center (holographic look)
        ctx.strokeStyle = this._themeColor(0.18);
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        for (let x = 0; x <= w; x += 2) {
            let t = x / w;
            let y = h / 2
                - Math.sin(t * 9 + phase) * (h * 0.38) * amp
                - Math.sin(t * 23 + phase * 1.7) * (h * 0.14) * amp;
            ctx.lineTo(x, y);
        }
        ctx.stroke();

        this.wavePhase += 0.06;
    }

    /* --------------------------- Metrics & log --------------------------- */

    async _updateMetrics() {
        try {
            let res = await Promise.all([
                window.si.currentLoad(),
                window.si.mem(),
                window.si.fsSize()
            ]);
            this.metrics.cpu = res[0].avgLoad;
            this.memUsed = res[1].used;
            this.memTotal = res[1].total;
            this.metrics.mem = (this.memUsed / this.memTotal) * 100;
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
                    this.netMbps = (ns[0].tx_sec + ns[0].rx_sec) / 125000;
                    this.metrics.net = Math.min(100, this.netMbps);
                }
            }
        } catch (e) { /* no network */ }

        // Update DOM bars - percentage + a concrete value
        this._setBar("cpu", this.metrics.cpu, this.cpuSpeed ? this.cpuSpeed.toFixed(1) + "G" : "--");
        this._setBar("mem", this.metrics.mem, `${(this.memUsed / 1e9).toFixed(1)}G/${(this.memTotal / 1e9).toFixed(1)}G`);
        this._setBar("dsk", this.metrics.dsk, `${(this.dskUsed / 1e9).toFixed(0)}G/${(this.dskSize / 1e9).toFixed(0)}G`);
        this._setBar("net", this.metrics.net, (this.netMbps || 0).toFixed(1) + "M");

        // Pulse when the system load spikes (simulates a "task / AI response")
        if (this.metrics.cpu - this._lastCPU > 14 && this.metrics.cpu > 30) {
            this.pulse();
        }
        this._lastCPU = this.metrics.cpu;

        // Feed the waveform amplitude (smoothed)
        this._load += ((this.metrics.cpu / 100) - this._load) * 0.25;
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
                let swapPct = mem.swaptotal > 0 ? (mem.swapused / mem.swaptotal) * 100 : 0;
                if (x.swap) x.swap.innerText = Math.round(swapPct) + "%";
                if (x.procs) x.procs.innerText = procs.all;
            } catch (e) { /* keep previous values */ }
        }
    }

    // Generate a dense, code-like log line (long enough to fill the log width)
    _genLogLine() {
        const stamps = ["OK", "RX", "TX", "SYNC", "SCAN", "ACK", "READ", "WRITE", "INIT", "LOAD", "CACHE", "POLL", "DEC", "ENC"];
        const comps = ["sys.mem", "net.link", "io.dev", "core.radar", "pxl.grid", "audio.fx", "fs.cache", "proc.mgr", "enc.layer", "vtx.array", "drv.i2c", "sec.auth", "dsp.core", "vfs.node"];
        const hex = () => "0x" + Math.floor(Math.random() * 0xFFFF).toString(16).toUpperCase().padStart(4, "0");
        const n = max => Math.floor(Math.random() * max);
        const t = new Date();
        const stamp = `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}:${String(t.getSeconds()).padStart(2, "0")}`;
        const s = stamps[Math.floor(Math.random() * stamps.length)];
        const c = comps[Math.floor(Math.random() * comps.length)];
        const patterns = [
            `[${stamp}] ${s} ${hex()} ${1 + n(512)}B ${c} seg=${hex()} off=${hex()} t=${(Math.random() * 3).toFixed(2)}ms rt=${n(90)}ms dma=ok`,
            `[${stamp}] >> ${hex()} ${c}.write n=${n(100)} err=${Math.random() < 0.08 ? 1 : 0} buf=${hex()}${hex()} win=${n(64000)} rto=${200 + n(40)}`,
            `[${stamp}] ${s} ${c} peer=10.0.${n(255)}.${n(255)}:${1000 + n(9000)} buf=${hex()} ack=${hex()} seq=${String(n(9999)).padStart(4, "0")}`,
            `[${stamp}] <${s}> ${c} idx=${hex()} cpu=${n(100)}% mem=${n(100)}% lat=${(Math.random() * 50).toFixed(1)}ms crc=${hex()}`,
            `[${stamp}] .. ${c} chunk seq=${String(n(9999)).padStart(4, "0")} sz=${n(4000)}B mode=burst fill=${n(100)}% bank=${hex()}`,
            `[${stamp}] ${s} ${c} hw=${hex()} ver=${n(9)}.${n(9)}.${n(9)} temp=${20 + n(40)}C vdd=${(3.1 + Math.random()).toFixed(2)}V stat=nominal`
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

        // Refresh the radar telemetry column ~5x/sec with live, animated values
        if (!this._dataTick || now - this._dataTick > 200) {
            this._dataTick = now;
            let d = this._radarData;

            // Azimuth - follows the rotating sweep beam (always moving)
            let azm = Math.round(this.radarAngle * 180 / Math.PI) % 360;
            if (d.azm) d.azm.innerText = String(azm).padStart(3, "0") + "°";

            // Range - oscillates, spikes when a pulse wave is expanding
            this._rng = 40 + Math.round(38 * (0.5 + 0.5 * Math.sin(now / 8000))) + (this.radarPulses.length > 0 ? 14 : 0);
            if (d.rng) d.rng.innerText = this._rng;

            // Contacts - live blip count
            if (d.contacts) d.contacts.innerText = String(this.radarBlips.length).padStart(2, "0");

            // Signal strength - smooth oscillation
            if (d.signal) d.signal.innerText = Math.round(55 + 42 * (0.5 + 0.5 * Math.sin(now / 1500 + 2))) + "%";

            // Frequency - wobbles around the carrier
            if (d.freq) d.freq.innerText = (9.2 + Math.sin(now / 6000) * 0.5).toFixed(2) + "G";

            // System load - real CPU metric
            if (d.load) d.load.innerText = Math.round(this.metrics.cpu) + "%";

            // Pulses - cumulative
            if (d.pulses) d.pulses.innerText = String(this._pulseCount).padStart(3, "0");

            // Threat level - shifts with contacts / pulses
            let threat = "LOW";
            if (this.radarBlips.length > 12 || this._pulseCount % 5 === 0) threat = "MED";
            if (this.radarBlips.length > 20 || this._pulseCount % 11 === 0) threat = "HIGH";
            if (d.threat) d.threat.innerText = threat;
        }
    }
}

module.exports = {
    CyberPanel
};
