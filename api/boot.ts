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
import { searchInternet, formatSearchResults } from "./services/tavily";
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
import { shouldUseTools, resolveToolsDirectly, type ToolDecision } from "./services/toolRouter";
import { classifyIntent, type IntentCategory } from "./services/intentClassifier";
import { semanticCache } from "./services/semanticCache";
import { buildApcPrompt } from "./lib/apcPrompt";
import { isKnowledgeCutoffRefusal } from "./lib/cutoffDetector";
import { removeOfflineWorkers } from "./services/cluster";
import {registerWorker,heartbeat,getWorkers,} from "./services/cluster";
import { recordMetricPoint } from "./services/clusterMetricsHistory";
import { startWorkerPoller } from "./services/workerPoller";

import { runtimeManager } from "./services/runtime/manager";
import { startCompanionService } from "./services/companion";
import { forgeStreamRouter } from "./forge/routes";
import { forgexStreamRouter } from "./forgex/routes";
import { isOpenRouterModel, streamOpenRouterGenerate, streamOpenRouterTyped } from "./services/openRouter";
import { authRouter } from "./routers/auth.router";
import { verifyWorkerKey, verifySession } from "./services/auth.service";
import { evaluateCloudflareAccess } from "./services/cloudflare.service";
import { validateCsrfProtection, applySecurityHeaders } from "./services/security.service";




