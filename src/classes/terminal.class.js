class Terminal {
    constructor(opts) {
        if (opts.role === "client") {
            if (!opts.parentId) throw "Missing options";

            this.xTerm = require("xterm").Terminal;
            const {AttachAddon} = require("xterm-addon-attach");
            const {FitAddon} = require("xterm-addon-fit");
            const {LigaturesAddon} = require("xterm-addon-ligatures");
            this.Ipc = require("electron").ipcRenderer;

            this.port = opts.port || 3000;
            this.muted = !!opts.muted;
            this.cwd = "";
            this.oncwdchange = () => {};
            // Alternate-screen history (#67): frames captured by the write
            // wrapper (below) land here, newest first, capped at 400 frames
            // (≈100s of alt-screen output).
            this._altHist = [];
            this._altHistIdx = 0;
            this._altLast = "";
            this._altPaused = false;
            // Browsers (the CLI browser = w3m) draw to the alt buffer but must
            // stay live. cliPanel session ids are "<appId>_<rand>", so the
            // browser's parentId (id stays "links2" for compatibility) opts out
            // of #67 alt-history: frozen history frames made the page look
            // unresponsive after a wheel-up. Wheel is then forwarded so the
            // browser can scroll its own page.
            this._altHistEnabled = opts.altHistory !== false && !/^links2_/.test(opts.parentId || "");
            this._altLastT = 0;
            this._serializeA = null;

            this._sendSizeToServer = () => {
                let cols = this.term.cols.toString();
                let rows = this.term.rows.toString();
                while (cols.length < 3) {
                    cols = "0"+cols;
                }
                while (rows.length < 3) {
                    rows = "0"+rows;
                }
                this.Ipc.send("terminal_channel-"+this.port, "Resize", cols, rows);
            };

            // Support for custom color filters on the terminal - see #483
            let doCustomFilter = (window.isTermFilterValidated) ? true : false;

            // Parse & validate color filter
            if (window.isTermFilterValidated !== true && typeof window.theme.terminal.colorFilter === "object" && window.theme.terminal.colorFilter.length > 0) {
                doCustomFilter = window.theme.terminal.colorFilter.every((step, i, a) => {
                    let func = step.slice(0, step.indexOf("("));

                    switch(func) {
                        case "negate":
                        case "grayscale":
                            a[i] = {
                                func,
                                arg: []
                            };
                            return true;
                        case "lighten":
                        case "darken":
                        case "saturate":
                        case "desaturate":
                        case "whiten":
                        case "blacken":
                        case "fade":
                        case "opaquer":
                        case "rotate":
                        case "mix":
                            break;
                        default:
                            return false;
                    }

                    let arg = step.slice(step.indexOf("(")+1, step.indexOf(")"));

                    if (typeof Number(arg) === "number") {
                        a[i] = {
                            func,
                            arg: [Number(arg)]
                        };
                        window.isTermFilterValidated = true;
                        return true;
                    }

                    return false;
                });
            }

            let color = require("color");
            let colorify;
            if (doCustomFilter) {
                colorify = (base, target) => {
                    let newColor = color(base);
                    target = color(target);

                    for (let i = 0; i < window.theme.terminal.colorFilter.length; i++) {
                        if (window.theme.terminal.colorFilter[i].func === "mix") {
                            newColor = newColor[window.theme.terminal.colorFilter[i].func](target, ...window.theme.terminal.colorFilter[i].arg);
                        } else {
                            newColor = newColor[window.theme.terminal.colorFilter[i].func](...window.theme.terminal.colorFilter[i].arg);
                        }
                    }

                    return newColor.hex();
                };
            } else {
                colorify = (base, target) => {
                    return color(base).grayscale().mix(color(target), 0.3).hex();
                };
            }

            let themeColor = `rgb(${window.theme.r}, ${window.theme.g}, ${window.theme.b})`;

            // The terminal background is made semi-transparent so the sci-fi
            // backdrop grid shows through, consistent with the rest of the UI.
            // The xterm canvas renderer in 4.14 paints the theme background as an
            // OPAQUE color even when given an alpha (allowTransparency is
            // unreliable), so the theme background is passed as fully transparent
            // and the translucent tint lives on `.xterm-viewport` in CSS instead.
            let termBg = "rgba(0, 0, 0, 0)";

            this.term = new this.xTerm({
                cols: 80,
                rows: 24,
                cursorBlink: window.theme.terminal.cursorBlink || true,
                cursorStyle: window.theme.terminal.cursorStyle || "block",
                allowTransparency: true,
                // xterm renders in a fixed character grid, so it MUST use a
                // monospace font - a proportional UI font breaks column alignment.
                // The bundled font (Fira Mono by default) has no CJK glyphs; the
                // image ships fonts-noto-cjk, so append system CJK fallbacks so
                // Chinese / Japanese / Korean render (browser pages etc.) instead
                // of blank cells.
                fontFamily: (window.theme.terminal.fontFamily || "Fira Mono") +
                    ', "Noto Sans Mono CJK SC", "Noto Sans CJK SC", "Noto Sans CJK TC", "Noto Sans CJK JP", "Noto Sans CJK KR", "WenQuanYi Zen Hei Mono", monospace',
                fontSize: window.theme.terminal.fontSize || window.settings.termFontSize || 11,
                fontWeight: window.theme.terminal.fontWeight || "normal",
                fontWeightBold: window.theme.terminal.fontWeightBold || "bold",
                letterSpacing: window.theme.terminal.letterSpacing || 0,
                lineHeight: window.theme.terminal.lineHeight || 1,
                scrollback: 1500,
                enableMouseEvents: true,
                bellStyle: "none",
                theme: {
                    foreground: window.theme.terminal.foreground,
                    background: termBg,
                    cursor: window.theme.terminal.cursor,
                    cursorAccent: window.theme.terminal.cursorAccent,
                    selection: window.theme.terminal.selection,
                    black: window.theme.colors.black || colorify("#2e3436", themeColor),
                    red: window.theme.colors.red || colorify("#cc0000", themeColor),
                    green: window.theme.colors.green || colorify("#4e9a06", themeColor),
                    yellow: window.theme.colors.yellow || colorify("#c4a000", themeColor),
                    blue: window.theme.colors.blue || colorify("#3465a4", themeColor),
                    magenta: window.theme.colors.magenta || colorify("#75507b", themeColor),
                    cyan: window.theme.colors.cyan || colorify("#06989a", themeColor),
                    white: window.theme.colors.white || colorify("#d3d7cf", themeColor),
                    brightBlack: window.theme.colors.brightBlack || colorify("#555753", themeColor),
                    brightRed: window.theme.colors.brightRed || colorify("#ef2929", themeColor),
                    brightGreen: window.theme.colors.brightGreen || colorify("#8ae234", themeColor),
                    brightYellow: window.theme.colors.brightYellow || colorify("#fce94f", themeColor),
                    brightBlue: window.theme.colors.brightBlue || colorify("#729fcf", themeColor),
                    brightMagenta: window.theme.colors.brightMagenta || colorify("#ad7fa8", themeColor),
                    brightCyan: window.theme.colors.brightCyan || colorify("#34e2e2", themeColor),
                    brightWhite: window.theme.colors.brightWhite || colorify("#eeeeec", themeColor)
                }
            });
            let fitAddon = new FitAddon();
            this.term.loadAddon(fitAddon);
            // Alternate-screen history capture: vim/htop/less draw into the alt
            // buffer, which has no scrollback, so the wheel can't scroll them.
            // While the active buffer is alt, snapshot a frame every 250ms via
            // SerializeAddon into _altHist (newest first). While _altPaused
            // (user is paging through history) live writes are swallowed so the
            // view stays put; the wheel handler below drives the paging.
            this._ow = this.term.write.bind(this.term);
            this.term.write = data => {
                try {
                    const buf = this.term.buffer && this.term.buffer.active;
                    if (this._altPaused && (!buf || buf.type !== "alt")) this._altPaused = false;
                    if (this._altPaused) return;
                    if (this._altHistEnabled && buf && buf.type === "alt") {
                        const now = Date.now();
                        if (now - this._altLastT > 250) {
                            this._altLastT = now;
                            if (!this._serializeA) {
                                const { SerializeAddon } = require("xterm-addon-serialize");
                                this._serializeA = new SerializeAddon();
                                try { this.term.loadAddon(this._serializeA); } catch (e) {}
                            }
                            const frame = this._serializeA ? this._serializeA.serialize() : "";
                            const prev = this._altHist[0];
                            if (frame && frame !== prev) {
                                this._altLast = frame;
                                this._altHist.unshift(frame);
                                if (this._altHist.length > 400) this._altHist.pop();
                                this._altHistIdx = 0;
                            }
                        }
                    }
                } catch (e) {}
                this._ow(data);
            };
            this.term.open(document.getElementById(opts.parentId));
            // Re-fit whenever the terminal container changes size (window
            // resize, module entrance animations, layout shifts), so the
            // character grid always wraps exactly at the terminal frame.
            // fit() is a no-op when dimensions are unchanged, so this observer
            // is cheap to keep around.
            if (typeof ResizeObserver !== "undefined" && this.term.element && this.term.element.parentElement) {
                this._resizeObserver = new ResizeObserver(() => this.fit());
                this._resizeObserver.observe(this.term.element.parentElement);
            }
            // WebGL is intentionally not loaded here: its renderer mishandles
            // allowTransparency (premultiplied alpha), painting the translucent
            // terminal background as an opaque, wrong color. The default canvas
            // renderer composites the semi-transparent background correctly.
            let ligaturesAddon = new LigaturesAddon();
            this.term.loadAddon(ligaturesAddon);
            this.term.attachCustomKeyEventHandler(e => {
                if (e.type === "keydown") {
                    const buf = this.term.buffer && this.term.buffer.active;
                    // Alternate-screen apps (vim, htop, …) get the keys untouched.
                    if (buf && buf.type === "normal") {
                        const rows = this.term.rows || 24;
                        // PgUp/PgDn always scroll the scrollback; Up/Down only
                        // once the user has scrolled up (at the bottom they fall
                        // through to the shell, e.g. bash history). Returning
                        // false swallows the key so it never reaches the pty.
                        if (e.key === "PageUp") { this.term.scrollLines(-rows); return false; }
                        if (e.key === "PageDown") { this.term.scrollLines(rows); return false; }
                        const scrolledUp = buf.viewportY > buf.baseY;
                        if ((e.key === "ArrowUp" || e.key === "ArrowDown") && scrolledUp) {
                            this.term.scrollLines(e.key === "ArrowUp" ? -1 : 1);
                            return false;
                        }
                    }
                }
                return true;
            });
            // Prevent the soft-keyboard on touch devices #733 - but ONLY there.
            // On desktop the xterm helper textarea must stay editable, otherwise
            // IME composition (Chinese / Japanese / Korean input) can never
            // commit its text into the buffer and the shell receives nothing.
            if ("ontouchstart" in window) {
                document.querySelectorAll('.xterm-helper-textarea').forEach(textarea => textarea.setAttribute('readonly', 'readonly'));
            }
            this.term.focus();

            this.Ipc.send("terminal_channel-"+this.port, "Renderer startup");
            this.Ipc.on("terminal_channel-"+this.port, (e, ...args) => {
                switch(args[0]) {
                    case "New cwd":
                        this.cwd = args[1];
                        this.oncwdchange(this.cwd);
                        break;
                    case "Fallback cwd":
                        this.cwd = "FALLBACK |-- "+args[1];
                        this.oncwdchange(this.cwd);
                        break;
                    case "New process":
                        if (this.onprocesschange) {
                            this.onprocesschange(args[1]);
                        }
                        break;
                    default:
                        return;
                }
            });
            this.resendCWD = () => {
                this.oncwdchange(this.cwd || null);
            };

            let sockHost = opts.host || "127.0.0.1";
            let sockPort = this.port;

            // WebSocket reconnect (#67): a suspend (lid close) can freeze the
            // main-process node-pty / ws server; on resume the socket is dead
            // and sends silently fail — "page shows but you can't type". Build
            // the connection through _wsConn() and auto-reconnect 1.5s after an
            // unexpected close, rebuilding the AttachAddon each time (message
            // listeners live inside _wsConn so they re-attach on reconnect). The
            // DOM liveness check stops reconnects for closed tabs (zombie
            // sockets). resumeFromSuspend calls reconnectNow() on resume.
            this._closing = false;
            this._rcT = null;
            this._attachAddon = null;
            this.reconnectNow = () => {
                try {
                    if (this._rcT) { clearTimeout(this._rcT); this._rcT = null; }
                    if (this._wsConn) this._wsConn();
                } catch (e) {}
            };
            this._wsConn = () => {
                this.socket = new WebSocket("ws://"+sockHost+":"+sockPort);
                this.socket.onopen = () => {
                    try { if (this._attachAddon) this._attachAddon.dispose(); } catch (e) {}
                    try { this._attachAddon = new AttachAddon(this.socket); } catch (e) { this._attachAddon = null; }
                    try { this.term.loadAddon(this._attachAddon); } catch (e) {}
                    this.fit();
                    // Re-assert keyboard focus once the pty link is up, so the
                    // very first keystroke after a slow tab spawn isn't lost
                    // (#13).
                    try { this.term.focus(); } catch (e) {}
                };
                this.socket.onerror = () => { try { this.socket.close(); } catch (e) {} };
                this.socket.onclose = e => {
                    if (this.onclose) this.onclose(e);
                    if (this._closing) return;
                    // Tab closed? Don't keep a zombie reconnect loop going.
                    try {
                        if (!(this.term && this.term.element && document.body.contains(this.term.element))) return;
                    } catch (e) { return; }
                    if (this._rcT) clearTimeout(this._rcT);
                    this._rcT = setTimeout(() => { try { this._wsConn(); } catch (e) {} }, 1500);
                };
                this.socket.addEventListener("message", e => {
                    let d = Date.now();

                    // muted terminals (the cover session's inert cat pty) must
                    // not chime — the screensaver/lock streams fake content,
                    // not real output, so its stdout sound would be noise (#50).
                    if (!this.muted && d - this.lastSoundFX > 30) {
                        window.audioManager.stdout.play();
                        this.lastSoundFX = d;
                    }
                    // #9 completion chime: after a user-typed command's output
                    // goes quiet for 1.5s, play the info sound once.
                    if (this._doneT) clearTimeout(this._doneT);
                    this._lastOut = d;
                    this._doneT = setTimeout(() => {
                        this._doneT = null;
                        if (!this.muted && this._userIn && Date.now() - this._lastOut >= 1500) {
                            try { window.audioManager && window.audioManager.info && window.audioManager.info.play(); } catch (_) {}
                        }
                    }, 1500);

                    if (d - this.lastRefit > 10000) {
                        this.fit();
                    }

                    // See #397
                    if (!window.settings.experimentalGlobeFeatures) return;
                    let ips = e.data.match(/((25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)/g);
                    if (ips !== null && ips.length >= 1) {
                        ips = ips.filter((val, index, self) => { return self.indexOf(val) === index; });
                        ips.forEach(ip => {
                            window.mods.globe.addTemporaryConnectedMarker(ip);
                        });
                    }
                });
            };
            this.lastSoundFX = Date.now();
            this._wsConn();

            let parent = document.getElementById(opts.parentId);
            // Wheel scrolling is owned here so speed/direction can be configured
            // (settings.terminalScrollSensitivity / .terminalScrollDirection).
            // Capture phase + stopPropagation so xterm's built-in viewport
            // handler does not also scroll (that double-scrolled before, and
            // the old Math.round(deltaY/10) snapped small trackpad deltas to 0).
            // Deltas are accumulated so smooth trackpad scrolling works.
            parent.addEventListener("wheel", e => {
                // Alternate screen (vim/htop/less): wheel pages through the
                // captured frame history. Up enters history view (further up =
                // older), down goes newer, and scrolling past either end
                // returns to live output. Exit also auto-clears _altPaused in
                // the write wrapper when the app leaves the alt buffer.
                const abuf = this.term && this.term.buffer && this.term.buffer.active;
                if (abuf && abuf.type === "alt") {
                    // Browser (w3m) opts out of #67 alt-history: don't
                    // swallow the wheel — xterm forwards it so the page scrolls.
                    if (!this._altHistEnabled) return;
                    e.preventDefault();
                    e.stopPropagation();
                    const dy = e.deltaY;
                    if (dy < 0) {
                        if (this._altPaused) {
                            if (this._altHistIdx < this._altHist.length - 1) {
                                this._altHistIdx++;
                            } else {
                                this._altPaused = false;
                                this._altHistIdx = 0;
                                this.term.reset();
                                if (this._altLast) this._ow(this._altLast);
                            }
                        } else if (this._altHist.length) {
                            this._altPaused = true;
                            this._altHistIdx = Math.min(1, this._altHist.length - 1);
                        }
                        if (this._altPaused) {
                            const h = this._altHist[this._altHistIdx];
                            if (h) { this.term.reset(); this._ow(h); }
                        }
                    } else if (dy > 0 && this._altPaused) {
                        if (this._altHistIdx > 0) {
                            this._altHistIdx--;
                        } else {
                            this._altPaused = false;
                            this._altHistIdx = 0;
                            this.term.reset();
                            if (this._altLast) this._ow(this._altLast);
                        }
                    }
                    return;
                }
                e.preventDefault();
                e.stopPropagation();
                const sens = Number(window.settings.terminalScrollSensitivity);
                const wheel = Number(window.settings.mouseWheelSpeed);
                const speed = ((isFinite(sens) && sens > 0) ? sens : 1)
                    * ((isFinite(wheel) && wheel > 0) ? wheel : 1);
                const dir = window.settings.terminalScrollDirection === "reversed" ? -1 : 1;
                this._wheelAcc = (this._wheelAcc || 0) + e.deltaY * speed;
                const lines = Math.trunc(this._wheelAcc / 8);
                if (lines !== 0) {
                    this.term.scrollLines(dir * lines);
                    this._wheelAcc -= lines * 8;
                }
            }, { capture: true, passive: false });
            this._lastTouchY = null;
            parent.addEventListener("touchstart", e => {
                this._lastTouchY = e.targetTouches[0].screenY;
            });
            parent.addEventListener("touchmove", e => {
                if (this._lastTouchY) {
                    let y = e.changedTouches[0].screenY;
                    let deltaY = y - this._lastTouchY;
                    this._lastTouchY = y;
                    this.term.scrollLines(-Math.round(deltaY/10));
                }
            });
            parent.addEventListener("touchend", e => {
                this._lastTouch = null;
            });
            parent.addEventListener("touchcancel", e => {
                this._lastTouch = null;
            });

            // Scope to THIS terminal's helper textarea: the old code took the
            // first .xterm-helper-textarea on the page, so every terminal tab
            // attached its F11 handler to tab 0's textarea. Guard the lookup so
            // a missing element can't crash the constructor (#13/#14).
            const helperTextarea = this.term.element && this.term.element.querySelector(".xterm-helper-textarea");
            if (helperTextarea) helperTextarea.addEventListener("keydown", e => {
                if (e.key === "F11" && window.settings.allowWindowed) {
                    e.preventDefault();
                    window.toggleFullScreen();
                }
            });

            this.fit = () => {
                this.lastRefit = Date.now();
                // FitAddon already floors to the largest cols/rows that fully
                // fit inside the container, so long lines wrap exactly at the
                // terminal frame. The old ratio-based "+x/+y" adjustments (#302)
                // overshot on some screen sizes and pushed the last column/row
                // past the visible edge, clipping the output.
                let dims = fitAddon.proposeDimensions();
                if (!dims || typeof dims.cols === "undefined" || typeof dims.rows === "undefined") return;
                // A hidden / mid-animation container reports fractional or 0
                // dims; xterm's resize() rejects non-integers with "This API
                // only accepts integers" (#48). Floor and clamp before touching
                // the terminal.
                // FitAddon reports a fractional cols that usually floors to the
                // right value, but on some DPIs it undershoots by one — leaving a
                // right-hand column of scrollbar gutter, so the browser renders
                // with black bars on both sides (#75). Re-measure against the real
                // rendered cell width and, when there's room, bump cols by up to 4.
                const base = Math.max(1, Math.floor(dims.cols));
                let cols = base;
                let rows = Math.max(1, Math.floor(dims.rows));
                try {
                    const parent = this.term.element && this.term.element.parentElement;
                    const dim = this.term._core && this.term._core._renderService
                        && this.term._core._renderService.dimensions;
                    if (parent && dim) {
                        const rect = parent.getBoundingClientRect();
                        if (dim.actualCellWidth > 0) {
                            const fitCols = Math.round(rect.width / dim.actualCellWidth);
                            if (fitCols >= base) cols = Math.min(fitCols, base + 4);
                        }
                        // CLI panels: .cli_session bleeds its container past the shell
                        // padding with negative insets, so the canvas must reach the
                        // frame bottom. FitAddon floors rows, leaving up to a full row
                        // of unpainted black at the bottom edge. Round UP here so the
                        // canvas covers the whole container; the overshoot is clipped
                        // by .cli_session's own overflow:hidden + clip-path, so the
                        // corner cut still occludes the content as designed (#89).
                        if (dim.actualCellHeight > 0
                                && typeof parent.classList !== "undefined"
                                && parent.classList.contains("cli_session")) {
                            rows = Math.max(rows, Math.ceil(rect.height / dim.actualCellHeight));
                            // 诊断标记:patch-appimage.sh #89 target 靠它判 fresh-skip
                            // (老构建无此标记才注入,避免对 fresh 构建重复打补丁)
                            window.__edexCliRowsCeil = 1;
                        }
                    }
                } catch (x) {}

                if (this.term.cols !== cols || this.term.rows !== rows) {
                    this.resize(cols, rows);
                }
            };

            this.resize = (cols, rows) => {
                cols = Math.floor(Number(cols));
                rows = Math.floor(Number(rows));
                if (!Number.isFinite(cols) || !Number.isFinite(rows) || cols < 1 || rows < 1) return;
                this.term.resize(cols, rows);
                this._sendSizeToServer();
            };

            this.write = cmd => {
                this._userIn = true;
                this.socket.send(cmd);
            };

            this.writelr = cmd => {
                this.socket.send(cmd+"\r");
            };

            this.clipboard = {
                copy: () => {
                    if (!this.term.hasSelection()) return false;
                    // xterm's selection is a virtual DOM selection, so
                    // document.execCommand("copy") can silently no-op. Pull the
                    // selected text out and write it to the OS clipboard directly
                    // — then it pastes into text docs, the file browser, anywhere.
                    let sel = "";
                    try { sel = this.term.getSelection(); } catch (e) {}
                    if (sel) {
                        try {
                            remote.clipboard.writeText(sel);
                            this.term.clearSelection();
                            this.clipboard.didCopy = true;
                            return true;
                        } catch (e) {}
                    }
                    document.execCommand("copy");
                    this.term.clearSelection();
                    this.clipboard.didCopy = true;
                    return true;
                },
                paste: () => {
                    this.write(remote.clipboard.readText());
                    this.clipboard.didCopy = false;
                },
                didCopy: false
            };

        } else if (opts.role === "server") {

            this.Pty = require("node-pty");
            this.Websocket = require("ws").Server;
            this.Ipc = require("electron").ipcMain;

            this.renderer = null;
            this.port = opts.port || 3000;

            this._closed = false;
            this.onclosed = () => {};
            this.onopened = () => {};
            this.onresize = () => {};
            this.ondisconnected = () => {};

            this._disableCWDtracking = false;
            // claude's workspace picker is keyboard-interactive: the boot \r
            // would confirm its default directory before the user can choose
            // one. Sessions that own their startup input opt out (#67).
            this._noBootCR = !!opts.noBootCR;
            this._getTtyCWD = tty => {
                return new Promise((resolve, reject) => {
                    let pid = tty.pid;
                    switch(require("os").type()) {
                        case "Linux":
                            require("fs").readlink(`/proc/${pid}/cwd`, (e, cwd) => {
                                if (e !== null) {
                                    reject(e);
                                } else {
                                    resolve(cwd);
                                }
                            });
                            break;
                        case "Darwin":
                            require("child_process").exec(`lsof -a -d cwd -p ${pid} | tail -1 | awk '{ for (i=9; i<=NF; i++) printf "%s ", $i }'`, (e, cwd) => {
                                if (e !== null) {
                                    reject(e);
                                } else {
                                    resolve(cwd.trim());
                                }
                            });
                            break;
                        default:
                            reject("Unsupported OS");
                    }
                });
            };
            this._getTtyProcess = tty => {
                return new Promise((resolve, reject) => {
                    let pid = tty.pid;
                    switch(require("os").type()) {
                        case "Linux":
                        case "Darwin":
                            require("child_process").exec(`ps -o comm --no-headers --sort=+pid -g ${pid} | tail -1`, (e, proc) => {
                                if (e !== null) {
                                    reject(e);
                                } else {
                                    resolve(proc.trim());
                                }
                            });
                            break;
                        default:
                            reject("Unsupported OS");
                    }
                });
            };
            this._nextTickUpdateTtyCWD = false;
            this._nextTickUpdateProcess = false;
            this._tick = setInterval(() => {
                if (this._nextTickUpdateTtyCWD && this._disableCWDtracking === false) {
                    this._nextTickUpdateTtyCWD = false;
                    this._getTtyCWD(this.tty).then(cwd => {
                        if (this.tty._cwd === cwd) return;
                        this.tty._cwd = cwd;
                        if (this.renderer) {
                            this.renderer.send("terminal_channel-"+this.port, "New cwd", cwd);
                        }
                    }).catch(e => {
                        if (!this._closed) {
                            console.log("Error while tracking TTY working directory: ", e);
                            this._disableCWDtracking = true;
                            try {
                                this.renderer.send("terminal_channel-"+this.port, "Fallback cwd", opts.cwd || process.env.PWD);
                            } catch(e) {
                                // renderer closed
                            }
                        }
                    });
                }

                if (this.renderer && this._nextTickUpdateProcess) {
                    this._nextTickUpdateProcess = false;
                    this._getTtyProcess(this.tty).then(process => {
                        if (this.tty._process === process) return;
                        this.tty._process = process;
                        if (this.renderer) {
                            this.renderer.send("terminal_channel-"+this.port, "New process", process);
                        }
                    }).catch(e => {
                        if (!this._closed) {
                            console.log("Error while retrieving TTY subprocess: ", e);
                            try {
                                this.renderer.send("terminal_channel-"+this.port, "New process", "");
                            } catch(e) {
                                // renderer closed
                            }
                        }
                    });
                }
            }, 1000);

            this.tty = this.Pty.spawn(opts.shell || "bash", (opts.params.length > 0 ? opts.params : (opts.login === false ? [] : (process.platform === "win32" ? [] : ["--login"]))), {
                name: opts.env.TERM || "xterm-256color",
                cols: 80,
                rows: 24,
                cwd: opts.cwd || process.env.PWD,
                env: opts.env || process.env
            });

            this.tty.onExit((code, signal) => {
                this._closed = true;
                this.onclosed(code, signal);
            });

            this.wss = new this.Websocket({
                port: this.port,
                clientTracking: true,
                // Allow reconnects: after a suspend the old client lingers and a
                // fresh connection would be refused; the connection handler
                // closes any older client instead (#67).
                verifyClient: () => true
            });
            this.Ipc.on("terminal_channel-"+this.port, (e, ...args) => {
                switch(args[0]) {
                    case "Renderer startup":
                        this.renderer = e.sender;
                        if (!this._disableCWDtracking && this.tty._cwd) {
                            this.renderer.send("terminal_channel-"+this.port, "New cwd", this.tty._cwd);
                        }
                        if (this._disableCWDtracking) {
                            this.renderer.send("terminal_channel-"+this.port, "Fallback cwd", opts.cwd || process.env.PWD);
                        }
                        break;
                    case "Resize":
                        let cols = args[1];
                        let rows = args[2];
                        try {
                            this.tty.resize(Number(cols), Number(rows));
                        } catch (error) {
                            //Keep going, it'll work anyways.
                        }
                        this.onresized(cols, rows);
                        break;
                    default:
                        return;
                }
            });
            this.wss.on("connection", ws => {
                // A reconnect arrives as a brand-new client; close any older
                // one so only the live renderer stays attached (#67).
                try {
                    this.wss.clients.forEach(c => { try { if (c !== ws) c.close(); } catch (_) {} });
                } catch (_) {}
                this.onopened(this.tty.pid);
                ws.on("close", (code, reason) => {
                    this.ondisconnected(code, reason);
                });
                ws.on("message", msg => {
                    this._bootIn = true;
                    this.tty.write(msg);
                });
                this.tty.onData(data => {
                    this._bootGot = true;
                    this._nextTickUpdateTtyCWD = true;
                    this._nextTickUpdateProcess = true;
                    try {
                        ws.send(data);
                    } catch (e) {
                        // Websocket closed
                    }
                });
                // The pty is spawned at app startup, so its opening prompt is
                // emitted before any renderer connects and is consumed by
                // nobody — the MAIN SHELL tab then boots blank. Send an empty
                // line so the shell redraws its prompt on this fresh connection
                // (harmless if it is already mid-command). Wait 1.2s first and
                // skip if the shell already produced output or the user typed,
                // so an active session never gets a stray Enter. claude's
                // picker sets noBootCR and skips this entirely (#67).
                try {
                    if (!this._noBootCR && !this._booted) {
                        this._booted = true;
                        this._bootGot = false;
                        this._bootIn = false;
                        this._bootT = setTimeout(() => {
                            try {
                                this._bootT = null;
                                if (!this._bootGot && !this._bootIn) this.tty.write("\r");
                            } catch (_) {}
                        }, 1200);
                    }
                } catch (e) {}
            });

            this.close = () => {
                this.tty.kill();
                this._closed = true;
            };
        } else {
            throw "Unknown purpose";
        }
    }
}

module.exports = {
    Terminal
};
