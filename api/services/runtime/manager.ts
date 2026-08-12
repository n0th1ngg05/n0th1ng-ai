import { RuntimeProcess } from "./process";

import { startPythonRuntime, PYTHON_PORT } from "./python";
import { waitForHealth } from "./health";
import { freePort } from "./freePort";

// NOTE: this manager used to also own the Speech runtime process, spawning
// it unconditionally at boot alongside Python. That's been removed.
//
// The Speech runtime's lifecycle is now owned entirely by
// speech/runtimes/pythonRuntime.ts (PythonRuntime.start() /
// startLocalProcess()), which already does exactly what's needed: it only
// spawns speech-runtime/main.py the first time an actual speech request
// comes in (via speechManager.synthesize()/transcribe() ->
// RuntimeManager.startRuntime() in speech/manager/runtimeManager.ts), and
// only if no distributed worker currently advertises the "speech" tool.
// Keeping a second spawn path here would race with that one for the same
// port (9000) and process.
class RuntimeManager {

    private started = false;

    private python?: RuntimeProcess;

    /**
     * Attaches the exit handler to `proc` and waits for it to become healthy.
     * On unexpected exit the process is restarted and this method is called again
     * on the new process, so the abort-and-restart logic is always live.
     */
    private async attachHandlers(
        proc: RuntimeProcess,
        abort: AbortController,
        isRestart = false
    ) {

        proc.onExit = async (code) => {

            // Abort the in-progress health poll for this process immediately.
            abort.abort(`Python Runtime exited with code ${code}`);

            // Exit code 1 = deliberate refusal (port conflict, fatal error).
            // Restarting would just loop forever printing the same message.
            if (code === 1) {
                console.error(
                    "[Runtime] Python Runtime exited with code 1 — " +
                    "likely a port conflict or fatal startup error. " +
                    "Not restarting automatically. Free port 8002 and restart the server."
                );
                return;
            }

            console.log("[Runtime] Restarting Python Runtime...");

            // Same defensive sweep as the initial start — the just-exited
            // process should have released the port on its own, but this
            // guards against a lingering child (e.g. a grandchild process
            // uvicorn spawned) that didn't die with it.
            freePort(PYTHON_PORT);

            const newProc = startPythonRuntime();
            this.python = newProc;
            const newAbort = new AbortController();

            await this.attachHandlers(newProc, newAbort, true);

        };

        try {
            // Was 300000 (5 min). That long a timeout only ever mattered for
            // a genuinely slow model load; when the process exits outright
            // (e.g. the port-conflict refusal in main.py), onExit() above
            // aborts this poll immediately anyway. Left long, this timeout
            // was mostly just masking Bug 1 (orphaned child process holding
            // the port) as what looked like a slow boot.
            await waitForHealth(
                "http://127.0.0.1:8002/health",
                90000,
                abort.signal
            );
            console.log(isRestart
                ? "[Runtime] Python Runtime Restarted"
                : "[Runtime] Python Runtime Ready"
            );
        } catch (err) {
            // Log clearly but do NOT rethrow. A failed Python runtime must
            // not prevent the rest of the server from starting.
            console.error(
                isRestart
                    ? "[Runtime] Python Runtime failed to become healthy after restart:"
                    : "[Runtime] Python Runtime did not become healthy:",
                err
            );
        }

    }

    async start() {

        if (this.started) {
            return;
        }

        this.started = true;

        console.log("[Runtime] Starting Python Runtime...");

        // Kill anything already squatting on the port from a previous
        // crashed/force-quit session before we even try to spawn — don't
        // rely solely on graceful shutdown having run last time.
        freePort(PYTHON_PORT);

        this.python = startPythonRuntime();
        await this.attachHandlers(this.python, new AbortController());

    }

    status() {

        return {

            python: !!this.python,

        };

    }

    async stop() {

        if (this.python) {

            // Plain kill() (SIGTERM) is normally enough, but this method is
            // now load-bearing for freeing port 8002 on every exit path
            // (see the process-exit hooks below), so force-kill as a
            // backstop in case the child ignores the first signal.
            const proc = this.python.process;
            proc.kill();

            if (proc.pid) {
                setTimeout(() => {
                    if (proc.exitCode === null && proc.signalCode === null) {
                        proc.kill("SIGKILL");
                    }
                }, 2000);
            }

            this.python = undefined;

        }

        this.started = false;

    }
}

export const runtimeManager = new RuntimeManager();

// Without this, closing the dev server terminal, Ctrl+C, or a Vite restart
// leaves the spawned python.exe (a full uvicorn process) running in the
// background with port 8002 still bound. The next `npm run dev` then hits
// main.py's _ensure_port_free() guard, which correctly refuses to start
// next to it — that refusal was never the bug; nothing was ever killing
// the previous instance in the first place. Hooking all three exit paths
// (SIGINT, SIGTERM, and a final synchronous "exit" as a backstop) ensures
// the child is reaped every time, however the process ends.
let shuttingDown = false;

const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;

    console.log(`[Runtime] Received ${signal}, stopping Python Runtime...`);
    runtimeManager.stop();

    process.exit(0);
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// Backstop: covers process.exit() calls elsewhere, or a normal exit that
// skips the signal handlers above. runtimeManager.stop() just calls
// child.kill(), which is synchronous-safe to call here.
process.on("exit", () => {
    if (!shuttingDown) {
        runtimeManager.stop();
    }
});