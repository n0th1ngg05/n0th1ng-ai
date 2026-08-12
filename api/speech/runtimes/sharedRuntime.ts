import { Runtime } from "./runtime.js";
import {
    RuntimeConfig,
    RuntimeHealth,
    RuntimeStatus,
} from "../types.js";

/**
 * SharedRuntime
 *
 * The Python speech runtime (speech-runtime/main.py) is a single FastAPI
 * process that auto-discovers and serves ALL providers (kokoro, whisper,
 * piper, xtts, dia, fishspeech, chatterbox) on one port. That process is
 * already started by the outer app boot sequence (manager.ts / speech.ts)
 * before any provider ever makes a request.
 *
 * Unlike PythonRuntime, SharedRuntime does NOT spawn its own child process.
 * It simply points every provider's HTTP client at the one runtime that is
 * already running, and polls its existing /health endpoint.
 */
export class SharedRuntime extends Runtime {

    constructor(config: RuntimeConfig) {
        super(config);
    }

    /** "Starting" a shared runtime just means confirming it's reachable */
    async start(): Promise<void> {

        console.log("========== SHARED ==========");
console.log("START()");
console.log("===========================");

        if (this.status === RuntimeStatus.RUNNING) {
            return;
        }

        this.status = RuntimeStatus.STARTING;

        const start = Date.now();

        while (Date.now() - start < 30000) {

            try {

                await this.httpClient.get("/health");

                this.status = RuntimeStatus.RUNNING;

                this.healthChecker.ping();

                return;

            } catch {

                await new Promise(resolve => setTimeout(resolve, 250));

            }

        }

        this.status = RuntimeStatus.ERROR;

        throw new Error(
            `Shared speech runtime at ${this.config.host}:${this.config.port} is not reachable. ` +
            `Make sure the speech runtime process has been started (see manager.ts).`
        );

    }

    /** Shared runtimes are owned by the outer app process, not by us — never kill them here */
    async stop(): Promise<void> {

        this.status = RuntimeStatus.STOPPED;

    }

    health(): RuntimeHealth {

        return this.healthChecker.getHealth(
            this.status,
            undefined,
            this.config.port
        );

    }

}