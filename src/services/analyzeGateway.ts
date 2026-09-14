// src/services/analyzeGateway.ts
//
// Worker-side SSE relay for the document_analysis LangGraph pipeline.
//
// The master's analyzeStream.ts calls POST /analyze-stream on this worker
// (chosen via the master's cluster.ts selectWorker("document_analysis")),
// and this file proxies that straight through to the worker's own local
// Python runtime at 127.0.0.1:8002/analyze — byte-for-byte, so the SSE
// event shape (progress / thinking / done / error — see the Python
// runtime's app/routes/analyze.py) is identical whether analysis runs on
// the master or on this worker. The master never needs to know which
// machine actually ran the pipeline.
//
// Every hand-off in this chain is logged so a stall or drop can be
// pinpointed to a specific machine: master console shows the worker it
// picked and the URL it called; this file's logs show whether it heard
// back from Ollama at all and how many bytes it relayed; the Python
// runtime's own console (see document_analysis/graph.py) shows the
// per-node LLM call detail.

import type { Context } from "hono";

const PYTHON_RUNTIME = "http://127.0.0.1:8002";

export async function handleAnalyzeStream(c: Context) {

    let body: { text?: string };

    try {
        body = await c.req.json();
    } catch (err) {
        console.error("[WORKER][ANALYZE] Failed to parse request body:", err);
        return c.json({ success: false, error: "Invalid JSON body." }, 400);
    }

    const text = body?.text;

    if (!text || !text.trim()) {
        console.warn("[WORKER][ANALYZE] Rejected — no text provided.");
        return c.json({ success: false, error: "Missing 'text' in payload." }, 400);
    }

    console.log("========================================");
    console.log("[WORKER][ANALYZE] Stream requested");
    console.log("[WORKER][ANALYZE] Input chars:", text.length);
    console.log("========================================");

    let upstream: Response;

    try {
        upstream = await fetch(`${PYTHON_RUNTIME}/analyze`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text }),
        });
    } catch (err: any) {
        console.error("[WORKER][ANALYZE] Could not reach local Python runtime:", err?.message ?? err);
        return c.json(
            {
                success: false,
                error: `Worker's Python runtime unreachable: ${err?.message ?? String(err)}`,
            },
            502
        );
    }

    if (!upstream.ok || !upstream.body) {
        const detail = await upstream.text().catch(() => "");
        console.error(
            "[WORKER][ANALYZE] Python runtime /analyze returned non-OK:",
            upstream.status,
            detail
        );
        return c.json(
            {
                success: false,
                error: `Python runtime /analyze failed: HTTP ${upstream.status}`,
            },
            502
        );
    }

    console.log("[WORKER][ANALYZE] Relaying SSE stream from local Python runtime...");

    let eventCount = 0;
    let byteCount = 0;

    // Wrap the upstream body so we can count/log without buffering the
    // whole stream in memory — every chunk is forwarded to the master
    // the instant it arrives, same as the Python runtime forwards every
    // token to this worker the instant Ollama emits it.
    const reader = upstream.body.getReader();

    const relay = new ReadableStream({
        async start(controller) {
            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    byteCount += value.byteLength;
                    // Cheap event-boundary count for the log line below —
                    // SSE frames are separated by a blank line ("\n\n").
                    const chunkText = new TextDecoder().decode(value);
                    eventCount += (chunkText.match(/\n\n/g) || []).length;

                    controller.enqueue(value);
                }
            } catch (err) {
                console.error("[WORKER][ANALYZE] Error while relaying stream:", err);
            } finally {
                controller.close();
                console.log(
                    `[WORKER][ANALYZE] Stream relay finished — ~${eventCount} events, ${byteCount} bytes.`
                );
            }
        },
    });

    return new Response(relay, {
        headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
        },
    });
}
