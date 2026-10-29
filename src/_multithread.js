// Multithreaded systeminformation controller.
//
// The original implementation forked CPU-bound systeminformation queries into a
// pool of cluster workers. cluster + child_process.fork() is fragile inside the
// Electron main process (it needs ELECTRON_RUN_AS_NODE, worker process
// management, and serializing large payloads over the cluster channel).
//
// Modern systeminformation is fully asynchronous under the hood (it shells out
// to `sysctl` / `ps` / `lsof` / ... via exec, never blocking the event loop),
// so dispatching queries directly in the main process is both simpler and more
// reliable. The renderer-side proxy (see _renderer.js) keeps the exact same
// `systeminformation-call` / `systeminformation-reply-<id>` protocol.
//
// Two hot queries are answered straight from /proc on Linux instead. Both of
// systeminformation's Linux implementations fork like mad:
//
//   processes()          -> `ps -axo ...` plus one `sh -c` running
//                           `cat /proc/stat; cat /proc/<pid>/stat` for every
//                           process (~180 extra forks). Measured on a 4-thread
//                           i3 laptop: 295 ms per call, every 1.9 s.
//   networkInterfaces()  -> one `sh -c` with ~25 `cat`s, plus four *synchronous*
//                           `nmcli` runs (execFileSync), which block the main
//                           process - and with it every IPC reply - while they
//                           spawn. Measured at 350-420 ms per call, every 2 s.
//
// Reading /proc directly costs ~13 ms and ~4 ms respectively, with zero forks.
//
// The /proc readers below return the same object shape as systeminformation, so
// nothing downstream changes. Any failure falls back to the library.

const { ipcMain } = require("electron");
const fs = require("fs");
const os = require("os");
const signale = require("signale");
const si = require("systeminformation");

signale.success("Systeminformation controller ready");

const IS_LINUX = process.platform === "linux";
const USER_HZ = 100; // /proc/<pid>/stat times are always in USER_HZ ticks

// ---------------------------------------------------------------------------
// processes()
// ---------------------------------------------------------------------------

const STATE_NAMES = {
    R: "running",
    S: "sleeping",
    T: "stopped",
    W: "paging",
    X: "dead",
    Z: "zombie",
    D: "blocked",
    U: "blocked"
};

// Same normalization as systeminformation: cpu% is a share of all cores, so
// cpuu + cpus never exceeds 100 (#1007 spike).
function clampCpuPair(cpuu, cpus) {
    if (!isFinite(cpuu) || cpuu < 0) cpuu = 0;
    if (!isFinite(cpus) || cpus < 0) cpus = 0;
    const total = cpuu + cpus;
    if (total > 100) {
        cpuu = (cpuu / total) * 100;
        cpus = (cpus / total) * 100;
    }
    return { cpuu, cpus };
}

let _passwd = { at: 0, map: null };

function uidNames() {
    const now = Date.now();
    if (_passwd.map && now - _passwd.at < 60000) return _passwd.map;
    const map = Object.create(null);
    try {
        for (const line of fs.readFileSync("/etc/passwd", "utf8").split("\n")) {
            const fields = line.split(":");
            if (fields.length >= 3) map[fields[2]] = fields[0];
        }
    } catch (err) {
        // No passwd (or unreadable): fall back to bare uids below.
    }
    _passwd = { at: now, map };
    return map;
}

function formatDate(date) {
    const p = n => ("0" + n).slice(-2);
    return (
        date.getFullYear() + "-" + p(date.getMonth() + 1) + "-" + p(date.getDate()) + " " +
        p(date.getHours()) + ":" + p(date.getMinutes()) + ":" + p(date.getSeconds())
    );
}

// /proc/<pid>/stat field 7 is an encoded dev_t; render it the way ps' TT column
// does ("pts/0", "tty1", "ttyS0") or as an empty string when there is no tty.
function decodeTty(nr) {
    if (!nr) return "";
    const major = (nr >> 8) & 0xfff;
    const minor = (nr & 0xff) | ((nr >> 12) & 0xfff00);
    if (major >= 136 && major <= 143) return "pts/" + minor;
    if (major === 4) return minor < 64 ? "tty" + minor : "ttyS" + (minor - 64);
    if (major === 5) return "tty";
    return "";
}

function readCpuTotal(line) {
    // "cpu  user nice system idle iowait irq softirq steal guest guest_nice"
    const parts = line.replace(/ +/g, " ").trim().split(" ");
    let total = 0;
    for (let i = 1; i < parts.length; i++) total += parseInt(parts[i], 10) || 0;
    return total;
}

function readCmdline(pid) {
    try {
        return fs.readFileSync("/proc/" + pid + "/cmdline", "utf8");
    } catch (err) {
        return "";
    }
}

const _procBaseline = { all: 0, list: Object.create(null), ms: 0 };
let _procCache = null;

