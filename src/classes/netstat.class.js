// Lightweight cached geolocation lookup.
//
// The original eDEX-UI bundled a GeoLite2 database (geolite2-redist + maxmind).
// MaxMind discontinued the free GeoLite2 databases, so the whole offline stack
// (a ~70 MB download + native-free pure-JS reader) is replaced here by a free,
// no-API-key HTTPS endpoint (ipwho.is). Lookups are cached in-memory to keep
// the request rate low.
class GeoLookup {
    constructor() {
        this.cache = new Map();
        this._agent = new require("https").Agent({keepAlive: false, maxSockets: 5});
    }
    // Resolves to `{ ip, location: {latitude, longitude, city, country} }` or null.
    // Kept async on purpose: callers (the globe) must `.then()` on it.
    get(ip) {
        if (typeof ip !== "string" || !ip.trim()) return Promise.resolve(null);
        ip = ip.trim();
        if (!this._isPublicIP(ip)) return Promise.resolve(null);
        if (this.cache.has(ip)) return this.cache.get(ip);

        let p = this._fetch(ip);
        this.cache.set(ip, p);
        return p;
    }
    _isPublicIP(ip) {
        if (ip.includes(":")) {
            // IPv6: skip loopback, link-local and unique-local addresses
            if (ip === "::" || ip === "::1" || ip.startsWith("fe80") || ip.startsWith("fc") || ip.startsWith("fd")) return false;
            return true;
        }
        let parts = ip.split(".").map(Number);
        if (parts.length !== 4) return false;
        if (parts.some(p => isNaN(p))) return false;
        if (parts[0] === 0 || parts[0] === 10 || parts[0] === 127) return false;
        if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return false;
        if (parts[0] === 192 && parts[1] === 168) return false;
        if (parts[0] === 169 && parts[1] === 254) return false;
        if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return false; // CGNAT
        if (parts[0] === 198 && (parts[1] === 18 || parts[1] === 19)) return false; // benchmark range (VPN/proxy fake IPs)
        if (parts[0] === 192 && parts[1] === 0) return false; // 192.0.0.0/24
        if (parts[0] === 198 && parts[1] === 51) return false; // TEST-NET-2
        if (parts[0] === 203 && parts[1] === 0) return false; // TEST-NET-3
        if (parts[0] >= 224) return false; // multicast + reserved
        return true;
    }
    _fetch(ip) {
        return new Promise(resolve => {
            let settled = false;
            let done = data => {
                if (settled) return;
                settled = true;
                resolve(data);
            };
            let req = require("https").get({
                host: "ipwho.is",
                path: "/" + encodeURIComponent(ip),
                agent: this._agent,
                timeout: 4000,
                headers: {"User-Agent": "eDEX-UI/2.2.8"}
            }, res => {
                let raw = "";
                res.on("data", c => raw += c);
                res.on("end", () => {
                    try {
                        let d = JSON.parse(raw);
                        if (d && d.success === true && typeof d.latitude === "number") {
                            done({
                                ip,
                                location: {
                                    latitude: d.latitude,
                                    longitude: d.longitude,
                                    city: d.city || "",
                                    country: d.country || ""
                                }
                            });
                        } else {
                            done(null);
                        }
                    } catch (e) {
                        done(null);
                    }
                });
            });
            req.on("timeout", () => { req.destroy(); done(null); });
            req.on("error", () => done(null));
        });
    }
}

