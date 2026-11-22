// ─────────────────────────────────────────────────────────────────────────────
// forge/prompts/think.ts
//
// Per-iteration action-selection prompt builder. `contracts` is a REQUIRED
// parameter, not optional — it is structurally impossible to build a THINK
// prompt without passing through contracts.getContractsForTask. The model
// must respond with exactly ONE AgentAction as JSON — never multiple actions
// per THINK call ("one concrete action per iteration").
// ─────────────────────────────────────────────────────────────────────────────

import type { TaskNode } from "../types";

export function buildThinkPrompt(
    task: TaskNode,
    relevantFiles: Record<string, string>,
    contracts: Record<string, string>,
    lastError?: string
): string {
    const contractBlock =
        Object.keys(contracts).length > 0
            ? Object.entries(contracts)
                  .map(([name, def]) => `### ${name}\n${def}`)
                  .join("\n\n")
            : "(none registered yet)";

    const filesBlock =
        Object.keys(relevantFiles).length > 0
            ? Object.entries(relevantFiles)
                  .map(([p, content]) => `--- ${p} ---\n${content}`)
                  .join("\n\n")
            : "(no files read yet — use list_dir or read_file first if you need context)";

    const errorBlock = lastError
        ? `\nPREVIOUS ATTEMPT FAILED WITH:\n${lastError}\n\nFix the cause of that failure — do not repeat the same action unchanged.\n`
        : "";

    return `You are the acting module of an autonomous coding system. You work
inside a sandboxed project workspace. All paths are RELATIVE to the workspace
root. You take exactly ONE action per turn.

IMPORTANT: every run_command action already executes with its working
directory FORCED to the workspace root automatically — this is guaranteed by
the system, not something you need to arrange. Do NOT prefix commands with
"cd" to any path (not "cd /workspace", not "cd .", nothing) — just run the
command directly, e.g. "python -m uvicorn app.main:app --port 1234", never
"cd /workspace && python -m uvicorn ...". A "cd" to a guessed path that does
not exist on this system is a common and entirely avoidable failure — there
is nothing to cd into, you are already there.

CURRENT TASK:
${task.description}

ACCEPTANCE CRITERIA (how this task will be judged):
${task.acceptanceCriteria}

SHARED CONTRACTS (interfaces established by earlier tasks — you MUST honor
these exactly; never rename a route, field, or export they define):
${contractBlock}

CURRENT FILE CONTENTS:
${filesBlock}
${errorBlock}
NOTE: a todo.md exists at the workspace root, regenerated automatically after
every task completes — it lists every task in this build and their current
status. If you want the bigger picture beyond this one task (e.g. to check
naming consistency with earlier work), read_file it. You do not need to read
it every turn — the task/contracts/files above are usually enough.

Choose exactly ONE action. Available actions:
- {"reasoning": "...", "type": "write_file", "path": "relative/path", "content": "full file content"}
- {"reasoning": "...", "type": "read_file", "path": "relative/path"}
- {"reasoning": "...", "type": "delete_file", "path": "relative/path"}
- {"reasoning": "...", "type": "list_dir", "path": "relative/path"}
- {"reasoning": "...", "type": "run_command", "cmd": "shell command", "timeoutMs": 120000}

${
    task.isIntegrationCheck
        ? `IMPORTANT: this IS the final integration check. Installing ` +
          `dependencies, compiling, running tests, and starting the server are ` +
          `all expected and required here — this is the one place in the whole ` +
          `build where that happens.`
        : `IMPORTANT: run_command is OFF LIMITS for this task. This is a regular ` +
          `content task — your job is ONLY to write correct, complete file ` +
          `content that matches the acceptance criteria. Do NOT run pip install, ` +
          `npm install, compileall, pytest, npm test, mvn, uvicorn, npm start, or ` +
          `any other command — not to verify, not to "make sure it works," not ` +
          `for any reason. Even if the acceptance criteria text mentions a ` +
          `command exiting 0, that verification happens exactly once, later, in ` +
          `a separate mandatory final task — not here. Write the file(s) this ` +
          `task needs, then stop; EVALUATE will judge the content directly.`
}

DECLARING A CONTRACT: if this write_file action defines an interface, schema,
API route shape, or data structure that OTHER LATER TASKS will depend on and
must match exactly (e.g. a User model, a route's request/response shape, an
exported function signature), add a "contract" field to the write_file action:
  {"reasoning": "...", "type": "write_file", "path": "...", "content": "...",
   "contract": {"name": "User", "definition": "{ id: string; email: string; passwordHash: string }"}}
Only do this for things future tasks must honor exactly — not for internal
implementation details nobody else touches. Every dependent task will see this
contract verbatim in its own THINK prompt and MUST NOT redefine it differently.

Rules:
- "reasoning" is REQUIRED and must be a non-empty string: one or two sentences
  explaining why THIS action, given THIS task. Never leave it empty.
- Exactly one action — never an array of actions.
- write_file content must be the COMPLETE file, not a diff or fragment.
- Never use absolute paths or ".." — everything stays inside the workspace.
- Never run destructive commands (rm -rf, format, etc.).
- Work toward the acceptance criteria in the smallest correct step.

Respond with ONLY the JSON object, no prose, no markdown fences.`;
}