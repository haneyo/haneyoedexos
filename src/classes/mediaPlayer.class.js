class MediaPlayer {
    constructor(opts) {
        const modalElementId = "modal_" + opts.modalId;
        const type = opts.type;
        const icons = require("./assets/icons/file-icons.json");
        const iconcolor = `rgb(${window.theme.r}, ${window.theme.g}, ${window.theme.b})`;
        const mediaContainer = document.getElementById(modalElementId).querySelector(".media_container");
        const media = document.getElementById(modalElementId).querySelector(type);
        const mediaControls = document.getElementById(modalElementId).querySelector(".media_controls");
        const playpause = document.getElementById(modalElementId).querySelector(".playpause");
        const volumeIcon = document.getElementById(modalElementId).querySelector(".volume_icon");
        const volume = document.getElementById(modalElementId).querySelector(".volume");
        const volumeBar = document.getElementById(modalElementId).querySelector(".volume_bar");
        const progress = document.getElementById(modalElementId).querySelector(".progress");
        const progressBar = document.getElementById(modalElementId).querySelector(".progress_bar");
        const fullscreen = document.getElementById(modalElementId).querySelector(".fs");
        const mediaTime = document.getElementById(modalElementId).querySelector(".media_time");

        let volumeDrag = false;
        let fullscreenVisible = true;
        let fullscreenTimeout;
        media.controls = false;
        mediaControls.setAttribute("data-state", "visible");

        this.changeButtonState = (type) => {
            if (media.paused || media.ended) {
                playpause.setAttribute("data-state", "play");
                playpause.innerHTML = `
                    <svg viewBox="0 0 ${icons["play"].width} ${icons["play"].height}" fill="${iconcolor}">
                        ${icons["play"].svg}
                    </svg>`;
            } else {
                playpause.setAttribute("data-state", "pause");
                // The pause glyph is two open line segments, so it needs stroke
                // (a filled open path renders as nothing -> invisible button).
                playpause.innerHTML = `
                    <svg viewBox="0 0 ${icons["pause"].width} ${icons["pause"].height}" fill="none" stroke="${iconcolor}" stroke-width="5" stroke-linecap="round">
                        ${icons["pause"].svg}
                    </svg>`;
            }
        };

        this.setFullscreenData = (state) => {
            if (fullscreen === null) { return; }
            mediaContainer.setAttribute("data-fullscreen", !!state);
            fullscreen.setAttribute("data-state", !!state ? "cancel-fullscreen" : "go-fullscreen");
            const buttonIcon = !!state ? "fullscreen-exit" : "fullscreen";
            fullscreen.innerHTML = `
                <svg viewBox="0 0 ${icons[buttonIcon].width} ${icons[buttonIcon].height}" fill="${iconcolor}">
                    ${icons[buttonIcon].svg}
                </svg>`;
        };

        this.handleFullscreen = () => {
            if (document.fullscreenElement) {
                document.exitFullscreen();
                this.setFullscreenData(false);

                mediaContainer.removeEventListener('mousemove', this.handleFullscreenControls);
                fullscreenVisible = true;
                clearTimeout(fullscreenTimeout);
                this.fullscreenVisible();
            } else {
                mediaContainer.requestFullscreen();
                this.setFullscreenData(true);

                fullscreenVisible = false;
                this.fullscreenHidden();
                mediaContainer.addEventListener('mousemove', this.handleFullscreenControls);
            }
        };

        this.handleFullscreenControls = () => {
            if (!fullscreenVisible) {
                fullscreenVisible = true
                this.fullscreenVisible();

                clearTimeout(fullscreenTimeout);

                fullscreenTimeout = setTimeout(() => {
                    fullscreenVisible = false;
                    this.fullscreenHidden();
                }, 2000);
            }
        };

        this.fullscreenHidden = () => {
            mediaContainer.style.cursor = "none";
            mediaControls.classList.add("fullscreen_hidden");
        };

        this.fullscreenVisible = () => {
            mediaContainer.style.cursor = "default";
            mediaControls.classList.remove("fullscreen_hidden");
        };

        this.mediaTimeToHMS = (time) => {
            let seconds = parseInt(time)
            const hours = parseInt(seconds / 3600);
            seconds = seconds % 3600;
            const minutes = parseInt(seconds / 60);
            seconds = seconds % 60;
            return (hours < 10 ? "0" : "") + hours + ":" +
                (minutes < 10 ? "0" : "") + minutes + ":" +
                (seconds < 10 ? "0" : "") + seconds;
        };

        this.updateVolume = (x) => {
            // Measure the clickable .volume element itself (not the absolutely
            // positioned fill) so clicks map 1:1 to the visible bar, even when
            // the flex layout shrinks the control.
            const rect = volume.getBoundingClientRect();
            let vol = (x - rect.left) / rect.width;
            if (vol > 1) {
                vol = 1;
            }
            if (vol < 0) {
                vol = 0;
            }
            volumeBar.style.width = (vol * 100) + "%";
            const knob = volume.querySelector(".volume_knob");
            if (knob) knob.style.left = (vol * 100) + "%";
            media.volume = vol;
            this.updateVolumeIcon(vol);
        };

        const volIcon = (muted) => (muted
            ? `<svg viewBox="0 0 24 24" fill="none" stroke="${iconcolor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M11 5 6 9H2v6h4l5 4z"/>
                <line x1="23" y1="9" x2="17" y2="15"/>
                <line x1="17" y1="9" x2="23" y2="15"/>
               </svg>`
            : `<svg viewBox="0 0 24 24" fill="none" stroke="${iconcolor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M11 5 6 9H2v6h4l5 4z"/>
                <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
               </svg>`);

        this.updateVolumeIcon = (vol) => {
            volumeIcon.innerHTML = volIcon(vol <= 0);
        };

        // Audio shows "current / total", video just the current position.
        const isAudio = mediaContainer.classList.contains("audio_player");
        const fmtTime = () => {
            const cur = this.mediaTimeToHMS(media.currentTime);
            if (!isAudio) return cur;
            return cur + " / " + (media.duration ? this.mediaTimeToHMS(media.duration) : "00:00:00");
        };
        // Size the video container to the video's rendered dimensions so the
        // transport bar matches a portrait/landscape clip instead of spanning
        // the whole box. Called on multiple events in case one fires early.
        const sizeVideo = () => {
            if (type !== "video") return;
            const vw = media.videoWidth, vh = media.videoHeight;
            if (vw && vh) {
                const maxW = window.innerWidth * 0.46;
                const maxH = window.innerHeight * 0.5;
                const scale = Math.min(maxW / vw, maxH / vh, 1);
                const w = Math.round(vw * scale);
                mediaContainer.style.width = w + "px";
                // Scale the transport controls to fit the (possibly narrow)
                // container: full size when the video fills 46vw, smaller when
                // a portrait clip leaves a narrow box.
                const ctrlScale = Math.min(1, w / maxW);
                mediaContainer.style.setProperty("--ctrl-scale", ctrlScale);
            }
        };
        sizeVideo();
        media.addEventListener("loadedmetadata", sizeVideo);
        media.addEventListener("loadeddata", sizeVideo);
        media.addEventListener("resize", sizeVideo);
        sizeVideo();
        media.addEventListener("loadedmetadata", sizeVideo);
        media.addEventListener("loadeddata", sizeVideo);
        media.addEventListener("resize", sizeVideo);

        media.addEventListener("loadedmetadata", () => {
            mediaTime.textContent = fmtTime();
        });

        // Audio "classified recording" status strip: STANDBY / PLAYING / ENDED.
        const statusText = document.getElementById(modalElementId).querySelector(".audio_status_text");
        const statusDot = document.getElementById(modalElementId).querySelector(".audio_status_dot");
        const updateStatus = () => {
            if (!statusText) return; // video player has no status strip
            const playing = !media.paused && !media.ended;
            statusText.textContent = playing ? "PLAYING" : (media.ended ? "ENDED" : "STANDBY");
            if (statusDot) statusDot.style.background = playing ? "#ff4d4d" : "";
            mediaContainer.classList.toggle("playing", playing);
        };
        media.addEventListener("play", updateStatus);
        media.addEventListener("pause", updateStatus);
        media.addEventListener("ended", updateStatus);
        updateStatus();

        // The audio modal's title bar is hidden (the file name lives in the
        // status strip instead), so make the status strip a drag handle too.
        if (isAudio) {
            const status = mediaContainer.querySelector(".audio_status");
            const modalEl = document.getElementById(modalElementId);
            if (status && modalEl) {
                let dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;
                status.addEventListener("mousedown", (e) => {
                    if (e.target.closest("button, input, .volume, .progress, canvas")) return;
                    dragging = true;
                    sx = e.clientX; sy = e.clientY;
                    const r = modalEl.getBoundingClientRect();
                    ox = r.left; oy = r.top;
                    e.preventDefault();
                });
                document.addEventListener("mousemove", (e) => {
                    if (!dragging) return;
                    modalEl.style.left = (ox + e.clientX - sx) + "px";
                    modalEl.style.top = (oy + e.clientY - sy) + "px";
                });
                document.addEventListener("mouseup", () => { dragging = false; });
            }
        }

        media.addEventListener("play", () => { this.changeButtonState("playpause") }, false);
        media.addEventListener("pause", () => { this.changeButtonState("playpause") }, false);
        media.addEventListener("timeupdate", () => {
            progressBar.style.width = Math.floor((media.currentTime / media.duration) * 100) + "%";
            mediaTime.textContent = fmtTime();
        });

        volume.addEventListener("mousedown", (e) => {
            volumeDrag = true;
            media.muted = false;
            this.updateVolume(e.clientX);
        });

        volumeIcon.addEventListener("click", () => {
            media.muted = !media.muted;
            this.updateVolumeIcon(media.muted ? 0 : media.volume);
        });

        // Seek via click or drag - viewport-relative rect keeps the math correct
        // with the absolutely-positioned controls bar.
        let seeking = false;
        const seek = (e) => {
            const rect = progress.getBoundingClientRect();
            const pos = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
            if (media.duration) media.currentTime = pos * media.duration;
        };
        progress.addEventListener("mousedown", (e) => { seeking = true; seek(e); e.preventDefault(); });
        document.addEventListener("mousemove", (e) => { if (seeking) seek(e); });
        document.addEventListener("mouseup", () => { seeking = false; });
        playpause.addEventListener("click", () => {
            (media.paused || media.ended) ? media.play(): media.pause();
        });
        if (fullscreen) fullscreen.addEventListener("click", () => { this.handleFullscreen() });

        document.addEventListener("fullscreenchange", () => {
            this.setFullscreenData(!!(document.fullscreenElement));
        });
        document.addEventListener("mouseup", (e) => {
            if (volumeDrag) {
                volumeDrag = false;
                this.updateVolume(e.clientX);
            }
        });
        document.addEventListener("mousemove", (e) => {
            if (volumeDrag) {
                this.updateVolume(e.clientX);
            }
        });

        // Auto-hide the video transport controls while idle during playback.
        if (type === "video") {
            let hideTimer = null;
            const showVideoControls = () => {
                mediaContainer.classList.remove("media_controls_hidden");
                clearTimeout(hideTimer);
                if (!media.paused && !media.ended) {
                    hideTimer = setTimeout(() => mediaContainer.classList.add("media_controls_hidden"), 2500);
                }
            };
            mediaContainer.addEventListener("mousemove", showVideoControls);
            mediaContainer.addEventListener("mousedown", showVideoControls);
            mediaContainer.addEventListener("mouseleave", () => {
                if (!media.paused && !media.ended) mediaContainer.classList.add("media_controls_hidden");
            });
            media.addEventListener("play", showVideoControls);
            media.addEventListener("pause", () => {
                clearTimeout(hideTimer);
                mediaContainer.classList.remove("media_controls_hidden");
            });
            media.addEventListener("seeked", showVideoControls);
        }

        // Retro spectrum bars for audio, powered by the Web Audio API so the
        // bars reflect the actual frequency content of what is playing.
        if (type === "audio") {
            const spectrum = mediaContainer.querySelector(".media_spectrum");
            const modeLabel = mediaContainer.querySelector(".media_spectrum_mode");
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (spectrum && AudioCtx) {
                try {
                    const actx = new AudioCtx();
                    const source = actx.createMediaElementSource(media);
                    const analyser = actx.createAnalyser();
                    analyser.fftSize = 1024;
                    analyser.smoothingTimeConstant = 0.82;
                    source.connect(analyser);
                    analyser.connect(actx.destination);
                    const data = new Uint8Array(analyser.frequencyBinCount);
                    const wave = new Uint8Array(analyser.fftSize);
                    const g = spectrum.getContext("2d");
                    // Click the strip to toggle SPECTRUM bars / mirrored WAVEFORM.
                    let mode = "bars";
                    const setModeLabel = () => { if (modeLabel) modeLabel.textContent = (mode === "bars") ? "SPECTRUM" : "WAVEFORM"; };
                    spectrum.style.cursor = "pointer";
                    spectrum.title = "Click to toggle SPECTRUM / WAVEFORM";
                    spectrum.addEventListener("click", () => {
                        mode = (mode === "bars") ? "mirror" : "bars";
                        setModeLabel();
                    });
                    setModeLabel();
                    const resize = () => {
                        spectrum.width = Math.max(1, spectrum.clientWidth) * devicePixelRatio;
                        spectrum.height = Math.max(1, spectrum.clientHeight) * devicePixelRatio;
                    };
                    resize();
                    window.addEventListener("resize", resize);
                    // The modal sizes itself asynchronously, so re-measure once
                    // layout settles and keep the canvas in sync on any change.
                    setTimeout(resize, 300);
                    if (typeof ResizeObserver === "function") {
                        try {
                            const ro = new ResizeObserver(resize);
                            ro.observe(spectrum.parentElement || spectrum);
                        } catch (e) {}
                    }
                    media.addEventListener("play", () => {
                        if (actx.state === "suspended") actx.resume();
                    });
                    const BARS = 64;
                    const draw = () => {
                        requestAnimationFrame(draw);
                        const w = spectrum.width, h = spectrum.height;
                        g.clearRect(0, 0, w, h);
                        const cr = window.theme.r, cg = window.theme.g, cb = window.theme.b;
                        if (mode === "mirror") {
                            // Mirror-image time-domain waveform (oscilloscope look).
                            analyser.getByteTimeDomainData(wave);
                            const midY = h / 2;
                            g.fillStyle = `rgb(${cr}, ${cg}, ${cb})`;
                            for (let x = 0; x < w; x++) {
                                const v = (wave[Math.floor(x / w * wave.length)] - 128) / 128;
                                const y = midY + v * (h * 0.42);
                                g.globalAlpha = 0.35 + 0.65 * (1 - Math.abs(v));
                                g.fillRect(x, y, 1, 1);
                                g.fillRect(x, h - y, 1, 1);
                            }
                            g.globalAlpha = 1;
                        } else {
                            analyser.getByteFrequencyData(data);
                            const bw = w / BARS;
                            for (let i = 0; i < BARS; i++) {
                                // Quadratic mapping concentrates bars on the musical
                                // low/mid range, like a classic equalizer.
                                const bin = Math.floor(Math.pow(i / BARS, 2) * (data.length - 1));
                                const v = data[bin] / 255;
                                const bh = Math.max(2, v * h);
                                g.fillStyle = `rgba(${cr}, ${cg}, ${cb}, ${0.3 + 0.65 * v})`;
                                g.fillRect(i * bw + bw * 0.2, h - bh, bw * 0.6, bh);
                            }
                        }
                    };
                    draw();
                } catch (e) {
                    // Web Audio unavailable (e.g. graph already taken) - the
                    // player still works, just without the visualizer.
                }
            }
            // Probe & display codec / sample rate / channels / bitrate via the
            // bundled ffmpeg (`ffmpeg -i` prints the stream info to stderr).
            let ffmpeg;
            try { ffmpeg = require("ffmpeg-static"); } catch (e) {}
            if (ffmpeg) {
                require("child_process").execFile(ffmpeg, ["-i", opts.path], { timeout: 8000 }, (err, stdout, stderr) => {
                    const s = stderr || "";
                    const set = (id, val) => { let el = document.getElementById("audio_info_" + id); if (el && val) el.textContent = val; };
                    let m;
                    set("codec", (m = s.match(/Audio:\s*([a-z0-9]+)/i)) ? m[1].toUpperCase() : null);
                    set("rate", (m = s.match(/(\d+)\s*Hz/)) ? (Math.round(+m[1] / 100) / 10 + " kHz") : null);
                    set("ch", (m = s.match(/(\d+)\s*Hz,\s*([a-z0-9.]+)/i)) ? m[2].toUpperCase() : null);
                    set("bitrate", (m = s.match(/(\d+)\s*kb\/s/)) ? m[1] + " kbps" : null);
                });
            }
        }

        // Autoplay may have already started before these event listeners were
        // bound, so sync the play/pause button to the current media state.
        this.changeButtonState("playpause");
    }
}

module.exports = {
    MediaPlayer
};
