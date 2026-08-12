// ─────────────────────────────────────────────────────────────────────────────
// forge/db.ts
//
// Drizzle query helpers against the three forge tables, following the style
// of routers/workflow.ts (getDb() singleton, eq/desc from drizzle-orm).
//
// Uses the core select()/insert()/update() API rather than db.query.* on
// purpose: the forge tables live in forge/schema.ts until they're merged into
// @db/schema (see the note there), so they aren't in getDb()'s schema map yet.
// ─────────────────────────────────────────────────────────────────────────────

import { randomUUID } from "crypto";
import path from "path";
import net from "net";
import { eq, desc, asc, and, gte } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { forgeSessions, forgeTaskNodes, forgeIterations } from "@db/schema";
import { FORGE_ROOT } from "./constants";
import type {
    ForgeSession,
    ForgeSessionStatus,
    TaskNode,
    TaskNodeStatus,
    ForgeIteration,
    ForgeIterationPhase,
} from "./types";

// MySQL JSON columns come back as unknown — these narrow them to the shapes
// the rest of forge/ relies on, defaulting safely instead of crashing on a
// row written by hand or by an older build.
function toContracts(raw: unknown): Record<string, string> {
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        const out: Record<string, string> = {};
        for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
            out[k] = typeof v === "string" ? v : JSON.stringify(v);
        }
        return out;
    }
    return {};
}

function toDependsOn(raw: unknown): string[] {
    if (Array.isArray(raw)) return raw.map((v) => String(v));
    return [];
}

function rowToSession(row: typeof forgeSessions.$inferSelect): ForgeSession {
    return {
        id: row.id,
        goal: row.goal,
        stackProfileId: row.stackProfileId,
        customStack: row.customStack,
        modelId: row.modelId,
        workspacePath: row.workspacePath,
        allocatedPort: row.allocatedPort,
        status: row.status,
        sharedContracts: toContracts(row.sharedContracts),
        iterationCount: row.iterationCount,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    };
}

function rowToTask(row: typeof forgeTaskNodes.$inferSelect): TaskNode {
    return {
        id: row.id,
        sessionId: row.sessionId,
        parentId: row.parentId,
        description: row.description,
        acceptanceCriteria: row.acceptanceCriteria,
        status: row.status,
        dependsOn: toDependsOn(row.dependsOn),
        attempts: row.attempts,
        lastError: row.lastError,
        isIntegrationCheck: row.isIntegrationCheck,
        createdAt: row.createdAt,
    };
}

function rowToIteration(
    row: typeof forgeIterations.$inferSelect
): ForgeIteration {
    return {
        id: row.id,
        sessionId: row.sessionId,
        taskId: row.taskId,
        phase: row.phase,
        input: row.input,
        output: row.output,
        timestamp: row.timestamp,
    };
}

// ── Sessions ──────────────────────────────────────────────────────────────────

// Binds a temporary server to port 0, letting the OS assign any genuinely
// free port, then immediately closes it and returns the number. Standard
// reliable technique — probing "is port N free" by connecting to it is
// race-prone; asking the OS for a free one avoids that. This is what stops a
// session's uvicorn/node/spring-boot dev server from colliding with anything
// else already running on the host (a permanent background service, another
// Forge session, etc.) instead of every session defaulting to the same
// hardcoded 8000/3000/8080.
export function findFreePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.unref();
        server.on("error", reject);
        server.listen(0, () => {
            const address = server.address();
            if (address && typeof address === "object") {
                const port = address.port;
                server.close(() => resolve(port));
            } else {
                server.close();
                reject(new Error("[FORGE][DB] Could not determine allocated port"));
            }
        });
    });
}

