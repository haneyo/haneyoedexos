class LocationGlobe {
    constructor(parentId) {
        if (!parentId) throw "Missing parameters";

        const path = require("path");

        this._geodata = require(path.join(__dirname, "assets/misc/grid.json"));
        require(path.join(__dirname, "assets/vendor/encom-globe.js"));
        this.ENCOM = window.ENCOM;

        // Create DOM and include lib
        this.parent = document.getElementById(parentId);
        this.parent.innerHTML += `<div id="mod_globe">
            <div id="mod_globe_innercontainer">
                <h1>WORLD VIEW<i>GLOBAL NETWORK MAP</i></h1>
                <h2>ENDPOINT LAT/LON<i class="mod_globe_headerInfo">0.0000, 0.0000</i></h2>
                <div id="mod_globe_canvas_placeholder"></div>
                <h3>OFFLINE</h3>
            </div>
        </div>`;

        this.lastgeo = {};
        this.conns = [];


        setTimeout(() => {
            let container = document.getElementById("mod_globe_innercontainer");
            let placeholder = document.getElementById("mod_globe_canvas_placeholder");

            // Create Globe
            this.globe = new this.ENCOM.Globe(placeholder.offsetWidth, placeholder.offsetHeight, {
                font: window.theme.cssvars.font_main,
                data: [],
                tiles: this._geodata.tiles,
                baseColor: window.theme.globe.base || `rgb(${window.theme.r},${window.theme.g},${window.theme.b})`,
                markerColor: window.theme.globe.marker || `rgb(${window.theme.r},${window.theme.g},${window.theme.b})`,
                pinColor: window.theme.globe.pin || `rgb(${window.theme.r},${window.theme.g},${window.theme.b})`,
                satelliteColor: window.theme.globe.satellite || `rgb(${window.theme.r},${window.theme.g},${window.theme.b})`,
                scale: 1.1,
                viewAngle: 0.630,
                dayLength: 1000 * 45,
                introLinesDuration: 2000,
                introLinesColor: window.theme.globe.marker || `rgb(${window.theme.r},${window.theme.g},${window.theme.b})`,
                maxPins: 300,
                maxMarkers: 100
            });

            // Place Globe
            placeholder.remove();
            container.append(this.globe.domElement);

            // Clicking the globe opens the default browser (map of the current
            // network location when known, otherwise the browser home).
            this.globe.domElement.addEventListener("click", () => {
                let url = "https://www.google.com";
                if (this.lastgeo && this.lastgeo.latitude && this.lastgeo.longitude) {
                    url = `https://www.google.com/maps?q=${this.lastgeo.latitude},${this.lastgeo.longitude}`;
                }
                try {
                    require("electron").shell.openExternal(url);
                } catch (e) { /* non-fatal */ }
            });

            // Init animations
            this._animate = () => {
                if (window.mods.globe.globe) {
                    window.mods.globe.globe.tick();
                }
                if (window.mods.globe._animate) {
                    setTimeout(() => {
                        try {
                            requestAnimationFrame(window.mods.globe._animate);
                        } catch(e) {
                            // We probably got caught in a theme change. Print it out but everything should keep running fine.
                            console.warn(e);
                        }
                    }, 1000 / 30);
                }
            };
            this.globe.init(window.theme.colors.light_black, () => {
                this._animate();
                window.audioManager.scan.play();
            });

            // resize handler
            this.resizeHandler = () => {
                let canvas = document.querySelector("div#mod_globe canvas");
                window.mods.globe.globe.camera.aspect = canvas.offsetWidth / canvas.offsetHeight;
                window.mods.globe.globe.camera.updateProjectionMatrix();
                window.mods.globe.globe.renderer.setSize(canvas.offsetWidth, canvas.offsetHeight);
            };
            window.addEventListener("resize", this.resizeHandler);

            // Connections
            this.conns = [];
            this.addConn = ip => {
                window.mods.netstat.geoLookup.get(ip).then(data => {
                    let geo = (data !== null ? data.location : {});
                    if (geo.latitude && geo.longitude) {
                        const lat = Number(geo.latitude);
                        const lon = Number(geo.longitude);
                        window.mods.globe.conns.push({
                            ip,
                            pin: window.mods.globe.globe.addPin(lat, lon, "", 1.2),
                        });
                    }
                }).catch(() => {});
            };
            this.removeConn = ip => {
                let index = this.conns.findIndex(x => x.ip === ip);
                if (index === -1) return;
                this.conns[index].pin.remove();
                this.conns.splice(index, 1);
            };

            // Add random satellites
            let constellation = [];
            for(var i = 0; i< 2; i++){
                for(var j = 0; j< 3; j++){
                    constellation.push({
                        lat: 50 * i - 30 + 15 * Math.random(),
                        lon: 120 * j - 120 + 30 * i,
                        altitude: Math.random() * (1.7 - 1.3) + 1.3
                    });
                }
            }

            this.globe.addConstellation(constellation);
        }, 2000);

        // Init updaters when intro animation is done
        setTimeout(() => {
            this.updateLoc();
            this.locUpdater = setInterval(() => {
                this.updateLoc();
            }, 1000);

            this.updateConns();
            this.connsUpdater = setInterval(() => {
                this.updateConns();
            }, 3000);

            // Transient random connections so the globe feels alive even with
            // no real traffic: linked markers appear, then fade away.
            this.activityTimer = setInterval(() => this._addRandomActivity(), 3000);
        }, 4000);
    }

    // Add a few random markers linked by lines (network-style activity), then
    // remove them after a few seconds.
    _addRandomActivity() {
        let globe = window.mods.globe.globe;
        if (!globe || window.mods.netstat.offline) return;
        let marks = [];
        let n = 2 + Math.floor(Math.random() * 2); // 2-3 markers
        for (let i = 0; i < n; i++) {
            let lat = this.getRandomInRange(-60, 75, 3);
            let lon = this.getRandomInRange(-180, 180, 3);
            marks.push(globe.addMarker(lat, lon, '', i === 0 ? false : marks[i - 1]));
        }
        setTimeout(() => {
            marks.forEach(m => { try { m.remove(); } catch (e) {} });
        }, 4000);
    }

    addRandomConnectedMarkers() {
        const randomLat = this.getRandomInRange(40, 90, 3);
        const randomLong = this.getRandomInRange(-180, 0, 3);
        this.globe.addMarker(randomLat, randomLong, '');
        this.globe.addMarker(randomLat - 20, randomLong + 150, '', true);
    }
    addTemporaryConnectedMarker(ip) {
        window.mods.netstat.geoLookup.get(ip).then(data => {
            let geo = (data !== null ? data.location : {});
            if (geo.latitude && geo.longitude) {
                const lat = Number(geo.latitude);
                const lon = Number(geo.longitude);

                window.mods.globe.conns.push({
                    ip,
                    pin: window.mods.globe.globe.addPin(lat, lon, "", 1.2)
                });
                let mark = window.mods.globe.globe.addMarker(lat, lon, '', true);
                setTimeout(() => {
                    mark.remove();
                }, 3000);
            }
        }).catch(() => {});
    }
    removeMarkers() {
        this.globe.markers.forEach(marker => { marker.remove(); });
        this.globe.markers = [];
    }
    removePins() {
        this.globe.pins.forEach(pin => {
            pin.remove();
        });
        this.globe.pins = [];
    }
    getRandomInRange(from, to, fixed) {
        return (Math.random() * (to - from) + from).toFixed(fixed) * 1;
    }
    updateLoc() {
        if (window.mods.netstat.offline) {
            document.querySelector("div#mod_globe").setAttribute("class", "offline");
            document.querySelector("i.mod_globe_headerInfo").innerText = "(OFFLINE)";

            this.removePins();
            this.removeMarkers();
            this.conns = [];
            this.lastgeo = {
                latitude: 0,
                longitude: 0
            };
        } else {
            this.updateConOnlineConnection().then(() => {
                document.querySelector("div#mod_globe").setAttribute("class", "");
            }).catch(() => {
                document.querySelector("i.mod_globe_headerInfo").innerText = "UNKNOWN";
            })
        }
    }
    async updateConOnlineConnection() {
        let newgeo = window.mods.netstat.ipinfo.geo;
        newgeo.latitude = Math.round(newgeo.latitude*10000)/10000;
        newgeo.longitude = Math.round(newgeo.longitude*10000)/10000;

        if (newgeo.latitude !== this.lastgeo.latitude || newgeo.longitude !== this.lastgeo.longitude) {

            document.querySelector("i.mod_globe_headerInfo").innerText = `${newgeo.latitude}, ${newgeo.longitude}`;
            this.removePins();
            this.removeMarkers();
            //this.addRandomConnectedPoints();
            this.conns = [];

            this._locPin = this.globe.addPin(newgeo.latitude, newgeo.longitude, "", 1.2);
            this._locMarker = this.globe.addMarker(newgeo.latitude, newgeo.longitude, "", false, 1.2);
        }

        this.lastgeo = newgeo;
        document.querySelector("div#mod_globe").setAttribute("class", "");
    }
    // Current ESTABLISHED TCP connections as [{peeraddress, state}].
    // systeminformation's networkConnections() returns an empty list on some
    // macOS versions, so fall back to parsing `lsof -iTCP` when that happens.
    _getConnections() {
        return new Promise(resolve => {
            window.si.networkConnections().then(conns => {
                if (Array.isArray(conns) && conns.length > 0) return resolve(conns);
                resolve(this._lsofConnections());
            }).catch(() => resolve(this._lsofConnections()));
        });
    }

    _lsofConnections() {
        return new Promise(resolve => {
            try {
                require("child_process").exec("lsof -nP -iTCP", { timeout: 3000 }, (err, stdout) => {
                    if (err || typeof stdout !== "string") return resolve([]);
                    let out = [];
                    stdout.split("\n").forEach(line => {
                        // NAME column: `local:port->remote:port (ESTABLISHED)`
                        let m = line.match(/->(\[[0-9a-fA-F:]+\]|[0-9a-fA-F:.]+):\d+\s*\((ESTABLISHED)\)/);
                        if (!m) return;
                        let ip = m[1].replace(/^\[|\]$/g, "");
                        if (ip === "0.0.0.0" || ip === "127.0.0.1" || ip === "::") return;
                        if (!window.mods.netstat.geoLookup._isPublicIP(ip)) return;
                        if (out.indexOf(ip) === -1) out.push(ip);
                    });
                    resolve(out.map(ip => ({ peeraddress: ip, state: "ESTABLISHED" })));
                });
            } catch (e) {
                resolve([]);
            }
        });
    }

    updateConns() {
        if (!window.mods.globe.globe || window.mods.netstat.offline) return false;
        this._getConnections().then(conns => {
            let newconns = [];
            conns.forEach(conn => {
                let ip = conn.peeraddress;
                let state = conn.state;
                if (state === "ESTABLISHED" && ip !== "0.0.0.0" && ip !== "127.0.0.1" && ip !== "::") {
                    newconns.push(ip);
                }
            });

            this.conns.forEach(conn => {
                if (newconns.indexOf(conn.ip) !== -1) {
                    newconns.splice(newconns.indexOf(conn.ip), 1);
                } else {
                    this.removeConn(conn.ip);
                }
            });

            newconns.forEach(ip => {
                this.addConn(ip);
            });
        });
    }
}

module.exports = {
    LocationGlobe
};