class Netstat {
    constructor(parentId) {
        if (!parentId) throw "Missing parameters";

        // Create DOM - the module is dedicated to the weather display, with a
        // three-level (province / city / district) location picker. Network
        // status is reduced to a single subtle footer line (see updateInfo).
        this.parent = document.getElementById(parentId);

        // China administrative divisions (province -> city -> districts) plus a
        // Location persisted via settings.json (key weatherLocation). Falls back
        // to the Chengdu, Xinjin default when nothing has been set yet.
        let saved = (window.settings && window.settings.weatherLocation && typeof window.settings.weatherLocation.latitude === "number")
            ? window.settings.weatherLocation : null;
        this._weatherSaved = saved;

        this.parent.innerHTML += `<div id="mod_netstat">
            <div id="mod_netstat_inner">
                <h1>WEATHER</h1>
                <div id="mod_netstat_weather_loc">
                    <button type="button" class="mod_loc_auto" title="Auto-detect my location (works anywhere)">AUTO</button>
                    <button type="button" class="mod_loc_cur" title="Click to change location"></button>
                    <div class="mod_loc_editor">
                        <input id="mod_netstat_weather_search" type="text" placeholder="Search city or address…" spellcheck="false" autocomplete="off">
                        <div class="mod_loc_results"></div>
                    </div>
                    <span id="mod_netstat_weather_loc_status"></span>
                </div>
                <div id="mod_netstat_weather_main">
                    <div id="mod_netstat_weather_main_temp">
                        <span id="mod_netstat_weather_icon">--</span>
                        <span id="mod_netstat_weather_temp">--°</span>
                    </div>
                    <div id="mod_netstat_weather_meta">
                        <h2 id="mod_netstat_weather_cond">--</h2>
                        <h2 id="mod_netstat_weather_detail">HUMIDITY --% · WIND -- KM/H</h2>
                        <h2 id="mod_netstat_weather_range">H --° · L --°</h2>
                    </div>
                </div>
                <div id="mod_netstat_forecast_label">NEXT 7 DAYS</div>
                <div id="mod_netstat_forecast">${'<div class="mod_netstat_fx"><span>---</span><span class="mod_weather_icon">--</span><span>--°</span><em class="mod_netstat_fx_low">--°</em><em class="mod_netstat_fx_rain"></em></div>'.repeat(7)}</div>
                <div id="mod_netstat_netfooter"></div>
            </div>
        </div>`;

        this.offline = false;
        this.iface = null;
        this.failedAttempts = {};
        this.runsBeforeGeoIPUpdate = 0;
        this._updatingIP = false;

        this._httpsAgent = new require("https").Agent({
            keepAlive: false,
            maxSockets: 10
        });

        // Cached geolocation service (used for the globe's connection pins)
        this.geoLookup = new GeoLookup();

        // Weather widget - replaces the public-IP readout in the top-right panel
        this._initWeather();
        this._initLocationPicker();

        // Init updaters
        this.updateInfo();
        this.infoUpdater = setInterval(() => {
            this.updateInfo();
        }, 2000);
    }

    // Current conditions + 7-day forecast via Open-Meteo. Coordinates come from
    // the saved location (settings.weatherLocation) or default to Chengdu, Xinjin.
    _initWeather() {
        let firstUpdate = true;
        let saved = this._weatherSaved;
        let lat = saved ? saved.latitude : 30.4113;
        let lon = saved ? saved.longitude : 103.8130;
        let tz = (saved && saved.timezone) ? saved.timezone : "Asia/Shanghai";

        this.weather = new Weather({
            latitude: lat,
            longitude: lon,
            timezone: tz,
            onUpdate: (current, weekly) => {
                // Re-query the DOM elements on every update instead of caching them:
                // the modules created AFTER this one rebuild the column's innerHTML
                // (they use `innerHTML +=`), which detaches references captured earlier.
                let iconEl = document.getElementById("mod_netstat_weather_icon");
                let tempEl = document.getElementById("mod_netstat_weather_temp");
                let condEl = document.getElementById("mod_netstat_weather_cond");
                let detailEl = document.getElementById("mod_netstat_weather_detail");
                let rangeEl = document.getElementById("mod_netstat_weather_range");
                let forecastEl = document.getElementById("mod_netstat_forecast");
                if (!tempEl || !forecastEl) return;

                let [cond, short, icon] = Weather.condition(current.weather_code);
                if (iconEl) iconEl.innerHTML = icon;
                tempEl.innerHTML = `${Math.round(current.temperature_2m)}°`;
                condEl.innerText = cond.toUpperCase();
                detailEl.innerText = `HUMIDITY ${current.relative_humidity_2m}% · WIND ${current.wind_speed_10m} KM/H`;
                if (weekly && weekly[0] && typeof weekly[0].temp_max === "number") {
                    rangeEl.innerText = `H ${Math.round(weekly[0].temp_max)}° · L ${Math.round(weekly[0].temp_min)}°`;
                } else {
                    rangeEl.innerText = "";
                }

                // 7-day forecast: day of week / icon / high / low / rain chance
                forecastEl.innerHTML = weekly.map((d, i) => {
                    let [dc, dshort, dic] = Weather.condition(d.code);
                    let [y, m, dd] = d.time.split("-").map(Number);
                    let dayName = (i === 0) ? "TODAY" : ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"][new Date(Date.UTC(y, m - 1, dd)).getUTCDay()];
                    let rain = (typeof d.precip === "number" && d.precip > 0) ? `<em class="mod_netstat_fx_rain">${d.precip}%</em>` : `<em></em>`;
                    return `<div class="mod_netstat_fx" title="${dc}">
                        <span>${dayName}</span>
                        <span class="mod_weather_icon">${dic}</span>
                        <span>${Math.round(d.temp_max)}°</span>
                        <em class="mod_netstat_fx_low">${Math.round(d.temp_min)}°</em>
                        ${rain}
                    </div>`;
                }).join("");

                // Keep the latest payload for the click-to-expand detail modal
                // (window.openWeatherModal reads window.mods.netstat._wx).
                this._wx = {
                    loc: (this._auto ? "AUTO · " : "") + ((this._weatherSaved && this._weatherSaved.name) || "Unknown"),
                    current,
                    weekly
                };

                if (firstUpdate) {
                    firstUpdate = false;
                    require("electron").ipcRenderer.send("log", "debug", `Weather loaded: ${Math.round(current.temperature_2m)}°C ${cond} (${weekly.length}-day forecast) - visible ${(document.querySelectorAll("#mod_netstat").length)} module(s)`);
                }
            }
        });
    }

