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

const { ipcMain } = require("electron");
const signale = require("signale");
const si = require("systeminformation");

signale.success("Systeminformation controller ready");

ipcMain.on("systeminformation-call", (e, type, id, ...args) => {
    if (typeof si[type] !== "function") {
        signale.warn(`Illegal request for systeminformation: ${type}`);
        return;
    }

    Promise.resolve()
        .then(() => si[type](...args))
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
