// api/services/cluster.ts

import type { ToolCall } from "./toolSelector";
import type { ExecutionResult } from "./toolExecutor";

import { executeRemote } from "./workerClient";
import { PYTHON_TOOLS } from "./pythonTools";
import { pythonRuntimeClient } from "./python-runtime";

export interface Worker {
    id: string;
    hostname: string;
    ip: string;
    port: number;
    online: boolean;
    tools: string[];

    runtimes: {
        python: boolean;
        speech: boolean;
    };

    providers: {
        ocr: string[];
        vision: string[];
        pdf: string[];
        speech: string[];
    };

    health: {
        cpu: number;
        ram: number;
        gpu: number;
    };

    // Both optional: only present once a worker running the patched
    // capabilities.ts starts heartbeating — an older/unpatched worker
    // still registers and heartbeats fine, it just won't have these.
    temps?: {
        cpu: number | null;
        gpu: number | null;
    };

    network?: {
        iface: string;
        rxBytesPerSec: number;
        txBytesPerSec: number;
    } | null;

    versions?: {
        worker: string;
        python: string;
        speech: string;
    };

    currentJobs: number;
    lastHeartbeat: number;
}

const workers = new Map<string, Worker>();
const HEARTBEAT_TIMEOUT = 15000;

export function registerWorker(worker: Worker) {

    // The worker side now retries its /register call every ~5s
    // indefinitely (not just once at boot, and not only on failure — see
    // src-worker/src/server.ts's startRegistrationLoop), so this function
    // gets called repeatedly for a worker that's already known. Previously
    // every single call printed the full 13-line "WORKER REGISTERED"
    // banner, which meant a healthy, already-registered worker flooded the
    // master's logs with that banner every 5 seconds forever. Only a
    // genuinely new worker (or one that had been dropped by
    // removeOfflineWorkers and is now reconnecting) should get the full
    // banner; a repeat registration from an already-known, online worker
    // just refreshes its data quietly, the same way heartbeat() does.
    const existing = workers.get(worker.id);
    const isNewRegistration = !existing;

    worker.online = true;
    worker.lastHeartbeat = Date.now();

    workers.set(worker.id, worker);

    if (!isNewRegistration) {
        // Already known — quiet refresh, no banner spam.
        console.log(`[CLUSTER] Worker re-registered (already known): ${worker.hostname}`);
        return;
    }

    console.log("\n==================================================");
    console.log("              WORKER REGISTERED");
    console.log("==================================================");
    console.log(`ID          : ${worker.id}`);
    console.log(`Hostname    : ${worker.hostname}`);
    console.log(`IP          : ${worker.ip}`);
    console.log(`Port        : ${worker.port}`);
    console.log(`Online      : ${worker.online}`);
    console.log(`Jobs        : ${worker.currentJobs}`);
    console.log(`Tools       : ${worker.tools.length}`);
    console.log(`Python      : ${worker.runtimes.python}`);
    console.log(`Speech      : ${worker.runtimes.speech}`);
    console.log(`OCR         : ${worker.providers.ocr.join(", ")}`);
    console.log(`Vision      : ${worker.providers.vision.join(", ")}`);
    console.log(`PDF         : ${worker.providers.pdf.join(", ")}`);
    console.log(`Speech AI   : ${worker.providers.speech.join(", ")}`);
    console.log(`Heartbeat   : ${new Date(worker.lastHeartbeat).toLocaleTimeString()}`);
    console.log("==================================================");
    console.log(`Active Workers : ${workers.size}`);
    console.log("==================================================\n");

}

export function heartbeat(workerId: string, stats: Partial<Worker>) {

    const worker = workers.get(workerId);
    if (!worker) return;

    if (stats.health) worker.health = stats.health;
    if (stats.temps) worker.temps = stats.temps;
    if (stats.network !== undefined) worker.network = stats.network;
    if (stats.runtimes) worker.runtimes = stats.runtimes;
    if (typeof stats.currentJobs === "number") worker.currentJobs = stats.currentJobs;

    worker.online = true;
    worker.lastHeartbeat = Date.now();

}

