class FilesystemDisplay {
    constructor(opts) {
        if (!opts.parentId) throw "Missing options";

        const fs = require("fs");
        const path = require("path");
        const os = require("os");
        this.cwd = [];
        this.cwd_path = null;
        this.iconcolor = `rgb(${window.theme.r}, ${window.theme.g}, ${window.theme.b})`;
        this._formatBytes = (a,b) => {if(0==a)return"0 Bytes";var c=1024,d=b||2,e=["Bytes","KiB","MiB","GiB","TiB","PiB","EiB","ZiB","YiB"],f=Math.floor(Math.log(a)/Math.log(c));return parseFloat((a/Math.pow(c,f)).toFixed(d))+" "+e[f]};
        this.fileIconsMatcher = require("./assets/misc/file-icons-match.js");
        this.icons = require("./assets/icons/file-icons.json");
        this.edexIcons = {
            theme: {
                width: 24,
                height: 24,
                svg: '<path d="M 17.9994,3.99805L 17.9994,2.99805C 17.9994,2.44604 17.5514,1.99805 16.9994,1.99805L 4.9994,1.99805C 4.4474,1.99805 3.9994,2.44604 3.9994,2.99805L 3.9994,6.99805C 3.9994,7.55005 4.4474,7.99805 4.9994,7.99805L 16.9994,7.99805C 17.5514,7.99805 17.9994,7.55005 17.9994,6.99805L 17.9994,5.99805L 18.9994,5.99805L 18.9994,9.99805L 8.9994,9.99805L 8.9994,20.998C 8.9994,21.55 9.4474,21.998 9.9994,21.998L 11.9994,21.998C 12.5514,21.998 12.9994,21.55 12.9994,20.998L 12.9994,11.998L 20.9994,11.998L 20.9994,3.99805L 17.9994,3.99805 Z"/>'
            },
            themesDir: {
                width: 24,
                height: 24,
                svg: `<path d="m9.9994 3.9981h-6c-1.105 0-1.99 0.896-1.99 2l-0.01 12c0 1.104 0.895 2 2 2h16c1.104 0 2-0.896 2-2v-9.9999c0-1.104-0.896-2-2-2h-8l-1.9996-2z" stroke-width=".2"/><path stroke-linejoin="round" d="m18.8 9.3628v-0.43111c0-0.23797-0.19314-0.43111-0.43111-0.43111h-5.173c-0.23797 0-0.43111 0.19313-0.43111 0.43111v1.7244c0 0.23797 0.19314 0.43111 0.43111 0.43111h5.1733c0.23797 0 0.43111-0.19314 0.43111-0.43111v-0.43111h0.43111v1.7244h-4.3111v4.7422c0 0.23797 0.19314 0.43111 0.43111 0.43111h0.86221c0.23797 0 0.43111-0.19314 0.43111-0.43111v-3.879h3.449v-3.4492z" stroke-width=".086221" fill="${window.theme.colors.light_black}"/>`
            },
            kblayout: {
                width: 24,
                height: 24,
                svg: '<path d="M 18.9994,9.99807L 16.9994,9.99807L 16.9994,7.99807L 18.9994,7.99807M 18.9994,12.9981L 16.9994,12.9981L 16.9994,10.9981L 18.9994,10.9981M 15.9994,9.99807L 13.9994,9.99807L 13.9994,7.99807L 15.9994,7.99807M 15.9994,12.9981L 13.9994,12.9981L 13.9994,10.9981L 15.9994,10.9981M 15.9994,16.9981L 7.99941,16.9981L 7.99941,14.9981L 15.9994,14.9981M 6.99941,9.99807L 4.99941,9.99807L 4.99941,7.99807L 6.99941,7.99807M 6.99941,12.9981L 4.99941,12.9981L 4.99941,10.9981L 6.99941,10.9981M 7.99941,10.9981L 9.99941,10.9981L 9.99941,12.9981L 7.99941,12.9981M 7.99941,7.99807L 9.99941,7.99807L 9.99941,9.99807L 7.99941,9.99807M 10.9994,10.9981L 12.9994,10.9981L 12.9994,12.9981L 10.9994,12.9981M 10.9994,7.99807L 12.9994,7.99807L 12.9994,9.99807L 10.9994,9.99807M 19.9994,4.99807L 3.99941,4.99807C 2.89441,4.99807 2.0094,5.89406 2.0094,6.99807L 1.99941,16.9981C 1.99941,18.1021 2.89441,18.9981 3.99941,18.9981L 19.9994,18.9981C 21.1034,18.9981 21.9994,18.1021 21.9994,16.9981L 21.9994,6.99807C 21.9994,5.89406 21.1034,4.99807 19.9994,4.99807 Z"/>'
            },
            kblayoutsDir: {
                width: 24,
                height: 24,
                svg: `<path d="m9.9994 3.9981h-6c-1.105 0-1.99 0.896-1.99 2l-0.01 12c0 1.104 0.895 2 2 2h16c1.104 0 2-0.896 2-2v-9.9999c0-1.104-0.896-2-2-2h-8l-1.9996-2z" stroke-width=".2"/><path stroke-linejoin="round" d="m17.48 11.949h-1.14v-1.14h1.14m0 2.8499h-1.14v-1.14h1.14m-1.7099-0.56999h-1.14v-1.14h1.14m0 2.8499h-1.14v-1.14h1.14m0 3.4199h-4.56v-1.14h4.56m-5.13-2.85h-1.1399v-1.14h1.14m0 2.8499h-1.1399v-1.14h1.14m0.56998 0h1.14v1.14h-1.14m0-2.8499h1.14v1.14h-1.14m1.7099 0.56999h1.14v1.14h-1.14m0-2.8499h1.14v1.14h-1.14m5.13-2.8494h-9.1199c-0.62982 0-1.1343 0.51069-1.1343 1.14l-0.0057 5.6998c0 0.62925 0.51013 1.14 1.14 1.14h9.1196c0.62925 0 1.14-0.5107 1.14-1.14v-5.6998c0-0.62926-0.5107-1.14-1.14-1.14z" stroke-width="0.114" fill="${window.theme.colors.light_black}"/>`
            },
            settings: {
                width: 24,
                height: 24,
                svg: '<path d="M 11.9994,15.498C 10.0664,15.498 8.49939,13.931 8.49939,11.998C 8.49939,10.0651 10.0664,8.49805 11.9994,8.49805C 13.9324,8.49805 15.4994,10.0651 15.4994,11.998C 15.4994,13.931 13.9324,15.498 11.9994,15.498 Z M 19.4284,12.9741C 19.4704,12.6531 19.4984,12.329 19.4984,11.998C 19.4984,11.6671 19.4704,11.343 19.4284,11.022L 21.5414,9.36804C 21.7294,9.21606 21.7844,8.94604 21.6594,8.73004L 19.6594,5.26605C 19.5354,5.05005 19.2734,4.96204 19.0474,5.04907L 16.5584,6.05206C 16.0424,5.65607 15.4774,5.32104 14.8684,5.06903L 14.4934,2.41907C 14.4554,2.18103 14.2484,1.99805 13.9994,1.99805L 9.99939,1.99805C 9.74939,1.99805 9.5434,2.18103 9.5054,2.41907L 9.1304,5.06805C 8.52039,5.32104 7.95538,5.65607 7.43939,6.05206L 4.95139,5.04907C 4.7254,4.96204 4.46338,5.05005 4.33939,5.26605L 2.33939,8.73004C 2.21439,8.94604 2.26938,9.21606 2.4574,9.36804L 4.5694,11.022C 4.5274,11.342 4.49939,11.6671 4.49939,11.998C 4.49939,12.329 4.5274,12.6541 4.5694,12.9741L 2.4574,14.6271C 2.26938,14.78 2.21439,15.05 2.33939,15.2661L 4.33939,18.73C 4.46338,18.946 4.7254,19.0341 4.95139,18.947L 7.4404,17.944C 7.95639,18.34 8.52139,18.675 9.1304,18.9271L 9.5054,21.577C 9.5434,21.8151 9.74939,21.998 9.99939,21.998L 13.9994,21.998C 14.2484,21.998 14.4554,21.8151 14.4934,21.577L 14.8684,18.9271C 15.4764,18.6741 16.0414,18.34 16.5574,17.9431L 19.0474,18.947C 19.2734,19.0341 19.5354,18.946 19.6594,18.73L 21.6594,15.2661C 21.7844,15.05 21.7294,14.78 21.5414,14.6271L 19.4284,12.9741 Z"/>'
            }
        };

        const container = document.getElementById(opts.parentId);

        // Quick-access tabs. Paths are user-customizable via the small corner
        // badge on each tab; customizations persist in settings.json.
        this._defaultQuickLinks = () => {
            const home = os.homedir();
            // eDEX-OS install-edex.sh creates ~/Applications for dropped AppImages
            // and the standard ~/Desktop|Downloads|Documents… dirs. Stock eDEX
            // pointed APPLICATIONS at macOS's /Applications, which doesn't exist
            // on Linux and made the tab report "cannot connect" (#17).
            const appsPath = process.platform === "darwin" ? "/Applications" : path.join(home, "Applications");
            return [
                {label: "DESKTOP", path: path.join(home, "Desktop")},
                {label: "DOWNLOADS", path: path.join(home, "Downloads")},
                {label: "DOCUMENTS", path: path.join(home, "Documents")},
                {label: "APPLICATIONS", path: appsPath}
            ];
        };
        let savedLinks = (window.settings && Array.isArray(window.settings.fsQuickLinks) && window.settings.fsQuickLinks.length)
            ? window.settings.fsQuickLinks
            : null;
        this.quickLinks = savedLinks ? savedLinks.map(l => ({label: l.label, path: l.path})) : this._defaultQuickLinks();

        this._quickbarHTML = () => this.quickLinks.map((link, i) => `
            <div class="fs_quick_link">
                <button class="fs_quick_btn" onclick="window.fsDisp.readQuickLink(${i})">${link.label}</button>
                <button class="fs_quick_badge" title="Customize label/path" onclick="window.fsDisp.editQuickLink(${i})"></button>
            </div>`).join("");

        // Gear button next to the "FILESYSTEM" title: opens the eDEX settings
        // editor directly (themes, shell, keyboard, ...).
        const gearIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;
        const trashIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6"/></svg>`;
        const netIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/></svg>`;

        container.innerHTML = `
            <h3 class="title"><p>FILESYSTEM<button class="fs_header_btn" title="Trash" onclick="window.fsDisp.showTrash()">${trashIcon}</button><button class="fs_header_btn" title="Network" onclick="window.fsDisp.showNetwork()">${netIcon}</button><button class="fs_gear" title="eDEX Settings" onclick="window.openSettings()">${gearIcon}</button></p><p id="fs_disp_title_dir"></p></h3>
            <div id="fs_quickbar">${this._quickbarHTML()}</div>
            <div id="fs_disp_container">
            </div>
            <div id="fs_space_bar">
                <h1>EXIT DISPLAY</h1>
                <h3>Calculating available space...</h3><progress value="100" max="100"></progress>
                <button id="fs_cd_btn" title="cd to current directory in the current terminal" onclick="window.fsDisp.cdToTerminal()">CD</button>
            </div>`;
        this.filesContainer = document.getElementById("fs_disp_container");
        this.space_bar = {
            text: document.querySelector("#fs_space_bar > h3"),
            bar: document.querySelector("#fs_space_bar > progress")
        };
        this.fsBlock = {};
        this.dirpath = "";
        this.failed = false;
        this._failedDir = null;
        this._noTracking = false;
        this._runNextTick = false;
        this._reading = false;

        this._timer = setInterval(() => {
            if (this._runNextTick === true) {
                this._runNextTick = false;
                this.readFS(this.dirpath);
            }
        }, 1000);

        this._asyncFSwrapper = new Proxy(fs, {
            get: function(fs, prop) {
                if (prop in fs) {
                    return function(...args) {
                        return new Promise((resolve, reject) => {
                            fs[prop](...args, (err, d) => {
                                if (typeof err !== "undefined" && err !== null) reject(err);
                                if (typeof d !== "undefined") resolve(d);
                                if (typeof d === "undefined" && typeof err === "undefined") resolve();
                            });
                        });
                    }
                }
            },
            set: function() {
                return false;
            }
        });

        this.setFailedState = failedDir => {
            this.failed = true;
            this._reading = false;
            if (typeof failedDir === "string") this._failedDir = failedDir;

            // Keep the quick-access tabs, title and space bar in place - only
            // the file grid area shows the error, and offers recovery buttons
            // so the browser can be navigated again without restarting.
            let title = document.getElementById("fs_disp_title_dir");
            if (title) title.innerText = "EXECUTION FAILED";

            this.filesContainer.setAttribute("class", "failed");
            let parent = this._failedDir ? path.dirname(this._failedDir) : null;
            let showUp = !!parent && parent !== this._failedDir;
            this.filesContainer.innerHTML = `
            <h2 id="fs_disp_error">CANNOT ACCESS CURRENT WORKING DIRECTORY</h2>
            <div id="fs_failed_actions">
                ${showUp ? `<button onclick="window.fsDisp.goUp()">GO UP</button>` : ""}
                <button onclick="window.fsDisp.goHome()">GO HOME</button>
            </div>`;
        };

        // Recovery buttons shown in the error state: jump to the parent of the
        // directory that failed, or straight to the user's home directory.
        this.goUp = () => {
            if (this._failedDir) this.readFS(path.dirname(this._failedDir));
        };
        this.goHome = () => {
            this.readFS(os.homedir());
        };

        this.followTab = () => {
            // Don't follow tabs when running in detached mode, see #432
            if (this._noTracking) return false;

            let num = window.currentTerm;

            window.term[num].oncwdchange = cwd => {
                // See #501
                if (this._noTracking) return false;

                if (cwd && cwd !== this.cwd_path && window.currentTerm === num) {
                    this.cwd_path = cwd;
                    if (this._fsWatcher) {
                        this._fsWatcher.close();
                    }
                    if (cwd.startsWith("FALLBACK |-- ")) {
                        this.readFS(cwd.slice(13));
                        this._noTracking = true;
                    } else {
                        this.readFS(cwd);
                        this.watchFS(cwd);
                    }
                }
            };
        };
        this.followTab();

        this.watchFS = dir => {
            if (this._fsWatcher) {
                this._fsWatcher.close();
            }
            try {
                this._fsWatcher = fs.watch(dir, (eventType, filename) => {
                    if (eventType != "change") { // #758 - Don't refresh file view if only file contents have changed.
                        this._runNextTick = true;
                    }
                });
            } catch (e) {
                // The directory doesn't exist (anymore) - nothing to watch. A
                // watcher is (re)registered on the next successful readFS.
                this._fsWatcher = null;
            }
        };

        this.toggleHidedotfiles = () => {
            if (window.settings.hideDotfiles) {
                container.classList.remove("hideDotfiles");
                window.settings.hideDotfiles = false;
            } else {
                container.classList.add("hideDotfiles");
                window.settings.hideDotfiles = true;
            }
        };

        this.toggleListview = () => {
            if (window.settings.fsListView) {
                container.classList.remove("list-view");
                window.settings.fsListView = false;
            } else {
                container.classList.add("list-view");
                window.settings.fsListView = true;
            }
        };

        // ---- Quick-access tabs (customizable paths) ----

        // Navigate to a quick tab's path - browser only. The shell is cded
        // explicitly via the "CD" button, so browsing never moves the terminal.
        this.readQuickLink = index => {
            let link = this.quickLinks[index];
            if (!link) return;
            this.readFS(link.path);
        };

        // cd the current terminal tab to the directory currently shown in the
        // browser (used by the "CD" button in the bottom-right corner).
        this.cdToTerminal = () => {
            if (!this.dirpath) return;
            window.term[window.currentTerm].writelr(`cd "${this.dirpath.replace(/"/g, '\\"')}"`);
        };

        // ---- File selection + right-click operations (via shell commands) ----

        this.selected = [];
        this.clipboard = null;
        this._dragSel = { active: false };
        this._justDragged = false;

        this._itemPath = el => el && el.getAttribute ? (el.getAttribute("data-path") || "") : "";

        this._refreshSelectionUI = () => {
            [...this.filesContainer.querySelectorAll("[data-path]")].forEach(el => {
                el.classList.toggle("selected", this.selected.indexOf(this._itemPath(el)) !== -1);
            });
        };

        this._selectOnly = p => { this.selected = p ? [p] : []; this._refreshSelectionUI(); };
        this._toggleSelect = p => {
            if (!p) return;
            let i = this.selected.indexOf(p);
            if (i === -1) this.selected.push(p);
            else this.selected.splice(i, 1);
            this._refreshSelectionUI();
        };
        this._clearSelection = () => { this.selected = []; this._refreshSelectionUI(); };

        // Anchor for shift+click range selection.
        this._lastClickedPath = null;

        // Context-menu "Open": every selected item gets opened (all stay open,
        // stacked with a cascading offset), but they appear one at a time with a
        // short gap between each - a staggered sci-fi cascade.
        this._openSelected = () => {
            let paths = this.selected.slice();
            if (!paths.length) return;
            let n = paths.length;
            paths.forEach((p, level) => {
                setTimeout(() => {
                    let i = this.cwd.findIndex(b => b.path === p);
                    if (i === -1) return;
                    let blk = this.cwd[i];
                    if (blk.type === "dir") { this.readFS(p); return; }
                    let beforeIds = Object.keys(window.modals);
                    if (blk.type === "image" || blk.type === "video" || blk.type === "audio") this.openMedia(i);
                    else this.openFile(i);
                    let newIds = Object.keys(window.modals).filter(id => beforeIds.indexOf(id) === -1);
                    let el = newIds.length ? document.getElementById("modal_" + newIds[0]) : null;
                    if (el) {
                        // Fan the stack out horizontally, CENTERED on the screen:
                        // the middle image stays centered, earlier ones go left,
                        // later ones go right, so the whole group reads as one
                        // balanced cluster. Larger step than before.
                        let step = window.innerWidth * 0.04;
                        let offset = (level - (n - 1) / 2) * step;
                        let r = el.getBoundingClientRect();
                        el.style.left = (r.left + offset) + "px";
                    }
                }, level * 200);
            });
        };

        // Shift+click: select everything between the last-clicked anchor and here.
        this._rangeSelect = p => {
            let items = [...this.filesContainer.querySelectorAll("[data-path]")]
                .map(el => this._itemPath(el)).filter(Boolean);
            let anchor = items.indexOf(this._lastClickedPath);
            let cur = items.indexOf(p);
            if (anchor === -1 || cur === -1) { this._selectOnly(p); return; }
            let [lo, hi] = anchor < cur ? [anchor, cur] : [cur, anchor];
            for (let i = lo; i <= hi; i++) {
                if (this.selected.indexOf(items[i]) === -1) this.selected.push(items[i]);
            }
            this._refreshSelectionUI();
        };

        // Ctrl+A: select all files - but only while the pointer is over the file
        // panel, so the terminal keeps its own Ctrl+A (readline) behaviour.
        this._fsHovered = false;
        this.filesContainer.addEventListener("mouseenter", () => { this._fsHovered = true; });
        this.filesContainer.addEventListener("mouseleave", () => { this._fsHovered = false; });
        // Capture phase + stopPropagation so the keystroke never reaches the
        // terminal (which sits deeper in the DOM and would react to Ctrl+A too).
        document.addEventListener("keydown", e => {
            if ((e.ctrlKey || e.metaKey) && e.code === "KeyA" && this._fsHovered) {
                e.preventDefault();
                e.stopPropagation();
                this.selected = [...this.filesContainer.querySelectorAll("[data-path]")]
                    .map(el => this._itemPath(el)).filter(Boolean);
                this._refreshSelectionUI();
            }
            // Windows-like deletion in the normal file view:
            //   Delete        → move to trash
            //   Shift + Delete → delete permanently
            if (this._fsHovered && this.dirpath !== "trash://"
                && this.selected && this.selected.length && e.code === "Delete") {
                e.preventDefault();
                e.stopPropagation();
                if (e.shiftKey) this._deleteSelectedPermanent();
                else this._deleteSelected();
            }
        }, true);

        // Single click still opens/navigates (the item's inline onclick). Only
        // block it when the click is the tail of a drag-box selection, or when a
        // modifier key requests multi-select. A click on empty space clears.
        this.filesContainer.addEventListener("click", e => {
            if (this._justDragged) { this._justDragged = false; e.preventDefault(); e.stopPropagation(); return; }
            let el = e.target.closest ? e.target.closest("[data-path]") : null;
            if (el) {
                let p = this._itemPath(el);
                if (p && (e.ctrlKey || e.metaKey)) {
                    // Ctrl/Cmd+click: toggle this item in the selection.
                    this._toggleSelect(p);
                    this._lastClickedPath = p;
                    e.preventDefault();
                    e.stopPropagation();
                    return;
                }
                if (p && e.shiftKey) {
                    // Shift+click: range-select from the anchor to here.
                    this._rangeSelect(p);
                    this._lastClickedPath = p;
                    e.preventDefault();
                    e.stopPropagation();
                    return;
                }
                // Plain click: make it the primary selection; the inline onclick
                // still opens/navigates it.
                if (p) { this._selectOnly(p); this._lastClickedPath = p; }
            } else {
                this._clearSelection();
            }
        }, true);

        // Right-click: select the file (if not already) and show the operations menu.
        this.filesContainer.addEventListener("contextmenu", e => {
            e.preventDefault();
            let el = e.target.closest ? e.target.closest("[data-path]") : null;
            if (el) {
                let p = this._itemPath(el);
                // Items without a real path (Show disks, Go up) never select
                if (p && this.selected.indexOf(p) === -1) this._selectOnly(p);
                this._showContextMenu(e.clientX, e.clientY, !!(p || this.selected.length));
            } else {
                this._clearSelection();
                this._showContextMenu(e.clientX, e.clientY, false);
            }
        });

        // Drag on empty area to box-select multiple files.
        this.filesContainer.addEventListener("mousedown", e => {
            if (e.button !== 0) return;
            if (e.target.closest && e.target.closest("[data-path]")) return;
            this._justDragged = false;
            this._dragSel = { active: true, startX: e.clientX, startY: e.clientY, moved: false };
            let box = document.createElement("div");
            box.id = "fs_drag_box";
            document.body.appendChild(box);
            this._dragSel.el = box;
        });
        document.addEventListener("mousemove", e => {
            let d = this._dragSel;
            if (!d.active || !d.el) return;
            if (Math.abs(e.clientX - d.startX) + Math.abs(e.clientY - d.startY) > 5) d.moved = true;
            let x = Math.min(e.clientX, d.startX), y = Math.min(e.clientY, d.startY);
            d.el.style.left = x + "px"; d.el.style.top = y + "px";
            d.el.style.width = Math.abs(e.clientX - d.startX) + "px";
            d.el.style.height = Math.abs(e.clientY - d.startY) + "px";
        });
        document.addEventListener("mouseup", e => {
            let d = this._dragSel;
            if (!d.active) return;
            this._dragSel = { active: false };
            if (d.el) d.el.remove();
            if (!d.moved) return;
            this._justDragged = true;
            let x1 = Math.min(e.clientX, d.startX), y1 = Math.min(e.clientY, d.startY);
            let x2 = Math.max(e.clientX, d.startX), y2 = Math.max(e.clientY, d.startY);
            this.selected = [];
            [...this.filesContainer.querySelectorAll("[data-path]")].forEach(el => {
                let r = el.getBoundingClientRect();
                if (r.right > x1 && r.left < x2 && r.bottom > y1 && r.top < y2) this.selected.push(this._itemPath(el));
            });
            this._refreshSelectionUI();
        });

        // Build the right-click operations menu once.
        this._ctxMenu = document.createElement("div");
        this._ctxMenu.id = "fs_ctx_menu";
        this._ctxMenu.className = "fs_ctx_menu";
        this._ctxMenu.style.display = "none";
        this._ctxMenu.innerHTML = `
            <button class="fs_ctx_item" data-action="open">Open</button>
            <button class="fs_ctx_item" data-action="info">Info</button>
            <button class="fs_ctx_item" data-action="rename">Rename</button>
            <button class="fs_ctx_item" data-action="copy">Copy</button>
            <button class="fs_ctx_item" data-action="cut">Cut</button>
            <button class="fs_ctx_item" data-action="paste">Paste</button>
            <button class="fs_ctx_item" data-action="trash">Move to Trash</button>
            <button class="fs_ctx_item" data-action="delete">Delete Permanently</button>
            <button class="fs_ctx_item" data-action="newfolder">New Folder</button>
            <button class="fs_ctx_item" data-action="compress">Compress to .7z</button>
            <button class="fs_ctx_item" data-action="extract">Extract Archive</button>`;
        document.body.appendChild(this._ctxMenu);
        this._ctxMenu.addEventListener("click", e => {
            let btn = e.target.closest ? e.target.closest(".fs_ctx_item") : null;
            if (!btn || btn.classList.contains("disabled")) return;
            this._ctxAction(btn.dataset.action);
        });
        // Close the menu when clicking anywhere else
        document.addEventListener("click", e => {
            if (this._ctxMenu && !(e.target.closest && e.target.closest("#fs_ctx_menu"))) this._hideContextMenu();
        });

        // True when the path looks like an archive 7-Zip can extract.
        this._isArchive = p => /\.(?:tar\.(?:gz|xz|bz2|zst)|tgz|7z|zip|tar|gz|xz|bz2|rar|cab|zst|lzma)$/i.test(p);
        // Strip a known archive suffix so extracting `foo.tar.gz` lands in `foo/`.
        this._archiveBase = p => p.replace(/\.(?:tar\.(?:gz|xz|bz2|zst)|tgz|7z|zip|tar|gz|xz|bz2|rar|cab|zst|lzma)$/i, "");

        this._showContextMenu = (x, y, hasSelection) => {
            let m = this._ctxMenu;
            if (!m) return;
            let pasteOk = !!(this.clipboard && this.clipboard.paths && this.clipboard.paths.length);
            m.querySelector('[data-action="open"]').classList.toggle("disabled", !hasSelection);
            m.querySelector('[data-action="info"]').classList.toggle("disabled", !hasSelection);
            m.querySelector('[data-action="rename"]').classList.toggle("disabled", this.selected.length !== 1);
            m.querySelector('[data-action="copy"]').classList.toggle("disabled", !hasSelection);
            m.querySelector('[data-action="cut"]').classList.toggle("disabled", !hasSelection);
            m.querySelector('[data-action="paste"]').classList.toggle("disabled", !pasteOk);
            m.querySelector('[data-action="trash"]').classList.toggle("disabled", !hasSelection);
            m.querySelector('[data-action="delete"]').classList.toggle("disabled", !hasSelection);
            m.querySelector('[data-action="compress"]').classList.toggle("disabled", !hasSelection);
            m.querySelector('[data-action="extract"]').classList.toggle("disabled", !(this.selected.length === 1 && this._isArchive(this.selected[0])));
            m.style.display = "block";
            let mw = m.offsetWidth, mh = m.offsetHeight;
            m.style.left = Math.min(x, window.innerWidth - mw - 8) + "px";
            m.style.top = Math.min(y, window.innerHeight - mh - 8) + "px";
        };
        this._hideContextMenu = () => { if (this._ctxMenu) this._ctxMenu.style.display = "none"; };

        this._ctxAction = action => {
            this._hideContextMenu();
            switch (action) {
                case "open": this._openSelected(); break;
                case "info": this._showInfo(); break;
                case "rename": this._rename(); break;
                case "copy": this.clipboard = { mode: "copy", paths: this.selected.slice() }; break;
                case "cut": this.clipboard = { mode: "cut", paths: this.selected.slice() }; break;
                case "paste": this._paste(); break;
                case "trash": this._deleteSelected(); break;                  // Move to Trash
                case "delete": this._deleteSelectedPermanent(); break;        // Delete Permanently
                case "newfolder": this._newFolder(); break;
                case "compress": this._compressSelected(); break;
                case "extract": this._extractSelected(); break;
            }
        };

        // Compress the selection into a .7z archive in the current directory.
        // Single selection → <name>.7z; multiple → <current-folder>.7z.
        // `cd` into the target dir so 7z stores relative names — feeding it
        // absolute paths would bake the whole tree into the archive.
        this._compressSelected = () => {
            if (!this.selected.length || !this.dirpath) return;
            let name = this.selected.length === 1
                ? (this.selected[0].split("/").pop() || "archive")
                : (this.dirpath.split("/").pop() || "archive");
            let names = this.selected
                .map(p => `"${(p.split("/").pop() || "").replace(/"/g, '\\"')}"`)
                .join(" ");
            this._exec(`cd "${this.dirpath.replace(/"/g, '\\"')}" && 7z a -y "${name}.7z" ${names}`);
        };

        // Extract the selected archive into a folder named after it (sans
        // extension), e.g. `foo.tar.gz` → `foo/`. `-o` creates the folder.
        this._extractSelected = () => {
            let p = this.selected[0];
            if (!p || !this.dirpath) return;
            let out = this._archiveBase(p.split("/").pop()) || "extracted";
            this._exec(`7z x -y "${p.replace(/"/g, '\\"')}" -o"${this.dirpath.replace(/"/g, '\\"')}/${out}"`);
        };

        // Rename the single selected item via `mv` in the shell.
        this._rename = () => {
            let p = this.selected[0];
            if (!p) return;
            this._renameDir = p.substring(0, p.lastIndexOf("/"));
            let oldName = p.split("/").pop() || p;
            new Modal({
                type: "custom",
                title: "Rename",
                html: `<p style="margin:0 0 0.4vh;">New name:</p>
                       <input type="text" id="fs_rename_name" value="${_escapeHtml(oldName)}">`,
                buttons: [{ label: "Rename", action: `window.fsDisp.doRename(); window.modals[Object.keys(window.modals).pop()].close();` }]
            });
        };
        this.doRename = () => {
            let input = document.getElementById("fs_rename_name");
            let oldPath = this.selected[0];
            if (!input || !input.value.trim() || !this._renameDir || !oldPath) return;
            let newPath = this._renameDir + "/" + input.value.trim();
            this._exec(`mv "${oldPath.replace(/"/g, '\\"')}" "${newPath.replace(/"/g, '\\"')}"`);
            this._renameDir = null;
        };

        // Convert a file mode into an "rwxr-xr-x" string (with setuid/setgid/sticky).
        this._formatPerms = mode => {
            let chars = "rwxrwxrwx", out = "";
            for (let i = 0; i < 9; i++) {
                let bit = 0o400 >> i;
                let set = (mode & bit) ? chars[i] : "-";
                if (i === 2 && (mode & 0o4000)) set = (set === "-") ? "S" : "s"; // setuid
                if (i === 5 && (mode & 0o2000)) set = (set === "-") ? "S" : "s"; // setgid
                if (i === 8 && (mode & 0o1000)) set = (set === "-") ? "T" : "t"; // sticky
                out += set;
            }
            return out;
        };

        // Real disk usage of a directory via `du -sk` (stat().size on a folder is
        // only the tiny directory entry, which is why folder sizes looked wrong).
        this._dirSize = p => {
            return new Promise(resolve => {
                let q = String(p).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\$/g, "\\$").replace(/`/g, "\\`");
                require("child_process").exec(`du -sk "${q}"`, (err, stdout) => {
                    if (err) return resolve(null);
                    let kb = parseInt(String(stdout).trim().split(/\s+/)[0], 10);
                    if (isNaN(kb)) return resolve(null);
                    let bytes = kb * 1024;
                    resolve(`${this._formatBytes(bytes)} (${bytes.toLocaleString()} bytes)`);
                });
            });
        };

        // Top-level item count inside a directory.
        this._countItems = p => {
            return new Promise(resolve => {
                require("fs").readdir(p, (e, files) => {
                    if (e) return resolve(null);
                    resolve(files.length);
                });
            });
        };

        // Show detailed info (size, dates, permissions) for the selected item.
        this._showInfo = async () => {
            let p = this.selected[0];
            if (!p) return;
            let lst = await this._asyncFSwrapper.lstat(p).catch(() => null);
            if (!lst) return;
            // Follow symlinks to the target for size/type, but keep the link visible.
            let st = (lst.isSymbolicLink()) ? (await this._asyncFSwrapper.stat(p).catch(() => lst)) : lst;
            let name = p.split("/").pop() || p;
            let isDir = st.isDirectory();
            let type = isDir ? "Directory"
                : (lst.isSymbolicLink() ? "Symbolic Link → " + (st.isFile() ? "File" : "Special")
                : st.isFile() ? "File" : "Special");

            let rows = [
                ["Name", name],
                ["Path", p],
                ["Type", type]
            ];
            if (isDir) {
                let size = await this._dirSize(p);
                let count = await this._countItems(p);
                rows.push(["Size", size || "Unavailable"]);
                rows.push(["Items", count === null ? "--" : `${count} item${count === 1 ? "" : "s"}`]);
            } else {
                rows.push(["Size", `${this._formatBytes(st.size)} (${st.size.toLocaleString()} bytes)`]);
            }
            rows.push(
                ["Modified", new Date(st.mtime).toLocaleString()],
                ["Accessed", new Date(st.atime).toLocaleString()],
                ["Created", new Date(st.birthtime).toLocaleString()],
                ["Permissions", `${this._formatPerms(st.mode)} (${(st.mode & 0o777).toString(8)})`],
                ["Owner", `uid ${st.uid}`],
                ["Group", `gid ${st.gid}`],
                ["Links", `${st.nlink}`],
                ["Inode", `${st.ino}`]
            );
            new Modal({
                type: "custom",
                title: "File Info",
                html: `<div class="fs_info">${rows.map(([k, v]) =>
                    `<div><span>${k}</span><b>${_escapeHtml(String(v))}</b></div>`).join("")}</div>`,
                buttons: []
            });
        };

        // Run a shell command in a BACKGROUND process (no dependency on the
        // terminals being free), then refresh. Used for file operations so they
        // work even when both terminal tabs are busy with other programs.
        this._exec = (cmd, cb) => {
            require("child_process").exec(cmd, (err, stdout, stderr) => {
                if (err) console.warn("[filesystem] op failed:", stderr || err.message);
                if (cb) cb();
                this.readFS(this.dirpath);
            });
        };

        this._paste = () => {
            if (!this.clipboard || !this.clipboard.paths.length || !this.dirpath) return;
            let dest = this.dirpath.replace(/"/g, '\\"');
            let srcs = this.clipboard.paths.map(p => `"${p.replace(/"/g, '\\"')}"`).join(" ");
            this._exec(this.clipboard.mode === "copy"
                ? `cp -R ${srcs} "${dest}/"`
                : `mv ${srcs} "${dest}/"`);
            this.clipboard = null;
        };

        this._deleteSelected = () => {
            if (!this.selected.length) return;
            // Windows-like: Delete moves to the trash.
            this._toTrash(this.selected);
            this.selected = [];
        };

        this._deleteSelectedPermanent = () => {
            if (!this.selected.length) return;
            this._deletePermanently(this.selected);
            this.selected = [];
        };

        /* ---- Trash (XDG) + network mount helpers ---- */
        this._trashDirs = () => {
            const os = require("os");
            const path = require("path");
            const root = process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
            const trash = path.join(root, "Trash");
            return { root: trash, files: path.join(trash, "files"), info: path.join(trash, "info") };
        };
        this._ensureTrash = () => {
            const fs = require("fs");
            const d = this._trashDirs();
            try { fs.mkdirSync(d.files, { recursive: true }); } catch (e) {}
            try { fs.mkdirSync(d.info, { recursive: true }); } catch (e) {}
            return d;
        };
        this._copyRecursive = (src, dest) => {
            const fs = require("fs");
            const path = require("path");
            const st = fs.statSync(src);
            if (st.isDirectory()) {
                fs.mkdirSync(dest, { recursive: true });
                fs.readdirSync(src).forEach(f => this._copyRecursive(path.join(src, f), path.join(dest, f)));
            } else {
                fs.copyFileSync(src, dest);
            }
        };
        // Move paths into the XDG trash (file + .trashinfo sidecar). Handles
        // name collisions and cross-device moves (copy + delete fallback).
        this._toTrash = (paths, cb) => {
            const fs = require("fs");
            const path = require("path");
            if (!paths || !paths.length) return;
            const d = this._ensureTrash();
            let remaining = paths.length;
            const done = () => {
                if (--remaining <= 0) { if (cb) cb(); this.readFS(this.dirpath); }
            };
            paths.forEach(p => {
                const base = path.basename(p);
                let name = base, n = 1;
                while (fs.existsSync(path.join(d.files, name))) { name = base + "." + Date.now() + "." + (n++); }
                const target = path.join(d.files, name);
                const encPath = p.split("/").map(encodeURIComponent).join("/");
                const info = `[Trash Info]\nPath=${encPath}\nDeletionDate=${new Date().toISOString()}\n`;
                try {
                    fs.renameSync(p, target);
                    try { fs.writeFileSync(path.join(d.info, name + ".trashinfo"), info); } catch (e) {}
                    done();
                } catch (e) {
                    try {
                        this._copyRecursive(p, target);
                        fs.rmSync(p, { recursive: true, force: true });
                        try { fs.writeFileSync(path.join(d.info, name + ".trashinfo"), info); } catch (e2) {}
                        done();
                    } catch (e2) { done(); }
                }
            });
        };
        // List trash contents (files + parsed .trashinfo originals).
        this._trashList = () => {
            const fs = require("fs");
            const path = require("path");
            const d = this._trashDirs();
            let items = [];
            try {
                const names = fs.readdirSync(d.files);
                items = names.map(name => {
                    let originalPath = "", deletionDate = "";
                    try {
                        const raw = fs.readFileSync(path.join(d.info, name + ".trashinfo"), "utf8");
                        const mPath = raw.match(/^Path=(.*)$/m);
                        const mDate = raw.match(/^DeletionDate=(.*)$/m);
                        if (mPath) originalPath = decodeURIComponent(mPath[1].replace(/\+/g, "%20"));
                        if (mDate) deletionDate = mDate[1];
                    } catch (e) {}
                    const full = path.join(d.files, name);
                    let st = null; try { st = fs.statSync(full); } catch (e) {}
                    return { name, originalPath, deletionDate, full,
                        isDir: st ? st.isDirectory() : false, size: st ? st.size : 0 };
                }).filter(i => i.name);
            } catch (e) {}
            return items;
        };
        // Restore one trash item back to its original path (rename, or copy+delete).
        this._restoreFromTrash = (item, cb) => {
            const fs = require("fs");
            const path = require("path");
            if (!item || !item.originalPath) return;
            let dest = item.originalPath;
            if (fs.existsSync(dest)) {
                const ext = path.extname(dest);
                const base = path.basename(dest, ext);
                dest = path.join(path.dirname(dest), base + " (restored)" + ext);
            }
            try { fs.mkdirSync(path.dirname(dest), { recursive: true }); } catch (e) {}
            const infoFile = path.join(this._trashDirs().info, item.name + ".trashinfo");
            try {
                fs.renameSync(item.full, dest);
                try { fs.rmSync(infoFile, { force: true }); } catch (e) {}
            } catch (e) {
                try {
                    this._copyRecursive(item.full, dest);
                    fs.rmSync(item.full, { recursive: true, force: true });
                    try { fs.rmSync(infoFile, { force: true }); } catch (e2) {}
                } catch (e2) {}
            }
            if (cb) cb();
            this._renderTrashView();
        };
        // Permanently delete a trash item (file + info).
        this._purgeTrashItem = item => {
            const fs = require("fs");
            const path = require("path");
            try { fs.rmSync(item.full, { recursive: true, force: true }); } catch (e) {}
            try { fs.rmSync(path.join(this._trashDirs().info, item.name + ".trashinfo"), { force: true }); } catch (e) {}
            this._renderTrashView();
        };
        // Empty the trash (files + info).
        this._emptyTrash = () => {
            const fs = require("fs");
            const d = this._trashDirs();
            try { fs.rmSync(d.files, { recursive: true, force: true }); } catch (e) {}
            try { fs.rmSync(d.info, { recursive: true, force: true }); } catch (e) {}
            this._renderTrashView();
        };
        // Delete permanently, bypassing the trash.
        this._deletePermanently = (paths, cb) => {
            const fs = require("fs");
            if (!paths || !paths.length) return;
            let remaining = paths.length;
            const done = () => {
                if (--remaining <= 0) { if (cb) cb(); this.readFS(this.dirpath); }
            };
            paths.forEach(p => { try { fs.rmSync(p, { recursive: true, force: true }); } catch (e) {} done(); });
        };
        this._gvfsRoot = () => {
            const os = require("os");
            return `/run/user/${os.userInfo().uid}/gvfs`;
        };
        // Mount an SMB share via gio (gvfs). Credentials are inlined so it can
        // work non-interactively; guest/anon when no user is given.
        this._mountSMB = (host, share, user, pass) => {
            const exec = require("child_process").exec;
            const enc = s => encodeURIComponent(s || "");
            let uri = "smb://";
            if (user) uri += enc(user) + (pass ? ":" + enc(pass) : "") + "@";
            uri += host;
            if (share) uri += "/" + share.split("/").map(enc).join("/");
            return new Promise(resolve => {
                exec(`gio mount "${uri}"`, { timeout: 25000 }, (err, stdout, stderr) => {
                    resolve({ ok: !err, err: err ? (stderr || err.message).trim() : "" });
                });
            });
        };

        /* ---- Trash + network views (virtual dirpaths "trash://" / "network://") ---- */
        this._trashHome = () => { const os = require("os"); return os.homedir(); };
        this._trashItemByIndex = i => this._trashList()[i] || null;
        this._restoreTrashByIndex = i => { const it = this._trashItemByIndex(i); if (it) this._restoreFromTrash(it); };
        this._purgeTrashByIndex = i => { const it = this._trashItemByIndex(i); if (it) this._purgeTrashItem(it); };

        this.showTrash = () => {
            this.dirpath = "trash://";
            this._renderTrashView();
        };

        this._renderTrashView = () => {
            const title = document.getElementById("fs_disp_title_dir");
            if (title) title.innerText = "TRASH";
            this.filesContainer.setAttribute("class", "");
            this.filesContainer.innerHTML = "";
            const items = this._trashList();
            const esc = s => String(s == null ? "" : s).replace(/</g, "&lt;");
            let html = `
                <div class="fs_virtual_bar">
                    <button class="fs_virtual_btn fs_virtual_empty" onclick="window.fsDisp._emptyTrash()">Empty</button>
                    <button class="fs_virtual_btn" onclick="window.fsDisp.readFS(window.fsDisp._trashHome())">Back</button>
                </div>
                <div class="fs_trash_list">`;
            if (!items.length) html += `<p class="fs_trash_none">Trash is empty</p>`;
            items.forEach((item, i) => {
                const icon = item.isDir ? this.icons.dir : this.icons.file;
                html += `
                    <div class="fs_trash_item">
                        <svg viewBox="0 0 ${icon.width} ${icon.height}" fill="${this.iconcolor}">${icon.svg}</svg>
                        <div class="fs_trash_meta">
                            <h3>${esc(item.name)}</h3>
                            <h4>${esc(item.originalPath || "unknown original location")}</h4>
                        </div>
                        <button class="fs_trash_restore" onclick="window.fsDisp._restoreTrashByIndex(${i})">Restore</button>
                        <button class="fs_trash_purge" onclick="window.fsDisp._purgeTrashByIndex(${i})">Delete</button>
                    </div>`;
            });
            html += `</div>`;
            this.filesContainer.innerHTML = html;
        };

        this.showNetwork = () => {
            this.dirpath = "network://";
            this._renderNetworkView();
        };

        this._renderNetworkView = () => {
            const fs = require("fs");
            const path = require("path");
            const title = document.getElementById("fs_disp_title_dir");
            if (title) title.innerText = "NETWORK";
            this.filesContainer.setAttribute("class", "");
            this.filesContainer.innerHTML = "";
            const gvfsRoot = this._gvfsRoot();
            let mounts = [];
            try { mounts = fs.readdirSync(gvfsRoot).filter(n => !n.startsWith(".")); } catch (e) {}
            const esc = s => String(s == null ? "" : s).replace(/</g, "&lt;");
            let html = `
                <div class="fs_virtual_bar">
                    <button class="fs_virtual_btn fs_virtual_empty" onclick="window.fsDisp.showMountDialog()">Connect to Server…</button>
                    <button class="fs_virtual_btn" onclick="window.fsDisp.readFS(window.fsDisp._trashHome())">Back</button>
                </div>
                <div class="fs_trash_list">`;
            if (!mounts.length) html += `<p class="fs_trash_none">No network mounts yet — connect to an SMB share</p>`;
            mounts.forEach(m => {
                const p = path.join(gvfsRoot, m);
                html += `
                    <div class="fs_trash_item fs_net_mount" data-path="${p.replace(/"/g, "&quot;")}" onclick="window.fsDisp.readFS(window.fsDisp._itemPath(this))">
                        <svg viewBox="0 0 ${this.icons.dir.width} ${this.icons.dir.height}" fill="${this.iconcolor}">${this.icons.dir.svg}</svg>
                        <div class="fs_trash_meta"><h3>${esc(m)}</h3><h4>${esc(p)}</h4></div>
                    </div>`;
            });
            html += `</div>`;
            this.filesContainer.innerHTML = html;
        };

        this.showMountDialog = () => {
            new Modal({
                type: "custom",
                title: "Connect to Server (SMB)",
                html: `
                    <div class="fs_mount_form">
                        <label>Server</label><input id="fs_mount_server" placeholder="192.168.1.10">
                        <label>Share (optional)</label><input id="fs_mount_share" placeholder="public">
                        <label>Username (optional)</label><input id="fs_mount_user">
                        <label>Password (optional)</label><input id="fs_mount_pass" type="password">
                    </div>`,
                buttons: [{ label: "Mount", action: `window.fsDisp.doMount(); window.modals[Object.keys(window.modals).pop()].close();` }]
            });
        };

        this.doMount = async () => {
            const g = id => document.getElementById(id);
            const host = g("fs_mount_server") ? g("fs_mount_server").value.trim() : "";
            const share = g("fs_mount_share") ? g("fs_mount_share").value.trim() : "";
            const user = g("fs_mount_user") ? g("fs_mount_user").value.trim() : "";
            const pass = g("fs_mount_pass") ? g("fs_mount_pass").value : "";
            if (!host) return;
            const r = await this._mountSMB(host, share, user, pass);
            if (!r.ok) {
                new Modal({ type: "custom", title: "Mount failed", html: `<p>${(r.err || "Could not mount the share").replace(/</g, "&lt;")}</p>` });
                return;
            }
            this.readFS(this._gvfsRoot());
        };

        this._newFolder = () => {
            new Modal({
                type: "custom",
                title: "New Folder",
                html: `<p style="margin:0 0 0.4vh;">Folder name:</p>
                       <input type="text" id="fs_new_folder_name" value="untitled folder">`,
                buttons: [{ label: "Create", action: `window.fsDisp.createNewFolder(); window.modals[Object.keys(window.modals).pop()].close();` }]
            });
        };
        this.createNewFolder = () => {
            let input = document.getElementById("fs_new_folder_name");
            if (!input || !input.value.trim() || !this.dirpath) return;
            let name = input.value.trim().replace(/"/g, '\\"');
            this._exec(`mkdir "${this.dirpath.replace(/"/g, '\\"')}/${name}"`);
        };

        // Open a small editor to change a quick tab's label and path.
        this.editQuickLink = index => {
            let link = this.quickLinks[index];
            if (!link) return;
            let esc = s => String(s).replace(/"/g, "&quot;");
            new Modal({
                type: "custom",
                title: `Customize Quick Tab`,
                html: `<p style="margin:0 0 0.4vh;">Label:</p>
                       <input type="text" id="fs_quick_edit_label" value="${esc(link.label)}">
                       <p style="margin:0.8vh 0 0.4vh;">Path:</p>
                       <input type="text" id="fs_quick_edit_path" value="${esc(link.path)}">
                       <button style="margin-left:0; margin-top:0.6vh;" title="Insert the file browser's current directory"
                               onclick="document.getElementById('fs_quick_edit_path').value = window.fsDisp.dirpath;">Use Current Directory</button>`,
                buttons: [
                    {label: "Save", action: `window.fsDisp.saveQuickLink(${index}); window.modals[Object.keys(window.modals).pop()].close();`}
                ]
            });
        };

        // Read the editor inputs, persist and refresh the tab.
        this.saveQuickLink = index => {
            let labelInput = document.getElementById("fs_quick_edit_label");
            let pathInput = document.getElementById("fs_quick_edit_path");
            if (!this.quickLinks[index]) return;
            if (labelInput && labelInput.value.trim()) this.quickLinks[index].label = labelInput.value.trim();
            if (pathInput && pathInput.value.trim()) this.quickLinks[index].path = pathInput.value.trim();
            this._persistQuickLinks();
            this.renderQuickbar();
        };

        // Persist the quick tabs into settings.json (best-effort).
        this._persistQuickLinks = () => {
            window.settings.fsQuickLinks = this.quickLinks.map(l => ({label: l.label, path: l.path}));
            try {
                let p = require("path");
                let remote = require("@electron/remote");
                require("fs").writeFileSync(
                    p.join(remote.app.getPath("userData"), "settings.json"),
                    JSON.stringify(window.settings, null, 4)
                );
            } catch (e) { /* non-fatal */ }
        };

        this.renderQuickbar = () => {
            let qb = document.getElementById("fs_quickbar");
            if (qb) qb.innerHTML = this._quickbarHTML();
        };

        this.readFS = async dir => {
            // Cover mode (lock / screensaver): never touch the real filesystem.
            // Render the fabricated launch-systems tree for whatever path is
            // asked — navigation inside the fake tree keeps calling readFS,
            // which short-circuits again here.
            if (window.cover && window.cover.isActive()) {
                const fakePath = window.cover.fakePath(dir);
                this.dirpath = fakePath;
                this._reading = false;
                this.failed = false;
                this._clearSelection();
                this._hideContextMenu();
                document.getElementById("fs_disp_title_dir").innerText = fakePath;
                this.filesContainer.setAttribute("class", "");
                this.cwd = window.cover.fakeDir(fakePath);
                this.render(this.cwd, false);
                return false;
            }
            if (this._reading) return false;
            // Virtual views (trash / network) are rendered specially, not read
            // as real directories.
            if (dir === "trash://" || dir === "network://") {
                this.dirpath = dir;
                this._reading = false;
                if (dir === "trash://") this._renderTrashView();
                else this._renderNetworkView();
                return false;
            }
            this._reading = true;
            // A new read attempt clears any previous failure, so navigation
            // always stays possible (quick tabs, GO UP/GO HOME, terminal cwd).
            this.failed = false;
            this._clearSelection();
            this._hideContextMenu();

            document.getElementById("fs_disp_title_dir").innerText = this.dirpath;
            this.filesContainer.setAttribute("class", "");
            // Show a loading animation while the directory is read; `render`
            // replaces it with the file grid once done.
            this.filesContainer.innerHTML = `<div class="fs_loading"><div class="fs_loading_ring"></div><div class="fs_loading_text">LOADING</div></div>`;
            if (this._noTracking) {
                document.querySelector("section#filesystem > h3.title > p:first-of-type").innerText = "FILESYSTEM - TRACKING FAILED, RUNNING DETACHED FROM TTY";
            }

            if (process.platform === "win32" && dir.endsWith(":")) dir = dir+"\\";
            let tcwd = dir;
            let content = await this._asyncFSwrapper.readdir(tcwd).catch(err => {
                console.warn(err);
                this.setFailedState(tcwd);
                if (this._noTracking === true && this.dirpath) { // #262
                    setTimeout(() => {
                        this.readFS(this.dirpath);
                    }, 1000);
                }
            });

            // The directory couldn't be read - release the read lock and stop.
            // The quick-access tabs above stay usable, so the browser can be
            // navigated back to a working directory without restarting.
            if (typeof content === "undefined") {
                this._reading = false;
                return false;
            }

            this.reCalculateDiskUsage(tcwd);

            this.cwd = [];

            await new Promise((resolve, reject) => {
                if (content.length === 0) resolve();

                // Wait for ALL the (async) lstat calls to finish, not just the
                // last one - otherwise a fast last entry resolves early and some
                // files are missing from the listing.
                let pending = content.length;
                content.forEach(async (file, i) => {
                    let fstat = await this._asyncFSwrapper.lstat(path.join(tcwd, file)).catch(e => {
                        if (!e.message.includes("EPERM") && !e.message.includes("EBUSY")) {
                            reject();
                        }
                    });

                    let e = {
                        name: window._escapeHtml(file),
                        path: path.resolve(tcwd, file),
                        type: "other",
                        category: "other",
                        hidden: false
                    };

                    if (typeof fstat !== "undefined") {
                        e.lastAccessed = fstat.mtime.getTime();

                        if (fstat.isDirectory()) {
                            e.category = "dir";
                            e.type = "dir";
                        }
                        if (e.category === "dir" && tcwd === settingsDir && file === "themes") e.type="edex-themesDir";
                        if (e.category === "dir" && tcwd === settingsDir && file === "keyboards") e.type = "edex-kblayoutsDir";

                        if (fstat.isSymbolicLink()) {
                            e.category = "symlink";
                            e.type = "symlink";
                        }

                        if (fstat.isFile()) {
                            e.category = "file";
                            e.type = "file";
                            e.size = fstat.size;
                        }
                    } else {
                        e.type = "system";
                        e.hidden = true;
                    }

                    if (e.category === "file" && tcwd === themesDir && file.endsWith(".json")) e.type = "edex-theme";
                    if (e.category === "file" && tcwd === keyboardsDir && file.endsWith(".json")) e.type = "edex-kblayout";
                    if (e.category === "file" && tcwd === settingsDir && file === "settings.json") e.type = "edex-settings";
                    if (e.category === "file" && tcwd === settingsDir && file === "shortcuts.json") e.type = "edex-shortcuts";

                    if (file.startsWith(".")) e.hidden = true;

                    this.cwd.push(e);
                    if (--pending === 0) resolve();
                });
            }).catch(() => { this.setFailedState(tcwd) });

            if (this.failed) return false;

            let ordering = {
                dir: 0,
                symlink: 1,
                file: 2,
                other: 3
            };

            this.cwd.sort((a, b) => {
                return (ordering[a.category] - ordering[b.category] || a.name.localeCompare(b.name));
            });

            this.cwd.splice(0, 0, {
                name: "Show disks",
                type: "showDisks"
            });

            if (tcwd !== "/" && /^[A-Z]:\\$/i.test(tcwd) === false) {
                this.cwd.splice(1, 0, {
                    name: "Go up",
                    type: "up"
                });
            }

            this.dirpath = tcwd;
            this.render(this.cwd);
            this._reading = false;
        };

        this.readDevices = async () => {
            this.failed = false;

            let blocks = await window.si.blockDevices();
            let devices = [];
            blocks.forEach(block => {
                if (fs.existsSync(block.mount)) {
                    let type = (block.type === "rom") ? "rom" : "disk";
                    if (block.removable && block.type !== "rom") {
                        type = "usb";
                    }

                    devices.push({
                        name: (block.label !== "") ? `${block.label} (${block.name})` : `${block.mount} (${block.name})`,
                        type,
                        path: block.mount
                    });
                }
            });

            this.render(devices, true);
        };

        this.render = async (originBlockList, isDiskView) => {
            // Work on a clone of the blocklist to avoid altering fsDisp.cwd
            let blockList = JSON.parse(JSON.stringify(originBlockList));

            // Cover mode safety net: whatever the caller produced (a real read
            // already in flight, the disk view, …), show the fabricated tree.
            if (window.cover && window.cover.isActive()) {
                const fakePath = window.cover.fakePath(this.dirpath);
                document.getElementById("fs_disp_title_dir").innerText = fakePath;
                blockList = JSON.parse(JSON.stringify(window.cover.fakeDir(fakePath)));
                this.cwd = blockList;
                isDiskView = false;
            }

            if (this.failed === true) return false;

            if (isDiskView) {
                document.getElementById("fs_disp_title_dir").innerText = "Showing available block devices";
                this.filesContainer.setAttribute("class", "disks");
            } else {
                document.getElementById("fs_disp_title_dir").innerText = this.dirpath;
                this.filesContainer.setAttribute("class", "");
            }
            if (this._noTracking) {
                document.querySelector("section#filesystem > h3.title > p:first-of-type").innerText = "FILESYSTEM - TRACKING FAILED, RUNNING DETACHED FROM TTY";
            }

            let filesDOM = ``;
            blockList.forEach((e, blockIndex) => {
                let hidden = e.hidden ? " hidden" : "";

                // The on-screen keyboard (which toggled Ctrl/Shift for file clicks)
                // was replaced by the Cyber Panel - always run the default command.
                let cmdPrefix = `if (false) {
                            } else {
                          `.replace(/\n+ */g, ''); // Minify

                let cmdSuffix = `}`;

                let cmd;

                // Directories only navigate the browser - the shell is cded
                // explicitly via the "CD" button in the bottom-right corner.
                if (e.type === "dir" || e.type.endsWith("Dir")) {
                    cmd = `window.fsDisp.readFS(fsDisp.cwd[${blockIndex}].path)`;
                } else if (e.type === "up") {
                    cmd = `window.fsDisp.readFS(path.resolve(window.fsDisp.dirpath, ".."))`;
                } else if (e.type === "disk" || e.type === "rom" || e.type === "usb") {
                    cmd = `window.fsDisp.readFS("${e.path.replace(/\\/g, '')}")`;
                } else {
                    cmd = `window.term[window.currentTerm].write("\\""+fsDisp.cwd[${blockIndex}].path+"\\"")`;
                }

                if (e.type === "file") {
                    cmd = `window.fsDisp.openFile(${blockIndex})`;
                }

                if (e.type === "system") {
                    cmd = "";
                }

                if (e.type === "showDisks") {
                    cmd = `window.fsDisp.readDevices()`;
                    cmdPrefix = '';
                    cmdSuffix = '';
                }

                if (e.type === "up") {
                    // cmd is OS-specific and defined above
                    cmdPrefix = '';
                    cmdSuffix = '';
                }

                if (e.type === "edex-theme") {
                    cmd = `window.themeChanger("${e.name.slice(0, -5)}")`;
                }
                if (e.type === "edex-kblayout") {
                    cmd = `window.remakeKeyboard("${e.name.slice(0, -5)}")`;
                }
                if (e.type === "edex-settings") {
                    cmd = `window.openSettings()`;
                }
                if (e.type === "edex-shortcuts") {
                    cmd = `window.openShortcutsHelp()`;
                }

                let icon = "";
                let type = "";
                switch(e.type) {
                    case "showDisks":
                        icon = this.icons.showDisks;
                        type = "--";
                        e.category = "showDisks";
                        break;
                    case "up":
                        icon = this.icons.up;
                        type = "--";
                        e.category = "up";
                        break;
                    case "symlink":
                        icon = this.icons.symlink;
                        break;
                    case "disk":
                        icon = this.icons.disk;
                        break;
                    case "rom":
                        icon = this.icons.rom;
                        break;
                    case "usb":
                        icon = this.icons.usb;
                        break;
                    case "edex-theme":
                        icon = this.edexIcons.theme;
                        type = "eDEX-UI theme";
                        break;
                    case "edex-kblayout":
                        icon = this.edexIcons.kblayout;
                        type = "eDEX-UI keyboard layout";
                        break;
                    case "edex-settings":
                    case "edex-shortcuts":
                        icon = this.edexIcons.settings;
                        type = "eDEX-UI config file";
                        break;
                    case "system":
                        icon = this.edexIcons.settings;
                        break;
                    case "edex-themesDir":
                        icon = this.edexIcons.themesDir;
                        type = "eDEX-UI themes folder";
                        break;
                    case "edex-kblayoutsDir":
                        icon = this.edexIcons.kblayoutsDir;
                        type = "eDEX-UI keyboards folder";
                        break;
                    default:
                        let iconName = this.fileIconsMatcher(e.name);
                        icon = this.icons[iconName];
                        if (typeof icon === "undefined") {
                            if (e.type === "file") icon = this.icons.file;
                            if (e.type === "dir") {
                                icon = this.icons.dir;
                                type = "folder";
                            }
                            if (typeof icon === "undefined") icon = this.icons.other;
                        } else if (e.category !== "dir") {
                            type = iconName.replace("icon-", "");
                        } else {
                            type = "special folder";
                        }
                        break;
                }

                if (type === "") type = e.type;
                e.type = type;

                // Handle displayable media
                if (e.type === 'video' || e.type === 'audio' || e.type === 'image') {
                    this.cwd[blockIndex].type = e.type;
                    cmd = `window.fsDisp.openMedia(${blockIndex})`;
                }

                if (typeof e.size === "number") {
                    e.size = this._formatBytes(e.size);
                } else {
                    e.size = "--";
                }
                if (typeof e.lastAccessed === "number") {
                    e.lastAccessed = new Date(e.lastAccessed).toLocaleString();
                } else {
                    e.lastAccessed = "--";
                }

                filesDOM += `<div class="fs_disp_${e.type}${hidden} animationWait" data-path="${(e.path || "").replace(/"/g, "&quot;")}" onclick='${cmdPrefix+cmd+cmdSuffix}'>
                                <svg viewBox="0 0 ${icon.width} ${icon.height}" fill="${this.iconcolor}">
                                    ${icon.svg}
                                </svg>
                                <h3>${e.name}</h3>
                                <h4>${type}</h4>
                                <h4>${e.size}</h4>
                                <h4>${e.lastAccessed}</h4>
                            </div>`;
            });
            this.filesContainer.innerHTML = filesDOM;

            if (this.filesContainer.getAttribute("class").endsWith("disks")) {
                document.getElementById("fs_space_bar").setAttribute("onclick", "window.fsDisp.render(window.fsDisp.cwd)");
            } else {
                document.getElementById("fs_space_bar").setAttribute("onclick", "");
            }

            // Render animation
            let id = 0;
            while (this.filesContainer.childNodes[id]) {
                let e = this.filesContainer.childNodes[id];
                e.setAttribute("class", e.className.replace(" animationWait", ""));

                if (window.settings.hideDotfiles !== true || e.className.indexOf("hidden") === -1) {
                    window.audioManager.folder.play();
                    await _delay(30);
                }

                id++;
            }
        };

        this.reCalculateDiskUsage = async path => {
            this.fsBlock = null;
            this.space_bar.text.innerHTML = "Calculating available space...";
            this.space_bar.bar.removeAttribute("value");

            window.si.fsSize().catch(() => {
                this.space_bar.text.innerHTML = "Could not calculate mountpoint usage.";
                this.space_bar.bar.value = 100;
            }).then(d => {
                d.forEach(fsBlock => {
                    if (path.startsWith(fsBlock.mount)) {
                        this.fsBlock = fsBlock;
                    }
                });
                this.renderDiskUsage(this.fsBlock);
            });
        };

        this.renderDiskUsage = async fsBlock => {
            if (document.getElementById("fs_space_bar").getAttribute("onclick") !== "" || fsBlock === null) return;

            let splitter = (process.platform === "win32") ? "\\" : "/";
            let displayMount = (fsBlock.mount.length < 18) ? fsBlock.mount : "..."+splitter+fsBlock.mount.split(splitter).pop();

            // See #226
            if (!isNaN(fsBlock.use)) {
                this.space_bar.text.innerHTML = `Mount <strong>${displayMount}</strong> used <strong>${Math.round(fsBlock.use)}%</strong>`;
                this.space_bar.bar.value = Math.round(fsBlock.use);
            } else if (!isNaN((fsBlock.size / fsBlock.used) * 100)) {
                let usage = Math.round((fsBlock.size / fsBlock.used) * 100);

                this.space_bar.text.innerHTML = `Mount <strong>${displayMount}</strong> used <strong>${usage}%</strong>`;
                this.space_bar.bar.value = usage;
            } else {
                this.space_bar.text.innerHTML = "Could not calculate mountpoint usage.";
                this.space_bar.bar.value = 100;
            }
        };

        // Automatically start indexing supposed beginning CWD
        // See #365
        // ...except if we're hot-reloading, in which case this can mess up the rendering
        // See #392
        if (!window._isHotReload()) {
            this.readFS(window.term[window.currentTerm].cwd || window.settings.cwd);
        }

        // Best-effort: the macOS default app name for a file (via Finder).
        this._defaultApp = p => {
            return new Promise(resolve => {
                let q = String(p).replace(/"/g, '\\"');
                require("child_process").exec(
                    `osascript -e 'tell application "Finder" to get name of application file of (info for POSIX file "${q}")'`,
                    { timeout: 3000 },
                    (err, out) => {
                        if (!err && out && out.trim()) resolve(out.trim());
                        else resolve(null);
                    }
                );
            });
        };

        // For files eDEX cannot preview, offer to open them with the system app.
        this._openWithSystem = async p => {
            let app = await this._defaultApp(p).catch(() => null);
            let esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
            let name = String(p).split("/").pop() || p;
            window._pendingOpenPath = p; // keep the path out of the inline onclick
            new Modal({
                type: "custom",
                title: "Open With System App",
                html: `<p style="margin:0 0 1.2vh;">eDEX-UI cannot preview this file type.</p>
                       <p style="margin:0;font-family:var(--font_main_light);font-size:1.7vh;opacity:0.95;word-break:break-all;">${esc(name)}</p>
                       <p style="margin:1.2vh 0 0.4vh;">Open it with <strong>${esc(app || "the default application")}</strong>?</p>`,
                buttons: [
                    {label: app ? `Open with ${esc(app)}` : "Open with Default App", action: "window.fsDisp.openExternal(window._pendingOpenPath); window.modals[Object.keys(window.modals).pop()].close();"}
                ]
            });
        };

        // Open a file with the operating system's default application.
        this.openExternal = async p => {
            try {
                let err = await require("electron").shell.openPath(p);
                if (err) throw new Error(err);
            } catch (e) {
                new Modal({type: "info", title: "Could not open file", message: String(e && e.message || e)});
            }
        };

        this.openFile = (name, path, type) => { //Might add text formatting at some point, not now though - Surge
            let block;

            if (typeof name === "number") {
                block = this.cwd[name];
                name = block.name;
            }

            let mime = require("mime-types");

            block.path = block.path.replace(/\\/g, "/");

            let filetype = mime.lookup(name.split(".")[name.split(".").length - 1]);

            // Web documents open in the embedded browser (shell tab 5) instead
            // of as raw text in the doc viewer.
            if (filetype === "text/html" || filetype === "application/xhtml+xml") {
                if (window.browser) {
                    const fileUrl = "file://" + (block.path.startsWith("/") ? "" : "/") + block.path;
                    window.browser.newTab(fileUrl);
                    window.focusShellTab(4);
                    return;
                }
            }

            switch (filetype) {
                case "application/pdf":
                    let html = `<div class="fs_loading"><div class="fs_loading_ring"></div><div class="fs_loading_text">LOADING</div></div><div>
                        <div class="pdf_options">
                            <button class="zoom_in">
                                <svg viewBox="0 0 ${this.icons["zoom-in"].width} ${this.icons["zoom-in"].height}" fill="${this.iconcolor}">
                                    ${this.icons["zoom-in"].svg}
                                </svg>
                            </button>
                            <button class="zoom_out">
                                <svg viewBox="0 0 ${this.icons["zoom-out"].width} ${this.icons["zoom-out"].height}" fill="${this.iconcolor}">
                                    ${this.icons["zoom-out"].svg}
                                </svg>
                            </button>
                            <button class="previous_page">
                                <svg viewBox="0 0 ${this.icons["backwards"].width} ${this.icons["backwards"].height}" fill="${this.iconcolor}">
                                    ${this.icons["backwards"].svg}
                                </svg>
                            </button>
                            <span>Page: <span class="page_num"/></span><span>/</span> <span class="page_count"></span></span>
                            <button class="next_page">
                                <svg viewBox="0 0 ${this.icons["forwards"].width} ${this.icons["forwards"].height}" fill="${this.iconcolor}">
                                    ${this.icons["forwards"].svg}
                                </svg>
                            </button>
                        </div>
                        <div class="pdf_container fsDisp_mediaDisp">
                            <canvas class="pdf_canvas" />
                        </div>
                    </div>`;
                    const newModal = new Modal(
                        {
                            type: "custom",
                            title: _escapeHtml(name),
                            html: html
                        }
                    );
                    new DocReader(
                        {
                            modalId: newModal.id,
                            path: block.path
                        }
                    );
                    break;
                default:
                    if (mime.charset(filetype) === "UTF-8") {
                        fs.readFile(block.path, 'utf-8', (err, data) => {
                            if (err) {
                                new Modal({
                                    type: "info",
                                    title: "Failed to load file: " + block.path,
                                    html: err
                                });
                                console.log(err);
                            };
                            new Modal(
                                {
                                    type: "custom",
                                    title: _escapeHtml(name),
                                    html: `<textarea id="fileEdit" rows="40" cols="150" spellcheck="false">${data}</textarea><p id="fedit-status"></p>`,
                                    buttons: [
                                        {label:"Save to Disk",action:`window.writeFile('${block.path}')`}
                                    ]
                                }, () => {
                                    window.term[window.currentTerm].term.focus();
                                }
                            );
                        });
                    } else {
                        // Not a text file and not handled above - offer to open
                        // it with the operating system's default application.
                        this._openWithSystem(block.path);
                    }
                   break;
                }
        };

        this.openMedia = (name, path, type) => {
            let block, html;
            let index = -1;

            if (typeof name === "number") {
                index = name;
                block = this.cwd[name];
                name = block.name;
            }

            block.path = block.path.replace(/\\/g, "/");

            switch (type || block.type) {
                case "image":
                    html = `<div class="fs_loading"><div class="fs_loading_ring"></div><div class="fs_loading_text">LOADING</div></div><img class="fsDisp_mediaDisp" src="${window._encodePathURI(path || block.path)}" ondragstart="return false;">`;
                    break;
                case "audio":
                    html = `<div class="fs_loading"><div class="fs_loading_ring"></div><div class="fs_loading_text">LOADING</div></div><div>
                                <div class="media_container audio_player" data-fullscreen="false">
                                    <audio class="media fsDisp_mediaDisp" preload="auto">
                                        <source src="${window._encodePathURI(path || block.path)}">
                                        Unsupported audio format!
                                    </audio>
                                    <div class="audio_status">
                                        <span class="audio_status_dot"></span>
                                        <span class="audio_status_text">STANDBY</span>
                                        <span class="audio_status_name">${_escapeHtml(name)}</span>
                                    </div>
                                    <div class="audio_body">
                                        <div class="media_spectrum_wrap">
                                            <canvas class="media_spectrum"></canvas>
                                            <span class="media_spectrum_mode">SPECTRUM</span>
                                        </div>
                                        <div class="media_controls" data-state="hidden">
                                            <div class="audio_info">
                                                <div class="audio_info_item"><span>CODEC</span><b id="audio_info_codec">--</b></div>
                                                <div class="audio_info_item"><span>RATE</span><b id="audio_info_rate">--</b></div>
                                                <div class="audio_info_item"><span>CHANNELS</span><b id="audio_info_ch">--</b></div>
                                                <div class="audio_info_item"><span>BITRATE</span><b id="audio_info_bitrate">--</b></div>
                                            </div>
                                            <div class="progress_container">
                                                <div class="progress">
                                                    <span class="progress_bar"></span>
                                                </div>
                                            </div>
                                            <div class="audio_row">
                                                <div class="playpause media_button" data-state="play">
                                                    <svg viewBox="0 0 ${this.icons["play"].width} ${this.icons["play"].height}" fill="${this.iconcolor}">
                                                        ${this.icons["play"].svg}
                                                    </svg>
                                                </div>
                                                <div class="media_time">00:00:00 / 00:00:00</div>
                                                <div class="volume_icon">
                                                    <svg viewBox="0 0 24 24" fill="none" stroke="${this.iconcolor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                                        <path d="M11 5 6 9H2v6h4l5 4z"/>
                                                        <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
                                                        <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
                                                    </svg>
                                                </div>
                                                <div class="volume">
                                                    <div class="volume_bkg"></div>
                                                    <div class="volume_bar"></div>
                                                    <div class="volume_knob"></div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>`;
                    break;
                case "video":
                    html = `<div class="fs_loading"><div class="fs_loading_ring"></div><div class="fs_loading_text">LOADING</div></div><div>
                                <div class="media_container" data-fullscreen="false">
                                    <video class="media fsDisp_mediaDisp" preload="auto">
                                        <source src="${window._encodePathURI(path || block.path)}">
                                        Unsupported video format!
                                    </video>
                                    <div class="media_controls" data-state="hidden">
                                        <div class="playpause media_button" data-state="play">
                                            <svg viewBox="0 0 ${this.icons["play"].width} ${this.icons["play"].height}" fill="${this.iconcolor}">
                                                ${this.icons["play"].svg}
                                            </svg>
                                        </div>
                                        <div class="progress_container">
                                            <div class="progress">
                                                <span class="progress_bar"></span>
                                            </div>
                                        </div>
                                        <div class="media_time">00:00:00</div>
                                        <div class="volume_icon">
                                            <svg viewBox="0 0 24 24" fill="none" stroke="${this.iconcolor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                                <path d="M11 5 6 9H2v6h4l5 4z"/>
                                                <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
                                                <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
                                            </svg>
                                        </div>
                                        <div class="volume">
                                            <div class="volume_bkg"></div>
                                            <div class="volume_bar"></div>
                                            <div class="volume_knob"></div>
                                        </div>
                                        <div class="fs media_button" data-state="go-fullscreen">
                                            <svg viewBox="0 0 ${this.icons["fullscreen"].width} ${this.icons["fullscreen"].height}" fill="${this.iconcolor}">
                                                ${this.icons["fullscreen"].svg}
                                            </svg>
                                        </div>
                                    </div>
                                </div>
                            </div>`;
                    break;
                default:
                    throw new Error("fsDisp media displayer: unknown type " + (type || block.type));
            }

            const newModal = new Modal({
                type: "custom",
                title: _escapeHtml(name),
                html
            });

            // Image title row reads like "‹ name ›" — inline prev/next arrows
            // flanking the filename, so the image itself stays unobstructed.
            if (block.type === "image" && index >= 0) {
                let h1 = document.getElementById("modal_" + newModal.id).querySelector("h1");
                if (h1) {
                    h1.innerHTML = `<button class="fs_media_link fs_media_prev" title="Previous image" onclick="window.fsDisp.mediaNav(${index}, -1)">&lt;</button> ${_escapeHtml(name)} <button class="fs_media_link fs_media_next" title="Next image" onclick="window.fsDisp.mediaNav(${index}, 1)">&gt;</button>`;
                }
            }

            // Remove the loading overlay once the media is actually ready
            let mEl = document.getElementById("modal_" + newModal.id);
            let removeLoad = () => { let l = mEl && mEl.querySelector(".fs_loading"); if (l) l.remove(); };
            if (block.type === "image") {
                let img = mEl && mEl.querySelector("img");
                if (img && img.complete) removeLoad();
                else if (img) { img.addEventListener("load", removeLoad); img.addEventListener("error", removeLoad); }
            } else if (block.type === "audio" || block.type === "video") {
                let media = mEl && mEl.querySelector("video, audio");
                if (!media) return;
                // A stuck load (unsupported container/codec) fires neither
                // loadedmetadata nor error, so let the user cancel directly from
                // the loading overlay - the modal's own Close button is covered
                // by the overlay while it is up.
                let loadEl = mEl && mEl.querySelector(".fs_loading");
                if (loadEl) {
                    let cancelBtn = document.createElement("button");
                    cancelBtn.className = "fs_loading_cancel";
                    cancelBtn.textContent = "Cancel";
                    cancelBtn.onclick = () => newModal.close();
                    loadEl.appendChild(cancelBtn);
                }
                let showError = msg => {
                    removeLoad();
                    let c = mEl && mEl.querySelector(".media_container");
                    // Transport controls and the media element are useless once
                    // playback failed - hide them so the error doesn't overlap.
                    let ctrls = mEl && mEl.querySelector(".media_controls");
                    if (ctrls) ctrls.style.display = "none";
                    let mv = mEl && mEl.querySelector(".media");
                    if (mv) mv.style.display = "none";
                    if (c && !mEl.querySelector(".fs_media_error")) {
                        let e = document.createElement("div");
                        e.className = "fs_media_error";
                        e.textContent = msg;
                        let openBtn = document.createElement("button");
                        openBtn.className = "fs_loading_cancel";
                        openBtn.textContent = "Open with Default App";
                        openBtn.onclick = () => {
                            window._pendingOpenPath = block.path;
                            window.fsDisp.openExternal(window._pendingOpenPath);
                        };
                        e.appendChild(openBtn);
                        c.appendChild(e);
                    }
                };
                // If HTML5 cannot decode the container/codec the media element
                // stays stuck loading without firing error, so transcode with the
                // bundled ffmpeg into a playable webm and retry.
                let transcoded = false;
                let tempOut = null;
                let tryTranscode = () => {
                    if (transcoded) return;
                    transcoded = true;
                    clearTimeout(loadTimer);
                    let ffmpeg;
                    try { ffmpeg = require("ffmpeg-static"); } catch (e) {}
                    if (!ffmpeg) { showError("Failed to load - the format may be unsupported."); return; }
                    let txt = loadEl && loadEl.querySelector(".fs_loading_text");
                    if (txt) txt.textContent = "CONVERTING…";
                    tempOut = require("path").join(require("os").tmpdir(),
                        "edex_" + require("crypto").randomBytes(6).toString("hex") + ".webm");
                    let args = ["-y", "-i", block.path];
                    if (block.type === "audio") args.push("-vn", "-c:a", "libopus");
                    else args.push("-c:v", "libvpx", "-c:a", "libopus", "-b:v", "1M");
                    args.push("-loglevel", "error", tempOut);
                    require("child_process").execFile(ffmpeg, args, err => {
                        if (err) { showError("Failed to load - the format may be unsupported."); return; }
                        let src = media.querySelector("source");
                        if (src) src.remove();
                        media.src = window._encodePathURI(tempOut);
                        media.load();
                    });
                };
                // Hard timeout so an undecodable file doesn't spin forever.
                let loadTimer = setTimeout(() => {
                    if (media.readyState < 1) tryTranscode();
                }, 6000);
                media.addEventListener("loadedmetadata", () => {
                    clearTimeout(loadTimer);
                    removeLoad();
                    media.play().catch(() => {});
                });
                media.addEventListener("error", () => {
                    clearTimeout(loadTimer);
                    tryTranscode();
                });
                // Clean the transcoded temp file once the modal closes.
                let origClose = newModal.close.bind(newModal);
                newModal.close = () => {
                    if (tempOut) { try { require("fs").unlinkSync(tempOut); } catch (e) {} }
                    origClose();
                };
            }

            if (block.type === "audio" || block.type === "video") {
                new MediaPlayer({
                    modalId: newModal.id,
                    path: block.path,
                    type: block.type
                });
            }
        };

        // Browse the previous/next image in the same directory, updating the
        // open media modal in place (no need to close and reopen). The arrows
        // are re-bound to the new image's index so repeated clicks keep moving.
        this.mediaNav = (index, delta) => {
            const images = this.cwd.map((b, i) => ({ b, i })).filter(x => x.b.type === "image");
            if (!images.length) return;
            const cur = images.findIndex(x => x.i === index);
            if (cur < 0) return;
            const next = images[(cur + delta + images.length) % images.length];
            const modalEls = document.querySelectorAll("[id^=modal_]");
            const modal = modalEls[modalEls.length - 1];
            if (!modal) return;
            const h1 = modal.querySelector("h1");
            if (h1) {
                h1.innerHTML = `<button class="fs_media_link fs_media_prev" title="Previous image" onclick="window.fsDisp.mediaNav(${next.i}, -1)">&lt;</button> ${_escapeHtml(next.b.name)} <button class="fs_media_link fs_media_next" title="Next image" onclick="window.fsDisp.mediaNav(${next.i}, 1)">&gt;</button>`;
            }
            const img = modal.querySelector("img.fsDisp_mediaDisp");
            if (img) img.src = window._encodePathURI(next.b.path);
        };
    }
}

module.exports = {
    FilesystemDisplay
};
