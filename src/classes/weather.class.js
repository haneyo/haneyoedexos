// Weather data provider.
//
// Uses the free Open-Meteo API (https://open-meteo.com) - no API key required.
// Provides current conditions plus the next 24 hours of hourly forecast.
// Runs through Node's https in the renderer so it is not blocked by the
// page's Content-Security-Policy (connect-src ws: file:).

class Weather {
    constructor(opts) {
        this.latitude = opts.latitude;
        this.longitude = opts.longitude;
        this.timezone = opts.timezone || "Asia/Shanghai";
        this.onUpdate = opts.onUpdate || (() => {});
        this._agent = new require("https").Agent({keepAlive: false, maxSockets: 2});
        this.fetch();
        this._timer = setInterval(() => this.fetch(), 10 * 60 * 1000); // refresh every 10 min
    }

    fetch() {
        let url = `https://api.open-meteo.com/v1/forecast?latitude=${this.latitude}&longitude=${this.longitude}` +
            `&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m` +
            `&daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max` +
            `&forecast_days=7&timezone=${encodeURIComponent(this.timezone)}`;

        let req = require("https").get(url, {
            agent: this._agent,
            timeout: 15000,
            headers: {"User-Agent": "eDEX-UI/2.2.8"}
        }, res => {
            let raw = "";
            res.on("data", c => raw += c);
            res.on("end", () => {
                try {
                    let d = JSON.parse(raw);
                    if (!d || !d.current || !d.daily || res.statusCode !== 200) {
                        this._scheduleRetry();
                        return;
                    }

                    // Normalize the 7-day daily forecast into a compact list
                    let weekly = d.daily.time.map((t, i) => ({
                        time: t,                                     // "YYYY-MM-DD"
                        code: d.daily.weather_code[i],
                        temp_max: d.daily.temperature_2m_max[i],
                        temp_min: d.daily.temperature_2m_min[i],
                        precip: d.daily.precipitation_probability_max[i]
                    }));

                    this.onUpdate(d.current, weekly);
                } catch (e) {
                    // Keep the previous data on any parse error, retry shortly after
                    this._scheduleRetry();
                }
            });
        });
        req.on("timeout", () => { req.destroy(); this._scheduleRetry(); });
        req.on("error", () => { this._scheduleRetry(); });
    }

    // On any failure (unreachable service, timeout, bad payload) retry in 15s
    // instead of waiting for the next 10-minute cycle - useful on flaky networks.
    _scheduleRetry() {
        clearTimeout(this._retryTimer);
        this._retryTimer = setTimeout(() => this.fetch(), 15 * 1000);
    }

    // Stop the refresh timer and any pending retry. Call before discarding the
    // instance (e.g. when the user picks a different location).
    destroy() {
        clearInterval(this._timer);
        clearTimeout(this._retryTimer);
    }
}

// Minimal stroke icons drawn with `currentColor` so they inherit the theme and
// match the rest of the HUD (replaces the emoji that clashed with the theme).
Weather.icons = {
    sun: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.2 5.2l2.1 2.1M16.7 16.7l2.1 2.1M18.8 5.2l-2.1 2.1M7.3 16.7l-2.1 2.1"/></svg>`,
    partly: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="7.5" r="3.2"/><path d="M8 2.8V2M3.8 3.8 3 3M2.8 7.5H2M15.8 19.2h3.2a3.2 3.2 0 0 0 .9-6.3 4.4 4.4 0 0 0-7.9-1"/></svg>`,
    cloud: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M6.8 18.5h10.4a4 4 0 0 0 .8-7.9 5 5 0 0 0-9.8-1.1 4.3 4.3 0 0 0-1.4 9z"/></svg>`,
    fog: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6.8 11h10.4a3.6 3.6 0 0 0 .8-7.1 5 5 0 0 0-9 1A4 4 0 0 0 6.8 11z"/><path d="M4 13h16M4 16h16M4 19h16"/></svg>`,
    drizzle: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6.8 11h10.4a3.6 3.6 0 0 0 .8-7.1 5 5 0 0 0-9 1A4 4 0 0 0 6.8 11z"/><path d="M8.5 15l-.8 2M12 15.2l-.8 2M15.5 15l-.8 2"/></svg>`,
    rain: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6.8 11h10.4a3.6 3.6 0 0 0 .8-7.1 5 5 0 0 0-9 1A4 4 0 0 0 6.8 11z"/><path d="M7.5 15l-1.2 3M11.2 15l-1.2 3M14.9 15l-1.2 3M18.6 15l-1.2 3"/></svg>`,
    snow: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6.8 11h10.4a3.6 3.6 0 0 0 .8-7.1 5 5 0 0 0-9 1A4 4 0 0 0 6.8 11z"/><path d="M12 14.5v4.5M9.7 15.5l4.6 2.6M14.3 15.5l-4.6 2.6"/></svg>`,
    thunder: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6.8 11h10.4a3.6 3.6 0 0 0 .8-7.1 5 5 0 0 0-9 1A4 4 0 0 0 6.8 11z"/><path d="M12.8 13 9.6 18h2.6l-1.6 3.5 4-5h-2.7z"/></svg>`
};

// WMO weather codes -> [full name, short code, icon svg]
Weather.conditions = {
    0:  ["Clear", "CLR", Weather.icons.sun],
    1:  ["Mainly clear", "CLR", Weather.icons.sun],
    2:  ["Partly cloudy", "CLDY", Weather.icons.partly],
    3:  ["Overcast", "OVC", Weather.icons.cloud],
    45: ["Fog", "FOG", Weather.icons.fog],
    48: ["Fog", "FOG", Weather.icons.fog],
    51: ["Drizzle", "DRZL", Weather.icons.drizzle],
    53: ["Drizzle", "DRZL", Weather.icons.drizzle],
    55: ["Drizzle", "DRZL", Weather.icons.drizzle],
    56: ["Freezing drizzle", "FRZ", Weather.icons.rain],
    57: ["Freezing drizzle", "FRZ", Weather.icons.rain],
    61: ["Rain", "RAIN", Weather.icons.rain],
    63: ["Rain", "RAIN", Weather.icons.rain],
    65: ["Heavy rain", "RAIN", Weather.icons.rain],
    66: ["Freezing rain", "FRZ", Weather.icons.rain],
    67: ["Freezing rain", "FRZ", Weather.icons.rain],
    71: ["Snow", "SNOW", Weather.icons.snow],
    73: ["Snow", "SNOW", Weather.icons.snow],
    75: ["Heavy snow", "SNOW", Weather.icons.snow],
    77: ["Snow grains", "SNOW", Weather.icons.snow],
    80: ["Showers", "SHWR", Weather.icons.rain],
    81: ["Showers", "SHWR", Weather.icons.rain],
    82: ["Heavy showers", "SHWR", Weather.icons.rain],
    85: ["Snow showers", "SNOW", Weather.icons.snow],
    86: ["Snow showers", "SNOW", Weather.icons.snow],
    95: ["Thunderstorm", "TSTM", Weather.icons.thunder],
    96: ["T-storm + hail", "TSTM", Weather.icons.thunder],
    99: ["T-storm + hail", "TSTM", Weather.icons.thunder]
};
Weather.condition = code => Weather.conditions[code] || ["Unknown", "----", "❓"];

module.exports = {
    Weather
};
