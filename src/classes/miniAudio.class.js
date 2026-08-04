// Mini music controller - a compact "now playing" widget for the bottom-right
// of the DATA window.
//
// Backends, chosen automatically per platform:
//   macOS   : `nowplaying-cli` (MediaRemote) when it can be resolved - reaches
//             ANY media app registered with the system media center (Apple
//             Music, NetEase Cloud Music, Spotify, QQ Music, ...). If it is
//             missing it falls back to AppleScript, which only ever talks to
//             Music / Spotify while they are ALREADY RUNNING - so starting
//             eDEX can never wake Apple Music.
//   Linux   : `playerctl` (MPRIS over D-Bus) - works with most Linux players.
//   Windows : PowerShell + the built-in SMTC media API (no extra install).
//
// Backends are resolved against absolute install paths first and `which` as a
// fallback: eDEX is often launched from Finder / a desktop launcher where PATH
// omits /opt/homebrew/bin, and a bare `which` would silently miss the tool.
//
// The visualizer is a smooth pseudo-animation (no audio samples are available
// for the system player); click the canvas to toggle bars / waveform.

// Embedded PowerShell helper for the Windows SMTC backend. `powershell.exe`
// ships with Windows, so this needs no third-party install. It is staged to a
// temp file at runtime because powershell.exe cannot read inside the Electron
// asar archive. `\`` below is an escaped backtick (PowerShell's "1" suffix in
// IAsyncOperation`1), written literally to the temp file.
const SMTC_PS1 = `
param([string]$Command = "info")

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Runtime.WindowsRuntime | Out-Null

$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq "AsTask" -and $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name -eq "IAsyncOperation\`1"
})[0]

function Await($WinRtTask, $ResultType) {
    $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
    $netTask = $asTask.Invoke($null, @($WinRtTask))
    $netTask.Wait(-1) | Out-Null
    $netTask.Result
}

[void][Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media.Control,ContentType=WindowsRuntime]

$mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
$session = $mgr.GetCurrentSession()
if ($null -eq $session) {
    if ($Command -eq "info") { Write-Output "none" }
    exit 0
}

switch ($Command) {
    "toggle" { [void]$session.TogglePlayPauseAsync(); exit 0 }
    "next"   { [void]$session.SkipNextAsync();        exit 0 }
    "prev"   { [void]$session.SkipPreviousAsync();    exit 0 }
    "play"   { [void]$session.PlayAsync();            exit 0 }
    "pause"  { [void]$session.PauseAsync();           exit 0 }
}

$props  = Await ($session.GetGlobalPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
$status = $session.GetPlaybackInfo().PlaybackStatus.ToString()
Write-Output ("{0}|{1}|{2}|{3}" -f $status, $session.SourceAppUserModelId, $props.Title, $props.Artist)
`;

class MiniAudio {
    constructor(opts) {
        this.container = typeof opts.container === "string" ? document.getElementById(opts.container) : opts.container;
        if (!this.container) return;

        this.mode = "bars";          // "bars" | "wave"
        this.playing = false;
        this.platform = process.platform;  // "darwin" | "linux" | "win32"
        this._polling = false;       // guard against overlapping slow polls
        this._macNpc = null;         // resolved path to nowplaying-cli, if any
        this._playerctl = null;      // resolved path to playerctl (Linux), if any
        this._winPs = null;          // staged SMTC helper .ps1 (Windows), if any
        this._phases = new Float32Array(20);
        for (let i = 0; i < this._phases.length; i++) this._phases[i] = Math.random() * Math.PI * 2;

        // Hidden by default - only the peek arrow stays on the screen edge.
        // (Added before _build so the widget never flashes in briefly.)
        this.container.classList.add("mini_audio_hidden");
        this._build();
        this._bind();

        // The widget is hidden most of the time, so the rAF visualizer and the
        // nowplaying-cli subprocess poll are expensive to keep running forever.
        // Start them only while the widget is actually visible on screen, and
        // pause them when it slides back to the edge arrow.
        this._visible = false;
        this._timer = null;
        this._animStop = true;
        this._checkBackend().then(() => this._poll());
        if (typeof MutationObserver === "function") {
            try {
                this._obs = new MutationObserver(() => this._syncVisibility());
                this._obs.observe(this.container, { attributes: true, attributeFilter: ["class"] });
            } catch (e) {}
        }
        this._syncVisibility();
        // Startup hint: slide the controller in once, hold ~3s, then auto-hide
        // back to the edge arrow so the user notices it is there.
        setTimeout(() => {
            this.container.classList.remove("mini_audio_hidden");
            setTimeout(() => this.container.classList.add("mini_audio_hidden"), 3000);
        }, 400);
    }

