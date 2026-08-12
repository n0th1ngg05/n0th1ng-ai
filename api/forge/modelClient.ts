// ─────────────────────────────────────────────────────────────────────────────
// forge/modelClient.ts
//
// Thin fetch() wrapper around Ollama's /api/generate, matching the shape of
// toolRouter.ts's stage1YesNoGate: same endpoint, same AbortController
// timeout pattern, same fail-safe philosophy. The one deliberate difference:
// the yes/no gate fails safe to `true` because it HAS a safe default — here
// there is no safe default action, so failures throw a typed ForgeModelError
// and the agent loop marks the current task blocked rather than crashing the
// whole session.
// ─────────────────────────────────────────────────────────────────────────────

import {
    FORGE_MODEL,
    OLLAMA_GENERATE_URL,
    DEFAULT_MODEL_TIMEOUT_MS,
} from "./constants";

export class ForgeModelError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ForgeModelError";
    }
}

// In-memory only — tracks "is a model call currently in flight for this
// session right now," so the UI can show a live "thinking..." state DURING a
// call, not just after it completes and gets logged as an iteration. This is
// exactly what was missing when a call hangs or times out: previously the
// live tail showed nothing at all until the call either finished or crashed,
// which made it impossible to tell "is it working" from "is it stuck."
// Deliberately not persisted to SQL — it's a live signal, not a durable
// record; the durable record is the logged iteration itself once the call
// resolves.
const inFlightCalls = new Map<string, { modelId: string; promptPreview: string; startedAt: Date }>();

export function getInFlightCall(sessionId: string) {
    return inFlightCalls.get(sessionId) ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Live token streaming (for the Raw Model Activity panel)
//
// callForgeModel itself still returns one complete string once the model is
// done — the agent loop needs the FULL response before it can parse it into
// an AgentAction/EvaluationResult, so that contract never changes. What's new
// is a PARALLEL live channel: as Ollama streams tokens back (stream: true),
// each token is pushed into a per-session ring buffer AND broadcast to any
// active SSE subscribers immediately, before the call has even finished. The
// browser gets real tokens as they're generated; the agent loop still gets
// the same blocking final string it always has. Two consumers of the same
// underlying stream, no change to the parsing contract.
// ─────────────────────────────────────────────────────────────────────────────

type TokenListener = (token: string) => void;
const tokenListeners = new Map<string, Set<TokenListener>>();

// Ring buffer per session so a browser tab that (re)connects mid-generation
// can immediately backfill everything streamed so far, instead of only
// seeing tokens from the moment it happened to connect.
const TOKEN_BUFFER_MAX_CHARS = 20_000;
const tokenBuffers = new Map<string, string>();

export function subscribeToTokens(sessionId: string, listener: TokenListener): () => void {
    if (!tokenListeners.has(sessionId)) tokenListeners.set(sessionId, new Set());
    tokenListeners.get(sessionId)!.add(listener);
    return () => {
        tokenListeners.get(sessionId)?.delete(listener);
    };
}

export function getTokenBuffer(sessionId: string): string {
    return tokenBuffers.get(sessionId) ?? "";
}

function emitToken(sessionId: string, token: string) {
    const buf = (tokenBuffers.get(sessionId) ?? "") + token;
    tokenBuffers.set(
        sessionId,
        buf.length > TOKEN_BUFFER_MAX_CHARS ? buf.slice(-TOKEN_BUFFER_MAX_CHARS) : buf
    );
    for (const listener of tokenListeners.get(sessionId) ?? []) {
        try {
            listener(token);
        } catch (err) {
            console.error("[FORGE][MODEL] token listener threw:", err);
        }
    }
}

// Clears the buffer for a fresh call — called at the start of every
// callForgeModel so the panel doesn't show the PREVIOUS call's leftover text
// stitched onto the new one.
function resetTokenBuffer(sessionId: string) {
    tokenBuffers.set(sessionId, "");
}

export async function callForgeModel(
    prompt: string,
    options?: { modelId?: string; temperature?: number; timeoutMs?: number; sessionId?: string }
): Promise<string> {
    const timeoutMs = options?.timeoutMs ?? DEFAULT_MODEL_TIMEOUT_MS;
    const modelId = options?.modelId ?? FORGE_MODEL;
    const sessionId = options?.sessionId;

    if (sessionId) {
        inFlightCalls.set(sessionId, {
            modelId,
            promptPreview: prompt.slice(0, 300),
            startedAt: new Date(),
        });
        resetTokenBuffer(sessionId);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;

    try {
        response = await fetch(OLLAMA_GENERATE_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                model: modelId,
                prompt,
                stream: true,
                options: { temperature: options?.temperature ?? 0.2 },
            }),
            signal: controller.signal,
        });
    } catch (err) {
        const isAbort = err instanceof Error && err.name === "AbortError";
        console.error(
            isAbort
                ? `[FORGE][MODEL] generate timed out after ${timeoutMs}ms`
                : "[FORGE][MODEL] generate fetch failed:",
            err
        );
        clearTimeout(timeoutId);
        if (sessionId) inFlightCalls.delete(sessionId);
        throw new ForgeModelError(
            isAbort
                ? `Model call timed out after ${timeoutMs}ms`
                : `Model call failed: ${String(err)}`
        );
    }

    if (!response.ok) {
        clearTimeout(timeoutId);
        if (sessionId) inFlightCalls.delete(sessionId);
        const errText = await response.text().catch(() => "");
        console.error(`[FORGE][MODEL] generate returned ${response.status}:`, errText);
        throw new ForgeModelError(
            `Model backend returned ${response.status}: ${errText}`
        );
    }

    if (!response.body) {
        clearTimeout(timeoutId);
        if (sessionId) inFlightCalls.delete(sessionId);
        throw new ForgeModelError("Model backend returned no response body to stream");
    }

    // Ollama's stream: true returns newline-delimited JSON objects, each with
    // a `response` fragment (the next token(s)) and a `done` boolean on the
    // final line. We read the raw bytes, split on newlines, parse each line,
    // emit the token fragment live, and concatenate into the same full string
    // this function has always returned.
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let full = "";
    let lineBuffer = "";

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            lineBuffer += decoder.decode(value, { stream: true });
            const lines = lineBuffer.split("\n");
            lineBuffer = lines.pop() ?? ""; // last element may be an incomplete line

            for (const line of lines) {
                if (!line.trim()) continue;
                let parsed: { response?: string; done?: boolean };
                try {
                    parsed = JSON.parse(line);
                } catch {
                    continue; // skip any malformed line rather than aborting the whole stream
                }
                if (typeof parsed.response === "string" && parsed.response.length > 0) {
                    full += parsed.response;
                    if (sessionId) emitToken(sessionId, parsed.response);
                }
            }
        }
        // Flush any trailing partial line still in the decoder/buffer.
        if (lineBuffer.trim()) {
            try {
                const parsed = JSON.parse(lineBuffer);
                if (typeof parsed.response === "string" && parsed.response.length > 0) {
                    full += parsed.response;
                    if (sessionId) emitToken(sessionId, parsed.response);
                }
            } catch {
                // Incomplete trailing chunk — nothing more we can do with it.
            }
        }
    } catch (err) {
        console.error("[FORGE][MODEL] error while reading stream:", err);
        throw new ForgeModelError(`Model stream read failed: ${String(err)}`);
    } finally {
        clearTimeout(timeoutId);
        if (sessionId) inFlightCalls.delete(sessionId);
    }

    if (!full.trim()) {
        console.error("[FORGE][MODEL] empty response from model");
        throw new ForgeModelError("Model returned an empty response");
    }

    return full;
}

