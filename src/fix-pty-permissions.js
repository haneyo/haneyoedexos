// Ensure node-pty's native spawn-helper binaries keep their execute bit.
//
// Some npm versions (notably npm 12) strip the +x bit from files inside
// dependency tarballs during extraction. node-pty ships its `spawn-helper`
// helper as a plain Mach-O executable in `prebuilds/`, and when the execute
// bit is missing `posix_spawn(2)` refuses to run it with EACCES, which makes
// every PTY spawn fail with "posix_spawnp failed.".
//
// This script is wired as a `postinstall` hook and is a safe no-op on every
// platform / setup where the bit is already set.

const fs = require("fs");
const path = require("path");

const prebuildsDir = path.join(__dirname, "node_modules", "node-pty", "prebuilds");

try {
    const platforms = fs.readdirSync(prebuildsDir);
    platforms.forEach(platform => {
        const helper = path.join(prebuildsDir, platform, "spawn-helper");
        try {
            fs.chmodSync(helper, 0o755);
        } catch (e) {
            // No spawn-helper for this platform (e.g. win32) - ignore
        }
    });
} catch (e) {
    // node-pty not installed yet - ignore
}
