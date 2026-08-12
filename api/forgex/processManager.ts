// ─────────────────────────────────────────────────────────────────────────────
// forgex/processManager.ts
//
// The actual core of ForgeX. Unlike forge/agentLoop.ts (which IS the agent —
// THINK/ACT/EVALUATE implemented from scratch), this file does NOT implement
// any agentic logic at all. It launches the REAL Claude Code CLI, routed to
// a local Ollama model via a project-local .claude/settings.json env block
// (not spawn-time env vars — see runTurn's comment for why that distinction
// is load-bearing), and streams its output live. Claude Code's own harness —
// system prompt, tool definitions, file editing, context management — does
// 100% of the actual agentic work. This file's job is process lifecycle +
// streaming + persistence, nothing more.
//
// ── HEADLESS ARCHITECTURE (per-turn, not one long-lived process) ───────────
// `claude "<goal>"` (a bare positional arg, no -p/--print) launches Claude
// Code's INTERACTIVE REPL with that text as the opening message — that's
// the documented behavior of the plain CLI invocation. An interactive REPL
// expects a real TTY (raw-mode input, live re-rendering). Spawned as a
// plain child_process with piped stdio, there is no TTY, so Claude Code
// falls back to trying to read piped stdin, gets nothing, times out after a
// few seconds with the "no stdin data received" warning, and exits — this
// is exactly the hang that was observed, not an environment/PATH problem.
//
// The fix is headless mode: `claude -p "<message>" --output-format
// stream-json --verbose`, which is Claude Code's officially documented
// non-interactive path. It needs no TTY. Each turn is its own spawn + exit,
// and conversation continuity across turns comes from
// `--resume <claudeSessionId>`, not from keeping a process alive with an
// open stdin. Two things that are NOT optional here, both confirmed by
// real-machine testing:
//   - `--verbose` is mandatory whenever `--print`/`-p` is combined with
//     `--output-format=stream-json` — Claude Code's CLI hard-errors
//     ("requires --verbose") and exits(1) without it. Not a nicety.
//   - stdin must be explicitly closed (spawn's `stdio: ["ignore", ...]`),
//     not left as the default open pipe. Even in `-p` mode (message passed
//     as a CLI arg, never via stdin), an open-but-silent stdin pipe is
//     indistinguishable to Claude Code from "a slow upstream process is
//     about to pipe something in," so it still waits ~3s per turn for
//     stdin data before proceeding (the "no stdin data received" warning) —
//     this was still firing on every turn even after switching to headless
//     mode, just as a delay instead of a hang. Closing stdin up front skips
//     that wait entirely.
// This means:
//   - There is no more "live process you write follow-ups into." A turn
//     spawns, runs to completion, exits. `liveProcesses` below now tracks
//     "a turn is currently in flight," not "the session's process," and is
//     empty between turns even though the conversation is very much still
//     alive (status: "idle").
//   - `isRunning()` therefore means "a turn is actively being processed
//     right now," not "this session has a resumable process." Use session
//     status ("idle") to mean "resumable, no turn in flight."
//   - sendInput() no longer writes to stdin — it starts a brand new turn
//     via runTurn(..., { resumeId: session.claudeSessionId }).
// ─────────────────────────────────────────────────────────────────────────────

import { spawn, type ChildProcess } from "child_process";
import fs from "fs/promises";
import path from "path";
import * as db from "./db";
import type { ForgeXSessionStatus } from "./types";
import {
    CLAUDE_CODE_BIN,
    OLLAMA_ANTHROPIC_BASE_URL,
    PROCESS_STARTUP_TIMEOUT_MS,
    OUTPUT_BUFFER_MAX_LINES,
} from "./constants";

class ForgeXProcessError extends Error {}

// In-memory registry of the CURRENTLY IN-FLIGHT turn's process per session
// (empty when a session is idle between turns — see header comment). Same
// "process handles can't be persisted to SQL" reasoning as before; this map
// is the live source of truth for "is a turn running right now," separate
// from the DB's durable `status` column.
const liveProcesses = new Map<string, ChildProcess>();

// Recent output lines per session, for SSE backfill on (re)connect — same
// reasoning as modelClient.ts's token ring buffer.
const outputBuffers = new Map<string, string[]>();

type OutputListener = (line: { stream: "stdout" | "stderr" | "system"; text: string }) => void;
const outputListeners = new Map<string, Set<OutputListener>>();

