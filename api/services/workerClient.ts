// api/services/workerClient.ts
//
// Remote execution client for the distributed cluster.
//
// ROUTING
// ───────
// Workers can be reached two ways:
//
//   LAN (default): http://<worker.ip>:<worker.port>/...
//     Used when the worker is on the same local network as the master.
//     No auth header needed — LAN is trusted.
//
//   Internet (Cloudflare tunnel): <worker.internetUrl>/...
//     Used when the worker has registered with an internetUrl (e.g.
//     https://worker.nothingstudios.co.in). All requests must include
//     Authorization: Bearer <worker.apiKey> so the exposure service's
//     security proxy accepts them.
//
// FILE EMBEDDING
// ─────────────
// Vision and PDF tools reference files by an absolute path that exists on the
// Master's filesystem. A remote Worker is a separate machine — it cannot open
// that path. Before sending, we read the file from disk and embed its bytes as
// a base64 string (`image_data` / `pdf_data`) alongside the original filename.
// The Worker's Python runtime decodes the base64 into a local temp file,
// processes it, then deletes the temp file.
//
// The local path argument (`image_path` / `pdf_path`) is stripped from the
// payload so the Worker never attempts to open a nonexistent path.

import type { ToolCall } from "./toolSelector";
import type { ExecutionResult } from "./toolExecutor";
import type { Worker } from "./cluster";
import fs from "fs/promises";
import path from "path";

const REQUEST_TIMEOUT = 30000;

// ── File-bearing tools ────────────────────────────────────────────────────────
// Maps: tool name → { localPathArg, remoteDataArg, remoteFilenameArg }

const FILE_ARG_MAP: Record<string, {
    pathArg: string;
    dataArg: string;
    filenameArg: string;
}> = {
    local_vision_ocr:      { pathArg: "image_path", dataArg: "image_data", filenameArg: "image_filename" },
    layout_analyzer:       { pathArg: "image_path", dataArg: "image_data", filenameArg: "image_filename" },
    local_vision_analyzer: { pathArg: "image_path", dataArg: "image_data", filenameArg: "image_filename" },
    marker_pdf_pipeline:   { pathArg: "pdf_path",   dataArg: "pdf_data",   filenameArg: "pdf_filename"   },
};

/**
 * Returns the base URL and auth headers to use when talking to this worker.
 * Uses the Cloudflare internet tunnel if the worker registered with one,
 * otherwise falls back to the direct LAN ip:port.
 */
function workerTarget(worker: Worker): { baseUrl: string; authHeaders: Record<string, string> } {
    if (worker.internetUrl && worker.apiKey) {
        return {
            baseUrl: worker.internetUrl.replace(/\/$/, ""),
            authHeaders: { Authorization: `Bearer ${worker.apiKey}` },
        };
    }
    return {
        baseUrl: `http://${worker.ip}:${worker.port}`,
        authHeaders: {},
    };
}

/**
 * For tools that operate on a local file, read that file off disk and inject
 * its bytes as base64 into the toolCall arguments.  The original path argument
 * is removed so the Worker never sees a path it cannot open.
 *
 * Returns a shallow-cloned ToolCall with the augmented arguments, or the
 * original ToolCall unchanged if the tool doesn't require a file.
 */
async function injectFileData(toolCall: ToolCall): Promise<ToolCall> {

    const mapping = FILE_ARG_MAP[toolCall.tool];
    if (!mapping) return toolCall;

    const { pathArg, dataArg, filenameArg } = mapping;
    const filePath = toolCall.arguments?.[pathArg];

    if (!filePath) {
        // No path present — validation already caught this upstream; pass through.
        return toolCall;
    }

    const absPath = path.isAbsolute(filePath)
        ? filePath
        : path.join(process.cwd(), filePath);

    console.log(`[CLUSTER] Reading file for remote embed: ${absPath}`);

    let fileBytes: Buffer;

    try {
        fileBytes = await fs.readFile(absPath);
    } catch (err: any) {
        // Surface the error as a failed result rather than crashing the caller.
        console.error(`[CLUSTER] Failed to read file for remote tool '${toolCall.tool}':`, err);
        throw new Error(`Master could not read file for remote execution: ${err?.message ?? String(err)}`);
    }

    const base64 = fileBytes.toString("base64");
    const filename = path.basename(absPath);

    // Clone arguments: inject data + filename, strip the local path.
    const newArgs = { ...(toolCall.arguments ?? {}) };
    delete newArgs[pathArg];
    newArgs[dataArg]     = base64;
    newArgs[filenameArg] = filename;

    console.log(`[CLUSTER] File embedded: ${filename} (${(fileBytes.length / 1024).toFixed(1)} KB → base64)`);

    return { ...toolCall, arguments: newArgs };

}

export async function executeRemote(
    worker: Worker,
    toolCall: ToolCall
): Promise<ExecutionResult> {

    const { baseUrl, authHeaders } = workerTarget(worker);
    const url = `${baseUrl}/execute`;
    const via = worker.internetUrl ? "internet (Cloudflare)" : "LAN";

    console.log("========================================");
    console.log("[CLUSTER] Remote Execution");
    console.log("Worker :", worker.hostname);
    console.log("Via    :", via);
    console.log("URL    :", url);
    console.log("Tool   :", toolCall.tool);
    console.log("========================================");

    // Embed file bytes as base64 for tools that need a local file.
    // Must happen before JSON.stringify — the Worker cannot open the Master's path.
    let preparedCall: ToolCall;
    try {
        preparedCall = await injectFileData(toolCall);
    } catch (err: any) {
        return { success: false, error: err?.message ?? "File read failed before remote dispatch." };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    try {

        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...authHeaders,
            },
            body: JSON.stringify(preparedCall),
            signal: controller.signal,
        });

        if (!response.ok) {
            const message = await response.text().catch(() => "");
            return {
                success: false,
                error: message || `HTTP ${response.status}`,
            };
        }

        const result = await response.json();

        if (
            typeof result !== "object" ||
            result === null ||
            typeof result.success !== "boolean"
        ) {
            return {
                success: false,
                error: "Worker returned an invalid response.",
            };
        }

        return result as ExecutionResult;

    } catch (err: any) {

        return {
            success: false,
            error: err?.message ?? "Worker unreachable",
        };

    } finally {

        clearTimeout(timeout);

    }

}

export async function pingWorker(
    worker: Worker
): Promise<boolean> {

    const { baseUrl, authHeaders } = workerTarget(worker);
    const url = `${baseUrl}/ping`;

    try {

        console.log(`[CLUSTER] Pinging ${worker.hostname} (${url})`);

        const response = await fetch(url, { headers: authHeaders });

        console.log("[CLUSTER] Ping Status:", response.status);

        return response.ok;

    } catch (err) {

        console.error("[CLUSTER] Ping Failed:", err);

        return false;

    }

}