// Models routinely wrap JSON in ```json fences or prepend prose. This strips
// down to the first balanced JSON object/array so callers can JSON.parse it.
// Throws ForgeModelError (not SyntaxError) so the agent loop's blocked-path
// handling stays uniform.
export function extractJson<T>(raw: string): T {
    let text = raw.trim();

    // Reasoning models (anything emitting a <think>...</think> block before
    // its real answer) routinely describe the plan IN PROSE inside that
    // block — including JSON-shaped fragments like `"dependsOn": []` while
    // talking through the structure before ever writing the real answer.
    // text.search(/[[{]/) below finds the FIRST bracket in the whole string,
    // so without stripping this block first, the brace-matcher locks onto a
    // bracket inside the reasoning narrative and returns garbage (or a
    // wrong-but-valid-looking fragment) instead of the actual answer that
    // follows. Strip everything up to and including </think> before doing
    // anything else. Only the LAST </think> tag counts, in case the
    // reasoning itself contains the literal string "</think>" while
    // discussing it (rare, but cheap to guard against).
    const thinkEnd = text.lastIndexOf("</think>");
    if (thinkEnd !== -1) {
        text = text.slice(thinkEnd + "</think>".length).trim();
    }

    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) text = fenced[1].trim();

    const start = text.search(/[[{]/);
    if (start === -1) {
        throw new ForgeModelError(`No JSON found in model output: ${raw.slice(0, 200)}`);
    }

    const open = text[start];
    const close = open === "{" ? "}" : "]";
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < text.length; i++) {
        const ch = text[i];
        if (inString) {
            if (escaped) escaped = false;
            else if (ch === "\\") escaped = true;
            else if (ch === '"') inString = false;
            continue;
        }
        if (ch === '"') inString = true;
        else if (ch === open) depth++;
        else if (ch === close) {
            depth--;
            if (depth === 0) {
                const candidate = text.slice(start, i + 1);
                try {
                    return JSON.parse(candidate) as T;
                } catch (err) {
                    throw new ForgeModelError(
                        `Model output looked like JSON but failed to parse: ${String(err)}`
                    );
                }
            }
        }
    }

    throw new ForgeModelError(`Unbalanced JSON in model output: ${raw.slice(0, 200)}`);
}