export function subscribeToOutput(sessionId: string, listener: OutputListener): () => void {
    if (!outputListeners.has(sessionId)) outputListeners.set(sessionId, new Set());
    outputListeners.get(sessionId)!.add(listener);
    return () => {
        outputListeners.get(sessionId)?.delete(listener);
    };
}

export function getBufferedOutput(sessionId: string): string[] {
    return outputBuffers.get(sessionId) ?? [];
}

// "Is a turn actively in flight right now" — NOT "is this session alive/
// resumable." A session with status "idle" is very much alive (resumable
// via --resume) but will correctly report isRunning() === false here.
export function isRunning(sessionId: string): boolean {
    return liveProcesses.has(sessionId);
}

// Live status push, separate from the output SSE channel — routes.ts's
// stream endpoint used to only send a single "status" event on connect;
// with turns now flipping status running -> idle/failed on every single
// turn, the frontend's updateFollowupBar needs to hear about that live, not
// just once. subscribeToStatus lets routes.ts push that.
type StatusListener = (status: ForgeXSessionStatus) => void;
const statusListeners = new Map<string, Set<StatusListener>>();

export function subscribeToStatus(sessionId: string, listener: StatusListener): () => void {
    if (!statusListeners.has(sessionId)) statusListeners.set(sessionId, new Set());
    statusListeners.get(sessionId)!.add(listener);
    return () => {
        statusListeners.get(sessionId)?.delete(listener);
    };
}

async function emitLine(
    sessionId: string,
    stream: "stdout" | "stderr" | "system",
    text: string
): Promise<void> {
    // Persist first — the SSE listeners are a live convenience, the DB row
    // is the durable record a reconnecting tab or a later review depends on.
    await db.logOutputLine(sessionId, stream, text);

    const buf = outputBuffers.get(sessionId) ?? [];
    buf.push(text);
    if (buf.length > OUTPUT_BUFFER_MAX_LINES) buf.shift();
    outputBuffers.set(sessionId, buf);

    for (const listener of outputListeners.get(sessionId) ?? []) {
        try {
            listener({ stream, text });
        } catch (err) {
            console.error("[FORGEX][PROC] output listener threw:", err);
        }
    }
}

function emitStatus(sessionId: string, status: ForgeXSessionStatus): void {
    for (const listener of statusListeners.get(sessionId) ?? []) {
        try {
            listener(status);
        } catch (err) {
            console.error("[FORGEX][PROC] status listener threw:", err);
        }
    }
}

// ── Windows shell-escaping fix (unchanged from the interactive version) ────
// spawn(..., { shell: true }) on Windows runs the command through cmd.exe
// /c, which concatenates argv into a single string WITHOUT escaping — a
// multi-word message needs explicit quoting or cmd.exe splits it into many
// separate arguments and `claude` receives garbage.
function winQuote(arg: string): string {
    return `"${arg.replace(/"/g, '\\"')}"`;
}
function spawnClaudeCode(args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv }) {
    const isWin = process.platform === "win32";
    return spawn(
        CLAUDE_CODE_BIN,
        isWin ? args.map(winQuote) : args,
        {
            cwd: opts.cwd,
            env: opts.env,
            shell: isWin,
            // Headless mode sends the message as a CLI arg (-p "<message>"),
            // never via stdin. Leaving stdin as the default open pipe means
            // it's an open, empty, never-closed pipe from Claude Code's POV
            // — indistinguishable from "a slow process is about to pipe
            // something in," so it waits ~3s before giving up and
            // proceeding (the "no stdin data received" warning). Explicitly
            // closing stdin (`'ignore'`) tells it up front there is nothing
            // coming, skipping that wait entirely.
            stdio: ["ignore", "pipe", "pipe"],
        }
    );
}