export async function createSession(
    goal: string,
    stackProfileId: string,
    modelId: string,
    customStack?: string | null
): Promise<ForgeSession> {
    const db = getDb();
    // randomUUID(), same as boot.ts does for voice conversations.
    const id = randomUUID();
    const workspacePath = path.join(FORGE_ROOT, id);
    const allocatedPort = await findFreePort();

    await db.insert(forgeSessions).values({
        id,
        goal,
        stackProfileId,
        customStack: customStack ?? null,
        modelId,
        workspacePath,
        allocatedPort,
        status: "planning",
        sharedContracts: {},
        iterationCount: 0,
    });

    const session = await getSession(id);
    if (!session) {
        throw new Error(`[FORGE][DB] Session ${id} vanished right after insert`);
    }
    return session;
}

export async function getSession(id: string): Promise<ForgeSession | null> {
    const db = getDb();
    const rows = await db
        .select()
        .from(forgeSessions)
        .where(eq(forgeSessions.id, id))
        .limit(1);
    return rows.length > 0 ? rowToSession(rows[0]) : null;
}

// Backs forge.list — the session rail on the left of the Forge page. Most
// recently updated first, since a session actively running/erroring is more
// relevant to surface than one that finished days ago.
export async function listSessions(): Promise<ForgeSession[]> {
    const db = getDb();
    const rows = await db
        .select()
        .from(forgeSessions)
        .orderBy(desc(forgeSessions.updatedAt));
    return rows.map(rowToSession);
}

// Backs forgeRouter.list — the session rail on the frontend polls this on
// an interval, same pattern as workflow.ts's list procedure.
export async function getAllSessions(): Promise<ForgeSession[]> {
    const db = getDb();
    const rows = await db
        .select()
        .from(forgeSessions)
        .orderBy(desc(forgeSessions.createdAt));
    return rows.map(rowToSession);
}

export async function updateSessionStatus(
    id: string,
    status: ForgeSessionStatus
): Promise<void> {
    const db = getDb();
    await db
        .update(forgeSessions)
        .set({ status, updatedAt: new Date() })
        .where(eq(forgeSessions.id, id));
}

// Merges into the existing JSON — never overwrites contracts registered by
// earlier tasks, since dependents rely on them staying visible forever.
export async function updateSharedContracts(
    id: string,
    contracts: Record<string, string>
): Promise<void> {
    const db = getDb();
    const session = await getSession(id);
    if (!session) {
        throw new Error(`[FORGE][DB] updateSharedContracts: no session ${id}`);
    }
    const merged = { ...session.sharedContracts, ...contracts };
    await db
        .update(forgeSessions)
        .set({ sharedContracts: merged, updatedAt: new Date() })
        .where(eq(forgeSessions.id, id));
}

export async function incrementSessionIterationCount(
    id: string
): Promise<void> {
    const db = getDb();
    const session = await getSession(id);
    if (!session) return;
    await db
        .update(forgeSessions)
        .set({ iterationCount: session.iterationCount + 1, updatedAt: new Date() })
        .where(eq(forgeSessions.id, id));
}

// ── Task nodes ────────────────────────────────────────────────────────────────

export async function createTaskNode(
    sessionId: string,
    node: {
        description: string;
        acceptanceCriteria: string;
        dependsOn?: string[];
        parentId?: string | null;
        isIntegrationCheck?: boolean;
    }
): Promise<TaskNode> {
    const db = getDb();
    const id = randomUUID();

    await db.insert(forgeTaskNodes).values({
        id,
        sessionId,
        parentId: node.parentId ?? null,
        description: node.description,
        acceptanceCriteria: node.acceptanceCriteria,
        status: "pending",
        dependsOn: node.dependsOn ?? [],
        attempts: 0,
        isIntegrationCheck: node.isIntegrationCheck ?? false,
    });

    const rows = await db
        .select()
        .from(forgeTaskNodes)
        .where(eq(forgeTaskNodes.id, id))
        .limit(1);
    return rowToTask(rows[0]);
}

export async function getTask(taskId: string): Promise<TaskNode | null> {
    const db = getDb();
    const rows = await db
        .select()
        .from(forgeTaskNodes)
        .where(eq(forgeTaskNodes.id, taskId))
        .limit(1);
    return rows.length > 0 ? rowToTask(rows[0]) : null;
}

