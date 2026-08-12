// ─────────────────────────────────────────────────────────────────────────────
// forge/execWorker.ts
//
// THE SAFETY-CRITICAL FILE. Every byte the agent writes to disk and every
// subprocess it spawns goes through here, and nowhere else. Two guards:
//
//   1. resolveSafePath  — no file operation may escape the session's own
//                         workspace directory (FORGE_ROOT/{sessionId}).
//   2. validateCommand  — no destructive command pattern, no `..` traversal,
//                         no absolute path outside FORGE_ROOT inside a command.
//
// Every operation logs to forge_iterations via db.logIteration internally —
// no caller is ever allowed to skip the log.
// ─────────────────────────────────────────────────────────────────────────────

import path from "path";
import fs from "fs/promises";
import { exec } from "child_process";
import { FORGE_ROOT, DEFAULT_COMMAND_TIMEOUT_MS } from "./constants";
import * as db from "./db";

export class ForgePathViolation extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ForgePathViolation";
    }
}

export class ForgeCommandViolation extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ForgeCommandViolation";
    }
}

// Resolves a model-supplied relative path against the session workspace and
// throws if the result escapes it — `..`, absolute paths, symlink-ish tricks
// via normalization all end up caught by the prefix check on the RESOLVED
// path, not on the raw input string.
export function resolveSafePath(
    sessionId: string,
    relativePath: string
): string {
    const sessionRoot = path.join(FORGE_ROOT, sessionId);
    const resolved = path.resolve(sessionRoot, relativePath);
    if (!resolved.startsWith(sessionRoot + path.sep) && resolved !== sessionRoot) {
        throw new ForgePathViolation(`Path escapes workspace: ${relativePath}`);
    }
    return resolved;
}

// Destructive / escaping command patterns. Deliberately blunt — a false
// positive costs one retry iteration; a false negative costs the disk.
const BLOCKED_COMMAND_PATTERNS: { pattern: RegExp; reason: string }[] = [
    { pattern: /\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)[a-z]*\b/i, reason: "rm -rf" },
    { pattern: /\brmdir\s+\/s\b/i, reason: "rmdir /s" },
    { pattern: /\bdel\s+\/s\b/i, reason: "del /s" },
    { pattern: /\bformat\b/i, reason: "format" },
    { pattern: /\bmkfs\b/i, reason: "mkfs" },
    { pattern: /\.\./, reason: "'..' path traversal" },
    { pattern: /\bshutdown\b/i, reason: "shutdown" },
    { pattern: /\breg(\.exe)?\s+(add|delete)\b/i, reason: "registry write" },
];

