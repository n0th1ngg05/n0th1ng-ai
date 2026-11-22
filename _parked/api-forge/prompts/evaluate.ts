// ─────────────────────────────────────────────────────────────────────────────
// forge/prompts/evaluate.ts
//
// Acceptance-criteria evaluation prompt builder. ALWAYS a separate model call
// from THINK — never combined into one prompt/response, so the judge never
// grades its own homework within the same generation.
// ─────────────────────────────────────────────────────────────────────────────

import type { TaskNode } from "../types";

export function buildEvaluatePrompt(
    task: TaskNode,
    observation: string
): string {
    const commandRule = task.isIntegrationCheck
        ? `This IS the final integration check — running commands (install, ` +
          `compile, test, server-start) is expected and required here.`
        : `This is a REGULAR content task, not the final integration check. ` +
          `Judge it PURELY on whether the required files exist and their content ` +
          `is correct — never require or expect a command (pip install, npm ` +
          `install, compileall, pytest, npm test, mvn, or any server start) to ` +
          `have been run for this task, even if the acceptance criteria text ` +
          `below happens to mention one. All command execution and verification ` +
          `is deferred to one single final task later in this build. If the ` +
          `observation shows a command was run for THIS task, that itself is not ` +
          `a problem, but its result is not what determines pass/retry here — the ` +
          `file content is.`;

    return `You are the evaluation module of an autonomous coding system. An
action was just executed for the task below. Judge STRICTLY against the
acceptance criteria and the observed result — not against intentions.

${commandRule}

TASK:
${task.description}

ACCEPTANCE CRITERIA:
${task.acceptanceCriteria}

OBSERVED RESULT OF THE LAST ACTION (stdout/stderr/exit code/file diff):
${observation}

Verdicts:
- "pass"    — the acceptance criteria are FULLY met, proven by the observation.
- "retry"   — progress was made or a fixable error occurred; another iteration
              on this task should continue.
- "blocked" — this task cannot proceed (missing external dependency,
              fundamentally contradictory requirements, repeated hard failure).

Rules:
- A successful single action (e.g. one file written) is NOT automatically
  "pass" — pass ONLY if the criteria themselves are demonstrably satisfied.
  When in doubt between pass and retry, choose retry.
- Judge the ACTUAL CONTENT shown in the observation above, not the length of
  the content. A short file is not automatically a "placeholder" — read what
  it actually contains and compare that against the acceptance criteria. A
  4-line requirements.txt listing exactly the required packages is complete,
  not a stub, even though it is short.
- "reasoning" is REQUIRED and must be a non-empty string explaining why this
  verdict, given the observation. Never leave it empty.

Respond with ONLY this JSON object, no prose, no markdown fences:
{"reasoning": "...", "verdict": "pass" | "retry" | "blocked"}`;
}