    _syncVisibility() {
        const visible = !this.container.classList.contains("mini_audio_hidden");
        if (visible === this._visible) return;
        this._visible = visible;
        if (visible) this._resume();
        else this._pause();
    }

    _resume() {
        if (!this._timer) this._timer = setInterval(() => this._poll(), 2500);
        this._anim();
    }

    _pause() {
        if (this._timer) { clearInterval(this._timer); this._timer = null; }
        this._animStop = true; // the rAF loop stops scheduling frames
    }

    _build() {
        this.container.innerHTML = `
        <div class="mini_audio" title="Mini music controller">
            <canvas class="mini_audio_canvas"></canvas>
            <div class="mini_audio_info">
                <span class="mini_audio_title">No music playing</span>
                <span class="mini_audio_artist"></span>
            </div>
            <div class="mini_audio_controls">
                <button class="mini_audio_btn mini_audio_prev" title="Previous track">${Icons.skipBack}</button>
                <button class="mini_audio_btn mini_audio_play" title="Play / Pause">${Icons.play}</button>
                <button class="mini_audio_btn mini_audio_next" title="Next track">${Icons.skipForward}</button>
                <button class="mini_audio_btn mini_audio_hide" title="Hide controller">${Icons.chevronsRight}</button>
            </div>
        </div>
        <button class="mini_audio_peek" title="Show controller">${Icons.chevronLeft}</button>`;

        this.canvas = this.container.querySelector(".mini_audio_canvas");
        this.ctx = this.canvas.getContext("2d");
        this.titleEl = this.container.querySelector(".mini_audio_title");
        this.artistEl = this.container.querySelector(".mini_audio_artist");
        this.playBtn = this.container.querySelector(".mini_audio_play");

        const resize = () => {
            this.canvas.width = Math.max(1, this.canvas.clientWidth) * devicePixelRatio;
            this.canvas.height = Math.max(1, this.canvas.clientHeight) * devicePixelRatio;
        };
        resize();
        window.addEventListener("resize", resize);
        setTimeout(resize, 300);
    }

    _exec(cmd) {
        return new Promise(resolve => {
            // 5s cap: nowplaying-cli/osascript are fast, but a cold PowerShell
            // start on Windows can take a couple of seconds.
            require("child_process").exec(cmd, { timeout: 5000 }, (err, out) => {
                resolve(err ? null : String(out).trim());
            });
        });
    }