    // Location picker: click the current-place button to open a search box
    // (Open-Meteo geocoding), pick a result, or toggle AUTO.
    //
    // Modules created after this one (globe, conninfo) rebuild the column's
    // innerHTML with `+=`, which re-parses and detaches every element captured
    // here. Two measures survive that:
    //   - a single delegated click listener on `document` (never rebuilt)
    //   - `_renderPicker()`, the single source of truth, re-run on a timer so
    //     the rebuilt DOM is re-populated from `this._weatherSaved`.
    _initLocationPicker() {
        this._auto = !!(this._weatherSaved && this._weatherSaved.auto);
        this._editorOpen = false;
        this._userPicked = false;
        this._autoApplied = false;
        this._manualSaved = (this._weatherSaved && !this._weatherSaved.auto) ? this._weatherSaved : null;

        // Delegated clicks: AUTO toggles; the current-location button opens the
        // search editor; a search result applies it; clicking outside closes.
        document.addEventListener("click", e => {
            const inLoc = e.target.closest && e.target.closest("#mod_netstat_weather_loc");
            if (inLoc) {
                if (e.target.closest(".mod_loc_auto")) {
                    if (this._auto) { this._disableAuto(); } else { this._enableAuto(); }
                    return;
                }
                if (e.target.closest(".mod_loc_cur")) { this._toggleEditor(); return; }
                return; // search results handle their own click
            }
            if (this._editorOpen && !(e.target.closest && e.target.closest("#mod_netstat_weather_loc"))) {
                this._closeEditor();
            }
        });

        // The netstat column is rebuilt by later modules (which detaches the
        // search input), so delegate input/keydown to `document` — the same way
        // the click handler is delegated.
        let debounce;
        document.addEventListener("input", e => {
            if (e.target && e.target.id === "mod_netstat_weather_search") {
                clearTimeout(debounce);
                const q = e.target.value.trim();
                debounce = setTimeout(() => this._searchAndRender(q), 350);
            }
        });
        document.addEventListener("keydown", e => {
            if (e.target && e.target.id === "mod_netstat_weather_search") {
                e.stopPropagation();
                if (e.key === "Escape") { e.preventDefault(); this._closeEditor(); }
                else if (e.key === "Enter") { e.preventDefault(); }
            }
        });

        this._renderPicker();
        // Re-render once the column is rebuilt by the modules created after this one
        setTimeout(() => this._renderPicker(), 0);
        setTimeout(() => this._renderPicker(), 400);

        // Auto-locate: once netstat detects this machine's public-IP location,
        // use it as the weather default until the user picks a location manually.
        if (!this._weatherSaved) {
            this._autoLocTimer = setInterval(() => this._autoLocate(), 2000);
        }
    }

