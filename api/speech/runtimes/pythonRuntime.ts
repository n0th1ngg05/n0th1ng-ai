import { Runtime } from "./runtime.js";
import {
    RuntimeConfig,
    RuntimeHealth,
    RuntimeStatus,
} from "../types.js";

import {
    emitRuntimeStarted,
    emitRuntimeStopped,
} from "../events/runtimeEvents.js";

import { ClusterHttpClient } from "./clusterHttpClient";

// NOTE: selectWorker is imported LAZILY (dynamic import) inside the methods
// that use it, not at module top level.
//
// cluster.ts pulls in python-runtime/client.ts → runtime/manager.ts, creating
// a load-time dependency chain that caused Vite's SSR module runner to time
// out ("transport invoke timed out after 60000ms") when walking router.ts.
// A dynamic import() defers resolution until the first actual speech request,
// after the initial module graph has already settled. Behavior is identical.
async function getSelectWorker() {
    const { selectWorker } = await import("../../services/cluster.js");
    return selectWorker;
}

/**
 * PythonRuntime — external speech runtime adapter.
 *
 * The speech runtime (speech-runtime/main.py) is started MANUALLY by the
 * user in a separate terminal. This class does NOT spawn or manage any child
 * process. It simply routes HTTP requests to whichever endpoint is available:
 *
 *   1. A registered cluster worker that advertises the "speech" tool.
 *   2. The locally-running speech runtime on http://127.0.0.1:{port}
 *      (started by the user before making any voice requests).
 *
 * If neither is reachable, the HTTP request will fail naturally and the
 * caller (synthesize / transcribe) will surface a readable error.
 */
export class PythonRuntime extends Runtime {

    private clusterHttpClient: ClusterHttpClient;

    constructor(config: RuntimeConfig) {
        super(config);
        this.clusterHttpClient = new ClusterHttpClient(
            `http://${config.host}:${config.port}`
        );
    }

    /**
     * Marks the runtime as RUNNING immediately.
     * No process is spawned — the speech runtime is expected to already be
     * running (started manually by the user in a separate terminal).
     */
    async start(): Promise<void> {

        if (
            this.status === RuntimeStatus.RUNNING ||
            this.status === RuntimeStatus.STARTING
        ) {
            return;
        }

        const selectWorker = await getSelectWorker();
        // Cache for use in the synchronous getHttpClient() below.
        this._selectWorker = selectWorker;
        const worker = selectWorker("speech");

        if (worker) {
            console.log(`[SPEECH] Cluster worker available (${worker.hostname}) — routing requests there.`);
        } else {
            console.log(`[SPEECH] No cluster worker registered. Requests will route to local runtime on port ${this.config.port}.`);
            console.log(`[SPEECH] Start the speech runtime manually: cd speech-runtime && .venv/Scripts/python.exe main.py`);
        }

        this.status = RuntimeStatus.RUNNING;
        emitRuntimeStarted(this.config.id, this.config.providerId);
    }

    /** The speech runtime is externally managed — nothing to stop here. */
    async stop(): Promise<void> {
        if (this.status === RuntimeStatus.STOPPED) return;
        this.status = RuntimeStatus.STOPPED;
        emitRuntimeStopped(this.config.id, this.config.providerId);
    }

    /** Returns runtime health based on status only (no process PID). */
    health(): RuntimeHealth {
        return this.healthChecker.getHealth(
            this.status,
            undefined,   // no child process PID — externally managed
            this.config.port
        );
    }

    /**
     * Returns the appropriate HTTP client for the current request:
     *   - ClusterHttpClient if a speech worker is registered and online.
     *   - The local HTTP client (pointing at the user's manually-started
     *     runtime on 127.0.0.1:{port}) otherwise.
     *
     * No process spawning ever happens here.
     */
    // NOTE: getHttpClient() is synchronous (required by the Runtime interface),
    // so we cannot await here. selectWorker is synchronous once cluster.ts is
    // loaded, but we need to ensure it has been loaded first. Since start()
    // is always called before any request (and start() awaits getSelectWorker()),
    // cluster.ts is guaranteed to be loaded by the time getHttpClient() runs.
    // We cache it on first use to avoid repeated dynamic imports.
    private _selectWorker?: typeof import("../../services/cluster.js")["selectWorker"];

    override getHttpClient() {
        const selectWorker = this._selectWorker;
        const worker = selectWorker?.("speech");
        if (worker) {
            console.log(`[SPEECH] → Routing request to cluster worker: ${worker.hostname}`);
            return this.clusterHttpClient;
        }
        console.log(`[SPEECH] → Routing request to local runtime (127.0.0.1:${this.config.port})`);
        return super.getHttpClient();
    }

}