// Absolute path references (C:\..., D:\..., /usr/...) are only allowed if
// they point inside FORGE_ROOT — anything else is the model trying to touch
// the host machine.
// The (?<![\w.]) guards keep URL schemes ("http://...") and dotted names from
// false-matching as drive-letter paths.
const ABSOLUTE_PATH_PATTERN = /(?:(?<![\w.])[A-Za-z]:[\\/]|(?<![\w.])\/(?:usr|etc|home|var|bin|windows|program files)\b)[^\s"']*/gi;

export function validateCommand(cmd: string): void {
    for (const { pattern, reason } of BLOCKED_COMMAND_PATTERNS) {
        if (pattern.test(cmd)) {
            throw new ForgeCommandViolation(
                `Command blocked (${reason}): ${cmd}`
            );
        }
    }

    const absoluteRefs = cmd.match(ABSOLUTE_PATH_PATTERN) ?? [];
    for (const ref of absoluteRefs) {
        const normalized = path.normalize(ref);
        if (!normalized.toLowerCase().startsWith(FORGE_ROOT.toLowerCase())) {
            throw new ForgeCommandViolation(
                `Command references absolute path outside FORGE_ROOT: ${ref}`
            );
        }
    }
}

export type CommandResult = {
    stdout: string;
    stderr: string;
    exitCode: number;
    timedOut: boolean;
};

// Spawns via child_process.exec with cwd FORCED to the session workspace —
// a `cd` inside `cmd` is never trusted as the working directory. Timeout via
// AbortController, matching toolRouter.ts's stage1YesNoGate pattern.
export async function runCommand(
    sessionId: string,
    cmd: string,
    timeoutMs: number = DEFAULT_COMMAND_TIMEOUT_MS
): Promise<CommandResult> {
    validateCommand(cmd);
    const cwd = resolveSafePath(sessionId, ".");

    console.log("[FORGE][EXEC] run_command:", cmd);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const result = await new Promise<CommandResult>((resolve) => {
        exec(
            cmd,
            {
                cwd,
                signal: controller.signal,
                maxBuffer: 10 * 1024 * 1024,
            },
            (error, stdout, stderr) => {
                const timedOut =
                    error !== null && (error as any).code === "ABORT_ERR";
                resolve({
                    stdout: String(stdout ?? ""),
                    stderr: String(stderr ?? ""),
                    exitCode: timedOut
                        ? -1
                        : error && typeof (error as any).code === "number"
                          ? (error as any).code
                          : error
                            ? 1
                            : 0,
                    timedOut,
                });
            }
        );
    }).finally(() => clearTimeout(timeoutId));

    await db.logIteration(
        sessionId,
        currentTaskId(sessionId),
        "act",
        JSON.stringify({ type: "run_command", cmd, timeoutMs }),
        JSON.stringify(result)
    );

    return result;
}

// ── Task attribution for ACT logs ─────────────────────────────────────────────
// execWorker logs every ACT itself, but it doesn't naturally know which task
// is running — agentLoop tells it before dispatching. A plain module-level
// map (sessionId -> taskId) is enough because each session's drive loop runs
// one iteration at a time by design.
const activeTaskBySession = new Map<string, string>();

export function setActiveTask(sessionId: string, taskId: string): void {
    activeTaskBySession.set(sessionId, taskId);
}

function currentTaskId(sessionId: string): string {
    return activeTaskBySession.get(sessionId) ?? "unattributed";
}

// ── File operations ───────────────────────────────────────────────────────────

export async function writeFile(
    sessionId: string,
    relPath: string,
    content: string
): Promise<void> {
    const target = resolveSafePath(sessionId, relPath);
    console.log("[FORGE][EXEC] write_file:", relPath, `(${content.length} chars)`);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, "utf8");
    await db.logIteration(
        sessionId,
        currentTaskId(sessionId),
        "act",
        JSON.stringify({ type: "write_file", path: relPath }),
        JSON.stringify({ ok: true, bytes: Buffer.byteLength(content, "utf8") })
    );
}

export async function readFile(
    sessionId: string,
    relPath: string
): Promise<string> {
    const target = resolveSafePath(sessionId, relPath);
    console.log("[FORGE][EXEC] read_file:", relPath);
    const content = await fs.readFile(target, "utf8");
    await db.logIteration(
        sessionId,
        currentTaskId(sessionId),
        "act",
        JSON.stringify({ type: "read_file", path: relPath }),
        JSON.stringify({ ok: true, bytes: Buffer.byteLength(content, "utf8") })
    );
    return content;
}

export async function deleteFile(
    sessionId: string,
    relPath: string
): Promise<void> {
    const target = resolveSafePath(sessionId, relPath);
    console.log("[FORGE][EXEC] delete_file:", relPath);
    await fs.unlink(target);
    await db.logIteration(
        sessionId,
        currentTaskId(sessionId),
        "act",
        JSON.stringify({ type: "delete_file", path: relPath }),
        JSON.stringify({ ok: true })
    );
}

export async function listDir(
    sessionId: string,
    relPath: string
): Promise<string[]> {
    const target = resolveSafePath(sessionId, relPath);
    console.log("[FORGE][EXEC] list_dir:", relPath);
    const entries = await fs.readdir(target, { withFileTypes: true });
    const listing = entries.map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
    await db.logIteration(
        sessionId,
        currentTaskId(sessionId),
        "act",
        JSON.stringify({ type: "list_dir", path: relPath }),
        JSON.stringify({ ok: true, entries: listing })
    );
    return listing;
}
