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
        // parallel map of their English (romanized) display names. Loaded
        // page-relative, same pattern as filesystem.class.js.
        this._cnAdmin = require("./assets/misc/cn_admin.json");
        this._cnEn = require("./assets/misc/cn_admin_en.json");

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
                    <div class="mod_loc_dd">
                        <button type="button" class="mod_loc_btn" data-field="province">--</button>
                        <div class="mod_loc_list" data-field="province"></div>
                    </div>
                    <div class="mod_loc_dd">
                        <button type="button" class="mod_loc_btn" data-field="city">--</button>
                        <div class="mod_loc_list" data-field="city"></div>
                    </div>
                    <div class="mod_loc_dd">
                        <button type="button" class="mod_loc_btn" data-field="district">--</button>
                        <div class="mod_loc_list" data-field="district"></div>
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

                if (firstUpdate) {
                    firstUpdate = false;
                    require("electron").ipcRenderer.send("log", "debug", `Weather loaded: ${Math.round(current.temperature_2m)}°C ${cond} (${weekly.length}-day forecast) - visible ${(document.querySelectorAll("#mod_netstat").length)} module(s)`);
                }
            }
        });
    }

    // English (romanized) display name for a Chinese division name, e.g.
    // 四川省 -> Sichuan, 深圳市 -> Shenzhen, 南山区 -> Nanshan District.
    // Falls back to the Chinese name when the parallel dataset has no entry.
    _en(field, zh) {
        if (!zh) return "--";
        let en = zh;
        if (field === "province") {
            en = (this._cnEn[zh] && this._cnEn[zh].en) || zh;
        } else if (field === "city") {
            en = (this._loc && this._cnEn[this._loc.province] && this._cnEn[this._loc.province].cities[zh] && this._cnEn[this._loc.province].cities[zh].en) || zh;
        } else {
            en = (this._loc && this._cnEn[this._loc.province] && this._cnEn[this._loc.province].cities[this._loc.city] && this._cnEn[this._loc.province].cities[this._loc.city].districts[zh]) || zh;
        }
        return en;
    }

    // Three-level (province / city / district) location picker, rendered as
    // custom dropdowns matching the theme (no native <select>).
    //
    // Modules created after this one (globe, conninfo) rebuild the column's
    // innerHTML with `+=`, which re-parses and detaches every element captured
    // here. Two measures survive that:
    //   - a single delegated click listener on `document` (never rebuilt)
    //   - `_renderPicker()`, the single source of truth, re-run on a timer so
    //     the rebuilt DOM is re-populated from `this._loc`.
    _initLocationPicker() {
        let saved = this._weatherSaved;
        if (saved && this._cnAdmin[saved.province] && this._cnAdmin[saved.province][saved.city]) {
            this._loc = { province: saved.province, city: saved.city, district: saved.district || "" };
        } else {
            // Default UI state mirrors the fallback location: Chengdu, Xinjin.
            this._loc = { province: "四川省", city: "成都市", district: "新津区" };
        }
        this._openField = null;
        this._userPicked = false;
        this._autoApplied = false;
        this._auto = !!(saved && saved.auto);   // explicit "AUTO" mode (works for non-China)

        // Delegated clicks, scoped to this module so the settings editor's own
        // `.mod_loc_*` dropdowns are left alone.
        document.addEventListener("click", e => {
            let inWeather = e.target.closest && e.target.closest("#mod_netstat_weather_loc");
            if (inWeather) {
                if (e.target.closest(".mod_loc_auto")) { this._enableAuto(); return; }
                let btn = e.target.closest(".mod_loc_btn");
                if (btn) { this._toggleField(btn.dataset.field); return; }
                let opt = e.target.closest(".mod_loc_opt");
                if (opt) { this._selectOption(opt.dataset.field, opt.dataset.value); return; }
            }
            // click outside any open weather dropdown closes it
            if (this._openField && !(e.target.closest && e.target.closest("#mod_netstat_weather_loc"))) {
                this._openField = null;
                this._renderPicker();
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

    // When nothing is saved and the user has not picked a location, apply the
    // location detected by netstat (ipwho.is) as the weather default. Uses the
    // detected coordinates directly (no geocoding); maps the detected city name
    // onto the admin-division table for display. Not persisted, so a roaming
    // machine re-detects on every launch until the user picks a location.
    _autoLocate() {
        if (this._userPicked || this._weatherSaved || this._autoApplied) return;
        let geo = this.ipinfo && this.ipinfo.geo;
        if (!geo || typeof geo.latitude !== "number" || typeof geo.longitude !== "number") return;

        let want = String(geo.city || "").toLowerCase().trim();
        let found = null;
        for (const [prov, p] of Object.entries(this._cnEn)) {
            for (const [city, c] of Object.entries(p.cities)) {
                if (String(c.en).toLowerCase() === want) { found = { prov, city }; break; }
            }
            if (found) break;
        }
        if (!found) return; // could not map the detected city; keep the fallback

        this._autoApplied = true;
        clearInterval(this._autoLocTimer);
        this._loc = {
            province: found.prov,
            city: found.city,
            district: (this._cnAdmin[found.prov][found.city] && this._cnAdmin[found.prov][found.city][0]) || ""
        };
        window.settings.weatherLocation = {
            province: found.prov, city: found.city, district: this._loc.district,
            name: geo.city, latitude: geo.latitude, longitude: geo.longitude,
            timezone: "Asia/Shanghai"
        };
        this._weatherSaved = window.settings.weatherLocation;
        this._renderPicker();
        if (this.weather && this.weather.destroy) this.weather.destroy();
        this._initWeather();
        require("electron").ipcRenderer.send("log", "debug",
            `Weather auto-located to ${found.prov}/${found.city} (${geo.latitude}, ${geo.longitude})`);
    }

    // Explicit "AUTO" location — uses the detected coordinates directly, so it
    // works for users OUTSIDE China too (no province/city mapping required).
    _enableAuto() {
        this._auto = true;
        this._userPicked = true;
        clearInterval(this._autoLocTimer);
        if (!this._applyAuto()) {
            clearInterval(this._autoRetry);
            this._autoRetry = setInterval(() => { if (this._applyAuto()) clearInterval(this._autoRetry); }, 2000);
        }
    }

    // Applies the geo-detected location to the weather. Returns true once done.
    _applyAuto() {
        let geo = this.ipinfo && this.ipinfo.geo;
        if (!geo || typeof geo.latitude !== "number" || typeof geo.longitude !== "number") return false;
        const name = geo.city || geo.country || "AUTO";
        window.settings.weatherLocation = {
            latitude: geo.latitude, longitude: geo.longitude,
            name: name, country: geo.country || "", auto: true
        };
        this._weatherSaved = window.settings.weatherLocation;
        this._renderPicker();
        if (this.weather && this.weather.destroy) this.weather.destroy();
        this._initWeather();
        return true;
    }

    // Rebuild the whole picker from `this._loc`: English button labels, the
    // Chinese dropdown lists and the open/closed state of each list.
    _renderPicker() {
        let provBtn = document.querySelector("#mod_netstat_weather_loc .mod_loc_btn[data-field='province']");
        if (!provBtn) return; // pre-rebuild DOM detached; the timer re-runs this
        let cityBtn = document.querySelector("#mod_netstat_weather_loc .mod_loc_btn[data-field='city']");
        let distBtn = document.querySelector("#mod_netstat_weather_loc .mod_loc_btn[data-field='district']");
        let autoBtn = document.querySelector("#mod_netstat_weather_loc .mod_loc_auto");
        let status = document.getElementById("mod_netstat_weather_loc_status");
        let dds = document.querySelectorAll("#mod_netstat_weather_loc .mod_loc_dd");

        if (this._auto) {
            // AUTO mode: show the detected place, hide the CN pickers.
            if (autoBtn) autoBtn.classList.add("mod_loc_auto_active");
            if (status) status.textContent = (this._weatherSaved && this._weatherSaved.name) || "detecting…";
            dds.forEach(d => { d.style.display = "none"; });
            if (cityBtn) cityBtn.textContent = "";
            if (distBtn) distBtn.textContent = "";
            return;
        }
        if (autoBtn) autoBtn.classList.remove("mod_loc_auto_active");
        if (status) status.textContent = "";
        dds.forEach(d => { d.style.display = ""; });

        provBtn.textContent = this._en("province", this._loc.province);
        if (cityBtn) cityBtn.textContent = this._en("city", this._loc.city);
        if (distBtn) distBtn.textContent = this._en("district", this._loc.district);

        this._renderList("province", Object.keys(this._cnAdmin));
        let cities = this._cnAdmin[this._loc.province] || {};
        this._renderList("city", Object.keys(cities));
        this._renderList("district", cities[this._loc.city] || []);

        document.querySelectorAll("#mod_netstat_weather_loc .mod_loc_list").forEach(l => {
            l.classList.toggle("mod_loc_open", l.dataset.field === this._openField);
        });
    }

    _renderList(field, items) {
        let list = document.querySelector(`#mod_netstat_weather_loc .mod_loc_list[data-field='${field}']`);
        if (!list) return;
        list.innerHTML = "";
        items.forEach(item => {
            let div = document.createElement("div");
            div.className = "mod_loc_opt" + (item === this._loc[field] ? " mod_loc_opt_active" : "");
            div.dataset.field = field;
            div.dataset.value = item;
            div.textContent = item;
            list.appendChild(div);
        });
    }

    _toggleField(field) {
        this._openField = (this._openField === field) ? null : field;
        this._renderPicker();
        if (this._openField === field) {
            let list = document.querySelector(`#mod_netstat_weather_loc .mod_loc_list[data-field='${field}']`);
            let active = list && list.querySelector(".mod_loc_opt_active");
            if (active) active.scrollIntoView({ block: "nearest" });
        }
    }

    _selectOption(field, value) {
        this._userPicked = true;
        this._auto = false;   // manual pick leaves AUTO mode
        if (field === "province") {
            this._loc.province = value;
            let cities = this._cnAdmin[value] || {};
            this._loc.city = Object.keys(cities)[0] || "";
            this._loc.district = (cities[this._loc.city] && cities[this._loc.city][0]) || "";
        } else if (field === "city") {
            this._loc.city = value;
            let cities = this._cnAdmin[this._loc.province] || {};
            this._loc.district = (cities[value] && cities[value][0]) || "";
        } else {
            this._loc.district = value;
        }
        this._openField = null;
        this._renderPicker();
        this._applyLocation();
    }

    // Geocode the currently selected province/city/district, persist the choice
    // and restart the weather widget on the resolved coordinates.
    _applyLocation() {
        let status = document.getElementById("mod_netstat_weather_loc_status");
        let province = this._loc.province;
        let city = this._loc.city || "";
        let district = this._loc.district || "";
        if (!province) return;

        if (status) status.innerText = "RESOLVING";
        this._geocodeSelection(province, city, district).then(loc => {
            if (!loc) {
                if (status) status.innerText = "FAILED";
                return;
            }

            // Persist for the next launch (best-effort; failure only affects this session)
            window.settings.weatherLocation = {
                province: province,
                city: city,
                district: district,
                name: loc.name,
                latitude: loc.latitude,
                longitude: loc.longitude,
                timezone: loc.timezone
            };
            this._weatherSaved = window.settings.weatherLocation;
            try {
                let fs = require("fs");
                let path = require("path");
                let remote = require("@electron/remote");
                fs.writeFileSync(path.join(remote.app.getPath("userData"), "settings.json"),
                    JSON.stringify(window.settings, null, 4));
            } catch (e) { /* non-fatal */ }

            // Restart the widget on the new coords; the picker buttons are the
            // location display, which `_renderPicker` updates on the next pick.
            if (this.weather && this.weather.destroy) this.weather.destroy();
            this._initWeather();

            if (status) status.innerText = "OK";
            require("electron").ipcRenderer.send("log", "debug",
                `Weather location set: ${province} ${city} ${district} (${loc.latitude}, ${loc.longitude})`);
        });
    }

    // Open-Meteo's geocoder indexes populated places, not administrative
    // divisions, so a district name alone usually fails. We therefore geocode the
    // parent city (or the county-level district for province-administered
    // divisions) and reuse those coordinates for the district - the forecast
    // grid is far too coarse for district-level differences to matter.
    _geocodeSelection(province, city, district) {
        let queries;
        if (!city || city === province) {
            queries = [province];                    // municipalities: geocode the city itself
        } else if (city === "省直辖县级行政区划") {
            queries = [district, city, province];    // province-administered counties
        } else {
            queries = [city, city.replace(/市$/, ""), province];
        }
        return this._geocodeCN(queries, province);
    }

    // Geocode candidate names against the free Open-Meteo API, restricted to
    // China. Results are ranked by the API; among them we prefer one whose
    // province (admin1) matches the selected province, since plain city names
    // often collide with unrelated towns in other provinces.
    _geocodeCN(queries, province) {
        let norm = s => String(s || "").replace(/省|市|壮族自治区|回族自治区|维吾尔自治区|自治区|特别行政区/g, "");
        let want = norm(province);

        let attempt = q => new Promise(resolve => {
            if (!q) return resolve([]);
            let url = "https://geocoding-api.open-meteo.com/v1/search?count=8&language=zh&format=json&country=CN&name=" + encodeURIComponent(q);
            let req = require("https").get(url, {
                agent: this._httpsAgent,
                timeout: 15000,
                headers: {"User-Agent": "eDEX-UI/2.2.8"}
            }, res => {
                let raw = "";
                res.on("data", c => raw += c);
                res.on("end", () => {
                    try {
                        let d = JSON.parse(raw);
                        resolve((d && d.results) || []);
                    } catch (e) { resolve([]); }
                });
            });
            req.on("timeout", () => { req.destroy(); resolve([]); });
            req.on("error", () => resolve([]));
        });

        let walk = i => {
            if (i >= queries.length) return Promise.resolve(null);
            return attempt(queries[i]).then(rs => {
                if (!rs.length) return walk(i + 1);
                let exact = rs.find(r => norm(r.admin1) === want);
                if (exact) return exact;
                // Last resort: the province-name query may only return a nearby city
                if (i === queries.length - 1) return rs[0];
                return walk(i + 1);
            });
        };

        return walk(0).then(r => r ? {
            name: r.name,
            latitude: r.latitude,
            longitude: r.longitude,
            timezone: r.timezone
        } : null);
    }

    updateInfo() {
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
