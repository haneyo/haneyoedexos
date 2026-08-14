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
                fontFamily: window.theme.terminal.fontFamily || "Fira Mono",
                fontSize: window.theme.terminal.fontSize || window.settings.termFontSize || 11,
                fontWeight: window.theme.terminal.fontWeight || "normal",
                fontWeightBold: window.theme.terminal.fontWeightBold || "bold",
                letterSpacing: window.theme.terminal.letterSpacing || 0,
                lineHeight: window.theme.terminal.lineHeight || 1,
                scrollback: 1500,
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

            this.socket = new WebSocket("ws://"+sockHost+":"+sockPort);
            this.socket.onopen = () => {
                let attachAddon = new AttachAddon(this.socket);
                this.term.loadAddon(attachAddon);
                this.fit();
                // Re-assert keyboard focus once the pty link is up, so the very
                // first keystroke after a slow tab spawn isn't lost (#13).
                try { this.term.focus(); } catch (e) {}
            };
            this.socket.onerror = e => {throw JSON.stringify(e)};
            this.socket.onclose = e => {
                if (this.onclose) {
                    this.onclose(e);
                }
            };

            this.lastSoundFX = Date.now();
            this.socket.addEventListener("message", e => {
                let d = Date.now();

                // muted terminals (the cover session's inert cat pty) must not
                // chime — the screensaver/lock streams fake content, not real
                // output, so its stdout sound would be noise (#50).
                if (!this.muted && d - this.lastSoundFX > 30) {
                    window.audioManager.stdout.play();
                    this.lastSoundFX = d;
                }
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

            let parent = document.getElementById(opts.parentId);
            // Wheel scrolling is owned here so speed/direction can be configured
            // (settings.terminalScrollSensitivity / .terminalScrollDirection).
            // Capture phase + stopPropagation so xterm's built-in viewport
            // handler does not also scroll (that double-scrolled before, and
            // the old Math.round(deltaY/10) snapped small trackpad deltas to 0).
            // Deltas are accumulated so smooth trackpad scrolling works.
            parent.addEventListener("wheel", e => {
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
                const cols = Math.max(1, Math.floor(dims.cols));
                const rows = Math.max(1, Math.floor(dims.rows));

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
                verifyClient: info => {
                    if (this.wss.clients.length >= 1) {
                        return false;
                    } else {
                        return true;
                    }
                }
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
                this.onopened(this.tty.pid);
                ws.on("close", (code, reason) => {
                    this.ondisconnected(code, reason);
                });
                ws.on("message", msg => {
                    this.tty.write(msg);
                });
                this.tty.onData(data => {
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
                // (harmless if it is already mid-command). Runs after onData is
                // wired so the redrawn prompt is not lost again.
                try { this.tty.write("\r"); } catch (e) {}
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
