import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { getCapabilities } from "./capabilities";
import { executeTool } from "./executor";
import {
    startJob,
    finishJob,
} from "./jobs";

import {
    forwardSpeech,
    type SpeechHttpRequest,
} from "./speechGateway";

import {
    forwardTool,
    type ToolHttpRequest,
} from "./toolGateway";

import { handleAnalyzeStream } from "./services/analyzeGateway";

import { getRuntimeStatus } from "./runtimeStatus";
import { runtimeManager } from "./runtime/manager";
import { logBuffer, type LogLine } from "./runtime/logBuffer";
import { connectionState } from "./connectionState";

// ── Connection state tracking (pull-based) ──────────────────────────────
// The master now polls GET /capabilities every 5 s instead of the worker
// pushing /register and /heartbeat to the master. This means the worker
// works regardless of which network the master is on.
//
// We track `lastMasterPoll` — the timestamp of the most recent successful
// /capabilities call from the master. A watchdog timer fires every 7 s; if
// more than 15 s have passed without a poll we consider the master gone and
// call markDisconnected(), which triggers the exposure-service auto-timer.
// The first poll after a disconnected period calls markConnected() again.

const app = new Hono();


let isConnected    = false;
let lastMasterPoll = 0; // 0 = never polled

function markConnected() {
    if (!isConnected) {
        isConnected = true;
        connectionState.setConnected(true);
        console.log("");
        console.log("========================================");
        console.log("[WORKER] Master connection: CONNECTED");
        console.log("========================================");
        console.log("");
    }
}

function markDisconnected(reason?: string) {
    if (isConnected) {
        isConnected = false;
        connectionState.setConnected(false);
        console.log("");
        console.log("========================================");
        console.log("[WORKER] Master connection: DISCONNECTED");
        if (reason) console.log("Reason:", reason);
        console.log("Waiting for master to poll /capabilities...");
        console.log("========================================");
        console.log("");
    }
}

// Watchdog — runs every 7 s. If the master hasn't polled in 15 s, mark disconnected.
const MASTER_POLL_TIMEOUT = 15_000;
setInterval(() => {
    if (lastMasterPoll === 0) return; // never been connected yet — stay silent
    if (Date.now() - lastMasterPoll > MASTER_POLL_TIMEOUT) {
        markDisconnected("Master poll timeout (no /capabilities request in 15 s)");
    }
}, 7_000);

// ── Static providers / versions payload ──────────────────────────────────

const PROVIDERS = {
    ocr:    ["surya"],
    vision: ["qwen3_vl", "minicpm"],
    pdf:    ["marker"],
    speech: ["kokoro", "whisper", "xtts", "fishspeech", "dia", "chatterbox", "piper"],
};

const VERSIONS = { worker: "1.5.0", python: "1.0.0", speech: "1.0.0" };

// ── GET /capabilities — master polls this every 5 s ──────────────────────

app.get("/capabilities", async (c) => {
    const caps    = await getCapabilities();
    const runtime = await getRuntimeStatus();

    // Record that the master just checked in — updates connectionState.
    lastMasterPoll = Date.now();
    markConnected();

    return c.json({
        ...caps,
        ...runtime,
        providers:   PROVIDERS,
        versions:    VERSIONS,
        // Tell master to route tool calls through the Cloudflare tunnel.
        internetUrl: process.env.CF_TUNNEL_URL  ?? "",
        apiKey:      process.env.WORKER_API_KEY ?? "",
    });
});

app.get("/ping", c => {
    return c.json({ success: true });
});



// ── Log access ──────────────────────────────────────────────────────────
// The master's Cluster System modal hits these directly (worker IP:port
// is already known from registration/heartbeat) rather than the worker
// pushing logs to the master — simpler, and consistent with /execute,
// /speech, /tool all being pull-style already.

// Snapshot of recently buffered lines, for the modal's initial paint
// before the live stream picks up. ?source=python|speech|kokoro
app.get("/logs", (c) => {
    const source = c.req.query("source");

    if (source === "kokoro") {
        return c.json({ lines: logBuffer.getKokoroLines() });
    }
    if (source === "python" || source === "speech") {
        return c.json({ lines: logBuffer.getRecent(source) });
    }
    return c.json({ lines: logBuffer.getRecent() });
});

