// ─────────────────────────────────────────────────────────────────────────────
// forgex/constants.ts
//
// ForgeX — Enhanced Coding Workplace. A bridge controller that launches the
// REAL Claude Code CLI as a subprocess, pointed at a local Ollama model via
// ANTHROPIC_BASE_URL, rather than reimplementing an agent loop the way
// forge/agentLoop.ts does. ForgeX's job is process lifecycle + streaming,
// nothing more — Claude Code's own harness (system prompt, tool definitions,
// context management, editing) does the actual agentic work.
// ─────────────────────────────────────────────────────────────────────────────

import path from "path";

// Separate workspace root from Forge's — these are two different subsystems
// with two different execution models (Forge's sandboxed exec loop vs
// ForgeX's real Claude Code process with real file access). Never share a
// root directory between them.
export const FORGEX_ROOT = "D:\\ForgeX\\workspaces";

// Ollama's native Anthropic-Messages-API-compatible endpoint (announced
// 2026-01-16). If the installed Ollama version predates this, Claude Code's
// requests will fail against this URL directly and a translation proxy
// (e.g. LiteLLM) would be needed in front of it instead — see
// processManager.ts's startup health check, which surfaces this distinction
// clearly rather than failing silently.
export const OLLAMA_ANTHROPIC_BASE_URL = "http://localhost:11434";
export const OLLAMA_TAGS_URL = "http://localhost:11434/api/tags";

// Claude Code reads ANTHROPIC_BASE_URL once at process start — changing it
// requires restarting the process, not just updating an env var live. This
// is why ForgeX sessions are scoped to one model for their whole lifetime,
// same as Forge sessions (see forgex/types.ts's ForgeXSession.modelId).
export const CLAUDE_CODE_BIN = process.env.CLAUDE_CODE_BIN ?? "claude";

// Claude Code's own documented context floor for reliable agentic operation.
// Below this, sessions degrade after a handful of turns — file edits
// truncate, tool calls drop arguments. ForgeX surfaces this as a warning at
// session creation if the selected model's context window (from Ollama's
// /api/show) is below it, but does not hard-block — the user explicitly
// chose to make this selectable rather than tier-locked.
export const RECOMMENDED_MIN_CONTEXT_TOKENS = 32_000;

// Headless mode (`claude -p`) processes a single turn end-to-end and then
// exits — a turn with real tool use (multi-file edits, running tests) can
// legitimately take a while without being stuck. So this is NOT a hard
// kill/failure deadline anymore; it's just how long to wait before emitting
// a "still working" system note to the UI so a long turn doesn't look hung.
// The process itself is never force-killed by this timer.
export const PROCESS_STARTUP_TIMEOUT_MS = 30_000;

// Max buffered output lines kept in memory per session for SSE backfill —
// mirrors modelClient.ts's token ring-buffer approach in forge/, same reason
// (a reconnecting tab should see recent history, not just new output).
export const OUTPUT_BUFFER_MAX_LINES = 2000;

export function workspacePathFor(sessionId: string): string {
    return path.join(FORGEX_ROOT, sessionId);
}