import { pythonRuntimeClient } from "./client";

const CHECK_INTERVAL_MS = 10000;

export class PythonRuntimeManager {

    private online = false;
    private started = false;

    // Previously `online` only ever got set by initialize(), and nothing
    // in the codebase called initialize() anywhere — so `online` stayed
    // false for a worker's entire lifetime regardless of whether the
    // Python runtime was actually up, which is why the master always saw
    // runtimes.python=false and refused to route document_analysis (or
    // any other Python tool) to this worker even when it was healthy.
    //
    // Fixed two ways: (1) startPolling() now runs from the constructor,
    // so this class is self-initializing and needs no external wiring;
    // (2) it re-checks on an interval instead of once, so a runtime that
    // finishes starting a few seconds after the worker process (the
    // common case — Python takes longer to boot than Node) gets picked
    // up automatically instead of being permanently marked offline from
    // one early check.
    constructor() {
        this.startPolling();
    }

    private startPolling() {
        if (this.started) return;
        this.started = true;

        const check = async () => {
            try {
                await pythonRuntimeClient.health();
                if (!this.online) {
                    console.log("[Python Runtime] Connected");
                }
                this.online = true;
            } catch {
                if (this.online) {
                    console.log("[Python Runtime] Offline");
                }
                this.online = false;
            }
        };

        check(); // immediate first check, don't wait for the first interval tick
        setInterval(check, CHECK_INTERVAL_MS);
    }

    // Kept for backward compatibility with any call site expecting an
    // explicit initialize() — now just forces an immediate re-check
    // instead of being the only way `online` ever gets set.
    async initialize() {
        try {
            await pythonRuntimeClient.health();
            this.online = true;
            console.log("[Python Runtime] Connected");
        } catch {
            this.online = false;
            console.log("[Python Runtime] Offline");
        }
    }

    isOnline() {
        return this.online;
    }

}

export const pythonRuntimeManager =
    new PythonRuntimeManager();