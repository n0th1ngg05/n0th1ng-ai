// api/services/workerPoller.ts
//
// Pull-based worker discovery for the distributed cluster.
//
// Instead of workers pushing /register and /heartbeat to the master
// (which requires the master to have a known, reachable IP — impossible
// when the master is on mobile data or a remote network), the master
// polls each configured worker's GET /capabilities endpoint every 5 s.
//
// Each worker's URL + API key is configured as a pair of env vars:
//
//   WORKER_1_URL=https://worker.nothingstudios.co.in
//   WORKER_1_KEY=<64-char api key>
//
//   WORKER_2_URL=http://192.168.0.108:3001    # local LAN worker, no key needed
//   WORKER_2_KEY=
//
// You can also use the shorthand for a single desktop worker:
//   WORKER_DESKTOP_URL / WORKER_DESKTOP_KEY
//
// The /capabilities response shape must match the Worker interface
// from services/cluster.ts — the worker's server.ts already returns
// everything needed, including internetUrl + apiKey for routing.

import { registerWorker, heartbeat, getWorker } from "./cluster";
import { recordMetricPoint } from "./clusterMetricsHistory";

const POLL_INTERVAL_MS = 5_000;

interface WorkerTarget {
    url:    string;  // base URL of the worker (no trailing slash)
    apiKey: string;  // WORKER_API_KEY for auth (empty = no auth / LAN)
}

// ── Load configured workers from env ─────────────────────────────────────

function loadTargets(): WorkerTarget[] {
    const targets: WorkerTarget[] = [];

    // Numbered workers: WORKER_1_URL / WORKER_1_KEY, WORKER_2_URL / ..., etc.
    for (let i = 1; i <= 10; i++) {
        const url = process.env[`WORKER_${i}_URL`]?.trim();
        if (!url) break;
        targets.push({ url: url.replace(/\/$/, ""), apiKey: process.env[`WORKER_${i}_KEY`]?.trim() ?? "" });
    }

    // Shorthand alias for a single desktop worker.
    const desktopUrl = process.env.WORKER_DESKTOP_URL?.trim();
    if (desktopUrl) {
        targets.push({
            url:    desktopUrl.replace(/\/$/, ""),
            apiKey: process.env.WORKER_DESKTOP_KEY?.trim() ?? "",
        });
    }

    return targets;
}

// ── Poll a single worker ──────────────────────────────────────────────────

async function pollWorker(target: WorkerTarget): Promise<void> {
    const headers: Record<string, string> = target.apiKey
        ? { Authorization: `Bearer ${target.apiKey}` }
        : {};

    let data: any;
    try {
        const res = await fetch(`${target.url}/capabilities`, {
            headers,
            signal: AbortSignal.timeout(8_000),
        });
        if (!res.ok) {
            // Worker is reachable but returned an error — log and move on.
            console.warn(`[POLLER] ${target.url} → HTTP ${res.status}`);
            return;
        }
        data = await res.json();
    } catch {
        // Network unreachable, ECONNREFUSED, timeout — normal when worker
        // is off. Don't log every tick; the worker will simply appear
        // "offline" in the cluster map (heartbeat timeout).
        return;
    }

    if (!data?.id) {
        console.warn(`[POLLER] ${target.url} returned no 'id' — ignoring`);
        return;
    }

    // Build the Worker object the cluster service expects.
    // Fields that can change between polls (health, runtimes, jobs) go into
    // the heartbeat stats object; static fields only need re-registering
    // if the worker isn't already known.
    const known = getWorker(data.id);

    const workerPayload = {
        id:          data.id,
        hostname:    data.hostname    ?? "unknown",
        ip:          data.ip          ?? "127.0.0.1",
        port:        data.port        ?? 3001,
        online:      true,
        tools:       data.tools       ?? [],
        runtimes:    data.runtimes    ?? { python: false, speech: false },
        providers:   data.providers   ?? { ocr: [], vision: [], pdf: [], speech: [] },
        health: {
            cpu: data.cpuUsage ?? 0,
            ram: data.ramUsage ?? 0,
            gpu: data.gpuUsage ?? 0,
        },
        temps:       data.temps       ?? undefined,
        network:     data.network     ?? null,
        versions:    data.versions    ?? undefined,
        currentJobs: data.currentJobs ?? 0,
        lastHeartbeat: Date.now(),
        // Internet tunnel routing — set if the worker is behind Cloudflare.
        internetUrl: data.internetUrl || undefined,
        apiKey:      data.apiKey      || undefined,
    };

    if (!known) {
        // First time we've seen this worker — full registration.
        console.log(`[POLLER] New worker discovered: ${workerPayload.hostname} (${target.url})`);
        registerWorker(workerPayload as any);
    } else {
        // Already known — lightweight heartbeat update.
        heartbeat(data.id, {
            health:      workerPayload.health,
            temps:       workerPayload.temps,
            network:     workerPayload.network,
            runtimes:    workerPayload.runtimes,
            currentJobs: workerPayload.currentJobs,
        });
    }

    // Feed the live-graphs history.
    recordMetricPoint(data.id, {
        health:      workerPayload.health,
        temps:       workerPayload.temps,
        network:     workerPayload.network,
        runtimes:    workerPayload.runtimes,
        currentJobs: workerPayload.currentJobs,
    });
}

// ── Start the poller ──────────────────────────────────────────────────────

export function startWorkerPoller(): void {
    const targets = loadTargets();

    if (targets.length === 0) {
        console.log("[POLLER] No worker URLs configured — worker poller disabled.");
        console.log("[POLLER] Set WORKER_DESKTOP_URL (and optionally WORKER_DESKTOP_KEY) in .env to enable.");
        return;
    }

    console.log(`[POLLER] Starting — polling ${targets.length} worker(s) every ${POLL_INTERVAL_MS / 1000} s`);
    targets.forEach(t => console.log(`[POLLER]   → ${t.url}`));

    const tick = () => {
        for (const target of targets) {
            // Each poll is fire-and-forget; failures are silently swallowed inside pollWorker().
            pollWorker(target).catch(() => {});
        }
    };

    // Poll immediately on start, then on interval.
    tick();
    setInterval(tick, POLL_INTERVAL_MS);
}
