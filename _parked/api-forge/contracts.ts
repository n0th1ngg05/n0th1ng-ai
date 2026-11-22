// ─────────────────────────────────────────────────────────────────────────────
// forge/contracts.ts
//
// Shared-contract store. When a task establishes an interface other tasks
// must honor (an API route shape, a DB table name, an exported function
// signature), it registers it here; every dependent task's THINK prompt then
// receives those contracts verbatim. buildThinkPrompt takes the contracts
// object as a REQUIRED parameter, so it is structurally impossible to build a
// THINK prompt without passing through getContractsForTask.
// ─────────────────────────────────────────────────────────────────────────────

import * as db from "./db";
import type { ForgeSession, TaskNode } from "./types";

// Persists via db.updateSharedContracts, which MERGES into the existing JSON
// rather than overwriting — earlier tasks' contracts survive forever.
export async function registerContract(
    session: ForgeSession,
    name: string,
    definition: string
): Promise<void> {
    console.log("[FORGE][CONTRACTS] register:", name);
    await db.updateSharedContracts(session.id, { [name]: definition });
}

// Contracts are stored flat on the session (name -> definition) but keyed to
// tasks by convention: a contract registered while task X ran is prefixed
// "taskId:" when the loop stores it. This lookup walks the task's dependsOn
// ancestry (transitively — a task depends on everything its dependencies
// depend on) and returns every contract registered by any ancestor, plus any
// un-prefixed session-global contracts.
export async function getContractsForTask(
    session: ForgeSession,
    task: TaskNode
): Promise<Record<string, string>> {
    const tree = await db.getTaskTree(session.id);
    const byId = new Map(tree.map((t) => [t.id, t]));

    // Walk up: collect the full dependency ancestry of this task.
    const ancestry = new Set<string>();
    const queue = [...task.dependsOn];
    while (queue.length > 0) {
        const id = queue.pop()!;
        if (ancestry.has(id)) continue;
        ancestry.add(id);
        const dep = byId.get(id);
        if (dep) queue.push(...dep.dependsOn);
    }

    const result: Record<string, string> = {};
    for (const [name, definition] of Object.entries(session.sharedContracts)) {
        const colonIdx = name.indexOf(":");
        if (colonIdx === -1) {
            // Session-global contract (no task prefix) — always injected.
            result[name] = definition;
            continue;
        }
        const ownerTaskId = name.slice(0, colonIdx);
        if (ancestry.has(ownerTaskId)) {
            result[name.slice(colonIdx + 1)] = definition;
        }
    }
    return result;
}

// Helper the agent loop uses to namespace a contract to the task that
// registered it, so getContractsForTask can scope by ancestry.
export function contractKeyForTask(taskId: string, name: string): string {
    return `${taskId}:${name}`;
}
