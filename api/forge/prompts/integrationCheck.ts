// ─────────────────────────────────────────────────────────────────────────────
// forge/prompts/integrationCheck.ts
//
// Final whole-app smoke-test prompt builder. This backs the literal LAST task
// of every session — taskTree.pickNextTask enforces it can't be skipped. Its
// only job: run the stack's runCmd, hit the actually-running app with a real
// request, and report pass/fail.
// ─────────────────────────────────────────────────────────────────────────────

import type { ForgeSession } from "../types";
import type { StackProfile } from "../stacks/types";

export function buildIntegrationCheckPrompt(
    session: ForgeSession,
    stackProfile: StackProfile
): string {
    // Stack profiles declare runCmd/description with a {{PORT}} placeholder
    // (see stacks/pythonFastapi.ts etc) rather than a hardcoded port, since
    // the real port is allocated fresh per-session (db.findFreePort) to
    // avoid colliding with anything else already running on the host.
    const port = session.allocatedPort;
    const runCmd = stackProfile.runCmd.replace(/\{\{PORT\}\}/g, String(port));

    return `You are performing the FINAL integration smoke test for a completed
build. Every other task in this project already passed — all files are
written and reviewed. This check ONLY verifies the server actually starts;
it does not change any code. The goal was:

${session.goal}

Stack: ${stackProfile.id}
Run command: ${runCmd}
Assigned port: ${port} (this port was specifically checked free before this
session started — if binding it fails, something else grabbed it in the
meantime, which is worth reporting clearly rather than silently retrying
forever)

IMPORTANT: your working directory is ALREADY the project root for every
run_command action — never prefix a command with "cd" to any path. Just run
the command directly, e.g. "${runCmd} &", never "cd /workspace && ${runCmd} &".

Your job, over your next few actions (one per turn):
1. Start the app in the background using a run_command action based on the
   run command above (e.g. append " &" or use "start /b" as appropriate, but
   do NOT cd anywhere first), giving it a few seconds to boot.
2. Hit the RUNNING app with a real request via run_command + curl:
   first "curl -s -o /dev/null -w \\"%{http_code}\\" http://localhost:${port}/health",
   then at least one request against the actual built feature (an /api route
   from the shared contracts).
3. Stop the app.

The test passes ONLY if the health check returns HTTP 200 from the running
app. This check is only attempted a couple of times — if it doesn't succeed
quickly, the system will skip it and record what was tried rather than
retrying indefinitely, since the actual code is already complete regardless
of whether this last-mile verification succeeds in this environment.

Respond to each turn with exactly one action JSON as usual.`;
}