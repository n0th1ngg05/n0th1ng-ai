// ─────────────────────────────────────────────────────────────────────────────
// forge/orchestrator.ts
//
// Session lifecycle: create (plan + workspace), pause/resume (status flips
// the drive loop checks), and driveSessionToCompletion — the actual overnight
// runner, called fire-and-forget from the tRPC create procedure (never
// awaited in a request handler, same pattern as runGeneration / createJob in
// boot.ts).
// ─────────────────────────────────────────────────────────────────────────────

import fs from "fs/promises";
import * as db from "./db";
import * as agentLoop from "./agentLoop";
import { callForgeModel, extractJson } from "./modelClient";
import { buildPlanningPrompt, type PlannedTask } from "./prompts/planning";
import { getStackProfile } from "./stacks/registry";
import type { ForgeSession } from "./types";

export async function createSession(
    goal: string,
    stackProfileId: string,
    modelId: string,
    customStack?: string | null
): Promise<ForgeSession> {
    // Fail loud on an unknown stack BEFORE touching the DB or disk.
    const stackProfile = getStackProfile(stackProfileId);

    const session = await db.createSession(goal, stackProfileId, modelId, customStack);
    console.log(
        `[FORGE][ORCH] created session ${session.id} (${stackProfileId}` +
            `${customStack ? `: ${customStack}` : ""}, model=${modelId})`
    );

    await fs.mkdir(session.workspacePath, { recursive: true });

    // Planning phase: one model call fills in the stack skeleton, output is
    // inserted as TaskNode rows in a single pass before the first iteration.
    //
    // Everything from here on is wrapped — a bad model name, Ollama not
    // running, a timeout, or a weak model returning unparseable JSON would
    // otherwise throw straight out of this function with NOTHING logged
    // server-side (the tRPC layer just turns it into a bare 500). That's
    // exactly the "create failed: 500, no other info" symptom — this catch
    // makes the real cause show up in the terminal every time, and marks the
    // session 'failed' explicitly instead of leaving it stuck at 0/0 tasks
    // forever with no indication anything went wrong.
    let raw: string;
    let planningPrompt: string;
    try {
        planningPrompt = buildPlanningPrompt(goal, stackProfile, customStack ?? undefined);
        raw = await callForgeModel(planningPrompt, { modelId, temperature: 0.1, sessionId: session.id });
    } catch (err) {
        console.error(
            `[FORGE][ORCH] planning model call FAILED for session ${session.id} ` +
                `(model=${modelId}):`,
            err
        );
        await db.updateSessionStatus(session.id, "failed");
        throw new Error(
            `[FORGE][ORCH] planning call to model '${modelId}' failed: ` +
                (err instanceof Error ? err.message : String(err))
        );
    }

    let planned: PlannedTask[];
    try {
        planned = extractJson<PlannedTask[]>(raw);
    } catch (err) {
        // Log the RAW model output on parse failure — this is the single
        // most useful thing to see when a weak/small model returns
        // malformed JSON, prose instead of JSON, or truncates mid-object.
        console.error(
            `[FORGE][ORCH] planner output for session ${session.id} was not valid JSON. ` +
                `Raw model output was:\n${raw}`
        );
        console.error(err);
        await db.updateSessionStatus(session.id, "failed");
        throw new Error(
            `[FORGE][ORCH] planner returned unparseable output from model '${modelId}' ` +
                `— see server logs for the raw response`
        );
    }

    if (!Array.isArray(planned) || planned.length === 0) {
        console.error(
            `[FORGE][ORCH] planner for session ${session.id} returned an empty/invalid ` +
                `task list. Raw model output was:\n${raw}`
        );
        await db.updateSessionStatus(session.id, "failed");
        throw new Error("[FORGE][ORCH] planner returned no tasks");
    }

    // Insert in order, mapping the planner's array indices to real task ids.
    const idByIndex: string[] = [];
    for (const [index, item] of planned.entries()) {
        const dependsOn = (item.dependsOn ?? [])
            .filter((i) => Number.isInteger(i) && i >= 0 && i < index)
            .map((i) => idByIndex[i]);
        const node = await db.createTaskNode(session.id, {
            description: item.description,
            acceptanceCriteria: item.acceptanceCriteria,
            dependsOn,
        });
        idByIndex.push(node.id);

        // Log the plan itself so the live tail shows planning output too.
        await db.logIteration(
            session.id,
            node.id,
            "think",
            index === 0 ? planningPrompt : "(planning — same prompt as task 0)",
            JSON.stringify({
                reasoning: "planning: task inserted from planner output",
                task: item,
            })
        );
    }

    console.log(`[FORGE][ORCH] planned ${planned.length} tasks for ${session.id}`);
    await db.updateSessionStatus(session.id, "running");
    await agentLoop.writeTodoFile(session.id);

    const fresh = await db.getSession(session.id);
    return fresh ?? session;
}

