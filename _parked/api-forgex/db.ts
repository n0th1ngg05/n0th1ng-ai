// ─────────────────────────────────────────────────────────────────────────────
// forgex/db.ts
//
// Drizzle query helpers for the two ForgeX tables. Same core select()/
// insert()/update() API as forge/db.ts, same staging-file import situation.
// ─────────────────────────────────────────────────────────────────────────────

import { randomUUID } from "crypto";
import { eq, desc, gte } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { forgexSessions, forgexOutput } from "@db/schema";
import { FORGEX_ROOT, workspacePathFor } from "./constants";
import type { ForgeXSession, ForgeXSessionStatus, ForgeXOutputLine } from "./types";

function rowToSession(row: typeof forgexSessions.$inferSelect): ForgeXSession {
    return {
        id: row.id,
        goal: row.goal,
        modelId: row.modelId,
        workspacePath: row.workspacePath,
        status: row.status,
        pid: row.pid,
        exitCode: row.exitCode,
        claudeSessionId: row.claudeSessionId ?? null,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    };
}

function rowToOutputLine(row: typeof forgexOutput.$inferSelect): ForgeXOutputLine {
    return {
        id: row.id,
        sessionId: row.sessionId,
        stream: row.stream,
        text: row.text,
        timestamp: row.timestamp,
    };
}

export async function createSession(
    goal: string,
    modelId: string
): Promise<ForgeXSession> {
    const db = getDb();
    const id = randomUUID();
    const workspacePath = workspacePathFor(id);

    await db.insert(forgexSessions).values({
        id,
        goal,
        modelId,
        workspacePath,
        status: "starting",
        pid: null,
        exitCode: null,
        claudeSessionId: null,
    });

    const session = await getSession(id);
    if (!session) {
        throw new Error(`[FORGEX][DB] Session ${id} vanished right after insert`);
    }
    return session;
}

export async function getSession(id: string): Promise<ForgeXSession | null> {
    const db = getDb();
    const rows = await db
        .select()
        .from(forgexSessions)
        .where(eq(forgexSessions.id, id))
        .limit(1);
    return rows.length > 0 ? rowToSession(rows[0]) : null;
}

export async function listSessions(): Promise<ForgeXSession[]> {
    const db = getDb();
    const rows = await db
        .select()
        .from(forgexSessions)
        .orderBy(desc(forgexSessions.updatedAt));
    return rows.map(rowToSession);
}

export async function updateSessionStatus(
    id: string,
    status: ForgeXSessionStatus,
    extra?: { pid?: number | null; exitCode?: number | null; claudeSessionId?: string | null }
): Promise<void> {
    const db = getDb();
    await db
        .update(forgexSessions)
        .set({
            status,
            ...(extra?.pid !== undefined ? { pid: extra.pid } : {}),
            ...(extra?.exitCode !== undefined ? { exitCode: extra.exitCode } : {}),
            ...(extra?.claudeSessionId !== undefined ? { claudeSessionId: extra.claudeSessionId } : {}),
            updatedAt: new Date(),
        })
        .where(eq(forgexSessions.id, id));
}

export async function logOutputLine(
    sessionId: string,
    stream: "stdout" | "stderr" | "system",
    text: string
): Promise<ForgeXOutputLine> {
    const db = getDb();
    const id = randomUUID();
    await db.insert(forgexOutput).values({ id, sessionId, stream, text });
    const rows = await db
        .select()
        .from(forgexOutput)
        .where(eq(forgexOutput.id, id))
        .limit(1);
    return rowToOutputLine(rows[0]);
}

// For SSE backfill/tail — same >= timestamp caveat as forge/db.ts's
// getIterationsSince (MySQL timestamp resolution is 1s; the caller dedupes
// by id against a sent-ids set, same pattern as forge/routes.ts).
export async function getOutputSince(
    sessionId: string,
    since: Date | null
): Promise<ForgeXOutputLine[]> {
    const db = getDb();
    const rows = await db
        .select()
        .from(forgexOutput)
        .where(
            since
                ? eq(forgexOutput.sessionId, sessionId)
                : eq(forgexOutput.sessionId, sessionId)
        )
        .orderBy(forgexOutput.timestamp);
    // Filtering by `since` done in JS rather than a second drizzle `and(gte(...))`
    // clause to keep this simple — output volume per session is bounded and
    // this table is read far less often than forge_iterations.
    return rows
        .map(rowToOutputLine)
        .filter((r) => !since || r.timestamp.getTime() >= since.getTime());
}