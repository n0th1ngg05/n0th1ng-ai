// ─────────────────────────────────────────────────────────────────────────────
// forge/types.ts
//
// Shared types for The Forge — the long-horizon autonomous coding subsystem.
// These shapes mirror the Drizzle table definitions in forge/schema.ts
// EXACTLY (same field names, same enum values). Nearly every other file in
// forge/ imports from here, so the schema and these types must never drift.
// ─────────────────────────────────────────────────────────────────────────────

export type ForgeSessionStatus =
    | "planning"
    | "running"
    | "paused"
    | "blocked"
    | "done"
    | "failed";

export type TaskNodeStatus =
    | "pending"
    | "in_progress"
    | "done"
    | "failed"
    | "blocked";

export type ForgeIterationPhase = "think" | "act" | "evaluate";

export type ForgeSession = {
    id: string;
    goal: string;
    stackProfileId: string;
    customStack: string | null;
    modelId: string;
    workspacePath: string;
    // Real free port allocated at session creation (see db.ts's
    // findFreePort) — NOT a hardcoded stack-profile default. Prevents this
    // session's dev server from colliding with anything else already
    // running on the host (other Forge sessions, a permanent background
    // service, etc.).
    allocatedPort: number;
    status: ForgeSessionStatus;
    sharedContracts: Record<string, string>;
    iterationCount: number;
    createdAt: Date;
    updatedAt: Date;
};

export type TaskNode = {
    id: string;
    sessionId: string;
    parentId: string | null;
    description: string;
    acceptanceCriteria: string;
    status: TaskNodeStatus;
    dependsOn: string[];
    attempts: number;
    lastError: string | null;
    isIntegrationCheck: boolean;
    createdAt: Date;
};

export type ForgeIteration = {
    id: string;
    sessionId: string;
    taskId: string;
    phase: ForgeIterationPhase;
    input: string;
    output: string;
    timestamp: Date;
};

// ── AgentAction ───────────────────────────────────────────────────────────────
// Exactly one action per THINK call. `reasoning` is REQUIRED, not optional —
// this is what makes the UI's "watch it think" live tail possible. Without a
// first-class reasoning field that information is buried inside whatever the
// model returned and has to be re-parsed client-side every time, which is
// fragile and against the "no compromise" principle for observability.
// prompts/think.ts instructs the model to always populate it; parsing rejects
// an empty reasoning string rather than letting it pass silently.

export type AgentAction =
    | {
          reasoning: string;
          type: "write_file";
          path: string;
          content: string;
          // OPTIONAL, checked on every write_file action (not just a
          // dedicated action type) — the model is far more likely to reliably
          // declare a contract in the same breath it writes the file that
          // defines it than to remember a separate action later. See
          // agentLoop.ts's dispatchAction: this is registered via
          // contracts.registerContract BEFORE the write itself is checked by
          // EVALUATE, so a dependent task's very next iteration can see it.
          contract?: { name: string; definition: string };
      }
    | {
          reasoning: string;
          type: "read_file";
          path: string;
      }
    | {
          reasoning: string;
          type: "delete_file";
          path: string;
      }
    | {
          reasoning: string;
          type: "list_dir";
          path: string;
      }
    | {
          reasoning: string;
          type: "run_command";
          cmd: string;
          timeoutMs?: number;
      };

export type AgentActionType = AgentAction["type"];

// ── EvaluationResult ──────────────────────────────────────────────────────────
// Output of the EVALUATE model call — always a separate call from THINK.
// `reasoning` is required for the same observability reason as AgentAction.

export type EvaluationResult = {
    reasoning: string;
    verdict: "pass" | "retry" | "blocked";
};