async function ensureWorkspaceConfigured(workspacePath: string, modelId: string): Promise<void> {
    await fs.mkdir(workspacePath, { recursive: true });

    // Project-local .claude/settings.json is the single source of truth for
    // Anthropic-routing env vars (ANTHROPIC_BASE_URL etc). Proven by real
    // testing to be the mechanism that actually works, unlike passing these
    // same keys via spawn(..., { env }) — pre-existing shell env vars are
    // NOT overwritten by settings.json's env block, they take precedence
    // over it, so setting them at spawn-time would silently shadow this
    // file. process.env is passed through to spawn unmodified for that
    // reason; do not add these keys there.
    //
    // Path built with path.join, NOT template-literal concatenation. On
    // Windows, workspacePath is backslash-separated (it comes from
    // constants.ts's workspacePathFor, which uses path.join against
    // FORGEX_ROOT). The old `${workspacePath}/.claude` pattern hardcoded a
    // forward slash onto a backslash-separated string, producing a MIXED
    // path like `D:\ForgeX\workspaces\<id>/.claude`. Confirmed on real
    // hardware to be the cause of Claude Code's sandbox check wrongly
    // rejecting legitimately-nested paths — a real `mkdir -p templates` was
    // blocked as "outside the allowed working directory" even though it
    // plainly wasn't, because the cwd we passed to spawn and the path
    // Claude Code resolved internally had inconsistent separators for its
    // string-prefix comparison. path.join normalizes throughout.
    const claudeDir = path.join(workspacePath, ".claude");
    await fs.mkdir(claudeDir, { recursive: true });
    await fs.writeFile(
        path.join(claudeDir, "settings.json"),
        JSON.stringify(
            {
                env: {
                    ANTHROPIC_BASE_URL: OLLAMA_ANTHROPIC_BASE_URL,
                    ANTHROPIC_AUTH_TOKEN: "ollama",
                    ANTHROPIC_API_KEY: "",
                    ANTHROPIC_MODEL: modelId,
                    ANTHROPIC_SMALL_FAST_MODEL: modelId,
                },
            },
            null,
            2
        ),
        "utf8"
    );
}

// Best-effort `claude logout` — guarantees no stored OAuth session in
// ~/.claude/ can override the settings.json env block above. Without this,
// a machine that has ever run `claude login` will silently route to real
// Anthropic auth and ignore everything ForgeX configured. Only needs to run
// once per session lifetime (first turn), not before every turn.
async function logoutBestEffort(workspacePath: string): Promise<void> {
    try {
        await new Promise<void>((resolve) => {
            const logout = spawnClaudeCode(["logout"], { cwd: workspacePath, env: process.env });
            logout.on("error", () => resolve());
            logout.on("exit", () => resolve());
        });
    } catch {
        // best-effort only
    }
}

// A single line of Claude Code's --output-format stream-json output. Not
// exhaustive — Claude Code's JSON schema has more fields than this; these
// are the ones ForgeX actually reads. Unrecognized event types are still
// forwarded to the terminal as raw JSON (see runTurn) so nothing is lost,
// just not specially parsed.
type StreamJsonEvent = {
    type?: string; // "system" | "assistant" | "user" | "result" | ...
    subtype?: string; // e.g. "init" on the first system event
    session_id?: string; // Claude Code's own session UUID — needed for --resume
    message?: {
        content?: Array<
            | { type: "text"; text: string }
            | { type: "thinking"; thinking: string; signature?: string }
            | { type: "tool_use"; name?: string; input?: unknown }
            | { type: "tool_result"; content?: unknown }
            | { type: string; [key: string]: unknown }
        >;
    };
    result?: string; // final result text on the terminal "result" event
    is_error?: boolean;
};

