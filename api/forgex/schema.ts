// ─────────────────────────────────────────────────────────────────────────────
// forgex/schema.ts
//
// Same staging-file situation as forge/schema.ts — merge these two exports
// into your real db/schema.ts, delete this file, and repoint forgex/db.ts's
// import to @db/schema. See forge/schema.ts's header comment for the exact
// steps; identical here.
// ─────────────────────────────────────────────────────────────────────────────

import {
    mysqlTable,
    varchar,
    text,
    mysqlEnum,
    int,
    timestamp,
} from "drizzle-orm/mysql-core";

export const forgexSessions = mysqlTable("forgex_sessions", {
    id: varchar("id", { length: 36 }).primaryKey(),
    goal: text("goal").notNull(),
    modelId: varchar("model_id", { length: 128 }).notNull(),
    workspacePath: varchar("workspace_path", { length: 512 }).notNull(),
    status: mysqlEnum("status", ["starting", "running", "idle", "exited", "failed"])
        .notNull()
        .default("starting"),
    pid: int("pid"),
    exitCode: int("exit_code"),
    // Claude Code's own session UUID (from stream-json's init event), needed
    // to pass --resume <id> on every turn after the first so context carries
    // across turns despite each turn being its own process (headless mode).
    claudeSessionId: varchar("claude_session_id", { length: 128 }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const forgexOutput = mysqlTable("forgex_output", {
    id: varchar("id", { length: 36 }).primaryKey(),
    sessionId: varchar("session_id", { length: 36 }).notNull(),
    stream: mysqlEnum("stream", ["stdout", "stderr", "system"]).notNull(),
    text: text("text").notNull(),
    timestamp: timestamp("timestamp").notNull().defaultNow(),
});