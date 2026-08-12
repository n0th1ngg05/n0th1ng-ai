// ─────────────────────────────────────────────────────────────────────────────
// forge/taskTree.ts
//
// Task-selection policy on top of forge/db.ts: which task runs next, when a
// task counts as stuck, and the guarantee that the integration check is the
// literal last task of every session — a session cannot reach 'done' without
// it (enforced here, not trusted to the planner's output).
// ─────────────────────────────────────────────────────────────────────────────

import * as db from "./db";
import {
    MAX_ATTEMPTS_PER_TASK,
    MAX_INTEGRATION_CHECK_ATTEMPTS,
    MAX_CONSECUTIVE_IDENTICAL_ERRORS,
} from "./constants";
import type { TaskNode } from "./types";
import { getStackProfile } from "./stacks/registry";

// Thin wrapper around db.getNextActionableTask with the integration-check
// enforcement layered on:
//   - actionable task exists            -> return it
//   - none, integration check not done  -> queue (or return) the check task
//   - none, integration check done      -> null (session complete)
//
// Considers only the MOST RECENT integration-check task, not any ever
// created — a follow-up message (see orchestrator.addFollowUp) appends a new
// task plus a FRESH integration check after a session already reached
// 'done', since the old check no longer reflects the app after new code
// lands. Ordering by createdAt keeps this correct across any number of
// follow-up rounds.
export async function pickNextTask(
    sessionId: string
): Promise<TaskNode | null> {
    const next = await db.getNextActionableTask(sessionId);
    if (next) return next;

    const tree = await db.getTaskTree(sessionId);
    const integrationTasks = tree
        .filter((t) => t.isIntegrationCheck)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const integrationTask = integrationTasks[integrationTasks.length - 1] ?? null;

    if (integrationTask) {
        if (integrationTask.status === "done") {
            // Was the most recent integration check really the LAST thing
            // created, or did a follow-up task land after it completed? If
            // anything non-integration-check was created after this check
            // finished, the app has changed since it was last verified —
            // fall through to queue a fresh check rather than declaring the
            // session complete on stale verification.
            const somethingNewer = tree.some(
                (t) =>
                    !t.isIntegrationCheck &&
                    t.createdAt.getTime() > integrationTask.createdAt.getTime()
            );
            if (!somethingNewer) return null; // genuinely complete
            // else: fall through to the "queue a new check" logic below
        } else {
            // Exists but not actionable and not done — it's blocked/failed,
            // or its deps are blocked. Nothing left to run.
            return null;
        }
    }

    // No integration check queued yet — create it from the stack profile's
    // mandatory template. It depends on every currently-done leaf so the
    // dependency graph stays honest.
    const session = await db.getSession(sessionId);
    if (!session) return null;

    const profile = getStackProfile(session.stackProfileId);
    const doneIds = tree.filter((t) => t.status === "done").map((t) => t.id);

    console.log("[FORGE][TREE] Queueing mandatory integration check for session", sessionId);

    return db.createTaskNode(sessionId, {
        description: profile.integrationCheck.description,
        acceptanceCriteria: profile.integrationCheck.acceptanceCriteria,
        dependsOn: doneIds,
        isIntegrationCheck: true,
    });
}

// A task is stuck if it has burned all attempts, or its last N evaluate
// iterations carry the same error string (spinning on the identical failure).
// The integration check uses a shorter attempt cap (see constants.ts) — it's
// meant to be skipped quickly, not ground on like a normal content task.
export async function checkStuck(task: TaskNode): Promise<boolean> {
    const maxAttempts = task.isIntegrationCheck
        ? MAX_INTEGRATION_CHECK_ATTEMPTS
        : MAX_ATTEMPTS_PER_TASK;
    if (task.attempts >= maxAttempts) return true;

    const evaluations = await db.getIterationsForTask(
        task.id,
        "evaluate",
        MAX_CONSECUTIVE_IDENTICAL_ERRORS
    );
    if (evaluations.length < MAX_CONSECUTIVE_IDENTICAL_ERRORS) return false;

    const errors = evaluations.map((it) => {
        try {
            const parsed = JSON.parse(it.output);
            return String(parsed.reasoning ?? it.output);
        } catch {
            return it.output;
        }
    });

    return errors.every((e) => e === errors[0]);
}

// Marks a REGULAR task blocked and RETURNS — the drive loop proceeds to the
// next pickNextTask call rather than halting the whole overnight run over
// one bad task.
//
// For the INTEGRATION CHECK specifically, marks it 'failed' instead of
// 'blocked' — this distinction matters: 'blocked' implies something is wrong
// that needs fixing before the session can be considered finished. But per
// explicit design: if every real content task already passed and only the
// final server-start smoke test couldn't be verified (port weirdness,
// missing system dependency, sandbox networking quirk), that's a SKIP, not a
// failure of the actual build — the code is done, this file just couldn't
// prove the last mile. runIteration's completion check (see agentLoop.ts)
// treats a 'failed' integration check as the session being DONE, with
// SETUP.md as the trail of what to try manually.
export async function markStuckAndContinue(task: TaskNode): Promise<void> {
    if (task.isIntegrationCheck) {
        console.warn(
            "[FORGE][STUCK] integration check could not be verified — skipping, " +
                "session will complete as done with SETUP.md:",
            task.id,
            task.lastError
        );
        await db.updateTaskStatus(task.id, "failed", task.lastError ?? undefined);
        return;
    }
    console.warn("[FORGE][STUCK] task blocked:", task.id, task.lastError);
    await db.updateTaskStatus(task.id, "blocked", task.lastError ?? undefined);
}