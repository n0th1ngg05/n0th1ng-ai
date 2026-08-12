// ─────────────────────────────────────────────────────────────────────────────
// forgex/types.ts
// ─────────────────────────────────────────────────────────────────────────────

export type ForgeXSessionStatus =
    | "starting" // first turn's `claude -p` invocation spawned, waiting for it to finish
    | "running" // a turn's `claude -p` process is currently alive and working
    | "idle" // a turn finished, conversation is resumable via --resume, no process alive
    | "exited" // user explicitly stopped the session (no more turns will be sent)
    | "failed"; // a turn's invocation failed outright (bad model, Ollama unreachable, etc)

export type ForgeXSession = {
    id: string;
    goal: string;
    modelId: string; // Ollama model tag, e.g. "devstral:24b-small-2505-q6_K"
    workspacePath: string;
    status: ForgeXSessionStatus;
    pid: number | null; // pid of the MOST RECENT turn's process — not a live handle; see processManager
    exitCode: number | null; // exit code of the most recent turn's process
    claudeSessionId: string | null; // Claude Code's own session UUID, from stream-json's init event — required for --resume on every turn after the first
    createdAt: Date;
    updatedAt: Date;
};

// One line of output from the claude subprocess (stdout or stderr), or a
// system-level note ForgeX itself injects (e.g. "process started",
// "process exited with code 1"). Persisted to forgex_output for full replay,
// and pushed live via SSE as it arrives — this is deliberately simpler than
// Forge's phase/reasoning/verdict structure, because ForgeX isn't parsing
// structured actions out of this output the way agentLoop.ts does; it's
// showing Claude Code's own terminal output as-is.
export type ForgeXOutputLine = {
    id: string;
    sessionId: string;
    stream: "stdout" | "stderr" | "system";
    text: string;
    timestamp: Date;
};

// What the user sends INTO the running claude process's stdin — Claude Code
// is interactive, so ForgeX needs to support sending follow-up input to an
// already-running session, not just launching it once and reading output.
export type ForgeXInputMessage = {
    sessionId: string;
    text: string;
};