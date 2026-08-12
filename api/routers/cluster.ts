import { z } from "zod";
import { createRouter, publicQuery } from "../middleware";
import { getWorkers, getWorker, removeOfflineWorkers } from "../services/cluster";
import { getMetricHistory } from "../services/clusterMetricsHistory";

/**
 * Exposes the real in-memory cluster worker registry (services/cluster.ts)
 * over tRPC. Workers self-register and heartbeat into that Map from the
 * distributed worker processes — this was previously only consumed
 * internally by executeClusterTool/selectWorker, never surfaced to any UI.
 */
export const clusterRouter = createRouter({
  workers: publicQuery.query(() => {
    // Prune anything that's missed its heartbeat window before reporting,
    // so the UI doesn't show a worker as online after it's actually died.
    removeOfflineWorkers();
    return getWorkers();
  }),

  worker: publicQuery
    .input(z.object({ id: z.string() }))
    .query(({ input }) => {
      removeOfflineWorkers();
      return getWorker(input.id) ?? null;
    }),

  // Recent CPU/RAM/GPU/temp/network points for one worker, for the
  // Cluster System modal's graphs. In-memory only (see
  // services/clusterMetricsHistory.ts) — resets on server restart, which
  // is fine for "live monitoring while the modal is open."
  metricHistory: publicQuery
    .input(z.object({ id: z.string() }))
    .query(({ input }) => {
      return getMetricHistory(input.id);
    }),

  // Snapshot of recently buffered log lines for one worker, proxied
  // through the master since the browser can't reach the worker's LAN
  // IP:port directly (CORS, and it may not even be on the same subnet as
  // whoever has the settings page open). Mirrors the worker's own
  // GET /logs?source=... shape.
  logs: publicQuery
    .input(
      z.object({
        id: z.string(),
        source: z.enum(["python", "speech", "kokoro"]).optional(),
      })
    )
    .query(async ({ input }) => {
      const worker = getWorker(input.id);
      if (!worker) return { lines: [] };

      try {
        const url = new URL(`http://${worker.ip}:${worker.port}/logs`);
        if (input.source) url.searchParams.set("source", input.source);

        const res = await fetch(url.toString());
        if (!res.ok) return { lines: [] };
        return await res.json();
      } catch {
        // Worker unreachable for this call specifically (distinct from
        // being marked offline via heartbeat timeout) — fail soft.
        return { lines: [] };
      }
    }),
});