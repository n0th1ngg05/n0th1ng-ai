// api/services/clusterMetricsHistory.ts
//
// Keeps a short in-memory time-series per worker (CPU/RAM/GPU%, temps,
// network rate) so the Cluster System modal can render live graphs instead
// of a single point-in-time number. Intentionally not DB-backed like
// telemetry.ts's systemSnapshots — this is "live monitoring while the
// modal is open" data, not a historical record that needs to survive a
// server restart, so an in-memory ring buffer is the right weight.

export interface MetricPoint {
    timestamp: number;
    cpu: number;
    ram: number;
    gpu: number;
    cpuTemp: number | null;
    gpuTemp: number | null;
    rxBytesPerSec: number;
    txBytesPerSec: number;
}

const MAX_POINTS_PER_WORKER = 180; // 15 min of history at a 5s heartbeat interval

const history = new Map<string, MetricPoint[]>();

/** Call this from the heartbeat handler, after cluster.heartbeat() has
 * already updated the worker's live health/temps/network fields. */
export function recordMetricPoint(
    workerId: string,
    stats: {
        health?: { cpu: number; ram: number; gpu: number };
        temps?: { cpu: number | null; gpu: number | null };
        network?: { rxBytesPerSec: number; txBytesPerSec: number } | null;
    }
) {
    if (!stats.health) return; // no health data on this tick — nothing to plot

    const points = history.get(workerId) ?? [];

    points.push({
        timestamp: Date.now(),
        cpu: stats.health.cpu,
        ram: stats.health.ram,
        gpu: stats.health.gpu,
        cpuTemp: stats.temps?.cpu ?? null,
        gpuTemp: stats.temps?.gpu ?? null,
        rxBytesPerSec: stats.network?.rxBytesPerSec ?? 0,
        txBytesPerSec: stats.network?.txBytesPerSec ?? 0,
    });

    if (points.length > MAX_POINTS_PER_WORKER) {
        points.splice(0, points.length - MAX_POINTS_PER_WORKER);
    }

    history.set(workerId, points);
}

export function getMetricHistory(workerId: string): MetricPoint[] {
    return [...(history.get(workerId) ?? [])];
}

/** Called alongside removeOfflineWorkers() so a dropped worker's history
 * doesn't accumulate forever in memory. */
export function clearMetricHistory(workerId: string) {
    history.delete(workerId);
}