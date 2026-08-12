import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { HttpBindings } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "./router";
import { createContext } from "./context";
import { env } from "./lib/env";
import { buildTemporalContext } from "./lib/temporalContext";
import fileUploadRouter from "./services/upload";
import chatUploadRouter from "./services/chatUpload";
import analyzeStreamRouter from "./services/analyzeStream";
import fs from "fs";
import path from "path";
import { startTelemetryCollector } from "./services/telemetry";
import { getDb, getDbAsync } from "./queries/connection";
import { systemSnapshots, chatAttachments } from "@db/schema";
import { desc, eq, inArray, asc } from "drizzle-orm";
import pslist from "ps-list";
import pidusage from "pidusage";
import si from "systeminformation";
import { createJob, generationJobs, } from "./services/generationState";
import { listProviders } from "./services/providers";
import { generateEmbedding } from "./services/embeddingService";
import { runGeneration, } from "./services/backgroundGeneration";
import { createVideoJob, videoJobs } from "./services/videoGenerationState";
import { runFramesXGeneration, type FramesXEvent } from "./services/framesx";
import { generatedVideos } from "@db/schema";
import { backfillEmbeddings } from "./services/backfillEmbeddings";
import { searchKnowledge } from "./services/semanticSearch";
import { buildRagPrompt } from "./services/rag";
import { getConversationMemory, getConversationMessages, } from "./services/conversationMemory";
import { buildConversationContext, MAX_CONTEXT_TOKENS, MAX_CONTEXT_MESSAGES, } from "./services/contextWindow";
import { runAgentLoop, synthesizeExecutionSummary, type AgentEvent, } from "./services/agentLoop";
import { processTools, } from "./services/toolPipeline";
import { searchInternet, } from "./services/tavily";
import { readUrl, } from "./services/firecrawl";
import { memoryStore, memorySearch, getAllMemories, } from "./services/memory";
import { buildMemoryContext, } from "./services/memoryContext";
import { summarizeConversation } from "./services/conversationSummary";
import { getConversationSummary, updateConversationSummary, getConversationSummarizedCount, updateConversationSummaryWithCount, } from "./queries/conversation";
import { searchChatAttachments } from "./services/chatAttachmentSearch";
import { initializeSpeechSystem, } from "./speech";
// NOTE: No static speechManager import — use the lazy accessor below.
// A static import would force Vite's SSR module runner to eagerly evaluate
// all 11 speech manager files, reliably timing out the 60 s fetchModule RPC.
import { getSpeechManager } from "./speech/lazy-speech-manager";
import type { ProviderId } from "./speech/types";
import { WavUtil } from "./speech/audio/wav";
import { getGeneratedAudioPath } from "./speech/utils/pathUtils";
import { writeFileAtomic } from "./speech/utils/fileUtils";
import { voiceConversations, voiceMessages } from "@db/schema";
import { randomUUID } from "crypto";
import { getVoiceConversationMemory, getVoiceConversationMessages, getVoiceConversationSummary, updateVoiceConversationSummary, getVoiceConversationSummarizedCount, } from "./services/voiceConversationMemory";
import { shouldUseTools } from "./services/toolRouter";
import { removeOfflineWorkers } from "./services/cluster";
import {registerWorker,heartbeat,getWorkers,} from "./services/cluster";
import { recordMetricPoint } from "./services/clusterMetricsHistory";
import { runtimeManager } from "./services/runtime/manager";
import { startCompanionService } from "./services/companion";
import { forgeStreamRouter } from "./forge/routes";
import { forgexStreamRouter } from "./forgex/routes";
import { isOpenRouterModel, streamOpenRouterGenerate } from "./services/openRouter";



function supportsThinking(model: string): boolean {
    const normalized = model.toLowerCase();

    // Native Ollama thinking support
    return (
        normalized.startsWith("qwen3:") ||
        normalized.startsWith("qwen3.5:")
    );
}

let latestSources: any[] = [];

const app = new Hono<{ Bindings: HttpBindings }>();

// c.req.json() throws SyntaxError on an empty/missing body (JSON.parse("")),
// which previously crashed the request with an unhandled parse error instead
// of a clean 400. Every handler below that reads a JSON body now goes
// through this helper so a stray empty-bodied PUT/POST (retry, devtools,
// client bug) can't take down the route.
//
// NOTE: this intentionally takes `c: any` and returns `Promise<any>` rather
// than being generic over Hono's Context<...> type. If this were written as
// `safeJson<T = any>(c: Context<...>): Promise<T | null>`, TypeScript infers
// T from c.req.json()'s actual declared return type at each call site
// (which Hono types narrowly per-route, often as `{}` when no validator is
// attached) instead of falling back to the `= any` default — so `body.title`
// / `body.prompt` etc. would fail to typecheck even though this is plain
// untyped JSON at runtime. Taking `c: any` sidesteps that inference
// entirely and keeps this a runtime-only safety net, matching how
// `c.req.json()` was used directly before (also effectively `any`).
async function safeJson(c: any): Promise<any> {
  try {
    return await c.req.json();
  } catch {
    return null;
  }
}

// Warm up the DB connection so that getDb() can be used synchronously from
// all request handlers. connection.ts fires initDb() in the background when
// it is first imported, but we explicitly await it here to guarantee the
// drizzle instance is ready before the first HTTP request can arrive.
try {
    await getDbAsync();
    console.log("[Boot] Database connection initialized.");
} catch (err) {
    console.error("[Boot] Database initialization failed:", err);
}

// Wrapped in try/catch — a speech system failure must not prevent the rest
// of the server (Python runtime, companion, telemetry, Hono routes) from
// starting. Speech features simply become unavailable until the server restarts.
try {
    await initializeSpeechSystem();
} catch (err) {
    console.error("[Boot] Speech system initialization failed — continuing without speech:", err);
}

// Only starts the Python runtime eagerly. The Speech runtime is no longer
// started here or at boot at all — it's started lazily, only the first time
// an actual speech request needs local synthesis/transcription, and only if
// no distributed worker is available. That logic lives in
// speech/runtimes/pythonRuntime.ts (PythonRuntime.start()), triggered via
// speechManager.synthesize()/transcribe().
await runtimeManager.start();
startCompanionService();
startTelemetryCollector();

app.use(bodyLimit({ maxSize: 50 * 1024 * 1024 }));
app.route("/api/files", fileUploadRouter);
app.route("/api/files", analyzeStreamRouter);
app.route("/api/chat-files", chatUploadRouter);
app.use("/api/trpc/*", async (c) => {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext,
  });
});

app.get("/api/system/current", async (c) => {
  const db = getDb();
  const latest = await db.query.systemSnapshots.findFirst({
    orderBy: [desc(systemSnapshots.createdAt)],
  });
  return c.json(latest);
});

app.post("/api/chat", async (c) => {
  const body = await safeJson(c);
  if (!body) {
    return c.json({ error: "Request body is missing or not valid JSON." }, 400);
  }

  console.log("[CHAT REQUEST]", { prompt: body.prompt, selectedFiles: body.selectedFiles });
  console.log("[MODEL USED]", body.model);

  const memoryContext = await buildMemoryContext(body.prompt);
  console.log("[MEMORY CONTEXT]");
  console.log(memoryContext || "None");

  // FIX 1: /api/chat had no attachmentContext — declare it here to avoid ReferenceError
  const attachmentContext = "";
  // NOTE: unlike /api/chat/stream, this legacy endpoint never reads
  // body.conversationId and never calls buildConversationContext(), so
  // there's no history to inject here even in principle. Left as "" on
  // purpose. This route appears unused by the frontend (only
  // /api/chat/stream is called with a conversationId) — confirm that
  // before relying on this endpoint for anything.
  const finalConversationContext = "";

  let ragResult: { sources: any[]; prompt?: string } = { sources: [] };
  let ragPrompt = "";

  // Mandatory on every prompt sent to a local model — see lib/temporalContext.ts.
  // Synced to the DEVICE's own timezone via body.timezone (chat.js sends
  // Intl.DateTimeFormat().resolvedOptions().timeZone on every request),
  // falling back to UTC if a client build hasn't been updated to send it yet.
  const temporalContext = buildTemporalContext({ timezone: body.timezone });

  if (body.useRag !== false) {
    console.log("[RAG] Enabled");

    ragResult = await buildRagPrompt(body.prompt, body.selectedFiles, finalConversationContext);

    ragPrompt = `
${temporalContext}

${memoryContext}

${attachmentContext}

${ragResult.prompt}
`;
  } else {
    console.log("[RAG] Disabled");

    ragPrompt = `
${temporalContext}

${memoryContext}

${attachmentContext}

${finalConversationContext}

User Question:

${body.prompt}
`;
  }

  const response = await fetch("http://localhost:11434/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: body.model,
      prompt: ragPrompt,
      stream: false,
    }),
  });

  const data = await response.json();

  return c.json({
    response: data.response,
    sources: ragResult.sources,
  });
});

