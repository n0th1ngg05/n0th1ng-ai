import { Hono } from "hono";

import { getDb } from "../queries/connection";
import { files, fileContents, documentAnalysis } from "@db/schema";
import { eq } from "drizzle-orm";
import { extractText } from "./fileProcessor";
import { pythonRuntimeClient } from "./python-runtime";
import { selectWorker, removeOfflineWorkers } from "./cluster";

const LOCAL_PYTHON_RUNTIME = "http://127.0.0.1:8002";

const analyzeStreamRouter = new Hono();

type PipelineStatus =
  | "pending" | "ingesting" | "summarizing" | "extracting"
  | "synthesizing" | "complete" | "error";

const NODE_TO_STATUS: Record<string, PipelineStatus> = {
  ingestion: "ingesting",
  summarizer: "summarizing",
  extractor: "extracting",
  metadata: "extracting",
  synthesizer: "synthesizing",
};

async function upsertAnalysisRow(db: ReturnType<typeof getDb>, fileId: number, values: Partial<{
  summary: string; entities: any; keywords: any; topics: any;
  language: string; documentType: string; confidence: number;
  status: PipelineStatus; error: string | null;
}>) {
  const existing = await db.query.documentAnalysis.findFirst({ where: eq(documentAnalysis.fileId, fileId) });
  if (existing) {
    await db.update(documentAnalysis).set({ ...values, updatedAt: new Date() }).where(eq(documentAnalysis.fileId, fileId));
  } else {
    await db.insert(documentAnalysis).values({ fileId, ...values });
  }
}

// Picks where to run the pipeline: a cluster worker advertising
// "document_analysis" if one's online, else this machine's own Python
// runtime. Logged explicitly so it's obvious from the master console
// whether a given run went local or remote, and to which worker.
function resolveAnalyzeTarget(): { url: string; label: string } {
  removeOfflineWorkers();
  const worker = selectWorker("document_analysis");

  if (worker) {
    console.log(`[ANALYZE] Routing to worker '${worker.hostname}' (${worker.ip}:${worker.port})`);
    return { url: `http://${worker.ip}:${worker.port}/analyze-stream`, label: worker.hostname };
  }

  console.log("[ANALYZE] No worker available — using local Python runtime.");
  return { url: `${LOCAL_PYTHON_RUNTIME}/analyze`, label: "local" };
}

// GET /api/files/:id/analyze-stream
//
// SSE relay: picks a target (remote worker or local runtime, see
// resolveAnalyzeTarget), proxies its /analyze SSE stream through 1:1
// (progress / thinking / done / error — see python-runtime's
// app/routes/analyze.py), persists progress + final result to
// document_analysis, and logs every stage transition + byte count so a
// stall can be traced to master vs. worker vs. Ollama.
analyzeStreamRouter.get("/:id/analyze-stream", async (c) => {
  const fileId = Number(c.req.param("id"));
  if (!fileId || Number.isNaN(fileId)) {
    return c.json({ success: false, error: "Invalid file id." }, 400);
  }

  const db = getDb();
  const file = await db.query.files.findFirst({ where: eq(files.id, fileId) });
  if (!file) return c.json({ success: false, error: "File not found." }, 404);

  let text = (await db.query.fileContents.findFirst({ where: eq(fileContents.fileId, fileId) }))?.content;
  if (!text || !text.trim()) text = await extractText(file.path, file.mimeType || "");
  if (!text || !text.trim()) {
    return c.json({ success: false, error: "File has no extractable text." }, 400);
  }

  const target = resolveAnalyzeTarget();

  if (target.label === "local") {
    await pythonRuntimeClient.health(); // ensures local runtime is started
  }

  await upsertAnalysisRow(db, fileId, { status: "pending", error: null });
  console.log(`[ANALYZE] fileId=${fileId} target=${target.label} textChars=${text.length}`);

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: string, data: any) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      let eventCount = 0;

      try {
        const upstream = await fetch(target.url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });

        if (!upstream.ok || !upstream.body) {
          const err = `Analysis target (${target.label}) request failed: HTTP ${upstream.status}`;
          console.error(`[ANALYZE] fileId=${fileId} ${err}`);
          await upsertAnalysisRow(db, fileId, { status: "error", error: err });
          send("error", { error: err, node: null });
          controller.close();
          return;
        }

        const reader = upstream.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split("\n\n");
          buffer = frames.pop() ?? "";

          for (const frame of frames) {
            const lines = frame.split("\n");
            const eventLine = lines.find((l) => l.startsWith("event:"));
            const dataLine = lines.find((l) => l.startsWith("data:"));
            if (!eventLine || !dataLine) continue;

            const eventName = eventLine.replace("event:", "").trim();
            let data: any;
            try {
              data = JSON.parse(dataLine.replace("data:", "").trim());
            } catch {
              continue;
            }
            eventCount++;

            if (eventName === "progress") {
              const status = NODE_TO_STATUS[data.node] ?? "pending";
              console.log(`[ANALYZE] fileId=${fileId} progress -> ${data.node}`);
              await upsertAnalysisRow(db, fileId, { status });
              send("progress", data);
            } else if (eventName === "thinking") {
              // High-volume — no DB write, no per-token console log; just
              // relay straight through to the browser.
              send("thinking", data);
            } else if (eventName === "done") {
              console.log(`[ANALYZE] fileId=${fileId} done (${eventCount} events relayed, target=${target.label})`);
              await upsertAnalysisRow(db, fileId, {
                status: "complete",
                summary: data.summary,
                entities: data.entities,
                keywords: data.keywords,
                topics: data.topics,
                language: data.metadata?.language,
                documentType: data.metadata?.document_type,
                confidence: data.metadata?.confidence,
                error: null,
              });
              send("done", data);
            } else if (eventName === "error") {
              console.error(`[ANALYZE] fileId=${fileId} error at node=${data.node} target=${target.label}: ${data.error}`);
              await upsertAnalysisRow(db, fileId, { status: "error", error: data.error });
              send("error", data);
            }
          }
        }
      } catch (err: any) {
        const message = err?.message || "Analysis stream failed.";
        console.error(`[ANALYZE] fileId=${fileId} stream exception (target=${target.label}):`, err);
        await upsertAnalysisRow(db, fileId, { status: "error", error: message });
        send("error", { error: message, node: null });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
});

// GET /api/files/:id/analysis — last known state (reload/resume).
analyzeStreamRouter.get("/:id/analysis", async (c) => {
  const fileId = Number(c.req.param("id"));
  if (!fileId || Number.isNaN(fileId)) {
    return c.json({ success: false, error: "Invalid file id." }, 400);
  }
  const db = getDb();
  const row = await db.query.documentAnalysis.findFirst({ where: eq(documentAnalysis.fileId, fileId) });
  return c.json({ success: true, analysis: row ?? null });
});

export default analyzeStreamRouter;
