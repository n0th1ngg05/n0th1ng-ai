// ─────────────────────────────────────────────────────────────────────────────
// forge/prompts/planning.ts
//
// Builds the one-shot planning prompt. The stack profile's scaffoldSteps are
// handed to the model as a SKELETON IT FILLS IN, not a blank-page brainstorm
// — the mitigation against Devstral's weaker from-scratch architectural
// judgment. Output is a JSON array parsed by the orchestrator and inserted as
// TaskNode rows in a single pass before the agent loop's first iteration.
// ─────────────────────────────────────────────────────────────────────────────

import type { StackProfile } from "../stacks/types";

export type PlannedTask = {
    description: string;
    acceptanceCriteria: string;
    dependsOn: number[];
};

export function buildPlanningPrompt(
    goal: string,
    stackProfile: StackProfile,
    customStack?: string
): string {
    const skeleton = stackProfile.scaffoldSteps
        .map(
            (step, i) =>
                `${i}. ${step.description}\n   acceptanceCriteria: ${step.acceptanceCriteria}\n   dependsOn: [${step.dependsOn.join(", ")}]`
        )
        .join("\n");

    const isGeneral = stackProfile.id === "general";

    const stackBlock = isGeneral
        ? `STACK: general-purpose (user-specified language/framework below —
no pre-built profile exists for this, so YOU must determine the real
install/build/test/run tooling, not use placeholders)

USER-SPECIFIED LANGUAGE/STACK:
${customStack?.trim() || "(not specified — infer the most reasonable choice from the goal itself)"}`
        : `STACK: ${stackProfile.id}
- package manager: ${stackProfile.packageManager}
- build: ${stackProfile.buildCmd}
- test: ${stackProfile.testCmd}
- run: ${stackProfile.runCmd} (port ${stackProfile.devServerPort})`;

    const generalExtraRules = isGeneral
        ? `
- This is a general-purpose build with NO pre-built tooling profile. For
  EVERY task's acceptanceCriteria, write the REAL, ACTUAL command for the
  language/stack specified above — not a placeholder, not "(language-appropriate
  command)". E.g. for Go: "go build ./... exits 0"; for C: "make exits 0 AND
  ./a.out runs without a segfault"; for Rust: "cargo test exits 0". If unsure
  of the idiomatic command, use the single most standard, widely-known one for
  that language.
- The FINAL scaffold step (review pass) must specify the real README content
  needed: actual install/build/run/test commands for this language, not
  generic prose.`
        : "";

    return `You are the planning module of an autonomous coding system.

GOAL:
${goal}

${stackBlock}

Below is the standard scaffold skeleton for this stack. Your job is to FILL IN
this skeleton for the specific goal above — specialize each step's description
to the goal's actual entities and features (e.g. "todo items and users", not
"the goal's models"). You may split a step into two or add a step where the
goal clearly needs it, but keep the overall shape and ordering of the skeleton.
Do NOT invent an architecture from scratch.

SKELETON:
${skeleton}

Rules:
- Each task must be small enough to complete in a handful of file writes or
  commands.
- Each acceptanceCriteria must be objectively checkable against real command
  output or file contents ("npm test exits 0", "file X exists"), never a
  judgement call ("code looks good").
- dependsOn contains ARRAY INDICES of tasks in YOUR output array that must be
  done first. Indices must only reference EARLIER elements.
- Do NOT include a final integration/smoke-test task — the system appends the
  mandatory integration check itself.${generalExtraRules}

Respond with ONLY a JSON array, no prose, no markdown fences:
[
  {
    "description": "...",
    "acceptanceCriteria": "...",
    "dependsOn": [0, 1]
  }
]`;
}