app.post("/api/chat/stream", async (c) => {
  const body: any = await safeJson(c);
  if (!body) {
    return c.json({ error: "Request body is missing or not valid JSON." }, 400);
  }

  let toolResult = null;

  const isVoice = body.mode === "voice";

  body.responseMode ??= "text";

  console.log("========== RESPONSE MODE ==========");
  console.log(body.responseMode);
  
    const skipRagTools = [
        "scientific_calculator",
        "system_monitor",
        "model_manager",
        "ollama_control",
        "sql_query",
        "internet_search",
        "url_reader",
        "research_query",
        "memory_store",
        "memory_search",
        "memory_update",
        "memory_delete",
        "local_vision_ocr",
        "layout_analyzer",
        "marker_pdf_pipeline",
        "local_vision_analyzer",
    ];

  let toolContext = "";

  // FIX 2: hoist attachmentContext declaration BEFORE the if-block so it's in scope for ragPrompt
  let attachmentContext = "";

if (body.conversationId) {

    const attachmentChunks =
        await searchChatAttachments(

            body.conversationId,

            body.prompt,

            8

        );

    if (attachmentChunks.length > 0) {

        attachmentContext =
`
==================================================
ATTACHMENT CONTEXT
==================================================

${attachmentChunks.map(chunk => chunk.content).join("\n\n")}

==================================================

The above information comes from the user's attached documents.
Use it as the primary reference whenever relevant.
`;

    }

}

  // Context window: keep up to MAX_CONTEXT_MESSAGES (50) / MAX_CONTEXT_TOKENS
  // (150k, estimated) of the most recent messages verbatim. Anything older
  // than that gets folded into (and kept fresh in) the stored summary, so
  // conversation.ts / voiceConversationMemory.ts stay in sync via the new
  // summarizedMessageCount column instead of silently dropping history.
  let conversationMessages: any[] = [];
  let finalConversationContext = "";
  let needsSummary = false;

  if (body.conversationId) {
      const existingSummary = isVoice
          ? await getVoiceConversationSummary(body.conversationId)
          : await getConversationSummary(Number(body.conversationId));

      const summarizedMessageCount = isVoice
          ? await getVoiceConversationSummarizedCount(body.conversationId)
          : await getConversationSummarizedCount(Number(body.conversationId));

      const built = await buildConversationContext({
          conversationId: body.conversationId,
          isVoice,
          existingSummary,
          summarizedMessageCount,
      });

      conversationMessages = built.allMessages;
      finalConversationContext = built.context;
      needsSummary = built.needsSummary;

      console.log(
          "[CONTEXT WINDOW]",
          {
              totalMessages: built.allMessages.length,
              windowMessages: built.windowMessageCount,
              windowTokens: built.windowTokens,
              maxTokens: MAX_CONTEXT_TOKENS,
              maxMessages: MAX_CONTEXT_MESSAGES,
              needsSummary,
          }
      );

      if (needsSummary) {
          console.log("[CONVERSATION] Regenerating summary (window overflowed)...");

          // built.messagesToSummarize is the FULL overflow set (every
          // message older than the current window), not just messages new
          // since the last summary -- so this regenerates the summary from
          // scratch each time rather than concatenating with the old one
          // (which would duplicate content and grow unbounded).
          const messagesToSummarize = built.messagesToSummarize;
          const combinedSummary = await summarizeConversation(
              messagesToSummarize,
              body.model
          );

          if (isVoice) {
              await updateVoiceConversationSummary(
                  body.conversationId,
                  combinedSummary,
                  messagesToSummarize.length
              );
          } else {
              await updateConversationSummaryWithCount(
                  Number(body.conversationId),
                  combinedSummary,
                  messagesToSummarize.length
              );
          }

          console.log("[CONVERSATION] Summary stored.");

          // Rebuild the context block with the freshly stored summary so
          // this turn's prompt already reflects it instead of waiting for
          // the next request.
          const rebuilt = await buildConversationContext({
              conversationId: body.conversationId,
              isVoice,
              existingSummary: combinedSummary,
              summarizedMessageCount: messagesToSummarize.length,
          });
          finalConversationContext = rebuilt.context;
      }
  }

  const decision = await shouldUseTools(
      body.model,
      body.prompt,
      finalConversationContext,
      body.uploadedAttachments ?? []
  );
    console.log("========== ROUTER ==========");
    console.log(decision);

    // processTools() needs the uploaded attachment objects (with .path and
    // .mimeType) so it can inject image_path / pdf_path into tool calls.
    // These arrive from the frontend under `uploadedAttachments` — NOT under
    // `selectedFiles`, which contains numeric RAG knowledge-base file IDs.
    const runTools = async () => {
        try {
            return await processTools(
                decision.tools,
                body.uploadedAttachments ?? [],
                body.prompt
            );
        } catch (err) {
            console.error("[PIPELINE] processTools threw:", err);
            return null;
        }
    };

    switch (decision.mode) {

    case "CHAT":
        break;

    case "TOOL":

        toolResult = await runTools();

        break;

    case "RAG":

        body.useRag = true;

        break;

    case "TOOL_RAG":

        body.useRag = true;

        toolResult = await runTools();

        break;

}

  const shouldSkipRag =
    decision.mode === "TOOL" &&
    toolResult &&
    toolResult.toolCalls.some(
        (tool: any) =>
            skipRagTools.includes(tool.tool)
    );

  if (toolResult) {
    toolContext = `
==================================================
TOOL RESULT
==================================================

Tools Used:

${toolResult.toolCalls.map((tool: any) => tool.tool).join(", ")}

Result:

${toolResult.toolCalls
  .map(
    (tool: any, index: number) => `
Tool ${index + 1}: ${tool.tool}

Result:

${JSON.stringify(toolResult.results[index], null, 2)}
`
  )
  .join("\n")}

==================================================
`;
  }

  console.log("[CHAT TOOL RESULT]", toolResult);

  console.log("[SHOULD SUMMARIZE]", needsSummary);
  console.log("[MESSAGE COUNT]", conversationMessages.length);
  console.log("[CHAT REQUEST]", { prompt: body.prompt, selectedFiles: body.selectedFiles });
  console.log("[MODEL USED]", body.model);

  const memoryContext = await buildMemoryContext(body.prompt);
  console.log("[MEMORY CONTEXT]");
  console.log(memoryContext || "None");

  let ragPrompt = "";
  let ragResult: { sources: any[]; prompt?: string } = { sources: [] };

  // Mandatory on every prompt sent to a local model — see lib/temporalContext.ts.
  // Synced to the DEVICE's own timezone via body.timezone.
  const temporalContext = buildTemporalContext({ timezone: body.timezone });

  if (shouldSkipRag || body.useRag === false) {
    console.log(body.useRag === false ? "[RAG] Disabled by User" : "[RAG] Skipped (Tool Result)");

    // FIX: finalConversationContext (the windowed history + summary from
    // contextWindow.ts) was computed above and used for tool routing, but
    // was never actually included in the generation prompt on this branch.
    // Since /api/chat/stream hits this branch whenever RAG is off or a
    // tool ran, the model never saw prior turns at all — hence "What is
    // my Name?" failing even right after "My name is Humza".
    ragPrompt = `
${temporalContext}

${memoryContext}

${attachmentContext}

${finalConversationContext}

${toolContext}

User Question:

${body.prompt}

Use the tool result to answer naturally.
`;
  } else {
    ragResult = await buildRagPrompt(body.prompt, body.selectedFiles, finalConversationContext);

    ragPrompt = `
${temporalContext}

${memoryContext}

${attachmentContext}

${toolContext}

${ragResult.prompt}
`;
  }

  latestSources = ragResult.sources;

  console.log("[RAG SOURCES]", latestSources);
  console.log("\n========== FINAL PROMPT ==========\n");
  console.log(ragPrompt);
  console.log("\n==================================\n");

  // FIX 11: this fetch had no timeout at all. If Ollama is still busy from
  // the router call moments earlier (or generally GPU-starved — your
  // telemetry shows sustained 99-100% CPU/GPU), this can hang indefinitely.
  // The server would sit on `await fetch(...)` or later on `reader.read()`
  // with literally nothing to log, while the FRONTEND'S OWN timeout fires
  // first and reports "streaming failed" — explaining a clean FINAL PROMPT
  // log immediately followed by silence, with no server-side error at all.
  const GENERATE_TIMEOUT_MS = 120_000;
  const generateController = new AbortController();
  const generateTimeoutId = setTimeout(
    () => generateController.abort(),
    GENERATE_TIMEOUT_MS
  );

  let ollamaResponse: Response;

  // ── Streaming Speech Pipeline (setup) ──────────────────────────────────
  // Moved above the OpenRouter/Ollama fork so BOTH branches can drive the
  // same voice pipeline. Previously this lived only in the Ollama branch
  // below, which meant `isOpenRouterModel(body.model)` requests returned
  // before any of this ever ran — no isVoiceMode, no speech settings, no
  // sentence-boundary detection — so OpenRouter voice replies never
  // produced a single `speech`/`fullAudio` chunk and the frontend's voice
  // pipeline had nothing to play.
  const isVoiceMode =
    body.responseMode === "voice" || body.responseMode === "text+voice";

  // Speech settings are resolved once, before either branch's read loop,
  // so that the many per-sentence synthesis tasks started inside the loop
  // don't race on the same database read.
  let speechProviderId: ProviderId | undefined;
  let speechModelId:    string | undefined;
  let speechVoiceId:    string | undefined;
  let speechSpeed:       number | undefined;
  let speechPitch:       number | undefined;
  let speechTemperature: number | undefined;
  let speechVolume:      number | undefined;

  if (isVoiceMode) {
    if (body.conversationId) {
      const db = getDb();
      const [conv] = await db
        .select()
        .from(voiceConversations)
        .where(eq(voiceConversations.id, body.conversationId));
      if (conv) {
        speechProviderId = conv.providerId as ProviderId | undefined;
        speechModelId    = conv.speechModelId ?? undefined;
        speechVoiceId    = conv.voiceId       ?? undefined;
      }
    }
    // Per-request overrides win over stored conversation settings.
    speechProviderId = (body.providerId as ProviderId | undefined) ?? speechProviderId;
    speechModelId    = body.speechModelId ?? body.modelId ?? speechModelId;
    speechVoiceId    = body.voiceId ?? speechVoiceId;

    // Voice tuning sliders from the frontend (Speed/Pitch/Temperature/
    // Volume Booster panel). Falls back to each provider's own default
    // when the frontend doesn't send a value.
    speechSpeed       = typeof body.speed       === "number" ? body.speed       : undefined;
    speechPitch       = typeof body.pitch       === "number" ? body.pitch       : undefined;
    speechTemperature = typeof body.temperature === "number" ? body.temperature : undefined;
    speechVolume      = typeof body.volume      === "number" ? body.volume      : undefined;

    if (!speechProviderId) {
      const profile = await (await getSpeechManager()).getProfileManager().getDefaultProfile();
      speechProviderId = profile?.providerId;
      speechModelId    = speechModelId ?? profile?.modelId;
      speechVoiceId    = speechVoiceId ?? profile?.voiceId;
    }

    console.log("[VOICE] Resolved speech settings for streaming:", {
      speechProviderId,
      speechModelId,
      speechVoiceId,
      speechSpeed,
      speechPitch,
      speechTemperature,
      speechVolume,
    });
  }

  // Sentence accumulation buffer and per-task tracking. Each provider
  // branch gets its own independent set of these (declared here, but a
  // fresh `sentenceBuffer`/`speechSequence`/etc. per branch instance is
  // created below since OpenRouter and Ollama each run their own IIFE) —
  // NOTE: kept as shared `let`/`const` at this scope is fine because only
  // one branch ever executes per-request (the `if`/return below is
  // exclusive), so there's no cross-branch race.
  let sentenceBuffer = "";
  let speechSequence = 0;
  const pendingSpeechTasks: Promise<void>[] = [];

  // ── Full-response audio capture ─────────────────────────────────────────
  // Each streamed sentence is still flushed to the client immediately for
  // realtime playback — this map additionally holds each chunk's raw WAV
  // bytes keyed by its sequence number, purely so the finalization step
  // can later stitch every chunk back together in the right order into one
  // continuous recording for replay. Keyed by seq (not push order) because
  // synthesis tasks can resolve out of submission order.
  const audioChunksBySeq = new Map<number, Buffer>();

  // ── Streaming sentence parser ─────────────────────────────────────────────
  // Scans `text` for the first genuine sentence-ending punctuation mark and
  // returns the index just after that boundary, or -1 if none found.
  //
  // Rules for '.':
  //   • Followed immediately by a digit        → decimal or version number (3.14, v1.5)
  //   • Preceded by a single uppercase letter
  //     that is itself after a '.' or space     → mid-abbreviation (U.S.)
  //   • Preceded by a known abbreviation word  → not a boundary (Dr., Mr., etc.)
  //   • Otherwise                              → genuine boundary
  // '!' and '?' are always boundaries.
  // Any boundary is only confirmed when followed by whitespace or end-of-string,
  // which also naturally skips ellipsis sequences ("...").
  const ABBREV_WORDS = new Set([
    "dr", "mr", "mrs", "ms", "prof", "sr", "jr",
    "vs", "etc", "approx", "dept", "est",
  ]);

  function findSentenceBoundary(text: string): number {
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];

      if (ch === "!" || ch === "?") {
        // Consume a run of the same terminator ("!!", "???")
        let end = i + 1;
        while (end < text.length && (text[end] === "!" || text[end] === "?")) end++;
        if (end >= text.length || text[end] === " " || text[end] === "\n") {
          return end;
        }
        i = end - 1;
        continue;
      }

      if (ch === ".") {
        // Skip ellipsis — advance past the dot run and continue scanning
        if (i + 1 < text.length && text[i + 1] === ".") {
          while (i + 1 < text.length && text[i + 1] === ".") i++;
          continue;
        }
        // Followed immediately by a digit → decimal / version number
        if (i + 1 < text.length && /\d/.test(text[i + 1])) continue;
        // Preceded by a single uppercase letter that itself follows a dot or
        // space → likely mid-abbreviation (e.g. the middle dot of "U.S.")
        if (
          i > 0 &&
          /[A-Z]/.test(text[i - 1]) &&
          (i < 2 || text[i - 2] === "." || text[i - 2] === " ")
        ) continue;
        // Preceded by a known abbreviation word (case-insensitive)
        const wordMatch = text.slice(0, i).match(/([a-zA-Z]+)$/);
        if (wordMatch && ABBREV_WORDS.has(wordMatch[1].toLowerCase())) continue;
        // If this '.' is the last character seen so far, we don't yet know
        // what follows it — it could be whitespace (genuine boundary) or a
        // digit that just hasn't streamed in yet (e.g. "34" then "." then
        // "25" arriving as three separate LLM tokens for "34.25"). Treat
        // this as "undecided" and wait for more tokens rather than firing
        // a boundary early, which is what previously caused decimals to
        // get cut into two separate TTS sentences ("34" / "25 percent").
        const next = i + 1;
        if (next >= text.length) {
          return -1;
        }
        // Boundary only if followed by whitespace
        if (text[next] === " " || text[next] === "\n") {
          return next;
        }
      }
    }
    return -1;
  }

  // ── Shared per-sentence TTS dispatch ────────────────────────────────────
  // Used by BOTH the OpenRouter and Ollama branches below. Feed it each
  // token as it streams in; it accumulates into sentenceBuffer, detects
  // completed sentences, and fires off background synthesis + `flush()`
  // of a `{ speech: {...} }` chunk for each one — exactly what the Ollama
  // branch always did inline, now shared so OpenRouter gets it too.
  function dispatchSentenceChunks(
    token: string,
    flush: (chunk: string) => Promise<void>
  ): void {
    if (!isVoiceMode || !token) return;
    sentenceBuffer += token;
    let boundary = findSentenceBoundary(sentenceBuffer);
    while (boundary !== -1) {
      const sentence = sentenceBuffer.slice(0, boundary).trim();
      sentenceBuffer = sentenceBuffer.slice(boundary).replace(/^\s+/, "");
      if (sentence) {
        const seq = speechSequence++;
        console.log(`[VOICE STREAM] Sentence ${seq}:`, sentence);
        const task = (async () => {
          try {
            const speech = await (await getSpeechManager()).synthesize({
              text:        sentence,
              providerId:  speechProviderId,
              modelId:     speechModelId,
              voiceId:     speechVoiceId,
              speed:       speechSpeed,
              pitch:       speechPitch,
              temperature: speechTemperature,
              volume:      speechVolume,
            });
            audioChunksBySeq.set(seq, speech.audioData);
            await flush(JSON.stringify({
              speech: {
                sequence:   seq,
                audio:      speech.audioData.toString("base64"),
                format:     speech.format,
                sampleRate: speech.sampleRate,
                duration:   speech.duration,
                voice:      speech.voiceId,
              },
            }));
            console.log(`[VOICE STREAM] Sentence ${seq} synthesis done.`);
          } catch (synthErr) {
            console.error(`[VOICE STREAM] Sentence ${seq} synthesis failed:`, synthErr);
          }
        })();
        pendingSpeechTasks.push(task);
      }
      boundary = findSentenceBoundary(sentenceBuffer);
    }
  }

  // ── Shared voice-pipeline finalisation ──────────────────────────────────
  // Call once after a branch's token stream ends: synthesizes any trailing
  // remainder, awaits all in-flight synthesis tasks, then concatenates
  // every succeeded chunk into one saved WAV and flushes `{ fullAudio }`
  // so the frontend replay button has something to fetch.
  async function finalizeVoicePipeline(
    flush: (chunk: string) => Promise<void>
  ): Promise<void> {
    if (isVoiceMode && sentenceBuffer.trim().length > 0) {
      const seq = speechSequence++;
      console.log(`[VOICE STREAM] Final remainder (sentence ${seq}):`, sentenceBuffer.trim());
      const finalTask = (async () => {
        try {
          const speech = await (await getSpeechManager()).synthesize({
            text:        sentenceBuffer.trim(),
            providerId:  speechProviderId,
            modelId:     speechModelId,
            voiceId:     speechVoiceId,
            speed:       speechSpeed,
            pitch:       speechPitch,
            temperature: speechTemperature,
            volume:      speechVolume,
          });
          audioChunksBySeq.set(seq, speech.audioData);
          await flush(JSON.stringify({
            speech: {
              sequence:   seq,
              audio:      speech.audioData.toString("base64"),
              format:     speech.format,
              sampleRate: speech.sampleRate,
              duration:   speech.duration,
              voice:      speech.voiceId,
            },
          }));
          console.log(`[VOICE STREAM] Final sentence ${seq} synthesis done.`);
        } catch (synthErr) {
          console.error(`[VOICE STREAM] Final sentence ${seq} synthesis failed:`, synthErr);
        }
      })();
      pendingSpeechTasks.push(finalTask);
    }

    if (pendingSpeechTasks.length > 0) {
      console.log(`[VOICE STREAM] Awaiting ${pendingSpeechTasks.length} synthesis task(s)...`);
      await Promise.all(pendingSpeechTasks);
      console.log("[VOICE STREAM] All synthesis tasks complete.");
    }

    if (isVoiceMode && audioChunksBySeq.size > 0) {
      try {
        const orderedChunks = Array.from(audioChunksBySeq.keys())
          .sort((a, b) => a - b)
          .map((seq) => audioChunksBySeq.get(seq)!);

        const fullAudio = WavUtil.concat(orderedChunks);
        const recordingId = randomUUID();
        const savePath = getGeneratedAudioPath(recordingId);

        await writeFileAtomic(savePath, fullAudio);

        const { sampleRate, channels, bitDepth } = WavUtil.parseHeader(fullAudio);
        const bytesPerFrame = channels * (bitDepth / 8);
        const totalDuration = fullAudio.length > 44 && bytesPerFrame > 0
          ? (fullAudio.length - 44) / (sampleRate * bytesPerFrame)
          : 0;

        console.log(
          `[VOICE STREAM] Saved full-response recording ${recordingId} ` +
          `(${orderedChunks.length} chunks, ${totalDuration.toFixed(2)}s) -> ${savePath}`
        );

        await flush(JSON.stringify({
          fullAudio: {
            id:       recordingId,
            url:      `/api/voice/audio/${recordingId}`,
            duration: totalDuration,
          },
        }));
      } catch (concatErr) {
        console.error("[VOICE STREAM] Failed to save full-response recording:", concatErr);
      }
    }
  }
  // ─────────────────────────────────────────────────────────────────────────

  // ── Route inference: OpenRouter vs Ollama ──────────────────────────────
  if (isOpenRouterModel(body.model)) {
    clearTimeout(generateTimeoutId);
    const orController = new AbortController();
    const orTimeoutId  = setTimeout(() => orController.abort(), GENERATE_TIMEOUT_MS);

    // Use the same TransformStream/ReadableStream pattern as the Ollama path
    // so the frontend reader loop gets identical NDJSON lines either way.
    const { readable: orReadable, writable: orWritable } = new TransformStream();
    const orWriter  = orWritable.getWriter();
    const orEncoder = new TextEncoder();

    const orFlush = async (obj: Record<string, unknown>) => {
      try {
        await orWriter.write(orEncoder.encode(JSON.stringify(obj) + "\n"));
      } catch { /* client disconnected */ }
    };

    // dispatchSentenceChunks()/finalizeVoicePipeline() (defined above the
    // provider fork) take a `flush(chunk: string)` — same shape as the
    // Ollama branch's `flush` — so wrap orFlush's object-based writer to
    // match instead of duplicating the write logic.
    const orFlushRaw = async (chunk: string) => {
      try {
        await orWriter.write(orEncoder.encode(chunk + "\n"));
      } catch { /* client disconnected */ }
    };

    // Fire-and-forget: stream tokens → NDJSON while the readable is returned.
    (async () => {
      let fullResponse = "";
      try {
        for await (const token of streamOpenRouterGenerate(body.model, ragPrompt, undefined, orController.signal)) {
          fullResponse += token;
          await orFlush({ response: token, thinking: "", done: false });

          // Same per-sentence TTS dispatch the Ollama branch uses — this
          // was previously missing entirely from the OpenRouter branch,
          // which is why voice mode never produced any audio for
          // OpenRouter models: the branch returned before ever touching
          // isVoiceMode, sentence-boundary detection, or synthesize().
          dispatchSentenceChunks(token, orFlushRaw);
        }
        await orFlush({ response: "", thinking: "", done: true });

        // Synthesizes any trailing remainder, awaits in-flight synthesis,
        // and flushes { fullAudio } for the replay button — same as the
        // Ollama branch's finalization step.
        await finalizeVoicePipeline(orFlushRaw);

        // NOTE: message persistence is intentionally NOT done here. The
        // frontend (chat.js saveMessage(), voice.js this.api.saveMessage())
        // already persists both user and assistant turns via
        // trpc.message.create / POST /api/voice/message after the stream
        // completes, for both Ollama and OpenRouter models — see chat.js
        // line ~379 and voice.js's stream() completion handler. The
        // previous code here tried to *also* save server-side via
        // dynamically-imported saveMessage/saveVoiceMessage functions that
        // were never actually exported from queries/conversation.ts or
        // services/voiceConversationMemory.ts (only summary/getter
        // functions live there) — every call threw
        // "TypeError: ... is not a function", logged loudly, and did
        // nothing, since the frontend save already covers persistence.
      } catch (err) {
        const isAbort = err instanceof Error && err.name === "AbortError";
        console.error(isAbort ? "[OPENROUTER] Timed out" : "[OPENROUTER] Stream error:", err);
        await orFlush({ error: isAbort ? "OpenRouter timed out" : String(err), done: true });
      } finally {
        clearTimeout(orTimeoutId);
        try { await orWriter.close(); } catch { /* already closed */ }
      }
    })();

    return new Response(orReadable, {
      headers: { "Content-Type": "application/x-ndjson" },
    });
  }

  // ── Ollama streaming path (unchanged below) ──────────────────────────────

  try {

      const ollamaPayload: any = {
          model: body.model,
          prompt: ragPrompt,
          stream: true,
      };

      if (supportsThinking(body.model)) {
          ollamaPayload.think = true;
      }

      ollamaResponse = await fetch(
          "http://localhost:11434/api/generate",
          {
              method: "POST",
              headers: {
                  "Content-Type": "application/json",
              },
              body: JSON.stringify(ollamaPayload),
              signal: generateController.signal,
          }
      );

  } catch (err) {
    clearTimeout(generateTimeoutId);
    // Ollama unreachable / connection refused / reset while GPU busy /
    // aborted by GENERATE_TIMEOUT_MS above.
    const isAbort = err instanceof Error && err.name === "AbortError";
    console.error(
      isAbort
        ? `[OLLAMA] generate timed out after ${GENERATE_TIMEOUT_MS}ms`
        : "[OLLAMA] generate fetch failed:",
      err
    );
    return c.json(
      {
        error: isAbort
          ? "Model backend timed out generating a response."
          : "Failed to reach the model backend.",
        detail: String(err),
      },
      isAbort ? 504 : 502
    );
  }

  clearTimeout(generateTimeoutId);

  // FIX 4: Ollama can return a non-2xx response (model still loading from the
  // router call moments earlier, OOM, context too large after tool-result
  // injection, etc). This was never checked, so the body — an error payload,
  // not NDJSON — was read line by line, every JSON.parse silently failed in
  // the catch{continue} below, and the stream closed having flushed ZERO
  // tokens. That is indistinguishable from "not answering" on the frontend,
  // which matches exactly what you're seeing once a tool result is injected.
  if (!ollamaResponse.ok || !ollamaResponse.body) {
    const errText = await ollamaResponse.text().catch(() => "");
    console.error(`[OLLAMA] generate returned ${ollamaResponse.status}:`, errText);
    return c.json(
      { error: `Model backend returned ${ollamaResponse.status}`, detail: errText },
      502
    );
  }

  // FIX 3: transform Ollama's raw NDJSON into the { response, thinking } shape
  // the frontend expects. Ollama streams lines like: { "response": "token", "done": false }
  // We pass "response" tokens through directly; thinking tokens (if model supports it via
  // a <think> tag convention) are split out. Without this transform the frontend's
  // processLine() never gets valid JSON it can parse into answerTarget.
  let completeResponse = "";

  // NOTE: isVoiceMode, speech settings, sentenceBuffer, findSentenceBoundary,
  // dispatchSentenceChunks(), and finalizeVoicePipeline() are now all set up
  // once, above, before the OpenRouter/Ollama fork — see the "Streaming
  // Speech Pipeline (setup)" block earlier in this handler. Both branches
  // share the same instances.

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  (async () => {
    const reader = ollamaResponse.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let inThinkBlock = false;
    let thinkBuffer = "";

    const flush = async (chunk: string) => {
      try {
        await writer.write(encoder.encode(chunk + "\n"));
      } catch (err) {
        // Writer already closed (client disconnected) — log and swallow so
        // this doesn't throw out of the read loop and leave the reader
        // dangling / become an unhandled rejection.
        console.error("[STREAM] write failed:", err);
      }
    };

    if (decision.status) {

    await flush(

        JSON.stringify({

            status: decision.status

        })

    );

}

    // FIX 12: reader.read() had no timeout at all. If Ollama accepts the
    // connection (status 200, headers fine) but then stalls mid-stream —
    // GPU stuck on the previous call, model swapping, OOM mid-generation —
    // this awaits forever with zero server-side log output. That matches
    // exactly what you're seeing: a clean FINAL PROMPT log and then nothing,
    // because the server genuinely has nothing to report yet — it's still
    // waiting. A per-chunk stall watchdog turns that silent hang into a
    // logged, client-visible error after a bounded wait.
    const STALL_TIMEOUT_MS = 60_000;
    const readWithStallTimeout = (): ReturnType<typeof reader.read> => {
      return Promise.race([
        reader.read(),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`No data from model for ${STALL_TIMEOUT_MS}ms — stream stalled`)),
            STALL_TIMEOUT_MS
          )
        ),
      ]);
    };

    try {
      while (true) {
        const { value, done } = await readWithStallTimeout();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;

          let parsed: any;
          try {
            parsed = JSON.parse(line);
          } catch {
            continue;
          }

          const token: string = parsed.response ?? "";

          // FIX 5: Ollama emits valid-JSON error lines like
          // {"error":"model requires more system memory..."} mid-stream.
          // These pass JSON.parse fine, have no .response field, and were
          // previously falling through as a silent empty token — the loop
          // would keep reading, hit done, and close with nothing ever sent
          // to the user. Surface it instead.
          if (parsed.error) {
            console.error("[OLLAMA] stream error payload:", parsed.error);
            await flush(JSON.stringify({ error: String(parsed.error) }));
            continue;
          }

          // Ollama's native reasoning field (present when "think": true is
          // sent in the request above, on Ollama versions/models that
          // support it). Streamed incrementally, one small chunk per line,
          // same as "response" tokens — forward each chunk as it arrives
          // instead of buffering the whole trace until the end, so the
          // thinking box fills in live.
          if (parsed.thinking) {
            await flush(JSON.stringify({ thinking: parsed.thinking }));
            continue;
          }

          // Detect <think>...</think> blocks emitted by reasoning models
          // as literal tags inside "response" — fallback path for
          // models/Ollama versions that don't use the native "thinking"
          // field above.
          if (token.includes("<think>")) {
            inThinkBlock = true;
            const after = token.split("<think>")[1] ?? "";
            if (after) thinkBuffer += after;
            continue;
          }

          if (inThinkBlock) {
            if (token.includes("</think>")) {
              inThinkBlock = false;
              const before = token.split("</think>")[0] ?? "";
              thinkBuffer += before;
              // Emit buffered thinking in one go
              await flush(JSON.stringify({ thinking: thinkBuffer }));
              thinkBuffer = "";
              const after = token.split("</think>")[1] ?? "";
              if (after) await flush(JSON.stringify({ response: after }));
            } else {
              thinkBuffer += token;
            }
            continue;
          }

          if (token) {
            completeResponse += token;
            await flush(JSON.stringify({ response: token }));

            // Accumulate tokens and dispatch each confirmed sentence for
            // TTS synthesis immediately, without waiting for the full LLM
            // response to finish. Shared with the OpenRouter branch — see
            // dispatchSentenceChunks() defined above the provider fork.
            dispatchSentenceChunks(token, flush);
          }
        }
      }
    } catch (err) {
      // FIX 6: previously there was no catch here at all — only finally.
      // A throw inside the read loop (connection reset, decode error, etc)
      // would run finally then rethrow, becoming an unhandled rejection in
      // this detached IIFE. The client never learns anything went wrong;
      // the stream just stops. Surface it as a proper error chunk instead.
      console.error("[STREAM] read loop failed:", err);
      await flush(JSON.stringify({ error: String(err instanceof Error ? err.message : err) }));
    } finally {

    // Synthesizes any trailing remainder, awaits all in-flight synthesis
    // tasks, then concatenates every succeeded chunk into one saved WAV and
    // flushes `{ fullAudio }`. Shared with the OpenRouter branch — see
    // finalizeVoicePipeline() defined above the provider fork.
    await finalizeVoicePipeline(flush);

    await writer.close();

}
  })();

  return new Response(readable, {
    headers: { "Content-Type": "application/x-ndjson" },
  });
});