// Pause/resume just flip status in the DB — driveSessionToCompletion checks
// status before every iteration, so a pause takes effect at the next
// iteration boundary (never mid-action).
export async function pauseSession(id: string): Promise<void> {
    console.log(`[FORGE][ORCH] pausing session ${id}`);
    await db.updateSessionStatus(id, "paused");
}

export async function resumeSession(id: string): Promise<void> {
    console.log(`[FORGE][ORCH] resuming session ${id}`);
    await db.updateSessionStatus(id, "running");
    // Resuming restarts the drive loop — fire and forget, same as create.
    void driveSessionToCompletion(id);
}

// Minimal chat/follow-up mechanism: a user message becomes a new TaskNode,
// appended after everything currently in the tree (so it runs after
// whatever's already there, including a prior integration check if the
// session had already finished). The session is reopened to 'running' and
// the drive loop restarts. taskTree.pickNextTask's "somethingNewer" check
// means a fresh integration check gets queued after this follow-up
// completes, rather than trusting the old one — a follow-up can change the
// app, so the old verification no longer applies.
//
// This deliberately does NOT try to interpret the message or route it
// specially — it's just a new task with the user's text as its description.
// The planner/THINK loop treats it exactly like any planner-authored task.
// If the message doesn't obviously specify checkable acceptance criteria,
// a generic one is used; EVALUATE will still judge it against real command
// output the same way as every other task.
export async function addFollowUp(
    sessionId: string,
    message: string
): Promise<void> {
    const session = await db.getSession(sessionId);
    if (!session) {
        throw new Error(`[FORGE][ORCH] addFollowUp: no session ${sessionId}`);
    }
    if (session.status !== "done" && session.status !== "blocked" && session.status !== "paused") {
        throw new Error(
            `[FORGE][ORCH] addFollowUp: session ${sessionId} is '${session.status}' — ` +
                `follow-ups can only be added once a session is done, blocked, or paused ` +
                `(sending one mid-run would race the active iteration)`
        );
    }

    const tree = await db.getTaskTree(sessionId);
    // Depend on every currently-terminal task (done/blocked) so this follow-up
    // is grounded in the actual current state of the app, not free-floating.
    const dependsOn = tree
        .filter((t) => t.status === "done" || t.status === "blocked")
        .map((t) => t.id);

    const node = await db.createTaskNode(sessionId, {
        description: message,
        acceptanceCriteria:
            "The change described above is implemented and does not break any " +
            "previously-passing acceptance criteria (re-verify via the stack's " +
            "test/build command).",
        dependsOn,
    });

    console.log(`[FORGE][ORCH] follow-up added to session ${sessionId}: task ${node.id}`);

    await db.updateSessionStatus(sessionId, "running");
    await agentLoop.writeTodoFile(sessionId);
    void driveSessionToCompletion(sessionId);
}

// Guards against the same session being driven by two concurrent loops —
// e.g. a double-click on Resume, or a retried request after a slow response.
// Without this, two loops independently call pickNextTask, can both grab the
// SAME task, and race on the same workspace files (execWorker's
// activeTaskBySession map assumes exactly one iteration in flight per
// session at a time — nothing enforced that assumption before this guard).
// In-memory is sufficient for a single-process, single-machine deployment;
// if Forge ever runs across multiple processes this needs to move to a
// DB-backed lock (e.g. a `driving` boolean + compare-and-swap on the session
// row) instead.
const activeDriveLoops = new Set<string>();

export async function driveSessionToCompletion(id: string): Promise<void> {
    if (activeDriveLoops.has(id)) {
        console.warn(
            `[FORGE][ORCH] drive loop already running for ${id} — ignoring duplicate start`
        );
        return;
    }
    activeDriveLoops.add(id);

    console.log(`[FORGE][ORCH] drive loop starting for ${id}`);
    try {
        while (true) {
            const session = await db.getSession(id);
            if (!session || session.status !== "running") break; // paused/done/failed externally
            const result = await agentLoop.runIteration(id);
            if (result === "session_done" || result === "session_blocked") break;
        }
    } finally {
        activeDriveLoops.delete(id);
        console.log(`[FORGE][ORCH] drive loop exited for ${id}`);
    }
}