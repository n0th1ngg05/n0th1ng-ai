// ─────────────────────────────────────────────────────────────────────────────
// forge/schema.ts
//
// Drizzle table definitions for The Forge's three tables.
//
// NOTE ON LOCATION: the api.zip handed to this build does not contain the
// physical file that `@db/schema` resolves to, so these definitions live here
// for now. To finish integration, APPEND these three exports to your real
// db/schema.ts (alongside `workflows`, `chatAttachments`, etc.), delete this
// file, and change the `./schema` import in forge/db.ts to `@db/schema`.
// Nothing else needs to change — forge/db.ts deliberately uses the
// db.select()/insert()/update() core API (not db.query.*) so it works whether
// or not these tables are registered in getDb()'s schema map. If your
// existing tables declare relations in @db/relations, mirror them with
// forgeSessionsRelations etc. the same way workflows declares its own.
// ─────────────────────────────────────────────────────────────────────────────

import {
    mysqlTable,
    varchar,
    text,
    mysqlEnum,
    json,
    int,
    boolean,
    timestamp,
} from "drizzle-orm/mysql-core";

export const forgeSessions = mysqlTable("forge_sessions", {
    id: varchar("id", { length: 36 }).primaryKey(),
    goal: text("goal").notNull(),
    stackProfileId: varchar("stack_profile_id", { length: 64 }).notNull(),
    // Free-text language/framework, only meaningful when stackProfileId is
    // 'general' — e.g. "Go with the standard library", "C with CMake", "Rust
    // + Actix". Null for the four dedicated profiles.
    customStack: text("custom_stack"),
    // Which Ollama model this session runs on — chosen at creation time from
    // the frontend's model dropdown, NOT a hardcoded constant. Stored per
    // session (not read fresh from a global setting) so a long-running
    // overnight session keeps using the model it started with even if the
    // user changes the default for their NEXT session while this one is
    // still going.
    modelId: varchar("model_id", { length: 128 }).notNull(),
    workspacePath: varchar("workspace_path", { length: 512 }).notNull(),
    allocatedPort: int("allocated_port").notNull(),
    status: mysqlEnum("status", [
        "planning",
        "running",
        "paused",
        "blocked",
        "done",
        "failed",
    ])
        .notNull()
        .default("planning"),
    sharedContracts: json("shared_contracts").notNull().default({}),
    iterationCount: int("iteration_count").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const forgeTaskNodes = mysqlTable("forge_task_nodes", {
    id: varchar("id", { length: 36 }).primaryKey(),
    sessionId: varchar("session_id", { length: 36 }).notNull(),
    parentId: varchar("parent_id", { length: 36 }),
    description: text("description").notNull(),
    acceptanceCriteria: text("acceptance_criteria").notNull(),
    status: mysqlEnum("status", [
        "pending",
        "in_progress",
        "done",
        "failed",
        "blocked",
    ])
        .notNull()
        .default("pending"),
    dependsOn: json("depends_on").notNull().default([]),
    attempts: int("attempts").notNull().default(0),
    lastError: text("last_error"),
    isIntegrationCheck: boolean("is_integration_check").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const forgeIterations = mysqlTable("forge_iterations", {
    id: varchar("id", { length: 36 }).primaryKey(),
    sessionId: varchar("session_id", { length: 36 }).notNull(),
    taskId: varchar("task_id", { length: 36 }).notNull(),
    phase: mysqlEnum("phase", ["think", "act", "evaluate"]).notNull(),
    input: text("input").notNull(),
    output: text("output").notNull(),
    timestamp: timestamp("timestamp").notNull().defaultNow(),
});