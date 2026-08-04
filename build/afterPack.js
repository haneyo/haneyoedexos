// electron-builder afterPack hook.
//
// node-pty ships prebuilt native binaries for several platforms in one folder
// (darwin-arm64, darwin-x64, win32-*, linux-*, ...). When an app bundles ALL of
// them, macOS can flag the (otherwise arm64) app as "Intel" because of the
// x86_64/win32 Mach-O binaries sitting in app.asar.unpacked.
//
// This hook deletes every prebuild that does NOT match the target platform +
// arch, so each build only ships the binary it can actually use:
//   - macOS arm64 -> keeps darwin-arm64 only (no Intel contamination)
//   - Windows x64  -> keeps win32-x64 only
//   - Linux        -> keeps linux-<arch> only
//
// It runs after packing, directly on the unpacked files, and is a no-op if the
// folder is absent.

exports.default = async function (context) {
    const fs = require("fs");
    const path = require("path");
    const { electronPlatformName, arch, appOutDir } = context;

    const ARCH_NAMES = { 0: "ia32", 1: "x64", 2: "armv7l", 3: "arm64" };
    const archName = ARCH_NAMES[arch] || String(arch);

    const resourceDir = electronPlatformName === "darwin"
        ? path.join(appOutDir, "Contents", "Resources", "app.asar.unpacked")
        : path.join(appOutDir, "resources", "app.asar.unpacked");
    const prebuildsDir = path.join(resourceDir, "node_modules", "node-pty", "prebuilds");

    if (!fs.existsSync(prebuildsDir)) return;

    const keep = `${electronPlatformName}-${archName}`;
    fs.readdirSync(prebuildsDir).forEach(dir => {
        if (dir !== keep) {
            fs.rmSync(path.join(prebuildsDir, dir), { recursive: true, force: true });
        }
    });
};