// Live tail via SSE. Same streaming Response pattern the master already
// uses for its own SSE routes (image job progress, chat token streaming).
app.get("/logs/stream", (c) => {
    const source = c.req.query("source"); // "python" | "speech" | "kokoro" | undefined (all)

    const encoder = new TextEncoder();
    let unsubscribe: (() => void) | null = null;

    const stream = new ReadableStream({
        start(controller) {
            const send = (entry: LogLine) => {
                try {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(entry)}\n\n`));
                } catch {
                    // Controller already closed (client disconnected) — the
                    // subscription is torn down via cancel() below.
                }
            };

            unsubscribe = logBuffer.subscribe((entry) => {
                if (source === "kokoro" && !/kokoro/i.test(entry.line)) return;
                if ((source === "python" || source === "speech") && entry.source !== source) return;
                send(entry);
            });
        },
        cancel() {
            unsubscribe?.();
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

app.post("/execute", async (c) => {

    console.log("========================================");
    console.log("[WORKER] Execute Request Received");

    const toolCall = await c.req.json();

    // Sanitize args before logging — base64 image/pdf data fields can be
    // hundreds of KB and flood the console. Replace them with a size summary.
    const argsForLog = toolCall.arguments
        ? Object.fromEntries(
            Object.entries(toolCall.arguments as Record<string, unknown>).map(([k, v]) =>
                typeof v === "string" && k.endsWith("_data") && v.length > 100
                    ? [k, `[base64 ~${(v.length * 0.75 / 1024).toFixed(1)} KB]`]
                    : [k, v]
            )
        )
        : {};

    console.log("[WORKER] Tool :", toolCall.tool);
    console.log("[WORKER] Args :", argsForLog);

    const job = startJob(toolCall.tool);

    const result = await executeTool(toolCall);

    const finished = finishJob(job.id);

    console.log("");

    console.log("========================================");
    console.log("[WORKER JOB]");
    console.log("ID       :", finished?.id);
    console.log("Tool     :", finished?.tool);
    console.log("Duration :", finished?.duration, "ms");
    console.log("Status   :", result.success ? "SUCCESS" : "FAILED");
    console.log("========================================");

    console.log("");

    console.log("[WORKER] Result:");
    console.dir(result, { depth: null });

    console.log("========================================");

    return c.json(result);

});

app.post("/analyze-stream", handleAnalyzeStream);

app.post("/speech", async (c) => {

    try {

        const request = await c.req.json();

        const response = await forwardSpeech(request);

        const contentType =
            response.headers.get("content-type") ?? "";

        if (contentType.includes("application/json")) {

            return c.json(

                await response.json(),

                response.status

            );

        }

        return new Response(

            await response.arrayBuffer(),

            {

                status: response.status,

                headers: response.headers,

            }

        );

    } catch (err: any) {

        console.error("");
        console.error("========================================");
        console.error("[WORKER SPEECH ERROR]");
        console.error(err?.message);
        console.error("========================================");
        console.error("");

        return c.json(

            {

                success: false,

                error:

                    err?.message ??

                    "Speech proxy failed",

            },

            500

        );

    }

});

app.post("/tool", async (c) => {

    try {

        const request =
            await c.req.json<ToolHttpRequest>();

        const response =
            await forwardTool(request);

        const contentType =
            response.headers.get("content-type") ?? "";

        if (contentType.includes("application/json")) {

            return c.json(

                await response.json(),

                response.status

            );

        }

        return new Response(

            await response.arrayBuffer(),

            {

                status: response.status,

                headers: response.headers,

            }

        );

    } catch (err: any) {

        console.error("");
        console.error("========================================");
        console.error("[WORKER TOOL ERROR]");
        console.error(err?.message);
        console.error("========================================");
        console.error("");

        return c.json(

            {

                success: false,

                error:

                    err?.message ??

                    "Tool proxy failed",

            },

            500

        );

    }

});

// ── Boot ─────────────────────────────────────────────────────────────────
// Start the HTTP server FIRST so :3001 is immediately reachable by the
// exposure service and HUD. Then boot the runtimes in the background —
// they take time to load but the worker can already accept requests.

serve({
    fetch: app.fetch,
    port: 3001,
});

console.log("[WORKER] Running on :3001");
console.log("[WORKER] Pull-based registration active — master polls GET /capabilities every 5 s.");

// Start Python + Speech runtimes in the background (non-blocking).
runtimeManager.start().catch(err => {
    console.error("[WORKER] Runtime start failed:", err);
});


// The ONLY intentional way this process should ever stop is the user
// hitting Ctrl+C in the terminal it was started from. Handle SIGINT (and
// SIGTERM, for completeness) explicitly so that's a clean, deliberate exit
// rather than something that happens implicitly elsewhere in this file.
function shutdown(signal: string) {
    console.log("");
    console.log("========================================");
    console.log(`[WORKER] Received ${signal} - shutting down.`);
    console.log("========================================");
    console.log("");
    process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT (Ctrl+C)"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// Belt-and-suspenders: if anything anywhere ever throws an unhandled
// rejection or exception despite the guards above, log it instead of
// letting Node's default handler kill the process. This worker must only
// ever stop via the SIGINT/SIGTERM handlers above.
process.on("unhandledRejection", (reason) => {
    console.error("[WORKER] Unhandled rejection (ignored, staying alive):", reason);
});

process.on("uncaughtException", (err) => {
    console.error("[WORKER] Uncaught exception (ignored, staying alive):", err);
});