function supportsThinking(model: string): boolean {
    const normalized = model.toLowerCase();

    // Native Ollama thinking support
    return (
        normalized.includes("qwen3") ||
        normalized.includes("deepseek-r1") ||
        normalized.includes("qwq") ||
        normalized.includes("thinking") ||
        normalized.includes("reasoning")
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

// Run Speech system and Python runtime initialization asynchronously in the
// background so top-level module evaluation of api/boot.ts returns immediately
// under Vite's SSR runner (preventing 60s fetchModule RPC timeouts). Both
// subsystems deduplicate their startup promises and are awaited on demand if a
// request arrives before background warmup finishes.
initializeSpeechSystem().catch((err) => {
    console.error("[Boot] Speech system initialization failed — continuing without speech:", err);
});

runtimeManager.start().catch((err) => {
    console.error("[Boot] Python runtime startup failed:", err);
});
startCompanionService();
startTelemetryCollector();
startWorkerPoller();

// ─────────────────────────────────────────────────────────────────────────────
// WORKSTATION GATEKEEPER MIDDLEWARE (Single-User Gate)
// ─────────────────────────────────────────────────────────────────────────────
app.use("*", async (c, next) => {
  const url = new URL(c.req.url);
  const pathname = url.pathname;

  // 0. CLOUDFLARE ACCESS OUTER PERIMETER:
  // Evaluates outer defense perimeter. Strict passthrough on local dev;
  // verifies Cf-Access-Jwt-Assertion if present or required.
  const cfAccess = await evaluateCloudflareAccess(c.req.raw);
  if (!cfAccess.passed) {
    const res = c.json(
      {
        error: "CF_ACCESS_REQUIRED",
        message: cfAccess.error || "Cloudflare Access verification failed.",
      },
      403
    );
    applySecurityHeaders(res.headers, c.req.raw);
    return res;
  }
  if (cfAccess.payload) {
    c.set("cfAccessUser" as any, cfAccess.payload);
  }

  // 0.5. CSRF & ORIGIN DEFENSE:
  // For state-changing methods (POST, PUT, DELETE, PATCH), verify Sec-Fetch-Site and Origin/Referer
  const csrfResult = validateCsrfProtection(c.req.raw);
  if (!csrfResult.valid) {
    const res = c.json(
      {
        error: "CSRF_DETECTED",
        message: "Cross-site request rejected.",
        reason: csrfResult.reason,
      },
      403
    );
    applySecurityHeaders(res.headers, c.req.raw);
    return res;
  }

  // 1. PUBLIC WHITELIST:
  // Public auth endpoints, login UI, Vite dev internals, and public styling assets
  const cleanPathname = pathname.replace(/\/+$/, "") || "/";
  const PUBLIC_AUTH_ROUTES = new Set([
    "/api/auth/status",
    "/api/auth/setup",
    "/api/auth/login",
    "/api/auth/totp/verify-login",
    "/api/auth/logout",
    "/api/auth/pin/unlock",
    "/api/auth/device-trust/status",
    "/api/auth/webauthn/status",
    "/api/auth/webauthn/login-options",
    "/api/auth/webauthn/login-verify",
    "/api/auth/cloudflare/status",
  ]);
  const isPublicAuthRoute = PUBLIC_AUTH_ROUTES.has(cleanPathname);
  const isLoginPage =
    pathname === "/login.html" ||
    pathname === "/login" ||
    pathname === "/frontend/login" ||
    pathname.startsWith("/frontend/login/");
  const isSafeStaticAsset = /\.(css|js|png|jpe?g|svg|ico|woff2?|webp|map)$/i.test(pathname);
  const isPublicAsset =
    (pathname.startsWith("/frontend/assets/") && isSafeStaticAsset) ||
    pathname.startsWith("/@") ||
    pathname.startsWith("/node_modules/") ||
    pathname === "/favicon.ico" ||
    pathname === "/robots.txt";

  if (isPublicAuthRoute || isLoginPage || isPublicAsset) {
    await next();
    if (c.res) {
      applySecurityHeaders(c.res.headers, c.req.raw);
    }
    return;
  }

  // 2. WORKER LANE (Checked before human session lane):
  // Check Authorization: Bearer <key>, X-Workstation-Key, or CF Service Token
  const authHeader = c.req.header("authorization");
  const bearerKey = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : undefined;
  const workstationKey = c.req.header("x-workstation-key");
  const incomingWorkerKey = bearerKey || workstationKey;

  if (incomingWorkerKey) {
    const isWorkerValid = await verifyWorkerKey(incomingWorkerKey);
    if (isWorkerValid) {
      c.set("isWorker" as any, true);
      await next();
      if (c.res) {
        applySecurityHeaders(c.res.headers, c.req.raw);
      }
      return;
    }
  }

  if (cfAccess.payload?.identity_type === "service") {
    c.set("isWorker" as any, true);
    await next();
    if (c.res) {
      applySecurityHeaders(c.res.headers, c.req.raw);
    }
    return;
  }

  // 3. HUMAN SESSION LANE:
  // Check valid signed session cookie (n0th1ng_session)
  const cookieHeader = c.req.header("cookie");
  let sessionCookie: string | undefined;
  if (cookieHeader) {
    const match = cookieHeader.match(/(?:^|;\s*)n0th1ng_session=([^;]*)/);
    if (match) {
      sessionCookie = decodeURIComponent(match[1]);
    }
  }

  const clientIp = c.req.header("x-forwarded-for")?.split(",")[0].trim() || "127.0.0.1";
  const session = await verifySession(sessionCookie, clientIp);

  if (session) {
    c.set("session" as any, session);
    await next();
    if (c.res) {
      applySecurityHeaders(c.res.headers, c.req.raw);
    }
    return;
  }

  // 4. UNAUTHENTICATED HANDLER:
  const acceptHeader = c.req.header("accept") || "";
  const isHtmlRequest = acceptHeader.includes("text/html");

  if (isHtmlRequest) {
    const returnTo = encodeURIComponent(pathname + url.search);
    const res = c.redirect(`/frontend/login/?returnTo=${returnTo}`, 302);
    applySecurityHeaders(res.headers, c.req.raw);
    return res;
  }

  const res = c.json({ error: "Unauthorized. Workstation locked.", code: "AUTH_REQUIRED" }, 401);
  applySecurityHeaders(res.headers, c.req.raw);
  return res;
});

app.route("/api/auth", authRouter);

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

  // 1. Immediately create TransformStream & return HTTP response headers (TTFT < 5ms)
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  const flush = async (data: Record<string, unknown> | string) => {
    try {
      const line = typeof data === "string" ? data : JSON.stringify(data);
      await writer.write(encoder.encode(`data: ${line}\n\n`));
    } catch {
      // client disconnected
    }
  };

  const isVoice = body.mode === "voice";
  body.responseMode ??= "text";

  console.log("========== RESPONSE MODE ==========");
  console.log(body.responseMode);

  // ── Streaming Speech Pipeline (setup) ──
  const isVoiceMode =
    body.responseMode === "voice" || body.responseMode === "text+voice";

  let speechProviderId: ProviderId | undefined;
  let speechModelId:    string | undefined;
  let speechVoiceId:    string | undefined;
  let speechSpeed:       number | undefined;
  let speechPitch:       number | undefined;
  let speechTemperature: number | undefined;
  let speechVolume:      number | undefined;

  const setupSpeech = async () => {
    if (!isVoiceMode) return;
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
    speechProviderId = (body.providerId as ProviderId | undefined) ?? speechProviderId;
    speechModelId    = body.speechModelId ?? body.modelId ?? speechModelId;
    speechVoiceId    = body.voiceId ?? speechVoiceId;
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
  };

  let sentenceBuffer = "";
  let speechSequence = 0;
  const pendingSpeechTasks: Promise<void>[] = [];
  const audioChunksBySeq = new Map<number, Buffer>();

  const ABBREV_WORDS = new Set([
    "dr", "mr", "mrs", "ms", "prof", "sr", "jr",
    "vs", "etc", "approx", "dept", "est",
  ]);

  function findSentenceBoundary(text: string): number {
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === "!" || ch === "?") {
        let end = i + 1;
        while (end < text.length && (text[end] === "!" || text[end] === "?")) end++;
        if (end >= text.length || text[end] === " " || text[end] === "\n") return end;
        i = end - 1;
        continue;
      }
      if (ch === ".") {
        if (i + 1 < text.length && text[i + 1] === ".") {
          while (i + 1 < text.length && text[i + 1] === ".") i++;
          continue;
        }
        if (i + 1 < text.length && /\d/.test(text[i + 1])) continue;
        if (
          i > 0 &&
          /[A-Z]/.test(text[i - 1]) &&
          (i < 2 || text[i - 2] === "." || text[i - 2] === " ")
        ) continue;
        const wordMatch = text.slice(0, i).match(/([a-zA-Z]+)$/);
        if (wordMatch && ABBREV_WORDS.has(wordMatch[1].toLowerCase())) continue;
        const next = i + 1;
        if (next >= text.length) return -1;
        if (text[next] === " " || text[next] === "\n") return next;
      }
    }
    return -1;
  }

  function dispatchSentenceChunks(
    token: string,
    flushFn: (chunk: string) => Promise<void>
  ): void {
    if (!isVoiceMode || !token) return;
    sentenceBuffer += token;
    let boundary = findSentenceBoundary(sentenceBuffer);
    while (boundary !== -1) {
      const sentence = sentenceBuffer.slice(0, boundary).trim();
      sentenceBuffer = sentenceBuffer.slice(boundary).replace(/^\s+/, "");
      if (sentence) {
        const seq = speechSequence++;
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
            await flushFn(JSON.stringify({
              speech: {
                sequence:   seq,
                audio:      speech.audioData.toString("base64"),
                format:     speech.format,
                sampleRate: speech.sampleRate,
                duration:   speech.duration,
                voice:      speech.voiceId,
              },
            }));
          } catch (synthErr) {
            console.error(`[VOICE STREAM] Sentence ${seq} synthesis failed:`, synthErr);
          }
        })();
        pendingSpeechTasks.push(task);
      }
      boundary = findSentenceBoundary(sentenceBuffer);
    }
  }

  async function finalizeVoicePipeline(
    flushFn: (chunk: string) => Promise<void>
  ): Promise<void> {
    if (isVoiceMode && sentenceBuffer.trim().length > 0) {
      const seq = speechSequence++;
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
          await flushFn(JSON.stringify({
            speech: {
              sequence:   seq,
              audio:      speech.audioData.toString("base64"),
              format:     speech.format,
              sampleRate: speech.sampleRate,
              duration:   speech.duration,
              voice:      speech.voiceId,
            },
          }));
        } catch (synthErr) {
          console.error(`[VOICE STREAM] Final sentence ${seq} synthesis failed:`, synthErr);
        }
      })();
      pendingSpeechTasks.push(finalTask);
    }

    if (pendingSpeechTasks.length > 0) {
      await Promise.all(pendingSpeechTasks);
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

        await flushFn(JSON.stringify({
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

  // ── Main Asynchronous Streaming Worker ──
  (async () => {
    try {
      await setupSpeech();

      const hasAttachments = Boolean(body.uploadedAttachments && body.uploadedAttachments.length > 0);
      const hasSelectedFiles = Boolean(body.selectedFiles && body.selectedFiles.length > 0);

      // ── Step 1: Tier 0 Option A Intent Classifier (<1ms) ──
      const intent = classifyIntent(body.prompt, {
        hasAttachments,
        hasSelectedFiles,
      });

      console.log(`[ROUTER][TIER0] Intent classified: ${intent.category} (${intent.confidence}) - ${intent.reason}`);

      // ── Step 2: Tier 0 Point 2 Semantic Response Cache Lookup (<20ms) ──
      if (intent.category === "GREETING" || intent.category === "CASUAL" || intent.category === "GENERAL") {
        const cached = await semanticCache.get(body.prompt, intent.category);
        if (cached) {
          console.log(`[SEMANTIC CACHE] Cache hit for: "${body.prompt}" (Streaming tokenized animation...)`);

          // Tokenize into natural words/tokens for smooth streaming animation
          const tokens = cached.response.match(/\S+\s*|\s+/g) || [cached.response];

          for (const token of tokens) {
            await flush({ response: token });
            if (isVoiceMode) {
              dispatchSentenceChunks(token, flush);
            }
            // Micro-delay per token for realistic fluid typing cadence (~55-60 tok/sec)
            await new Promise((r) => setTimeout(r, 16));
          }

          await flush({ response: "", done: true });
          if (isVoiceMode) {
            await finalizeVoicePipeline(flush);
          }
          await writer.close();
          return;
        }
      }

      // ── Step 3: Fast Parallel Context Fetching (Tier 2 Point 3) ──
      let attachmentContext = "";
      let finalConversationContext = "";
      let memoryContext = "";
      let toolContext = "";
      let toolResult: any = null;

      const temporalContext = buildTemporalContext({ timezone: body.timezone });

      // Run Context Window and DB Reads in parallel
      const loadContextPromise = async () => {
        if (!body.conversationId) return;
        try {
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
            // Background summarization so current request is not blocked
            summarizeConversation(built.messagesToSummarize, body.model)
              .then(async (combinedSummary) => {
                if (isVoice) {
                  await updateVoiceConversationSummary(body.conversationId, combinedSummary, built.messagesToSummarize.length);
                } else {
                  await updateConversationSummaryWithCount(Number(body.conversationId), combinedSummary, built.messagesToSummarize.length);
                }
              })
              .catch((err) => console.error("[CONVERSATION] Background summary error:", err));
          }
        } catch (err) {
          console.error("[CONTEXT] Error loading conversation context:", err);
        }
      };

      // ── Step 4: Branch by Intent ──

      if (intent.category === "TOOL_TASK") {
        // Direct to Stage 2 / Stage 3 (lfm2.5-thinking:1.2b) & Parallel 6-second heartbeat!
        await loadContextPromise();

        // Immediate user notification (TTFT < 20ms)
        await flush({
          status: "Preparing tool execution...",
          notification: "Looking into this for you right now, please give me a moment while I query the system...",
        });

        let elapsedSeconds = 0;
        const heartbeatTimer = setInterval(async () => {
          elapsedSeconds += 6;
          const messages = [
            "Still working on your tool request, please wait a moment...",
            "Executing background tool, almost there...",
            "Processing the tool output for you, thanks for your patience...",
            "Finalizing the results, preparing your answer...",
          ];
          const msg = messages[Math.min(Math.floor(elapsedSeconds / 6) - 1, messages.length - 1)];
          await flush({
            status: `Executing tool (${elapsedSeconds}s)...`,
            notification: msg,
            heartbeat: true,
          });
        }, 6000);

        try {
          // Direct Stage 2 (regex) + Stage 3 (lfm2.5-thinking:1.2b), bypassing Stage 1 gate!
          const toolDecision = await resolveToolsDirectly(
            body.prompt,
            finalConversationContext,
            body.uploadedAttachments ?? []
          );

          if (toolDecision.status) {
            await flush({ status: toolDecision.status });
          }

          toolResult = await processTools(
            toolDecision.tools,
            body.uploadedAttachments ?? [],
            body.prompt
          );
        } catch (err) {
          console.error("[TOOL TASK] Error during tool execution:", err);
        } finally {
          clearInterval(heartbeatTimer);
        }

        await flush({
          status: "Tool finished, generating response...",
          notification: "Tool finished, generating your answer...",
        });

        if (toolResult && toolResult.toolCalls) {
          toolContext = `
==================================================
TOOL RESULT
==================================================
Tools Used: ${toolResult.toolCalls.map((t: any) => t.tool).join(", ")}
Result:
${toolResult.toolCalls.map((t: any, idx: number) => `Tool ${idx + 1}: ${t.tool}\n${JSON.stringify(toolResult.results?.[idx] ?? t.arguments, null, 2)}`).join("\n")}
==================================================`;
        }
      } else if (intent.category === "RAG_QUERY" || body.useRag) {
        // Parallel retrieval of attachments, context, and memory
        await Promise.all([
          loadContextPromise(),
          (body.conversationId && hasAttachments)
            ? searchChatAttachments(body.conversationId, body.prompt, 8).then((chunks) => {
                if (chunks.length > 0) {
                  attachmentContext = `\n==================================================\nATTACHMENT CONTEXT\n==================================================\n${chunks.map((c) => c.content).join("\n\n")}\n==================================================\n`;
                }
              })
            : Promise.resolve(),
          buildMemoryContext(body.prompt).then((mem) => { memoryContext = mem; }),
        ]);
      } else {
        // GREETING, CASUAL, or GENERAL:
        // Skip heavy document RAG, skip tool router, load conversation context
        await loadContextPromise();
      }

      // ── Step 5: Format Prompt for Automatic Prefix Caching (Tier 2 Point 2) ──
      let ragResult: { sources: any[]; prompt?: string } = { sources: [] };
      let ragContext = "";

      if ((intent.category === "RAG_QUERY" || body.useRag) && hasSelectedFiles) {
        ragResult = await buildRagPrompt(body.prompt, body.selectedFiles, finalConversationContext);
        ragContext = ragResult.prompt || "";
        latestSources = ragResult.sources;
      }

      const ragPrompt = buildApcPrompt({
        conversationContext: finalConversationContext,
        temporalContext,
        memoryContext,
        attachmentContext,
        toolContext,
        ragContext,
        userPrompt: body.prompt,
      });

      console.log("\n========== FINAL APC PROMPT ==========\n");
      console.log(ragPrompt.slice(0, 500) + "\n...[truncated for log]...");
      console.log("\n======================================\n");

      // ── Step 6: Stream Inference (OpenRouter or Ollama) ──
      const GENERATE_TIMEOUT_MS = 120_000;
      let completeResponse = "";

      async function runModelInference(promptToUse: string): Promise<string> {
        let accumulated = "";

        if (isOpenRouterModel(body.model)) {
          const orController = new AbortController();
          const orTimeoutId = setTimeout(() => orController.abort(), GENERATE_TIMEOUT_MS);
          try {
            for await (const tok of streamOpenRouterTyped(body.model, promptToUse, undefined, orController.signal)) {
              if (tok.type === "thinking") {
                await flush({ thinking: tok.text });
              } else {
                accumulated += tok.text;
                await flush({ response: tok.text, done: false });
                dispatchSentenceChunks(tok.text, flush);
              }
            }
          } finally {
            clearTimeout(orTimeoutId);
          }
        } else {
          // Ollama local streaming path
          const generateController = new AbortController();
          const generateTimeoutId = setTimeout(() => generateController.abort(), GENERATE_TIMEOUT_MS);

          const ollamaPayload: any = {
            model: body.model,
            prompt: promptToUse,
            stream: true,
          };

          if (supportsThinking(body.model)) {
            ollamaPayload.think = true;
          }

          let ollamaResponse: Response;
          try {
            ollamaResponse = await fetch("http://localhost:11434/api/generate", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(ollamaPayload),
              signal: generateController.signal,
            });
          } catch (fetchErr) {
            clearTimeout(generateTimeoutId);
            const isAbort = fetchErr instanceof Error && fetchErr.name === "AbortError";
            await flush({ error: isAbort ? "Model backend timed out generating a response." : "Failed to reach the model backend." });
            return accumulated;
          }

          clearTimeout(generateTimeoutId);

          if (!ollamaResponse.ok || !ollamaResponse.body) {
            const errText = await ollamaResponse.text().catch(() => "");
            await flush({ error: `Model backend returned ${ollamaResponse.status}`, detail: errText });
            return accumulated;
          }

          const reader = ollamaResponse.body.getReader();
          const decoder = new TextDecoder();
          let streamBuffer = "";
          let inThinkBlock = false;

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

              streamBuffer += decoder.decode(value, { stream: true });
              const lines = streamBuffer.split("\n");
              streamBuffer = lines.pop() ?? "";

              for (const line of lines) {
                if (!line.trim()) continue;
                let parsed: any;
                try {
                  parsed = JSON.parse(line);
                } catch {
                  continue;
                }

                const token: string = parsed.response ?? "";

                if (parsed.error) {
                  console.error("[OLLAMA] stream error payload:", parsed.error);
                  await flush({ error: String(parsed.error) });
                  continue;
                }

                if (parsed.thinking) {
                  await flush({ thinking: parsed.thinking });
                  continue;
                }

                if (token.includes("<think>")) {
                  inThinkBlock = true;
                  const after = token.split("<think>")[1] ?? "";
                  if (after) {
                    if (after.includes("</think>")) {
                      inThinkBlock = false;
                      const [thinkPart, afterPart] = after.split("</think>");
                      if (thinkPart) await flush({ thinking: thinkPart });
                      if (afterPart) {
                        accumulated += afterPart;
                        await flush({ response: afterPart });
                        dispatchSentenceChunks(afterPart, flush);
                      }
                    } else {
                      await flush({ thinking: after });
                    }
                  }
                  continue;
                }

                if (inThinkBlock) {
                  if (token.includes("</think>")) {
                    inThinkBlock = false;
                    const [before, after] = token.split("</think>");
                    if (before) await flush({ thinking: before });
                    if (after) {
                      accumulated += after;
                      await flush({ response: after });
                      dispatchSentenceChunks(after, flush);
                    }
                  } else {
                    // Stream thinking tokens in REAL TIME
                    await flush({ thinking: token });
                  }
                  continue;
                }

                if (token) {
                  accumulated += token;
                  await flush({ response: token });
                  dispatchSentenceChunks(token, flush);
                }
              }
            }
          } finally {
            try {
              reader.releaseLock();
            } catch {
              /* ignore */
            }
          }
        }

        return accumulated;
      }

      completeResponse = await runModelInference(ragPrompt);

      // ── Step 6.5: Knowledge Cutoff / Inability Refusal Fallback ──
      // If the LLM refused or admitted lack of knowledge / post-cutoff events,
      // automatically execute live web search via Tavily, wipe the refusal,
      // re-synthesize with the live web results, and stream the real answer!
      if (
        completeResponse &&
        intent.category !== "TOOL_TASK" &&
        isKnowledgeCutoffRefusal(completeResponse)
      ) {
        console.log(`[CUTOFF FALLBACK] Detected knowledge cutoff refusal in response: "${completeResponse.slice(0, 100)}...". Triggering automatic Tavily search.`);

        await flush({
          notification: "Searching the internet for the latest information...",
          status: "Searching internet for latest info...",
        });

        try {
          const rawResults = await searchInternet(body.prompt);
          const formattedResults = formatSearchResults(rawResults);

          if (rawResults?.results && Array.isArray(rawResults.results)) {
            latestSources = rawResults.results.map((r: any) => ({
              title: r.title,
              url: r.url,
              content: r.content,
            }));
          }

          sentenceBuffer = ""; // Reset voice buffer
          await flush({
            resetResponse: true,
            notification: "Synthesizing answer from internet results...",
            status: "Synthesizing answer from internet...",
          });

          const fallbackToolContext = `
==================================================
INTERNET SEARCH RESULTS (LATEST LIVE DATA)
==================================================
The user asked a question requiring real-time, recent, or post-cutoff information. Live internet search was executed.
Query: ${body.prompt}

Search Results:
${formattedResults}
==================================================
INSTRUCTION: Answer the user's question accurately, completely, and naturally using the search results above. Do not mention your knowledge cutoff or say you lack real-time access. Synthesize the findings directly.
==================================================`;

          const fallbackPrompt = buildApcPrompt({
            conversationContext: finalConversationContext,
            temporalContext,
            memoryContext,
            attachmentContext,
            toolContext: fallbackToolContext,
            ragContext,
            userPrompt: body.prompt,
          });

          completeResponse = await runModelInference(fallbackPrompt);
        } catch (searchErr) {
          console.error("[CUTOFF FALLBACK] Error during internet search fallback:", searchErr);
        }
      }

      await flush({ response: "", thinking: "", done: true });
      await finalizeVoicePipeline(flush);

      // ── Step 7: Cache for future instant TTFT (Point 2) ──
      if (
        completeResponse &&
        (intent.category === "GENERAL" || intent.category === "GREETING" || intent.category === "CASUAL")
      ) {
        semanticCache.set(body.prompt, completeResponse, intent.category).catch((err) => {
          console.warn("[SEMANTIC CACHE] Background cache write failed:", err);
        });
      }
    } catch (err) {
      console.error("[STREAM] Error in stream worker:", err);
      await flush({ error: String(err instanceof Error ? err.message : err) });
    } finally {
      try {
        await writer.close();
      } catch {
        /* already closed */
      }
    }
  })();

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
});