// ─────────────────────────────────────────────────────────────────────────
// /api/chat/agent-stream — "Extended Thinking" toggle.
//
// Separate endpoint from /api/chat/stream (which is left completely
// untouched above). Same request body shape, but instead of one Ollama
// call + optional single-shot tool router, this runs services/agentLoop.ts:
// generate -> optional tool call -> execute -> feed result back ->
// generate again -> ... -> final answer, no round cap. See agentLoop.ts
// for the full design rationale.
//
// Reuses the same context-building pieces as /api/chat/stream (attachment
// search, conversation window + summary, memory context) so the agent loop
// starts from the same grounded context — it just doesn't go through
// toolRouter.ts/toolPipeline.ts, since the agent loop does its own
// multi-round tool calling instead of a single pre-decided plan.
//
// Wire protocol: NDJSON, one JSON object per line, same convention as
// /api/chat/stream. Event shapes are a superset — { round }, { thinking },
// { tool_call }, { tool_result }, { response }, { status }, { error } — see
// AgentEvent in agentLoop.ts.
// ─────────────────────────────────────────────────────────────────────────
app.post("/api/chat/agent-stream", async (c) => {
  const body: any = await safeJson(c);
  if (!body) {
    return c.json({ error: "Request body is missing or not valid JSON." }, 400);
  }

  const isVoice = body.mode === "voice";

  // ── Attachment context (same as /api/chat/stream) ───────────────────────
  let attachmentContext = "";
  if (body.conversationId) {
    const attachmentChunks = await searchChatAttachments(
      body.conversationId,
      body.prompt,
      8
    );
    if (attachmentChunks.length > 0) {
      attachmentContext = `
==================================================
ATTACHMENT CONTEXT
==================================================

${attachmentChunks.map(chunk => chunk.content).join("\n\n")}

==================================================

The above information comes from the user's attached documents.
Use it as the primary reference whenever relevant.
`;
    }
  }

  // ── Conversation window + summary (same as /api/chat/stream) ───────────
  let finalConversationContext = "";
  if (body.conversationId) {
    const existingSummary = isVoice
      ? await getVoiceConversationSummary(body.conversationId)
      : await getConversationSummary(Number(body.conversationId));

    const summarizedMessageCount = isVoice
      ? await getVoiceConversationSummarizedCount(body.conversationId)
      : await getConversationSummarizedCount(Number(body.conversationId));

    const built = await buildConversationContext({
      conversationId: body.conversationId,
      isVoice,
      existingSummary,
      summarizedMessageCount,
    });

    finalConversationContext = built.context;

    if (built.needsSummary) {
      const combinedSummary = await summarizeConversation(
        built.messagesToSummarize,
        body.model
      );

      if (isVoice) {
        await updateVoiceConversationSummary(
          body.conversationId,
          combinedSummary,
          built.messagesToSummarize.length
        );
      } else {
        await updateConversationSummaryWithCount(
          Number(body.conversationId),
          combinedSummary,
          built.messagesToSummarize.length
        );
      }

      const rebuilt = await buildConversationContext({
        conversationId: body.conversationId,
        isVoice,
        existingSummary: combinedSummary,
        summarizedMessageCount: built.messagesToSummarize.length,
      });
      finalConversationContext = rebuilt.context;
    }
  }

  // ── Memory context (same as /api/chat/stream) ───────────────────────────
  const memoryContext = await buildMemoryContext(body.prompt);

  const baseContext = `
${finalConversationContext}

${attachmentContext}

${memoryContext}
`;

  // NOTE: the "AGENT LOOP START" banner itself is printed once, inside
  // runAgentLoop() (agentLoop.ts) — that's the single source of truth for
  // loop-start logging. Here we only log the baseContext breakdown, which
  // agentLoop.ts doesn't have the per-piece char counts for (it only sees
  // the already-concatenated baseContext string).
  console.log("[AGENT] baseContext breakdown:", {
    conversationContextChars: finalConversationContext.length,
    attachmentContextChars:   attachmentContext.length,
    memoryContextChars:       memoryContext.length,
    totalBaseContextChars:    baseContext.length,
    totalBaseContextTokensEst: Math.ceil(baseContext.length / 3.5),
  });

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  const flush = async (event: AgentEvent) => {
    try {
      await writer.write(encoder.encode(JSON.stringify(event) + "\n"));
    } catch (err) {
      // Writer already closed (client disconnected) — same defensive
      // swallow as /api/chat/stream's flush().
      console.error("[AGENT STREAM] write failed:", err);
    }
  };

  (async () => {
    try {
      const { finalAnswer, transcript } = await runAgentLoop(
        {
          model: body.model,
          userPrompt: body.prompt,
          baseContext,
          timezone: body.timezone,
        },
        flush
      );

      if (body.conversationId && finalAnswer) {
        // Persist the assistant's final answer the same way the existing
        // single-shot flow does via saveMessage() on the frontend — but
        // since intermediate tool rounds aren't separate chat messages,
        // only the final answer is saved here, same as today's behavior
        // where only the final "response" text becomes the stored message.
        console.log(`[AGENT] Final answer ready | conversationId=${body.conversationId} | length=${finalAnswer.length} chars`);
      } else if (finalAnswer) {
        console.log(`[AGENT] Final answer ready (no conversationId) | length=${finalAnswer.length} chars`);
      } else {
        console.warn("[AGENT] Loop completed with no final answer.");
      }

      // ── Post-loop synthesis pass ──────────────────────────────────────
      // Runs AFTER the agent loop has fully returned — finalAnswer above is
      // already final and is never touched by this. This is purely an
      // additional, longer recap of the whole session (every tool call and
      // result) streamed as its own summary_chunk/summary_done events, for
      // the frontend to render as a separate "here's everything that
      // happened" block underneath the real final answer. Wrapped in its
      // own try/catch so a failure here can never affect the already-
      // successful agent loop result or prevent the writer from closing.
      try {
        await synthesizeExecutionSummary(body.model, body.prompt, transcript, flush);
      } catch (err) {
        console.error("[AGENT] Post-loop summary synthesis failed:", err);
        await flush({ error: `Summary synthesis failed: ${err instanceof Error ? err.message : String(err)}` });
      }
    } catch (err) {
      console.error("[AGENT STREAM] loop failed:", err);
      await flush({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      await writer.close();
    }
  })();

  return new Response(readable, {
    headers: { "Content-Type": "application/x-ndjson" },
  });
});

app.get("/api/speech/providers", async (c) => {

    return c.json({

        providers:
            (await getSpeechManager())
                .getProviderManager()
                .listProviders()

    });

});

app.get("/api/speech/models", async (c) => {

    const providerId =
    c.req.query("provider") as ProviderId;

    if (!providerId) {

        return c.json({

            models: []

        });

    }

    const provider =
        (await getSpeechManager())
            .getProviderManager()
            .getProvider(providerId as ProviderId);

    if (!provider) {

        return c.json({

            models: []

        });

    }

    return c.json({

        models:
            await provider.listModels()

    });

});

app.get("/api/speech/voices", async (c) => {

    const providerId =
    c.req.query("provider") as ProviderId;

    const modelId =
        c.req.query("model");

    if (!providerId) {

        return c.json({

            voices: []

        });

    }

    const provider =
        (await getSpeechManager())
            .getProviderManager()
            .getProvider(providerId as ProviderId);

    if (!provider) {

        return c.json({

            voices: []

        });

    }

    // Aggregates local + online worker voices (see ProviderManager.listVoices())
    // instead of calling provider.listVoices() directly, which only ever
    // returns this machine's local voices and never reaches the cluster.
    const voices =
        await (await getSpeechManager())
            .getProviderManager()
            .listVoices(providerId as ProviderId, modelId);

    return c.json({

        voices

    });

});

app.get("/api/speech/profiles", async (c) => {

    return c.json({

        profiles:
            await (await getSpeechManager())
                .getProfileManager()
                .getAllProfiles()

    });

});

app.post("/api/speech/tts", async (c) => {

    try {

        const body = await safeJson(c);

        if (!body?.text || typeof body.text !== "string" || !body.text.trim()) {

            return c.json(
                {
                    success: false,
                    error: "No text provided",
                },
                400
            );

        }

        console.log("\n========== TTS REQUEST ==========");
        console.log({
            textLength: body.text.length,
            providerId: body.providerId,
            modelId: body.modelId,
            voiceId: body.voiceId,
            profileId: body.profileId,
        });
        console.log("=================================\n");

        const mgr = await getSpeechManager();
        const result =
            await mgr.synthesize({

                text: body.text,

                providerId: body.providerId,

                modelId: body.modelId,

                voiceId: body.voiceId,

                profileId: body.profileId,

                language: body.language,

                speed: body.speed,

                pitch: body.pitch,

                volume: body.volume,

                temperature: body.temperature,

                emotion: body.emotion,

            });

        return c.json({

            success: true,

            audio: result.audioData.toString("base64"),

            format: result.format,

            sampleRate: result.sampleRate,

            duration: result.duration,

            providerId: result.providerId,

            modelId: result.modelId,

            voiceId: result.voiceId,

        });

    } catch (err) {

        console.error("========== TTS ERROR ==========");
        console.error(err);
        console.error("===============================\n");

        return c.json(
            {
                success: false,
                error:
                    err instanceof Error
                        ? err.message
                        : String(err),
            },
            500
        );

    }

});

app.post("/api/speech/stt", async (c) => {
    try {
        const form = await c.req.formData();
        const audio = form.get("audio");
        if (!(audio instanceof File)) {
            return c.json(
                {
                    success: false,
                    error: "No audio file provided",
                },
                400
            );
        }
        const providerId =
            ((form.get("providerId") as ProviderId) ??
                ("whisper" as ProviderId));
        const modelId =
            (form.get("modelId") as string | null) ?? undefined;
        const language =
            (form.get("language") as string | null) ?? undefined;
        const sampleRate =
            Number(form.get("sampleRate")) || 16000;
        const audioBuffer =
            Buffer.from(await audio.arrayBuffer());
        const extension =
            audio.name
                .split(".")
                .pop()
                ?.toLowerCase() ?? "";
        const mime =
            audio.type.toLowerCase();
        let format: "wav" | "mp3" | "ogg" | "pcm" | "webm";
        switch (extension) {
            case "wav":
                format = "wav";
                break;
            case "mp3":
                format = "mp3";
                break;
            case "ogg":
                format = "ogg";
                break;
            case "pcm":
                format = "pcm";
                break;
            case "webm":
                format = "webm";
                break;
            default:
                if (mime.includes("webm")) {
                    format = "webm";
                } else if (mime.includes("wav")) {
                    format = "wav";
                } else if (mime.includes("mpeg")) {
                    format = "mp3";
                } else if (mime.includes("ogg")) {
                    format = "ogg";
                } else {
                    return c.json(
                        {
                            success: false,
                            error: `Unsupported audio format: ${extension || mime}`,
                        },
                        400
                    );
                }
        }
        console.log("\n========== STT REQUEST ==========");
        console.log({
            fileName: audio.name,
            mimeType: mime,
            extension,
            detectedFormat: format,
            size: audioBuffer.length,
            providerId,
            modelId,
            sampleRate,
        });
        console.log("=================================\n");

        const mgr = await getSpeechManager();
        const result =
            await mgr.transcribe({

                audioData: audioBuffer,

                format,

                sampleRate,

                providerId,

                modelId,

                language,

            });

        return c.json(result);

    } catch (err) {

        console.error("========== STT ERROR ==========");
        console.error(err);
        console.error("===============================\n");

        return c.json(
            {
                success: false,
                error:
                    err instanceof Error
                        ? err.message
                        : String(err),
            },
            500
        );

    }

});

app.put("/api/speech/profiles", async (c) => {

    const profile = await safeJson(c);

    if (!profile) {

        return c.json(

            { success: false, error: "Request body is missing or not valid JSON." },

            400

        );

    }

    console.log("========== PROFILE SAVE ==========");
    console.log(profile);
    console.log("==================================");

    const manager = (await getSpeechManager()).getProfileManager();

    if (profile.id) {

        await manager.updateProfile(

            profile.id,

            profile

        );

    } else {

         if (!profile.name) profile.name = "Custom Profile";
    await manager.createProfile(profile);

    }

    return c.json({

        success: true

    });

});

app.get("/api/speech/health", async (c) => {

    const report =
        await (await getSpeechManager())
            .getHealthManager()
            .getHealthReport();

    return c.json(report);

});

app.post("/api/voice/conversation", async (c) => {
    try {
        const db = getDb();
        const body = await safeJson(c);
        if (!body) {
            return c.json({ success: false, error: "Request body is missing or not valid JSON." }, 400);
        }
        const id = randomUUID();
        await db.insert(voiceConversations).values({
            id,
            title: "New Conversation",
            modelId: body.model,
            mode: body.mode,
            providerId: body.providerId,
            speechModelId: body.modelId,
            voiceId: body.voiceId,
        });
        return c.json({
            success: true,
            id,
        });
    } catch (err) {
        console.error("========== VOICE CONVERSATION ERROR ==========");
        console.error(err);
        console.error("==============================================");
        return c.json({
            success: false,
            error: err instanceof Error ? err.message : String(err),
        }, 500);
    }
});

app.post("/api/voice/message", async (c) => {
    const db = getDb();
    const body = await safeJson(c);
    if (!body) {
        return c.json({ success: false, error: "Request body is missing or not valid JSON." }, 400);
    }
    const id = randomUUID();
    await db.insert(voiceMessages).values({
        id,
        conversationId: body.conversationId,
        role: body.role,
        content: body.content,
        audio: body.audio ?? null,
        providerId: body.providerId ?? null,
        speechModelId: body.speechModelId ?? null,
        voiceId: body.voiceId ?? null,
        duration: body.duration ?? null,
        tokensUsed: body.tokensUsed ?? 0,
        responseTime: body.responseTime ?? null,
    });
    if (body.role === "user") {
        const conversation = await db
            .select()
            .from(voiceConversations)
            .where(
                eq(
                    voiceConversations.id,
                    body.conversationId
                )
            )
            .then(r => r[0]);
        if (
            conversation &&
            conversation.title === "New Conversation"
        ) {
            await db
                .update(voiceConversations)
                .set({
                    title:
                    body.content.length > 60
                            ? body.content.substring(0, 60)
                            : body.content
                })
                .where(
                    eq(
                        voiceConversations.id,
                        body.conversationId
                    )
                );
        }
    }
    return c.json({
        success: true,
        id,
    });
});

app.post("/api/voice/conversation/rename", async (c) => {
    try {
        const db = getDb();
        const body = await safeJson(c);
        if (!body) {
            return c.json({ success: false, error: "Request body is missing or not valid JSON." }, 400);
        }
        await db
            .update(voiceConversations)
            .set({
                title: body.title,
                updatedAt: new Date(),
            })
            .where(
                eq(
                    voiceConversations.id,
                    body.conversationId
                )
            );
        return c.json({
            success: true,
        });
    } catch (err) {
        console.error(err);
        return c.json({
            success: false,
            error:
                err instanceof Error
                    ? err.message
                    : String(err),
        }, 500);
    }
});

app.delete(

    "/api/voice/conversation/:id",

    async (c) => {
        try {
            const db = getDb();
            const id =
                c.req.param("id");
            await db
                .delete(
                    voiceConversations
                )
                .where(
                    eq(
                        voiceConversations.id,
                        id
                    )
                );
            return c.json({
                success: true,
            });
        } catch (err) {
            console.error(err);
            return c.json({
                success: false,
                error:
                    err instanceof Error
                        ? err.message
                        : String(err),
            }, 500);
        }
    }
);

app.get("/api/voice/messages/:id", async (c) => {
      const id = c.req.param("id");
      const db = getDb();
      const rows = await db
          .select()
          .from(voiceMessages)
          .where(eq(
              voiceMessages.conversationId,
              id
          ));
      return c.json(rows);
  });

// Serves a saved full-response voice recording (concatenated from every
// streamed sentence of one assistant turn) back for replay. `id` is a
// randomUUID minted when the recording was saved — getGeneratedAudioPath
// runs it through sanitizeFilename before touching the filesystem, so this
// can't be used to read arbitrary paths even if something odd shows up here.
app.get("/api/voice/audio/:id", async (c) => {
    const id = c.req.param("id");
    const filePath = getGeneratedAudioPath(id);

    let data: Buffer;
    try {
        data = await fs.promises.readFile(filePath);
    } catch {
        return c.json({ success: false, error: "Recording not found" }, 404);
    }

    return new Response(data, {
        headers: {
            "Content-Type":   "audio/wav",
            "Content-Length": String(data.length),
            // Recordings are immutable once written (each gets a fresh
            // UUID), so they're safe to cache aggressively client-side.
            "Cache-Control":  "public, max-age=31536000, immutable",
        },
    });
});

app.get("/api/voice/conversations", async (c) => {

    const db = getDb();

    const conversations = await db
        .select()
        .from(voiceConversations)
        .orderBy(desc(voiceConversations.updatedAt));

    return c.json(conversations);

});

app.get("/api/voice/conversation/:id", async (c) => {
    const id = c.req.param("id");
    const db = getDb();
    const conversation = await db
        .select()
        .from(voiceConversations)
        .where(eq( voiceConversations.id,id))
        .then(r => r[0]);
    if (!conversation) {
        return c.json({error: "Conversation not found"},404);
    }
    const messages = await db
        .select()
        .from(voiceMessages)
        .where(
            eq(
                voiceMessages.conversationId,
                id
            )
        )
        .orderBy(
            asc(
                voiceMessages.createdAt
            )
        );
    return c.json({
        conversation,
        messages,
    });
});

app.patch("/api/voice/conversation/:id", async (c) => {
    const id = c.req.param("id");
    const body = await safeJson(c);
    if (!body) {
        return c.json({ success: false, error: "Request body is missing or not valid JSON." }, 400);
    }
    const { title } = body;
    const db = getDb();
    await db
        .update(voiceConversations)
        .set({ title, updatedAt: new Date(),})
        .where(eq(voiceConversations.id, id));
    return c.json({ success: true, });
});

app.get("/api/voice/messages", async (c) => {
    const db = getDb();
    const conversationId = c.req.query("conversationId");
    if (!conversationId) {
        return c.json([]);
    }
    const messages = await db
        .select()
        .from(voiceMessages)
        .where(
            eq(
                voiceMessages.conversationId,
                conversationId
            )
        )
        .orderBy(
            voiceMessages.createdAt
        );
    return c.json(messages);
});

app.get("/api/system/services", async (c) => {
  const processes = await pslist();

  const findService = (keywords: string[]) => {
    return processes.some((p) =>
      keywords.some((keyword) => p.name.toLowerCase().includes(keyword))
    );
  };

  return c.json([
    { name: "Ollama", status: findService(["ollama"]) ? "running" : "stopped" },
    { name: "MySQL", status: findService(["mysqld", "mysql"]) ? "running" : "stopped" },
    { name: "Node Backend", status: findService(["node"]) ? "running" : "stopped" },
    { name: "ComfyUI", status: findService(["comfyui"]) ? "running" : "stopped" },
  ]);
});

app.get("/api/system/processes", async (c) => {
  const processes = await pslist();

  const interestingProcesses = processes
    .filter((p) =>
      ["ollama", "node", "python", "mysqld", "mysql", "comfyui"].some((name) =>
        p.name.toLowerCase().includes(name)
      )
    )
    .slice(0, 20);

  const result = await Promise.all(
    interestingProcesses.map(async (proc) => {
      try {
        const stats = await pidusage(proc.pid);
        return {
          pid: proc.pid,
          name: proc.name,
          cpu: Number(stats.cpu.toFixed(1)),
          ram: Math.round(stats.memory / 1024 / 1024),
        };
      } catch {
        return null;
      }
    })
  );

  return c.json(result.filter(Boolean));
});

app.get("/api/system/storage", async (c) => {
  const disks = await si.fsSize();
  return c.json(
    disks.map((disk) => ({
      filesystem: disk.fs,
      mount: disk.mount,
      total: disk.size,
      used: disk.used,
      available: disk.available,
      usagePercent: disk.use,
    }))
  );
});

app.get("/api/providers", (c) => {
  const mediaType = c.req.query("mediaType");
  if (mediaType !== "image" && mediaType !== "video") {
    return c.json({ success: false, error: "mediaType query param must be 'image' or 'video'" }, 400);
  }
  const providers = listProviders(mediaType).map((p) => ({
    id: p.id,
    label: p.label,
    executor: p.executor,
  }));
  return c.json({ success: true, providers });
});

// ── Image Studio realtime (mirrors the FramesX SSE pattern above) ───────
const imageJobListeners = new Map<string, Set<(event: any) => void>>();

function emitToImageJob(jobId: string, event: any) {
  const listeners = imageJobListeners.get(jobId);
  if (!listeners) return;
  for (const listener of listeners) listener(event);
}

app.post("/api/image/generate", async (c) => {
  const body = await safeJson(c);
  if (!body) {
    return c.json({ success: false, error: "Request body is missing or not valid JSON." }, 400);
  }

  const input = {
    prompt: body.prompt,
    negativePrompt: body.negativePrompt ?? "",
    width: body.width ?? 1024,
    height: body.height ?? 1024,
    steps: body.steps ?? 20,
    cfg: body.cfg ?? 1,
    denoise: body.denoise ?? 1,
    batchSize: body.batchSize ?? 1,
    sampler: body.sampler ?? "euler",
    scheduler: body.scheduler ?? "simple",
    seed: body.seed,
    providerId: body.providerId,
  };

  const jobId = createJob(input.prompt);
  runGeneration(jobId, input, (event) => emitToImageJob(jobId, event)).catch(console.error);

  return c.json({ success: true, jobId });
});

// GET /api/image/stream/:jobId — live SSE feed, same shape/usage as
// /api/video/stream/:jobId below. Open right after POST /api/image/generate
// returns. /api/image/status and /api/image/result remain correct as a
// fallback if the stream drops.
app.get("/api/image/stream/:jobId", async (c) => {
  const jobId = c.req.param("jobId");

  if (!generationJobs.get(jobId)) {
    return c.json({ success: false, error: "Unknown job id." }, 404);
  }

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const send = (event: any) => {
        controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));
      };

      if (!imageJobListeners.has(jobId)) imageJobListeners.set(jobId, new Set());
      const listeners = imageJobListeners.get(jobId)!;

      const listener = (event: any) => {
        send(event);
        if (event.type === "done" || event.type === "error") {
          listeners.delete(listener);
          if (listeners.size === 0) imageJobListeners.delete(jobId);
          controller.close();
        }
      };

      listeners.add(listener);

      // Replay current state immediately for a tab that opens the stream
      // slightly late or reconnects.
      const job = generationJobs.get(jobId);
      if (job) {
        send({
          type: job.status === "completed" ? "done" : job.status === "failed" ? "error" : "comfy_progress",
          value: job.currentStep ?? 0,
          max: job.totalSteps ?? 0,
          error: job.error,
          result: job.status === "completed" ? job : undefined,
        });
      }
    },
    cancel() {
      // Listener cleanup happens on "done"/"error"; an early client
      // disconnect just leaves the listener until the job finishes, same
      // trade-off the video stream already accepts.
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

app.get("/api/image/status/:jobId", (c) => {
  const jobId = c.req.param("jobId");
  const job = generationJobs.get(jobId);
  if (!job) return c.json({ status: "unknown" });
  return c.json(job);
});

app.get("/api/image/result/:jobId", (c) => {
  const jobId = c.req.param("jobId");
  const job = generationJobs.get(jobId);
  if (!job) return c.json(null);
  return c.json({
    imageUrl: job.imageUrl,
    seed: job.seed,
    generationTime: job.generationTime,
    status: job.status,
  });
});

// ── FramesX (video studio) ──────────────────────────────────────────────
//
// /api/video/generate + /api/video/status/:jobId + /api/video/result/:jobId
// mirror /api/image/* exactly (poll-based fallback/resume path — same shape
// consumers already know from the image studio).
//
// /api/video/stream/:jobId is the new piece: an SSE channel that relays
// every live event framesx.ts's orchestrator emits — LLM planning tokens as
// they're generated, which ComfyUI node is executing, live sampler
// step/total, per-scene completion, the ffmpeg merge step, and the final
// result — as it happens, not on a 1s poll interval. Same
// ReadableStream+SSE pattern as analyzeStreamRouter's /analyze-stream.
//
// The frontend is expected to open the stream immediately after a
// successful POST /api/video/generate and drive its live log / scene queue
// UI from it; /status and /result remain correct even if the stream drops
// (tab backgrounded, network blip) since every emit also writes into
// videoJobs.

// In-memory per-job SSE fan-out. A job is normally watched by exactly one
// browser tab, but this supports more without re-running the generation.
const videoJobListeners = new Map<string, Set<(event: FramesXEvent) => void>>();

function emitToJob(jobId: string, event: FramesXEvent) {
  const listeners = videoJobListeners.get(jobId);
  if (!listeners) return;
  for (const listener of listeners) listener(event);
}

app.post("/api/video/generate", async (c) => {
  const body = await safeJson(c);
  if (!body) {
    return c.json({ success: false, error: "Request body is missing or not valid JSON." }, 400);
  }

  const input = {
    prompt: body.prompt,
    negativePrompt: body.negativePrompt ?? "",
    width: body.width ?? 768,
    height: body.height ?? 512,
    length: body.length ?? 193,
    frameRate: body.frameRate ?? 25,
    fps: body.fps ?? 24,
    steps: body.steps ?? 30,
    cfg: body.cfg ?? 3,
    seed: body.seed,
    format: body.format ?? "webp",
    targetDurationSeconds: body.targetDurationSeconds,
    sceneCountOverride: body.sceneCountOverride,
    planningModel: body.planningModel,
    providerId: body.providerId,
  };

  if (!input.prompt) {
    return c.json({ success: false, error: "prompt is required" }, 400);
  }

  const jobId = createVideoJob(input.prompt);

  runFramesXGeneration(jobId, input, (event) => emitToJob(jobId, event)).catch(console.error);

  return c.json({ success: true, jobId });
});

app.get("/api/video/status/:jobId", (c) => {
  const jobId = c.req.param("jobId");
  const job = videoJobs.get(jobId);
  if (!job) return c.json({ status: "unknown" });
  return c.json(job);
});

app.get("/api/video/result/:jobId", (c) => {
  const jobId = c.req.param("jobId");
  const job = videoJobs.get(jobId);
  if (!job) return c.json(null);
  return c.json({
    videoUrl: job.videoUrl,
    seed: job.seed,
    generationTime: job.generationTime,
    status: job.status,
    sceneCount: job.sceneCount,
    scenes: job.scenes,
    prompt: job.prompt,
  });
});

// GET /api/video/stream/:jobId — live SSE feed for a job already created
// via POST /api/video/generate. Open this right after generate returns.
app.get("/api/video/stream/:jobId", async (c) => {
  const jobId = c.req.param("jobId");

  if (!videoJobs.get(jobId)) {
    return c.json({ success: false, error: "Unknown job id." }, 404);
  }

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const send = (event: FramesXEvent) => {
        controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));
      };

      if (!videoJobListeners.has(jobId)) videoJobListeners.set(jobId, new Set());
      const listeners = videoJobListeners.get(jobId)!;

      const listener = (event: FramesXEvent) => {
        send(event);
        if (event.type === "done" || event.type === "error") {
          listeners.delete(listener);
          if (listeners.size === 0) videoJobListeners.delete(jobId);
          controller.close();
        }
      };

      listeners.add(listener);

      // Replay current state immediately so a tab that opens the stream
      // slightly late (or reconnects) isn't stuck on a blank log — send a
      // synthetic snapshot of whatever the job map already has.
      const job = videoJobs.get(jobId);
      if (job) {
        send({
          type: "scene_start",
          index: job.currentSceneIndex,
          total: job.sceneCount,
          prompt: job.scenes[job.currentSceneIndex]?.prompt ?? job.prompt,
        });
        if (job.status === "completed") {
          send({ type: "done", result: { videoUrl: job.videoUrl, seed: job.seed, generationTime: job.generationTime, sceneCount: job.sceneCount, scenes: job.scenes } });
        } else if (job.status === "failed") {
          send({ type: "error", error: job.error ?? "Generation failed." });
        }
      }
    },
    cancel() {
      const listeners = videoJobListeners.get(jobId);
      if (listeners) {
        listeners.clear();
        videoJobListeners.delete(jobId);
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
});

// GET /api/video/list — full DB-backed history, every stored column, so a
// page reload can fully reconstruct past jobs (not just what's in memory
// via videoJobs, which only holds jobs from the current server process).
app.get("/api/video/list", async (c) => {
  const db = getDb();
  const rows = await db.query.generatedVideos.findMany({
    orderBy: (t, { desc }) => [desc(t.createdAt)],
  });
  return c.json({ success: true, videos: rows });
});

// DELETE /api/video/:id — deletes both the DB row and the file on disk.
app.delete("/api/video/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!id || Number.isNaN(id)) {
    return c.json({ success: false, error: "Invalid video id." }, 400);
  }

  const db = getDb();
  const video = await db.query.generatedVideos.findFirst({
    where: eq(generatedVideos.id, id),
  });

  if (!video) {
    return c.json({ success: false, error: "Video not found." }, 404);
  }

  if (video.videoUrl) {
    try {
      const relativePath = video.videoUrl.replace(/^\//, "");
      const absolutePath = path.join(process.cwd(), "public", relativePath);
      fs.unlinkSync(absolutePath);
    } catch (err) {
      console.warn("Video file delete failed:", err);
    }
  }

  await db.delete(generatedVideos).where(eq(generatedVideos.id, id));

  return c.json({ success: true });
});

