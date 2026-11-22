// ─────────────────────────────────────────────────────────────────────────────
// forgex/routes.ts
//
// Plain Hono sub-router for ForgeX's streaming needs, mounted in boot.ts via
// app.route("/api/forgex", forgexStreamRouter). Same SSE paradigm as
// forge/routes.ts, but event-driven rather than polled — subprocess stdout/
// stderr arrives as real events (processManager.subscribeToOutput), not rows
// to poll for, so there's no equivalent of forge/routes.ts's POLL_INTERVAL_MS
// here at all.
//
// GET /api/forgex/:sessionId/stream — live tail of Claude Code's raw output.
// ─────────────────────────────────────────────────────────────────────────────

import { Hono } from "hono";
import * as db from "./db";
import * as processManager from "./processManager";

const forgexStreamRouter = new Hono();

forgexStreamRouter.get("/:sessionId/stream", async (c) => {
    const sessionId = c.req.param("sessionId");

    const session = await db.getSession(sessionId);
    if (!session) {
        return c.json({ success: false, error: "Session not found." }, 404);
    }

    return new Response(
        new ReadableStream({
            async start(controller) {
                const encoder = new TextEncoder();
                let closed = false;

                function send(event: string, data: unknown) {
                    if (closed) return;
                    controller.enqueue(
                        encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
                    );
                }

                // Backfill from the DATABASE, not just the in-memory buffer.
                // processManager.getBufferedOutput only holds what's
                // accumulated in this server process's memory since it last
                // booted — it's empty after any server restart, and even
                // mid-session it's an incomplete substitute for the durable
                // record. db.getOutputSince(sessionId, null) reads every
                // persisted line for this session directly from
                // forgex_output, ordered by timestamp, which is what a
                // reconnecting/reloaded tab actually needs to reconstruct
                // full history. This was the real cause of terminal logs
                // appearing to "wipe out on reload" — logOutputLine was
                // always persisting correctly, nothing was ever reading it
                // back.
                const persistedLines = await db.getOutputSince(sessionId, null);
                for (const line of persistedLines) {
                    send("output", { stream: line.stream, text: line.text, backfill: true });
                }

                const unsubscribeOutput = processManager.subscribeToOutput(sessionId, (line) => {
                    send("output", { ...line, backfill: false });
                });

                // Headless mode flips status on every single turn (running
                // while a turn is in flight, then idle/failed once it
                // exits) — the frontend's follow-up bar needs to hear about
                // that live, not just once at connect time.
                const unsubscribeStatus = processManager.subscribeToStatus(sessionId, (status) => {
                    send("status", { status, running: processManager.isRunning(sessionId) });
                });

                send("status", {
                    status: session.status,
                    running: processManager.isRunning(sessionId),
                });

                c.req.raw.signal.addEventListener("abort", () => {
                    closed = true;
                    unsubscribeOutput();
                    unsubscribeStatus();
                    try {
                        controller.close();
                    } catch {
                        // Already closed.
                    }
                });
            },
        }),
        {
            headers: {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                Connection: "keep-alive",
            },
        }
    );
});

export { forgexStreamRouter };
export default forgexStreamRouter;