// Formats ONE stream-json event into zero or more labeled terminal lines.
// Nothing is silenced — thinking blocks, tool calls (with their full input),
// tool results, and system/init events are all surfaced, each with a
// bracketed label so the terminal reads as a real live feed of everything
// Claude Code is doing, not a filtered chat transcript. The one thing this
// still avoids is a literal structural duplicate: the terminal "result"
// event repeats the exact same final text that the last assistant "text"
// block already carried, so runTurn skips re-printing that one line — that
// is a dedupe of an exact repeat, not content filtering.
function formatEvent(evt: StreamJsonEvent): string[] {
    const lines: string[] = [];

    if (evt.type === "system" && evt.subtype === "init") {
        lines.push(`[init] session_id=${evt.session_id ?? "unknown"}`);
        return lines;
    }

    if (evt.type === "system" && evt.subtype === "api_retry") {
        const e = evt as any;
        lines.push(
            `[retry] attempt ${e.attempt}/${e.max_retries} (${e.error ?? "unknown error"}), retrying in ${e.retry_delay_ms}ms`
        );
        return lines;
    }

    if (evt.type === "system" && evt.subtype === "thinking_tokens") {
        // Fires once per token while the model is thinking — real signal
        // (model is alive and working), but one line per tick floods the
        // terminal. Still surfaced, just not per-event: runTurn throttles
        // these to a periodic progress line instead of dropping them.
        return ["__THINKING_TOKENS_TICK__"];
    }

    const content = evt.message?.content;
    if (Array.isArray(content)) {
        for (const block of content) {
            const b = block as any;
            if (b.type === "text" && typeof b.text === "string") {
                lines.push(b.text);
            } else if (b.type === "thinking" && typeof b.thinking === "string") {
                lines.push(`[thinking] ${b.thinking}`);
            } else if (b.type === "tool_use") {
                const name = b.name ?? "tool";
                let inputStr = "";
                try {
                    inputStr = JSON.stringify(b.input ?? {});
                } catch {
                    inputStr = String(b.input);
                }
                lines.push(`[tool_use] ${name}(${inputStr})`);
            } else if (b.type === "tool_result") {
                let resultStr = "";
                try {
                    resultStr = typeof b.content === "string" ? b.content : JSON.stringify(b.content ?? "");
                } catch {
                    resultStr = String(b.content);
                }
                lines.push(`[tool_result] ${resultStr}`);
            } else {
                // Any block type not explicitly named above still gets
                // shown, just tagged with its raw type instead of dropped.
                lines.push(`[${b.type ?? "block"}] ${JSON.stringify(b)}`);
            }
        }
    }

    if (evt.type === "result" && typeof evt.result === "string") {
        lines.push(`[result] ${evt.result}`);
    }

    return lines;
}