// GET /api/models/list — plain REST wrapper around Ollama's /api/tags +
// /api/ps, same data modelRouter.list (tRPC) already computes, exposed as
// REST for the static-JS frontend to populate the scene-planning model
// select with real installed models instead of a hardcoded fake list.
app.get("/api/models/list", async (c) => {
  let ollamaModels: any[] = [];
  try {
    const tagsResponse = await fetch("http://localhost:11434/api/tags");
    const tagsData = await tagsResponse.json();

    const psResponse = await fetch("http://localhost:11434/api/ps");
    const psData = await psResponse.json();

    const loadedModels = new Set((psData.models ?? []).map((m: any) => m.name));

    ollamaModels = (tagsData.models ?? []).map((model: any) => ({
      id: model.name,
      name: model.name,
      status: loadedModels.has(model.name) ? "active" : "idle",
      parameterSize: model.details?.parameter_size ?? null,
      quantization: model.details?.quantization_level ?? null,
      source: "ollama",
    }));
  } catch (err) {
    console.error("[/api/models/list] Ollama unreachable:", err);
  }

  try {
    const { listOpenRouterModels } = await import("./services/openRouter");
    const orModels = listOpenRouterModels().map(m => ({
      id: m.id,
      name: m.label,
      status: "active",
      parameterSize: null,
      quantization: null,
      source: "openrouter",
    }));
    return c.json({ success: true, models: [...orModels, ...ollamaModels] });
  } catch (err) {
    console.error("[/api/models/list] Failed to get OpenRouter models:", err);
    return c.json({ success: true, models: ollamaModels });
  }
});