    _toggleEditor() {
        this._editorOpen = !this._editorOpen;
        this._renderPicker();
        if (this._editorOpen) {
            setTimeout(() => {
                const input = document.getElementById("mod_netstat_weather_search");
                if (input) { input.value = ""; input.focus(); }
                const results = document.querySelector("#mod_netstat_weather_loc .mod_loc_results");
                if (results) results.innerHTML = "";
            }, 0);
        }
    }

    _closeEditor() {
        this._editorOpen = false;
        this._renderPicker();
    }

    // Open-Meteo geocoding search (any country, English results).
    _searchLocations(q) {
        return new Promise(resolve => {
            if (!q) return resolve([]);
            const url = "https://geocoding-api.open-meteo.com/v1/search?count=8&language=en&format=json&name=" + encodeURIComponent(q);
            const req = require("https").get(url, {
                agent: this._httpsAgent, timeout: 12000,
                headers: {"User-Agent": "eDEX-UI/2.2.8"}
            }, res => {
                let raw = "";
                res.on("data", c => raw += c);
                res.on("end", () => { try { const d = JSON.parse(raw); resolve((d && d.results) || []); } catch (e) { resolve([]); } });
            });
            req.on("timeout", () => { req.destroy(); resolve([]); });
            req.on("error", () => resolve([]));
        });
    }

    async _searchAndRender(q) {
        const results = document.querySelector("#mod_netstat_weather_loc .mod_loc_results");
        if (!results) return;
        if (!q) { results.innerHTML = ""; return; }
        results.innerHTML = `<div class="mod_loc_status_line">SEARCHING…</div>`;
        const found = await this._searchLocations(q);
        if (!found.length) { results.innerHTML = `<div class="mod_loc_status_line">NO RESULTS</div>`; return; }
        results.innerHTML = "";
        found.forEach((r, i) => {
            const d = document.createElement("div");
            d.className = "mod_loc_result" + (i === 0 ? " mod_loc_result_top" : "");
            d.innerHTML = `<b>${r.name}</b><span>${[r.admin1, r.country].filter(Boolean).join(" · ")}</span>`;
            d.onclick = () => this._selectSearchResult(r);
            results.appendChild(d);
        });
    }

    _selectSearchResult(r) {
        this._auto = false;
        this._userPicked = true;
        clearInterval(this._autoRetry);
        clearInterval(this._autoLocTimer);
        const name = [r.name, r.admin1, r.country].filter(Boolean).join(", ");
        window.settings.weatherLocation = {
            name, latitude: r.latitude, longitude: r.longitude,
            timezone: r.timezone || "auto", auto: false
        };
        this._manualSaved = window.settings.weatherLocation;
        this._weatherSaved = window.settings.weatherLocation;
        this._persistWeather();
        this._closeEditor();
        this._renderPicker();
        if (this.weather && this.weather.destroy) this.weather.destroy();
        this._initWeather();
        require("electron").ipcRenderer.send("log", "debug",
            `Weather location set: ${name} (${r.latitude}, ${r.longitude})`);
    }

    _persistWeather() {
        try {
            const fs = require("fs"), path = require("path"), remote = require("@electron/remote");
            fs.writeFileSync(path.join(remote.app.getPath("userData"), "settings.json"),
                JSON.stringify(window.settings, null, 4));
        } catch (e) { /* non-fatal */ }
    }

    // When nothing is saved and the user has not picked a location, apply the
    // location detected by netstat (ipwho.is) as the weather default. Not
    // persisted, so a roaming machine re-detects on every launch until the
    // user picks a location.
    _autoLocate() {
        if (this._userPicked || this._weatherSaved || this._autoApplied) return;
        let geo = this.ipinfo && this.ipinfo.geo;
        if (!geo || typeof geo.latitude !== "number" || typeof geo.longitude !== "number") return;
        this._autoApplied = true;
        clearInterval(this._autoLocTimer);
        const name = [geo.city, geo.region, geo.country].filter(Boolean).join(", ") || "Detected location";
        window.settings.weatherLocation = { name, latitude: geo.latitude, longitude: geo.longitude, timezone: "auto" };
        this._weatherSaved = window.settings.weatherLocation;
        this._renderPicker();
        if (this.weather && this.weather.destroy) this.weather.destroy();
        this._initWeather();
        require("electron").ipcRenderer.send("log", "debug",
            `Weather auto-located to ${name} (${geo.latitude}, ${geo.longitude})`);
    }

