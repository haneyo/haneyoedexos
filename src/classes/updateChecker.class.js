class UpdateChecker {
    constructor() {
        let https = require("https");
        let electron = require("electron");
        let remote = require("@electron/remote");
        let current = remote.app.getVersion();

        // This repo (not upstream GitSquared/edex-ui) is the source of truth for
        // eDEX-OS updates. The release workflow (`.github/workflows/release.yml`)
        // attaches the x64 AppImage + a `.sha256` to every `v*` tag.
        const REPO = "haneyo/haneyoedexos";

        this._failed = false;
        this._willfail = false;
        this._fail = e => {
            this._failed = true;
            electron.ipcRenderer.send("log", "note", "UpdateChecker: Could not fetch latest release from GitHub's API.");
            electron.ipcRenderer.send("log", "debug", `Error: ${e}`);
        };

        https.get({
            protocol: "https:",
            host: "api.github.com",
            path: `/repos/${REPO}/releases/latest`,
            headers: {
                "User-Agent": "eDEX-UI UpdateChecker"
            }
        }, res => {
            switch(res.statusCode) {
                case 200:
                    break;
                case 404:
                    this._fail("Got 404 (Not Found) response from server");
                    break;
                default:
                    this._willfail = true;
            }

            let rawData = "";

            res.on('data', chunk => {
                rawData += chunk;
            });

            res.on('end', () => {
                let d = rawData;
                if (this._failed === true) {
                    // Do nothing, it already failed
                } else if (this._willfail) {
                    this._fail(d.toString());
                } else {
                    try {
                        let release = JSON.parse(d.toString());
                        if (release.tag_name.slice(1) === current) {
                            electron.ipcRenderer.send("log", "info", "UpdateChecker: Running latest version.");
                        } else if (Number(release.tag_name.slice(1).replace(/\./g, "")) < Number(current.replace("-pre", "").replace(/\./g, ""))) {
                            electron.ipcRenderer.send("log", "info", "UpdateChecker: Running an unreleased, development version.");
                        } else {
                            this._offerUpdate(release, current);
                            electron.ipcRenderer.send("log", "info", `UpdateChecker: New version ${release.tag_name} available.`);
                        }
                    } catch(e) {
                        this._fail(e);
                    }
                }
            });
        }).on('error', e => {
            this._fail(e);
        }).setTimeout(8000, () => {
            // GitHub's API can hang on some networks (e.g. mainland China) - bail out silently
            this._fail("Timed out while fetching the latest release");
        });
    }

    // Show the "new version" dialog. On an eDEX-OS install (running from the
    // AppImage) the button triggers the in-app updater; anywhere else it just
    // opens the release page in the browser.
    _offerUpdate(release, current) {
        let assets = release.assets || [];
        let appImage = assets.find(a => /\.AppImage$/i.test(a.name));
        let sha = assets.find(a => /\.AppImage\.sha256$/i.test(a.name));
        let releaseUrl = release.html_url || release.url || "https://github.com";

        let buttons;
        if (appImage && appImage.browser_download_url) {
            buttons = [{
                label: "Download & Update",
                action: `window.edexUpdate.start(${JSON.stringify(appImage.browser_download_url)}, ${JSON.stringify(sha ? sha.browser_download_url : "")}, ${JSON.stringify(releaseUrl)})`
            }];
        } else {
            buttons = [{
                label: "Open release page",
                action: `require("electron").shell.openExternal(${JSON.stringify(releaseUrl)})`
            }];
        }

        new Modal({
            type: "custom",
            title: "New version available",
            html:
                `<p style="margin:0 0 .8vh">eDEX-UI <strong>${release.tag_name}</strong> is now available.` +
                ` Current: <strong>${current}</strong></p>` +
                (release.name ? `<h5 style="margin:0 0 .4vh">${release.name}</h5>` : "") +
                (release.body ? `<pre style="max-height:30vh;overflow:auto;font-size:12px;margin:0">${release.body.slice(0, 1200)}</pre>` : ""),
            buttons
        });
    }
}

module.exports = {
    UpdateChecker
};