export async function getTaskTree(sessionId: string): Promise<TaskNode[]> {
    const db = getDb();
    const rows = await db
        .select()
        .from(forgeTaskNodes)
        .where(eq(forgeTaskNodes.sessionId, sessionId))
        .orderBy(asc(forgeTaskNodes.createdAt));
    return rows.map(rowToTask);
}

export async function updateTaskStatus(
    taskId: string,
    status: TaskNodeStatus,
    lastError?: string
): Promise<void> {
    const db = getDb();
    await db
        .update(forgeTaskNodes)
        .set(
            lastError === undefined
                ? { status }
                : { status, lastError }
        )
        .where(eq(forgeTaskNodes.id, taskId));
}

export async function incrementTaskAttempts(taskId: string): Promise<void> {
    const db = getDb();
    const task = await getTask(taskId);
    if (!task) return;
    await db
        .update(forgeTaskNodes)
        .set({ attempts: task.attempts + 1 })
        .where(eq(forgeTaskNodes.id, taskId));
}

// First pending task whose every dependsOn id resolves to a task with
// status 'done'. Returns null if none is actionable — the CALLER decides
// whether that means "queue the integration check" or "session done"
// (that policy lives in taskTree.ts, not here).
export async function getNextActionableTask(
    sessionId: string
): Promise<TaskNode | null> {
    const tree = await getTaskTree(sessionId);
    const doneIds = new Set(
        tree.filter((t) => t.status === "done").map((t) => t.id)
    );

    for (const task of tree) {
        // in_progress counts too — a task left mid-flight by a crash or a
        // retry verdict must be resumed, not skipped.
        if (task.status !== "pending" && task.status !== "in_progress") continue;
        if (task.dependsOn.every((dep) => doneIds.has(dep))) {
            return task;
        }
    }
    return null;
}

// ── Iterations ────────────────────────────────────────────────────────────────

// Called unconditionally on every THINK / ACT / EVALUATE, no exceptions —
// this is the "checkpoint every iteration" non-negotiable. If the process
// dies overnight, this table is the resume point AND the live-tail source.
export async function logIteration(
    sessionId: string,
    taskId: string,
    phase: ForgeIterationPhase,
    input: string,
    output: string
): Promise<ForgeIteration> {
    const db = getDb();
    const id = randomUUID();
    await db.insert(forgeIterations).values({
        id,
        sessionId,
        taskId,
        phase,
        input,
        output,
    });
    const rows = await db
        .select()
        .from(forgeIterations)
        .where(eq(forgeIterations.id, id))
        .limit(1);
    return rowToIteration(rows[0]);
}

export async function getIterationsForTask(
    taskId: string,
    phase?: ForgeIterationPhase,
    limit = 50
): Promise<ForgeIteration[]> {
    const db = getDb();
    const rows = await db
        .select()
        .from(forgeIterations)
        .where(
            phase
                ? and(
                      eq(forgeIterations.taskId, taskId),
                      eq(forgeIterations.phase, phase)
                  )
                : eq(forgeIterations.taskId, taskId)
        )
        .orderBy(desc(forgeIterations.timestamp))
        .limit(limit);
    return rows.map(rowToIteration);
}

// Rows at-or-after `afterTimestamp`, oldest first — the SSE live tail polls
// this with its last-seen timestamp and dedupes by id on its side (>= not >,
// because MySQL timestamps have 1s resolution and several iterations can
// share one second; strictly-greater would silently drop siblings).
export async function getIterationsSince(
    sessionId: string,
    afterTimestamp: Date | null,
    limit = 500
): Promise<ForgeIteration[]> {
    const db = getDb();
    const rows = await db
        .select()
        .from(forgeIterations)
        .where(
            afterTimestamp
                ? and(
                      eq(forgeIterations.sessionId, sessionId),
                      gte(forgeIterations.timestamp, afterTimestamp)
                  )
                : eq(forgeIterations.sessionId, sessionId)
        )
        .orderBy(asc(forgeIterations.timestamp))
        .limit(limit);
    return rows.map(rowToIteration);
}