// ─────────────────────────────────────────────────────────────────────────
// /api/chat/agent-stream — "Extended Thinking" toggle.
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
      await writer.write(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
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
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
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

  const DEFAULT_IMAGE_NEGATIVE =
    "cartoon, anime, CGI, 3D render, toy car, unrealistic reflections, plastic body, distorted car, incorrect proportions, warped wheels, malformed headlights, duplicate car, floating vehicle, excessive motion blur, oversaturated colors, artificial lighting, low detail, blurry, low resolution, noisy image, excessive HDR, crushed blacks, blown highlights, watermark, text, logo";

  let width = body.width;
  let height = body.height;
  if ((!width || !height) && typeof body.aspectRatio === "string") {
    const match = body.aspectRatio.match(/^(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)$/);
    if (match) {
      const r = parseFloat(match[1]) / parseFloat(match[2]);
      if (r > 0) {
        height = Math.round(Math.sqrt(1048576 / r) / 16) * 16;
        width = Math.round((height * r) / 16) * 16;
      }
    }
  }

  const input = {
    prompt: body.prompt,
    negativePrompt: (typeof body.negativePrompt === "string" && body.negativePrompt.trim().length > 0)
      ? body.negativePrompt.trim()
      : DEFAULT_IMAGE_NEGATIVE,
    width: width ?? 1024,
    height: height ?? 1024,
    aspectRatio: body.aspectRatio ?? undefined,
    steps: body.steps ?? 20,
    cfg: body.cfg ?? 1,
    denoise: body.denoise ?? 1,
    batchSize: body.batchSize ?? 1,
    sampler: body.sampler ?? "euler",
    scheduler: body.scheduler ?? "simple",
    seed: body.seed,
    providerId: body.providerId,
    // Full-pipeline upscale section
    upscaleModel:  body.upscaleModel  ?? undefined,
    targetWidth:   body.targetWidth   ?? undefined,
    targetHeight:  body.targetHeight  ?? undefined,
    interpolation: body.interpolation ?? undefined,
    hiresSteps:    body.hiresSteps    ?? undefined,
    hiresDenoise:  body.hiresDenoise  ?? undefined,
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
    baseImageUrl: job.baseImageUrl ?? null,
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
    // Phase 2: Require valid worker API key (Bearer token or X-Workstation-Key)
    const isWorker = c.get("isWorker" as any);
    if (!isWorker) {
        return c.json({ success: false, error: "Unauthorized. Valid worker API key required." }, 401);
    }

    const worker = await safeJson(c);
    if (!worker) {
        return c.json({ success: false, error: "Request body is missing or not valid JSON." }, 400);
    }
    registerWorker(worker);
    return c.json({ success: true });
});

app.post("/api/cluster/heartbeat", async (c) => {
    // Phase 2: Require valid worker API key (Bearer token or X-Workstation-Key)
    const isWorker = c.get("isWorker" as any);
    if (!isWorker) {
        return c.json({ success: false, error: "Unauthorized. Valid worker API key required." }, 401);
    }

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
    // Phase 2: Require inbound request (browser -> master) to carry a valid human session
    const session = c.get("session" as any);
    if (!session) {
        return c.json({ error: "Unauthorized. Operator session required to stream worker logs." }, 401);
    }

    const workerId = c.req.param("id");
    const source = c.req.query("source"); // "python" | "speech" | "kokoro" | undefined


    const worker = getWorkers().find((w) => w.id === workerId);
    if (!worker) {
        return c.json({ error: "Worker not found" }, 404);
    }

    const baseUrl = (worker.internetUrl ?? `http://${worker.ip}:${worker.port}`).replace(/\/$/, "");
    const url = new URL(`${baseUrl}/logs/stream`);
    if (source) url.searchParams.set("source", source);

    const authHeaders = worker.apiKey ? { Authorization: `Bearer ${worker.apiKey}` } : {};

    let upstream: Response;
    try {
        upstream = await fetch(url.toString(), { headers: authHeaders });
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