export function removeOfflineWorkers() {

    const now = Date.now();

    for (const [id, worker] of workers) {

        if (now - worker.lastHeartbeat > HEARTBEAT_TIMEOUT) {

            console.log(`[CLUSTER] Worker Offline: ${worker.hostname}`);
            workers.delete(id);
            // Deferred require avoids a circular import at module-load
            // time (clusterMetricsHistory doesn't import from cluster.ts,
            // but keeping this decoupled is cheap insurance either way).
            import("./clusterMetricsHistory").then(({ clearMetricHistory }) => {
                clearMetricHistory(id);
            }).catch(() => { /* best-effort cleanup only */ });

        }

    }

}

export function getWorkers() {

    return [...workers.values()];

}

export function getWorker(id: string) {

    return workers.get(id);

}

export function selectWorker(tool: string): Worker | null {

    const all = [...workers.values()];

    if (all.length === 0) {
        console.log(`[CLUSTER] selectWorker('${tool}'): no workers registered at all.`);
        return null;
    }

    const available = all
        .filter(worker => {

            if (!worker.online) {
                console.log(`[CLUSTER] selectWorker('${tool}'): '${worker.hostname}' rejected — offline (lastHeartbeat=${new Date(worker.lastHeartbeat).toISOString()}).`);
                return false;
            }
            if (!worker.tools.includes(tool)) {
                console.log(`[CLUSTER] selectWorker('${tool}'): '${worker.hostname}' rejected — tool not advertised. worker.tools=[${worker.tools.join(", ")}]`);
                return false;
            }
            if (PYTHON_TOOLS.has(tool) && !worker.runtimes.python) {
                console.log(`[CLUSTER] selectWorker('${tool}'): '${worker.hostname}' rejected — python runtime not online on worker (runtimes.python=${worker.runtimes.python}).`);
                return false;
            }

            return true;

        })
        .sort((a, b) => a.currentJobs - b.currentJobs);

    if (available.length === 0) {
        console.log(`[CLUSTER] selectWorker('${tool}'): 0/${all.length} registered workers matched.`);
        return null;
    }

    console.log(`[CLUSTER] selectWorker('${tool}'): picked '${available[0].hostname}' (${available.length} candidate(s) matched).`);
    return available[0];

}

export async function executeClusterTool(
    tool: string,
    toolCall: ToolCall,
    localExecutor: () => Promise<ExecutionResult>
): Promise<ExecutionResult> {

    removeOfflineWorkers();

    const isPythonTool = PYTHON_TOOLS.has(tool);
    console.log(`[CLUSTER] Tool '${tool}' | python_tool=${isPythonTool} | workers=${[...workers.values()].filter(w => w.online).length} online`);

    const worker = selectWorker(tool);

    if (!worker) {

        console.log(`[CLUSTER] No Worker Available for '${tool}'`);

        if (isPythonTool) {

            console.log("[CLUSTER] Using Local Python Runtime");

            return await pythonRuntimeClient.execute(
                tool,
                toolCall.arguments ?? {}
            );

        }

        console.log(`[CLUSTER] Using Local JS Executor for '${tool}'`);
        return await localExecutor();

    }

    console.log(`[CLUSTER] Executing '${tool}' on ${worker.hostname}`);

    worker.currentJobs++;

    try {

        const result = await executeRemote(worker, toolCall);

        if (result.success) return result;

        console.warn("[CLUSTER] Remote execution failed. Falling back.");

    } catch (err) {

        console.error("[CLUSTER] Worker unreachable.", err);

        worker.online = false;

    } finally {

        worker.currentJobs = Math.max(0, worker.currentJobs - 1);

    }

    if (isPythonTool) {

        console.log("[CLUSTER] Using Local Python Runtime (worker fallback)");

        return await pythonRuntimeClient.execute(
            tool,
            toolCall.arguments ?? {}
        );

    }

    console.log(`[CLUSTER] Using Local JS Executor for '${tool}' (worker fallback)`);

    return await localExecutor();

}