    // AppleScript via the absolute osascript path (safe even with a stripped PATH).
    _apple(script) {
        const q = String(script).replace(/'/g, "\\'");
        return this._exec(`/usr/bin/osascript -e '${q}'`);
    }

    // Run a nowplaying-cli command through the resolved absolute binary path.
    _npc(args) {
        if (!this._macNpc) return Promise.resolve(null);
        return this._exec(`"${this._macNpc}" ${args}`);
    }

    _checkBackend() {
        const fs = require("fs");

        // macOS - nowplaying-cli (MediaRemote) reaches every media app.
        if (this.platform === "darwin") {
            const candidates = [
                // Homebrew installs. Checked before `which`: a Finder launch has
                // a stripped PATH that omits /opt/homebrew/bin, which is exactly
                // why the old code silently fell back to AppleScript and woke
                // Apple Music on every startup.
                "/opt/homebrew/bin/nowplaying-cli",   // Apple Silicon
                "/usr/local/bin/nowplaying-cli",      // Intel
            ];
            if (process.resourcesPath) {
                // Optional bundled copy: drop a prebuilt binary at the app's
                // Resources/bin/ and eDEX ships its own nowplaying-cli.
                candidates.push(require("path").join(process.resourcesPath, "bin", "nowplaying-cli"));
            }
            for (const p of candidates) {
                try { if (fs.existsSync(p)) { this._macNpc = p; return Promise.resolve(); } } catch (e) {}
            }
            return this._exec("which nowplaying-cli").then(out => { if (out) this._macNpc = out; });
        }

        // Linux - playerctl is the standard MPRIS CLI.
        if (this.platform === "linux") {
            const candidates = ["/usr/bin/playerctl", "/usr/local/bin/playerctl", "/snap/bin/playerctl"];
            for (const p of candidates) {
                try { if (fs.existsSync(p)) { this._playerctl = p; return Promise.resolve(); } } catch (e) {}
            }
            return this._exec("which playerctl").then(out => { if (out) this._playerctl = out; });
        }

        // Windows - SMTC via the built-in PowerShell, staged to a temp file.
        if (this.platform === "win32") {
            try {
                const path = require("path"), os = require("os");
                this._winPs = path.join(os.tmpdir(), "edex-smtc.ps1");
                fs.writeFileSync(this._winPs, SMTC_PS1);
            } catch (e) { this._winPs = null; }
        }
        return Promise.resolve();
    }

    // AppleScript-capable players, checked in order; the first that is ALREADY
    // RUNNING is returned (never launched): "Music", then "Spotify".
    _appleTarget() {
        return this._apple('if application "Music" is running then return "Music"\nif application "Spotify" is running then return "Spotify"\nreturn ""').then(s => s || null);
    }

    async _poll() {
        if (this._polling) return;
        this._polling = true;
        try {
            if (this.platform === "darwin") {
                if (this._macNpc) await this._pollNPC();
                else await this._pollApple();
            } else if (this.platform === "linux") {
                await this._pollPlayerctl();
            } else if (this.platform === "win32") {
                await this._pollSMTC();
            }
        } finally {
            this._polling = false;
        }
    }

    // nowplaying-cli -> works for any registered media app (NetEase, Spotify...).
    async _pollNPC() {
        const state = await this._npc("get playbackState");
        this.playing = (state === "playing");
        const active = (state === "playing" || state === "paused");
        if (this.playBtn) this.playBtn.textContent = this.playing ? "⏸" : "▶";
        if (active) {
            const title = await this._npc("get title");
            const artist = await this._npc("get artist");
            const app = await this._npc("get app");
            if (this.titleEl) this.titleEl.textContent = title || (this.playing ? "Playing…" : "--");
            if (this.artistEl) this.artistEl.textContent = [artist, app].filter(Boolean).join(" · ");
        } else {
            if (this.titleEl) this.titleEl.textContent = "No music playing";
            if (this.artistEl) this.artistEl.textContent = "";
        }
    }

    // AppleScript fallback - only touches apps that are already running.
    async _pollApple() {
        const app = await this._appleTarget();
        if (!app) {
            this.playing = false;
            if (this.playBtn) this.playBtn.textContent = "▶";
            if (this.titleEl) this.titleEl.textContent = "No music · install nowplaying-cli";
            if (this.artistEl) this.artistEl.textContent = "";
            return;
        }
        const state = await this._apple(`tell application "${app}" to get player state`);
        this.playing = (state === "playing");
        if (this.playBtn) this.playBtn.textContent = this.playing ? "⏸" : "▶";
        if (state === "playing" || state === "paused") {
            const name = await this._apple(`tell application "${app}" to get name of current track`);
            const artist = await this._apple(`tell application "${app}" to get artist of current track`);
            if (this.titleEl) this.titleEl.textContent = name || "--";
            if (this.artistEl) this.artistEl.textContent = artist || "";
        } else {
            if (this.titleEl) this.titleEl.textContent = "No music playing";
            if (this.artistEl) this.artistEl.textContent = "";
        }
    }

    // playerctl / MPRIS - one metadata call carries status + player + title + artist.
    async _pollPlayerctl() {
        if (!this._playerctl) {
            this.playing = false;
            if (this.playBtn) this.playBtn.textContent = "▶";
            if (this.titleEl) this.titleEl.textContent = "No music · install playerctl";
            if (this.artistEl) this.artistEl.textContent = "";
            return;
        }
        const line = await this._exec(`${this._playerctl} metadata --format "{{status}}|{{playerName}}|{{title}}|{{artist}}"`);
        if (!line) {
            this.playing = false;
            if (this.playBtn) this.playBtn.textContent = "▶";
            if (this.titleEl) this.titleEl.textContent = "No music playing";
            if (this.artistEl) this.artistEl.textContent = "";
            return;
        }
        const [status, app, title, artist] = line.split("|");
        this.playing = (status === "Playing");
        if (this.playBtn) this.playBtn.textContent = this.playing ? "⏸" : "▶";
        if (this.titleEl) this.titleEl.textContent = title || "--";
        if (this.artistEl) this.artistEl.textContent = [artist, app].filter(Boolean).join(" · ");
    }

    // Windows SMTC - PowerShell prints "status|app|title|artist" or "none".
    async _pollSMTC() {
        if (!this._winPs) {
            this.playing = false;
            if (this.playBtn) this.playBtn.textContent = "▶";
            if (this.titleEl) this.titleEl.textContent = "No music playing";
            if (this.artistEl) this.artistEl.textContent = "";
            return;
        }
        const out = await this._exec(`powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${this._winPs}" -Command info`);
        if (!out || out === "none") {
            this.playing = false;
            if (this.playBtn) this.playBtn.textContent = "▶";
            if (this.titleEl) this.titleEl.textContent = "No music playing";
            if (this.artistEl) this.artistEl.textContent = "";
            return;
        }
        const [status, app, title, artist] = out.split("|");
        this.playing = (status === "Playing");
        if (this.playBtn) this.playBtn.textContent = this.playing ? "⏸" : "▶";
        if (this.titleEl) this.titleEl.textContent = title || "--";
        if (this.artistEl) this.artistEl.textContent = [artist, app].filter(Boolean).join(" · ");
    }

    _bind() {
        const btn = cls => this.container.querySelector(cls);
        const after = () => setTimeout(() => this._poll(), 350);
        // Route a transport action to whichever player is active. This never
        // launches a player: the macOS AppleScript path only talks to an
        // already-running app, and the OS backends only affect the current
        // media session.
        const ctrl = (npcArgs, appleCmd, pcCmd, psCmd) => {
            if (this.platform === "darwin") {
                if (this._macNpc) this._npc(npcArgs);
                else this._appleTarget().then(app => { if (app) this._apple(`tell application "${app}" to ${appleCmd}`); });
            } else if (this.platform === "linux" && this._playerctl) {
                this._exec(`${this._playerctl} ${pcCmd}`);
            } else if (this.platform === "win32" && this._winPs) {
                this._exec(`powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${this._winPs}" -Command ${psCmd}`);
            }
            after();
        };
        if (btn(".mini_audio_prev")) btn(".mini_audio_prev").onclick = () => ctrl("previous", "previous track", "previous", "prev");
        if (this.playBtn) this.playBtn.onclick = () => ctrl("togglePlayPause", "playpause", "play-pause", "toggle");
        if (btn(".mini_audio_next")) btn(".mini_audio_next").onclick = () => ctrl("next", "next track", "next", "next");
        if (btn(".mini_audio_hide")) btn(".mini_audio_hide").onclick = () => this.container.classList.add("mini_audio_hidden");
        if (btn(".mini_audio_peek")) btn(".mini_audio_peek").onclick = () => this.container.classList.remove("mini_audio_hidden");
        if (this.canvas) this.canvas.onclick = () => {
            this.mode = (this.mode === "bars") ? "wave" : "bars";
        };
    }

    _anim() {
        this._animStop = false;
        const draw = () => {
            if (this._animStop) return; // paused: stop scheduling frames
            requestAnimationFrame(draw);
            if (!this._visible) return; // safety: hidden, nothing to draw
            const w = this.canvas.width, h = this.canvas.height;
            if (w < 2 || h < 2) return;
            this.ctx.clearRect(0, 0, w, h);
            const cr = window.theme.r, cg = window.theme.g, cb = window.theme.b;
            const speed = this.playing ? 0.22 : 0.04;
            if (this.mode === "bars") {
                const bars = 18, bw = w / bars;
                for (let i = 0; i < bars; i++) {
                    this._phases[i] += speed;
                    const v = 0.15 + 0.85 * Math.abs(
                        Math.sin(this._phases[i]) * Math.sin(this._phases[i] * 0.53 + i * 1.7));
                    const bh = Math.max(2, v * h);
                    this.ctx.fillStyle = `rgba(${cr}, ${cg}, ${cb}, ${0.35 + 0.6 * v})`;
                    this.ctx.fillRect(i * bw + bw * 0.2, h - bh, bw * 0.6, bh);
                }
            } else {
                this._phases[0] += speed;
                const midY = h / 2;
                this.ctx.beginPath();
                for (let x = 0; x < w; x++) {
                    const y = midY
                        + Math.sin(x * 0.06 + this._phases[0]) * h * 0.32
                        + Math.sin(x * 0.11 - this._phases[0] * 1.3) * h * 0.1;
                    if (x === 0) this.ctx.moveTo(x, y);
                    else this.ctx.lineTo(x, y);
                }
                this.ctx.strokeStyle = `rgba(${cr}, ${cg}, ${cb}, 0.9)`;
                this.ctx.lineWidth = 2;
                this.ctx.stroke();
            }
        };
        draw();
    }
}

module.exports = {
    MiniAudio
};