    // Explicit "AUTO" location — uses the detected coordinates directly, so it
    // works everywhere (no province/city mapping required).
    _enableAuto() {
        this._auto = true;
        this._userPicked = true;
        clearInterval(this._autoLocTimer);
        if (!this._applyAuto()) {
            clearInterval(this._autoRetry);
            this._autoRetry = setInterval(() => { if (this._applyAuto()) clearInterval(this._autoRetry); }, 2000);
        }
    }

    // Leave AUTO: restore the last manually searched location, if any.
    _disableAuto() {
        this._auto = false;
        this._userPicked = true;
        clearInterval(this._autoRetry);
        const manual = this._manualSaved;
        if (manual) {
            window.settings.weatherLocation = manual;
            this._weatherSaved = window.settings.weatherLocation;
            this._persistWeather();
            if (this.weather && this.weather.destroy) this.weather.destroy();
            this._initWeather();
        }
        this._renderPicker();
    }

    // Applies the geo-detected location to the weather. Returns true once done.
    _applyAuto() {
        let geo = this.ipinfo && this.ipinfo.geo;
        if (!geo || typeof geo.latitude !== "number" || typeof geo.longitude !== "number") return false;
        const name = [geo.city, geo.region, geo.country].filter(Boolean).join(", ") || "AUTO";
        window.settings.weatherLocation = {
            latitude: geo.latitude, longitude: geo.longitude,
            name, country: geo.country || "", auto: true
        };
        this._weatherSaved = window.settings.weatherLocation;
        this._renderPicker();
        if (this.weather && this.weather.destroy) this.weather.destroy();
        this._initWeather();
        return true;
    }

    // Rebuild the whole picker from `this._loc`: English button labels, the
    // Chinese dropdown lists and the open/closed state of each list.
    // Rebuild the location row: AUTO button state, the current place name
    // (English), and the open/closed state of the search editor.
    _renderPicker() {
        const loc = document.querySelector("#mod_netstat_weather_loc");
        if (!loc) return;
        const autoBtn = loc.querySelector(".mod_loc_auto");
        const cur = loc.querySelector(".mod_loc_cur");
        const editor = loc.querySelector(".mod_loc_editor");
        const status = document.getElementById("mod_netstat_weather_loc_status");

        if (autoBtn) autoBtn.classList.toggle("mod_loc_auto_active", this._auto);
        const saved = this._weatherSaved;
        if (cur) {
            cur.textContent = this._auto
                ? ((saved && saved.name) ? "AUTO · " + saved.name : "AUTO · detecting…")
                : ((saved && saved.name) ? saved.name : "Set location");
        }
        if (editor) editor.style.display = this._editorOpen ? "block" : "none";
        if (status) status.textContent = "";
    }

