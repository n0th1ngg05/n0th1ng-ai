// ─────────────────────────────────────────────────────────────────────────────
// forge/routes.ts
//
// Plain Hono sub-router for The Forge's streaming needs, mounted in boot.ts
// via app.route("/api/forge", forgeStreamRouter). Follows the SSE pattern of
// services/analyzeStream.ts — tRPC subscriptions aren't used anywhere in this
// codebase, so we stay consistent with the existing paradigm instead of
// introducing a new one.
//
// GET /api/forge/:sessionId/stream — live tail of forge_iterations. Every
// THINK and EVALUATE row is pushed (full verbosity, not just terminal
// outcomes) including the first-class `reasoning` string, so the UI can show
// what the agent is "thinking", not only what it did. The UI is responsible
// for collapsing/expanding per-task detail; the stream does not pre-filter.
// ─────────────────────────────────────────────────────────────────────────────

import { Hono } from "hono";
import * as db from "./db";
import { getInFlightCall, subscribeToTokens, getTokenBuffer } from "./modelClient";

const forgeStreamRouter = new Hono();

const POLL_INTERVAL_MS = 1_000;

// Extracts the reasoning string from a logged iteration's output JSON so it
// rides alongside phase/taskId at the top level of every event — the UI never
// has to re-parse model output to find it.
function extractReasoning(output: string): string {
    try {
        const parsed = JSON.parse(output);
        if (typeof parsed?.reasoning === "string") return parsed.reasoning;
    } catch {
        // Raw non-JSON output (shouldn't happen, but never break the tail).
    }
    return "";
}

forgeStreamRouter.get("/:sessionId/stream", async (c) => {
    const sessionId = c.req.param("sessionId");

    const session = await db.getSession(sessionId);
    if (!session) {
        return c.json({ success: false, error: "Session not found." }, 404);
    }

    console.log(`[FORGE][STREAM] live tail opened for session ${sessionId}`);

    const stream = new ReadableStream({
        async start(controller) {
            const encoder = new TextEncoder();
            const send = (event: string, data: any) => {
                controller.enqueue(
                    encoder.encode(
                        `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
                    )
                );
            };

            // Cursor: last-seen timestamp plus a sent-id set for dedupe,
            // because MySQL timestamps have 1s resolution and the poll uses
            // >= (see db.getIterationsSince).
            let lastTimestamp: Date | null = null;
            const sentIds = new Set<string>();
            let closed = false;

            // ── True token streaming, event-driven, NOT part of the 1s poll ──
            // Whatever's already accumulated in the ring buffer (this tab
            // connected mid-generation) gets sent once immediately, then every
            // NEW token pushes the instant modelClient.ts receives it from
            // Ollama — no polling delay, no batching. This is the actual
            // real-time channel the raw activity panel now uses; the
            // "iteration"/"status" events below remain on the 1s poll since
            // those are cheap DB reads and don't need sub-second latency.
            const bufferedSoFar = getTokenBuffer(sessionId);
            if (bufferedSoFar) {
                send("token", { text: bufferedSoFar, backfill: true });
            }
            const unsubscribe = subscribeToTokens(sessionId, (token) => {
                if (closed) return;
                send("token", { text: token, backfill: false });
            });

            c.req.raw.signal.addEventListener("abort", () => {
                closed = true;
                unsubscribe();
            });

            try {
                while (!closed) {
                    const rows = await db.getIterationsSince(
                        sessionId,
                        lastTimestamp
                    );

                    for (const it of rows) {
                        if (sentIds.has(it.id)) continue;
                        sentIds.add(it.id);
                        lastTimestamp = it.timestamp;

                        send("iteration", {
                            id: it.id,
                            taskId: it.taskId,
                            phase: it.phase,
                            reasoning: extractReasoning(it.output),
                            output: it.output,
                            timestamp: it.timestamp.toISOString(),
                        });
                    }

                    // Status ride-along so the UI can stop tailing when the
                    // session leaves 'running'/'planning' without a second poll.
                    const current = await db.getSession(sessionId);
                    if (!current) break;
                    send("status", {
                        status: current.status,
                        iterationCount: current.iterationCount,
                    });

                    // In-flight signal — is a model call actively happening
                    // RIGHT NOW for this session, distinct from the completed
                    // iterations above. This is what lets the raw thinking
                    // panel show "generating..." during a long/hung call
                    // instead of showing nothing until it finishes or crashes.
                    const inFlight = getInFlightCall(sessionId);
                    send("raw_activity", {
                        active: inFlight !== null,
                        modelId: inFlight?.modelId ?? null,
                        promptPreview: inFlight?.promptPreview ?? null,
                        startedAt: inFlight?.startedAt?.toISOString() ?? null,
                    });

                    if (
                        current.status === "done" ||
                        current.status === "failed" ||
                        current.status === "blocked"
                    ) {
                        console.log(
                            `[FORGE][STREAM] session ${sessionId} reached '${current.status}' — closing tail`
                        );
                        break;
                    }

                    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
                }
            } catch (err) {
                console.error(`[FORGE][STREAM] tail failed for ${sessionId}:`, err);
                send("error", { error: String(err) });
            } finally {
                unsubscribe();
                try {
                    controller.close();
                } catch {
                    // Already closed by the client — nothing to do.
                }
            }
        },
    });

    return new Response(stream, {
        headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
        },
    });
});

export { forgeStreamRouter };
export default forgeStreamRouter;