app.get("/uploads/*", async (c) => {
  const filePath = path.join(process.cwd(), c.req.path);
  if (!fs.existsSync(filePath)) return c.notFound();
  return c.body(fs.readFileSync(filePath));
});

app.get("/api/test-embedding", async (c) => {
  const embedding = await generateEmbedding("Hello world");
  return c.json({ length: embedding.length, firstFive: embedding.slice(0, 5) });
});

app.get("/api/backfill-embeddings", async (c) => {
  await backfillEmbeddings();
  return c.json({ success: true });
});

app.get("/api/search", async (c) => {
  const query = c.req.query("q");
  if (!query) return c.json({ error: "Missing query" });
  const results = await searchKnowledge(query);
  return c.json(results);
});

app.get("/api/chat/sources", async (c) => {
  return c.json(latestSources);
});

app.get("/api/test-tavily", async (c) => {
  const result = await searchInternet("Latest NVIDIA news");
  return c.json(result);
});

app.post("/api/cluster/register", async (c) => {
    const worker = await safeJson(c);
    if (!worker) {
        return c.json({ success: false, error: "Request body is missing or not valid JSON." }, 400);
    }
    registerWorker(worker);
    return c.json({ success: true });
});

app.post("/api/cluster/heartbeat", async (c) => {
    const body = await safeJson(c);
    if (!body) {
        return c.json({ success: false, error: "Request body is missing or not valid JSON." }, 400);
    }

    heartbeat(body.id, body.stats);
    // Feeds the Cluster System modal's live graphs — a no-op if this
    // heartbeat's stats don't include health data (nothing to plot).
    if (body.id && body.stats) {
        recordMetricPoint(body.id, body.stats);
    }

    return c.json({ success: true });
});