// /proc reports rss in pages. Derive the page size from our own process instead
// of assuming 4 KiB, so the 16 KiB-page ARM kernels get the same mem% as ps.
let _pageSize = 0;
function pageSize() {
    if (_pageSize) return _pageSize;
    _pageSize = 4096;
    try {
        const selfStat = fs.readFileSync("/proc/self/stat", "utf8");
        const rp = selfStat.lastIndexOf(")");
        const pages = parseInt(selfStat.slice(rp + 2).split(" ")[21], 10);
        if (pages > 0) {
            const derived = process.memoryUsage().rss / pages;
            if (derived > 1024 && derived < 1048576) _pageSize = Math.pow(2, Math.round(Math.log2(derived)));
        }
    } catch (err) {
        // keep the 4 KiB default
    }
    return _pageSize;
}

// Returns the systeminformation `processes()` shape, or null to fall back.
function nativeProcesses() {
    if (_procCache && Date.now() - _procCache.ms < 500) return _procCache.result;

    let statText;
    let entries;
    try {
        statText = fs.readFileSync("/proc/stat", "utf8");
        entries = fs.readdirSync("/proc");
    } catch (err) {
        return null;
    }

    const newline = statText.indexOf("\n");
    const all = readCpuTotal(newline > 0 ? statText.slice(0, newline) : statText);
    const btimeMatch = /^btime (\d+)$/m.exec(statText);
    const bootTime = btimeMatch ? parseInt(btimeMatch[1], 10) * 1000 : Date.now() - os.uptime() * 1000;

    const totalMem = os.totalmem();
    const ps = pageSize();
    const users = uidNames();
    const baseline = _procBaseline;
    const baselineValid = baseline.all > 0 && baseline.ms > 0;
    const delta = baselineValid ? all - baseline.all : 0;

    const list = [];
    const listNew = Object.create(null);

    for (let i = 0; i < entries.length; i++) {
        const name = entries[i];
        const first = name.charCodeAt(0);
        if (first < 48 || first > 57) continue; // numeric pids only

        let stat;
        try {
            stat = fs.readFileSync("/proc/" + name + "/stat", "utf8");
        } catch (err) {
            continue; // process exited between readdir and read
        }

        const rparen = stat.lastIndexOf(")");
        if (rparen < 0) continue;
        const lparen = stat.indexOf("(");
        const pid = parseInt(stat.slice(0, lparen), 10);
        if (!pid) continue;
        const comm = stat.slice(lparen + 1, rparen);
        const fields = stat.slice(rparen + 2).split(" ");
        if (fields.length < 22) continue;

        const utime = parseInt(fields[11], 10) || 0;
        const stime = parseInt(fields[12], 10) || 0;

        let cpuu = 0;
        let cpus = 0;
        const old = baselineValid ? baseline.list[pid] : null;
        if (old && delta > 0) {
            cpuu = ((utime - old.utime) / delta) * 100;
            cpus = ((stime - old.stime) / delta) * 100;
        } else if (all > 0) {
            cpuu = (utime / all) * 100;
            cpus = (stime / all) * 100;
        }
        const clamped = clampCpuPair(cpuu, cpus);

        let user = "";
        try {
            user = users[String(fs.statSync("/proc/" + name).uid)] || "";
        } catch (err) {
            user = "";
        }

        // Chromium (and anything else that rewrites its process title) rewrites
        // the whole argv block into argv[0], so join on NUL first and treat the
        // result as one command line - that is also how ps and systeminformation
        // read it.
        const fullCommand = readCmdline(name).replace(/\u0000/g, " ").trim();
        const argv0 = fullCommand.split(" ")[0];
        let command = argv0;
        let cmdPath = "";
        if (argv0) {
            const slash = argv0.lastIndexOf("/");
            if (slash > 0) {
                cmdPath = argv0.slice(0, slash);
                command = argv0.slice(slash + 1);
            }
        }
        if (!command) command = comm;
        const params = fullCommand.slice(argv0.length).trim();

        const rssPages = parseInt(fields[21], 10) || 0;
        const vszKb = Math.round((parseInt(fields[20], 10) || 0) / 1024);

        list.push({
            pid,
            parentPid: parseInt(fields[1], 10) || 0,
            name: command,
            cpu: Math.round((clamped.cpuu + clamped.cpus) * 100) / 100,
            cpuu: clamped.cpuu,
            cpus: clamped.cpus,
            mem: totalMem > 0 ? ((rssPages * ps) / totalMem) * 100 : 0,
            priority: parseInt(fields[15], 10) || 0,
            memVsz: vszKb,
            memRss: Math.round((rssPages * ps) / 1024),
            nice: parseInt(fields[16], 10) || 0,
            started: formatDate(new Date(bootTime + Math.round((parseInt(fields[19], 10) || 0) / USER_HZ * 1000))),
            state: STATE_NAMES[fields[0]] || "unknown",
            tty: decodeTty(parseInt(fields[4], 10) || 0),
            user,
            command,
            params,
            path: cmdPath
        });

        listNew[pid] = { utime, stime };
    }

    let running = 0;
    let blocked = 0;
    let sleeping = 0;
    for (let i = 0; i < list.length; i++) {
        const s = list[i].state;
        if (s === "running") running++;
        else if (s === "blocked") blocked++;
        else if (s === "sleeping") sleeping++;
    }

    const result = { all: list.length, running, blocked, sleeping, unknown: 0, list };

    baseline.all = all;
    baseline.list = listNew;
    baseline.ms = Date.now();
    _procCache = { ms: baseline.ms, result };
    return result;
}