    updateInfo() {
        // Cover mode (lock / screensaver): report the fabricated uplink instead
        // of the real interface / public IP.
        if (window.cover && window.cover.isActive()) {
            let ms = 30 + Math.floor(Math.random() * 50);
            document.getElementById("mod_netstat_netfooter").innerText = `NET: SATLINK-7 · ONLINE · ${ms}MS · IP 10.90.45.7`;
            return;
        }
        window.si.networkInterfaces().then(async data => {
            let offline = false;

            let net = data[0];
            let netID = 0;

            if (typeof window.settings.iface === "string") {
                while (net.iface !== window.settings.iface) {
                    netID++;
                    if (data[netID]) {
                        net = data[netID];
                    } else {
                        // No detected interface has the custom iface name, fallback to automatic detection on next loop
                        window.settings.iface = false;
                        return false;
                    }
                }
            } else {
                // Find the first external, IPv4 connected networkInterface that has a MAC address set

                while (net.operstate !== "up" || net.internal === true || net.ip4 === "" || net.mac === "") {
                    netID++;
                    if (data[netID]) {
                        net = data[netID];
                    } else {
                        // No external connection!
                        this.iface = null;
                        this.offline = true;
                        document.getElementById("mod_netstat_netfooter").innerText = "NETWORK: OFFLINE";
                        break;
                    }
                }
            }

            if (net.ip4 !== this.internalIPv4) this.runsBeforeGeoIPUpdate = 0;

            this.iface = net.iface;
            this.internalIPv4 = net.ip4;

            if (net.ip4 === "127.0.0.1") {
                offline = true;
            } else {
                // Refresh the public IP / geolocation once per IP change
                if (this.runsBeforeGeoIPUpdate === 0 && !this._updatingIP) {
                    this._updatingIP = true;
                    let info = await this._fetchIPinfo(net.ip4);
                    this._updatingIP = false;

                    if (info) {
                        this.ipinfo = info;
                        this._publicIP = info.ip;
                        this.runsBeforeGeoIPUpdate = 10;
                    }
                } else if (this.runsBeforeGeoIPUpdate !== 0) {
                    this.runsBeforeGeoIPUpdate = this.runsBeforeGeoIPUpdate - 1;
                }

                let p = await this.ping(window.settings.pingAddr || "223.5.5.5", 80, net.ip4).catch(() => { offline = true });

                // Cover mode was engaged while this async chain was in flight
                // (e.g. a lock right after the previous tick started) — the fake
                // footer already took over, so a real IP must not overwrite it.
                if (window.cover && window.cover.isActive()) return;

                this.offline = offline;
                let footer = `NET: ${net.iface} · ${offline ? "OFFLINE" : "ONLINE"}`;
                if (!offline) footer += ` · ${Math.round(p)}MS`;
                if (this._publicIP) footer += ` · IP ${this._publicIP}`;
                document.getElementById("mod_netstat_netfooter").innerText = footer;
            }
        });
    }
    // Fetch the public IP + geolocation as seen from the given interface.
    // Uses the free ipwho.is endpoint (no API key required).
    //
    // Binding the socket to the interface's local address asks ipwho.is "what is
    // my public IP as seen from this interface", which is the correct approach on
    // multi-homed machines. On some networks (observed on macOS) that bound
    // request hangs and times out, so we retry over the default route (no
    // localAddress) before giving up.
    _fetchIPinfo(localIP) {
        let attempt = opts => new Promise(resolve => {
            let settled = false;
            let done = data => {
                if (settled) return;
                settled = true;
                resolve(data);
            };

            let req = require("https").get(opts, res => {
                let rawData = "";
                res.on("data", chunk => {
                    rawData += chunk;
                });
                res.on("end", () => {
                    try {
                        let data = JSON.parse(rawData);
                        if (data && data.success === true) {
                            done({
                                ip: data.ip,
                                geo: {
                                    latitude: data.latitude,
                                    longitude: data.longitude,
                                    city: data.city || "",
                                    country: data.country || ""
                                }
                            });
                        } else {
                            done(null);
                        }
                    } catch (e) {
                        this.failedAttempts[e] = (this.failedAttempts[e] || 0) + 1;
                        if (this.failedAttempts[e] > 2) return done(null);
                        console.warn(e);
                        require("electron").ipcRenderer.send("log", "note", "NetStat: Error parsing data from ipwho.is");
                        require("electron").ipcRenderer.send("log", "debug", `Error: ${e}`);
                        done(null);
                    }
                });
            });
            req.on("timeout", () => {
                req.destroy();
                done(null);
            });
            req.on("error", () => {
                done(null);
            });
        });

        let base = {
            host: "ipwho.is",
            path: "/",
            family: 4,
            agent: this._httpsAgent,
            timeout: 6000,
            headers: {"User-Agent": "eDEX-UI/2.2.8"}
        };

        // Bound attempt first (per-interface), then fall back to the default route
        return attempt(Object.assign({}, base, { localAddress: localIP }))
            .then(info => info || attempt(base));
    }
    ping(target, port, local) {
        return new Promise((resolve, reject) => {
            let s = new require("net").Socket();
            let start = process.hrtime();

            s.connect({
                port,
                host: target,
                localAddress: local,
                family: 4
            }, () => {
                let time_arr = process.hrtime(start);
                let time = (time_arr[0] * 1e9 + time_arr[1]) / 1e6;
                resolve(time);
                s.destroy();
            });
            s.on('error', e => {
                s.destroy();
                reject(e);
            });
            s.setTimeout(1900, function() {
                s.destroy();
                reject(new Error("Socket timeout"));
            });
        });
    }
}

module.exports = {
    Netstat
};
