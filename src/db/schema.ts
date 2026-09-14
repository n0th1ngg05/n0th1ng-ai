import {
    mysqlTable,
    mysqlEnum,
    serial,
    varchar,
    text,
    int,
    bigint,
    float,
    boolean,
    timestamp,
} from "drizzle-orm/mysql-core";

// ── Worker config ─────────────────────────────────────────────────────────────
// Persisted key/value settings: toggle mode, tunnel URL, etc.
export const workerConfig = mysqlTable("worker_config", {
    key:   varchar("key",   { length: 100 }).primaryKey(),
    value: text("value").notNull(),
});

// ── Access log ────────────────────────────────────────────────────────────────
// Every proxied request that arrives via the exposure service.
export const accessLog = mysqlTable("worker_access_log", {
    id:         serial("id").primaryKey(),
    ts:         bigint("ts", { mode: "number", unsigned: true }).notNull(),
    method:     varchar("method", { length: 10 }).notNull(),
    path:       varchar("path",   { length: 500 }).notNull(),
    status:     int("status").notNull(),
    durationMs: int("duration_ms").notNull(),
    ip:         varchar("ip", { length: 60 }),
    tool:       varchar("tool", { length: 100 }),
    source:     mysqlEnum("source", ["local", "remote"]).default("remote"),
});

// ── Tool call history ─────────────────────────────────────────────────────────
// Persistent record of every completed tool job (local + remote).
export const toolHistory = mysqlTable("worker_tool_history", {
    id:         serial("id").primaryKey(),
    jobId:      int("job_id").notNull(),
    tool:       varchar("tool", { length: 100 }).notNull(),
    startedAt:  bigint("started_at", { mode: "number", unsigned: true }).notNull(),
    durationMs: int("duration_ms").notNull(),
    success:    boolean("success").notNull(),
    source:     mysqlEnum("source", ["local", "remote"]).default("local"),
});

// ── Metrics snapshots ─────────────────────────────────────────────────────────
// Periodic system vitals captured every 60s for the HUD history graph.
export const metricsSnapshots = mysqlTable("worker_metrics_snapshots", {
    id:         serial("id").primaryKey(),
    ts:         bigint("ts", { mode: "number", unsigned: true }).notNull(),
    cpuPct:     float("cpu_pct"),
    ramGb:      float("ram_gb"),
    gpuPct:     float("gpu_pct"),
    gpuTemp:    float("gpu_temp"),
    cpuTemp:    float("cpu_temp"),
    rxBps:      bigint("rx_bps", { mode: "number", unsigned: true }),
    txBps:      bigint("tx_bps", { mode: "number", unsigned: true }),
    activeJobs: int("active_jobs"),
    isExposed:  boolean("is_exposed"),
});