// Runs exactly ONE turn: spawns `claude -p "<message>" --output-format
// stream-json` (with --resume <claudeSessionId> if this isn't the first
// turn), streams parsed output live, persists the new claudeSessionId once
// seen, and resolves once the turn's process exits. This is the shared core
// used by both startSession (first turn, no --resume) and sendInput
// (follow-up turns, --resume required).
async function runTurn(
    sessionId: string,
    message: string,
    opts: { workspacePath: string; modelId: string; resumeId: string | null; isFirstTurn: boolean }
): Promise<void> {
    if (liveProcesses.has(sessionId)) {
        throw new ForgeXProcessError(
            `Session ${sessionId} already has a turn in flight — wait for it to finish before sending another`
        );
    }

    await ensureWorkspaceConfigured(opts.workspacePath, opts.modelId);
    if (opts.isFirstTurn) {
        await logoutBestEffort(opts.workspacePath);
    }

    // --permission-mode acceptEdits: without this, every file write/edit
    // Claude Code attempts blocks waiting on interactive approval — real
    // testing confirmed this exactly: a Write tool call sat retrying with
    // exponential backoff for ~10 attempts ("you haven't granted it yet")
    // before timing out, and the earlier `mkdir` "blocked" message from an
    // even earlier turn was this same root cause, not a sandbox/path issue.
    // Headless mode (-p) has no human present to click "allow," so Claude
    // Code needs an explicit non-interactive permission mode — this is the
    // officially documented fix, not a workaround.
    //
    // acceptEdits (not bypassPermissions/--dangerously-skip-permissions) is
    // the deliberate choice here: acceptEdits auto-approves file
    // reads/writes/edits only, while Bash commands and anything else still
    // go through normal gating. bypassPermissions approves everything,
    // including arbitrary shell execution, and is explicitly documented as
    // only safe "inside isolated environments like containers, VMs, or
    // devcontainers without internet access" — the opposite of ForgeX's
    // real setup (a real Windows machine, real filesystem, real network).
    // Each ForgeX session is already scoped to its own fresh workspace
    // folder, which is what makes acceptEdits an acceptable fit here: file
    // operations are contained to that directory, without also handing a
    // local model unrestricted shell access on the host machine.
    const args = [
        "-p",
        message,
        "--output-format",
        "stream-json",
        "--verbose",
        "--permission-mode",
        "acceptEdits",
    ];
    if (opts.resumeId) {
        args.push("--resume", opts.resumeId);
    }

    await db.updateSessionStatus(sessionId, "running");
    emitStatus(sessionId, "running");
    await emitLine(
        sessionId,
        "system",
        opts.isFirstTurn
            ? `Starting Claude Code (model: ${opts.modelId})...`
            : `Resuming Claude Code session...`
    );

    let proc: ChildProcess;
    try {
        proc = spawnClaudeCode(args, { cwd: opts.workspacePath, env: process.env });
    } catch (err) {
        console.error(`[FORGEX][PROC] failed to spawn claude for ${sessionId}:`, err);
        await db.updateSessionStatus(sessionId, "failed");
        emitStatus(sessionId, "failed");
        await emitLine(sessionId, "system", `Failed to start Claude Code: ${String(err)}`);
        throw new ForgeXProcessError(String(err));
    }

    liveProcesses.set(sessionId, proc);
    await db.updateSessionStatus(sessionId, "running", { pid: proc.pid ?? null });

    // Soft heartbeat note only — NOT a kill/failure timer. A turn doing real
    // tool use (multi-file edits, running tests) can legitimately take
    // longer than this without being stuck. See constants.ts.
    let sawFirstOutput = false;
    const heartbeatTimer = setTimeout(async () => {
        if (!sawFirstOutput && liveProcesses.has(sessionId)) {
            await emitLine(
                sessionId,
                "system",
                `Still waiting on Claude Code after ${PROCESS_STARTUP_TIMEOUT_MS / 1000}s. ` +
                    `If this persists, the selected Ollama model may not speak Claude Code's ` +
                    `expected protocol (Anthropic Messages API) — check your Ollama version ` +
                    `supports this, or that a translation proxy is running if it doesn't.`
            );
        }
    }, PROCESS_STARTUP_TIMEOUT_MS);

    let stdoutBuf = "";
    let capturedClaudeSessionId: string | null = opts.resumeId;
    let lastAssistantText: string | null = null;
    let thinkingTickCount = 0;
    const THINKING_TICK_EMIT_EVERY = 25; // ~1 line per 25 thinking-token events instead of 1:1

    proc.stdout!.on("data", (chunk: Buffer) => {
        sawFirstOutput = true;
        stdoutBuf += chunk.toString("utf8");
        let newlineIdx: number;
        while ((newlineIdx = stdoutBuf.indexOf("\n")) !== -1) {
            const rawLine = stdoutBuf.slice(0, newlineIdx).trim();
            stdoutBuf = stdoutBuf.slice(newlineIdx + 1);
            if (!rawLine) continue;

            let evt: StreamJsonEvent | null = null;
            try {
                evt = JSON.parse(rawLine);
            } catch {
                // Not a JSON line (shouldn't normally happen with
                // --output-format stream-json, but don't drop it silently).
                void emitLine(sessionId, "stdout", rawLine);
                continue;
            }

            if (evt?.session_id && !capturedClaudeSessionId) {
                capturedClaudeSessionId = evt.session_id;
                void db.updateSessionStatus(sessionId, "running", { claudeSessionId: evt.session_id });
            }

            if (evt?.type === "result" && typeof evt.result === "string" && evt.result === lastAssistantText) {
                // Exact structural repeat of the final assistant text block
                // — skip only this one duplicate line, nothing else.
                continue;
            }

            const formatted = formatEvent(evt!);
            if (formatted.length === 1 && formatted[0] === "__THINKING_TOKENS_TICK__") {
                thinkingTickCount++;
                if (thinkingTickCount % THINKING_TICK_EMIT_EVERY === 0) {
                    const est = (evt as any)?.estimated_tokens;
                    void emitLine(sessionId, "stdout", `[thinking] ...still generating (~${est ?? thinkingTickCount} tokens so far)`);
                }
            } else if (formatted.length > 0) {
                for (const line of formatted) void emitLine(sessionId, "stdout", line);
                const content = evt?.message?.content;
                if (evt?.type === "assistant" && Array.isArray(content)) {
                    const textBlock = content.find((b: any) => b.type === "text");
                    if (textBlock) lastAssistantText = (textBlock as any).text;
                }
            } else {
                // Truly nothing recognized in this event at all (rare) —
                // still forward the raw JSON so nothing silently vanishes.
                void emitLine(sessionId, "stdout", rawLine);
            }
        }
    });

    proc.stderr!.on("data", (chunk: Buffer) => {
        sawFirstOutput = true;
        void emitLine(sessionId, "stderr", chunk.toString("utf8"));
    });

    await new Promise<void>((resolve) => {
        proc.on("error", async (err) => {
            console.error(`[FORGEX][PROC] process error for session ${sessionId}:`, err);
            clearTimeout(heartbeatTimer);
            liveProcesses.delete(sessionId);
            await db.updateSessionStatus(sessionId, "failed");
            emitStatus(sessionId, "failed");
            await emitLine(sessionId, "system", `Process error: ${String(err)}`);
            resolve();
        });

        proc.on("exit", async (code) => {
            clearTimeout(heartbeatTimer);
            liveProcesses.delete(sessionId);
            console.log(`[FORGEX][PROC] session ${sessionId} turn exited with code ${code}`);

            // A clean (or even nonzero-but-ran) turn leaves the CONVERSATION
            // alive and resumable — "idle", not "exited". "exited" is
            // reserved for the user explicitly stopping the session (see
            // stopSession). Only a turn that produced no claudeSessionId at
            // all (never even got a valid stream-json init event) counts as
            // a real failure to start.
            if (!capturedClaudeSessionId) {
                await db.updateSessionStatus(sessionId, "failed", { exitCode: code });
                emitStatus(sessionId, "failed");
                await emitLine(
                    sessionId,
                    "system",
                    `Claude Code exited (code ${code ?? "unknown"}) without starting a session — check the model/Ollama connection above.`
                );
            } else {
                await db.updateSessionStatus(sessionId, "idle", {
                    exitCode: code,
                    claudeSessionId: capturedClaudeSessionId,
                });
                emitStatus(sessionId, "idle");
                await emitLine(sessionId, "system", `Turn complete. Send a follow-up to continue.`);
            }
            resolve();
        });
    });
}