app.get("/api/cluster/workers", (c) => {
    return c.json(getWorkers());
});

// Proxies a worker's live SSE log stream through to the browser. Not a
// tRPC procedure — tRPC's transport isn't a clean fit for forwarding an
// upstream SSE stream byte-for-byte, and this is a straightforward pass-
// through, same shape as the other raw SSE routes already in this file.
app.get("/api/cluster/:id/logs/stream", async (c) => {
    const workerId = c.req.param("id");
    const source = c.req.query("source"); // "python" | "speech" | "kokoro" | undefined

    const worker = getWorkers().find((w) => w.id === workerId);
    if (!worker) {
        return c.json({ error: "Worker not found" }, 404);
    }

    const url = new URL(`http://${worker.ip}:${worker.port}/logs/stream`);
    if (source) url.searchParams.set("source", source);

    let upstream: Response;
    try {
        upstream = await fetch(url.toString());
    } catch (err) {
        return c.json({ error: `Worker unreachable: ${err instanceof Error ? err.message : String(err)}` }, 502);
    }

    if (!upstream.body) {
        return c.json({ error: "Worker returned no stream body" }, 502);
    }

    // Straight byte pass-through — the worker already frames this as
    // `data: {...}\n\n` SSE, so there's nothing to transform here.
    return new Response(upstream.body, {
        headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
        },
    });
});

setInterval(() => {
    removeOfflineWorkers();
}, 5000);


app.route("/api/forge", forgeStreamRouter);
app.route("/api/forgex", forgexStreamRouter);


//All other routes should be declared before this scope, otherwise they will not be reachable. This is a catch-all route for any undefined API endpoints.

app.all("/api/*", (c) => c.json({ error: "Not Found" }, 404));

export default app;

if (env.isProduction) {
  const { serve } = await import("@hono/node-server");
  const { serveStaticFiles } = await import("./lib/vite");
  serveStaticFiles(app);

  const port = parseInt(process.env.PORT || "3000");
  serve({ fetch: app.fetch, port }, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}