// ---------------------------------------------------------------------------
// networkInterfaces()
// ---------------------------------------------------------------------------

function sysfsInt(iface, field) {
    try {
        return parseInt(fs.readFileSync("/sys/class/net/" + iface + "/" + field, "utf8").trim(), 10);
    } catch (err) {
        return NaN;
    }
}

function sysfsStr(iface, field) {
    try {
        return fs.readFileSync("/sys/class/net/" + iface + "/" + field, "utf8").trim();
    } catch (err) {
        return "";
    }
}

// The default-route interface, read from /proc/net/route (destination 0.0.0.0).
function defaultIface() {
    try {
        const lines = fs.readFileSync("/proc/net/route", "utf8").split("\n");
        for (let i = 1; i < lines.length; i++) {
            const f = lines[i].trim().split(/\s+/);
            if (f.length > 2 && f[1] === "00000000") return f[0];
        }
    } catch (err) {
        // no routing table / not permitted
    }
    return "";
}

function isWireless(iface) {
    try {
        return fs.existsSync("/sys/class/net/" + iface + "/wireless");
    } catch (err) {
        return false;
    }
}

// Returns the systeminformation `networkInterfaces()` shape, or null to fall back.
function nativeNetworkInterfaces() {
    let ifaces;
    try {
        ifaces = os.networkInterfaces();
    } catch (err) {
        return null;
    }

    let names;
    try {
        names = fs.readdirSync("/sys/class/net");
    } catch (err) {
        return null;
    }

    const present = Object.create(null);
    for (let i = 0; i < names.length; i++) present[names[i]] = true;
    const def = defaultIface();
    const result = [];

    for (const dev of Object.keys(ifaces)) {
        const iface = dev.split(":")[0].trim();
        if (!present[iface]) continue;
        const addrs = ifaces[dev] || [];

        const v4 = addrs.find(a => a.family === "IPv4" || a.family === 4);
        const v6 = addrs.find(a => a.family === "IPv6" || a.family === 6);
        const macEntry = addrs.find(a => a.mac && a.mac !== "00:00:00:00:00:00");
        const internal = addrs.length ? !!addrs[0].internal : false;

        const operstate = sysfsStr(iface, "operstate") || "unknown";
        const speedRaw = sysfsInt(iface, "speed");
        const mtu = sysfsInt(iface, "mtu");

        let type = "unknown";
        if (operstate === "up") type = isWireless(iface) ? "wireless" : "wired";
        if (iface === "lo" || iface.startsWith("bond")) type = "virtual";

        result.push({
            iface,
            ifaceName: iface, // systeminformation fills this from `nmcli`, which we no longer fork for
            default: iface === def,
            ip4: v4 ? v4.address : "",
            ip4subnet: v4 && v4.netmask ? v4.netmask : "",
            ip6: v6 ? v6.address : "",
            ip6subnet: v6 && v6.netmask ? v6.netmask : "",
            mac: macEntry ? macEntry.mac : (addrs[0] ? addrs[0].mac : ""),
            internal,
            virtual: false,
            operstate,
            type,
            duplex: sysfsStr(iface, "duplex"),
            mtu: isNaN(mtu) ? null : mtu,
            speed: isNaN(speedRaw) ? null : speedRaw,
            dhcp: false,
            dnsSuffix: "",
            ieee8021xAuth: "",
            ieee8021xState: "",
            carrierChanges: sysfsInt(iface, "carrier_changes") || 0
        });
    }

    return result;
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------

const NATIVE = {
    processes: nativeProcesses,
    networkInterfaces: nativeNetworkInterfaces
};

ipcMain.on("systeminformation-call", (e, type, id, ...args) => {
    if (typeof si[type] !== "function") {
        signale.warn(`Illegal request for systeminformation: ${type}`);
        return;
    }

    Promise.resolve()
        .then(() => {
            if (IS_LINUX && NATIVE[type] && args.length === 0) {
                const native = NATIVE[type]();
                if (native) return native;
            }
            return si[type](...args);
        })
        .then(res => {
            if (e.sender && !e.sender.isDestroyed()) {
                e.sender.send("systeminformation-reply-" + id, res);
            }
        })
        .catch(err => {
            signale.debug(`systeminformation ${type} failed: ${err.message}`);
            if (e.sender && !e.sender.isDestroyed()) {
                e.sender.send("systeminformation-reply-" + id, null);
            }
        });
});