// Launches the FIRST turn for a new session (no --resume — there is no
// claudeSessionId yet). Fire-and-forget from the router's perspective; this
// resolves once that one turn's process exits, not when the whole
// conversation "ends" (there is no such moment in headless mode — the
// conversation stays resumable until the user stops it).
export async function startSession(
    sessionId: string,
    goal: string,
    modelId: string,
    workspacePath: string
): Promise<void> {
    await runTurn(sessionId, goal, {
        workspacePath,
        modelId,
        resumeId: null,
        isFirstTurn: true,
    });
}

// Starts a NEW turn (`--resume <claudeSessionId>`) for a session that has
// already completed at least one turn. This replaces the old "write to a
// live process's stdin" model entirely — there is no live process between
// turns in headless mode, so a follow-up genuinely means spawning again.
export async function sendInput(sessionId: string, text: string): Promise<void> {
    const session = await db.getSession(sessionId);
    if (!session) {
        throw new ForgeXProcessError(`Session ${sessionId} not found`);
    }
    if (!session.claudeSessionId) {
        throw new ForgeXProcessError(
            `Session ${sessionId} has no claudeSessionId yet — the first turn may still be running or failed to start`
        );
    }
    if (liveProcesses.has(sessionId)) {
        throw new ForgeXProcessError(
            `Session ${sessionId} already has a turn in flight — wait for it to finish before sending another`
        );
    }

    await emitLine(sessionId, "system", `> ${text}`);
    await runTurn(sessionId, text, {
        workspacePath: session.workspacePath,
        modelId: session.modelId,
        resumeId: session.claudeSessionId,
        isFirstTurn: false,
    });
}

// Stop is now purely about the IN-FLIGHT turn's process (if any) plus
// marking the session as no-longer-continuable. Since headless mode has no
// long-lived process to kill between turns, "stop" mostly means "mark this
// session exited so the UI won't offer follow-ups anymore" — but if a turn
// happens to be running right now, kill it too.
export async function stopSession(sessionId: string): Promise<void> {
    const proc = liveProcesses.get(sessionId);
    if (proc) {
        console.log(`[FORGEX][PROC] stopping in-flight turn for session ${sessionId}`);
        proc.kill("SIGTERM");
        setTimeout(() => {
            if (liveProcesses.has(sessionId)) {
                console.warn(`[FORGEX][PROC] session ${sessionId} did not exit after SIGTERM, sending SIGKILL`);
                proc.kill("SIGKILL");
            }
        }, 5000);
    }
    await db.updateSessionStatus(sessionId, "exited");
    emitStatus(sessionId, "exited");
    await emitLine(sessionId, "system", `Session stopped by user.`);
}