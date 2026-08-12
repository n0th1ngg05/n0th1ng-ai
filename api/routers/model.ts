import { z } from "zod";
import { createRouter, publicQuery } from "../middleware";
import { listOpenRouterModels } from "../services/openRouter";
// NOTE: getDb / aiModels / eq are intentionally NOT imported at the top level.
// connection.ts does `import * as relations from "@db/relations"` which causes
// Vite's SSR fetchModule RPC to time out (60 s limit) at startup when evaluated
// eagerly. They are dynamically imported inside the handlers that need them.

export const modelRouter = createRouter({
  list: publicQuery.query(async () => {
    // ── Ollama models ──────────────────────────────────────────────────────
    let ollamaModels: any[] = [];
    try {
      const tagsResponse = await fetch("http://localhost:11434/api/tags");
      const tagsData = await tagsResponse.json();

      const psResponse = await fetch("http://localhost:11434/api/ps");
      const psData = await psResponse.json();

      const loadedModels = new Set(
        (psData.models ?? []).map((m: any) => m.name)
      );

      ollamaModels = (tagsData.models ?? []).map((model: any) => ({
        id: model.name,
        name: model.name,
        displayName: `${model.name} (Ollama - Local)`,
        source: "ollama",
        size: model.size,
        quantization: model.details?.quantization_level ?? "Unknown",
        contextLength: model.details?.context_length ?? 32768,
        status: loadedModels.has(model.name) ? "active" : "idle",
        memoryUsage: 0,
        vramUsage: 0,
        tokenSpeed: 0,
        lastUsed: model.modified_at,
      }));
    } catch {
      // Ollama offline — return empty, don't crash the whole list
    }

    // ── OpenRouter models ──────────────────────────────────────────────────
    const openRouterModels = listOpenRouterModels().map((m) => ({
      id: m.id,
      name: m.id,
      displayName: `${m.label} (OpenRouter - API)`,
      source: "openrouter",
      size: 0,
      quantization: "API",
      contextLength: 128000,
      status: "idle" as const,
      memoryUsage: 0,
      vramUsage: 0,
      tokenSpeed: 0,
      lastUsed: null,
    }));

    return [...ollamaModels, ...openRouterModels];
  }),

  activeMetrics: publicQuery.query(async () => {
    const psResponse = await fetch("http://localhost:11434/api/ps");
    const psData = await psResponse.json();

    if (!psData.models || psData.models.length === 0) {
      return null;
    }

    const model = psData.models[0];

    return {
      name: model.name,
      family: model.details?.family ?? "Unknown",
      parameters: model.details?.parameter_size ?? "Unknown",
      quantization: model.details?.quantization_level ?? "Unknown",
      contextLength: model.context_length ?? 0,
      sizeGB: model.size / 1024 / 1024 / 1024,
      vramGB: model.size_vram / 1024 / 1024 / 1024,
      expiresAt: model.expires_at,
    };
  }),

  getById: publicQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      // Lazy import — avoids pulling connection.ts into the module graph at startup
      const { getDb } = await import("../queries/connection");
      const { aiModels } = await import("@db/schema");
      const { eq } = await import("drizzle-orm");
      const db = getDb();
      return db.query.aiModels.findFirst({
        where: eq(aiModels.id, input.id),
      });
    }),

  switch: publicQuery
    .input(z.object({ id: z.number() }))
    .mutation(async () => {
      const { getDb } = await import("../queries/connection");
      const { aiModels } = await import("@db/schema");
      const db = getDb();
      await db.update(aiModels).set({ status: "idle" });
      return { success: true };
    }),

  load: publicQuery
    .input(
      z.object({
        id: z.string(),
        // Ollama keep_alive: duration string ("30m", "1h"), seconds as
        // number, or -1 to keep loaded indefinitely until an explicit
        // unload. Omit to use the Ollama server default (5m).
        keepAlive: z.union([z.string(), z.number()]).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const response = await fetch("http://localhost:11434/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: input.id,
          prompt: "hello",
          stream: false,
          ...(input.keepAlive !== undefined ? { keep_alive: input.keepAlive } : {}),
        }),
      });
      return { success: response.ok };
    }),

  unload: publicQuery
    .input(
      z.object({
        // Ollama model name, e.g. "qwen3.5:9b" — this is what /api/ps and
        // /api/tags key on, not the numeric aiModels.id used by getById/switch.
        id: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      // Ollama's documented way to force-unload a loaded model: issue a
      // generate call with an empty prompt and keep_alive: 0, which evicts
      // it from VRAM as soon as the (trivial) request completes.
      const response = await fetch("http://localhost:11434/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: input.id,
          prompt: "",
          stream: false,
          keep_alive: 0,
        }),
      });
      return { success: response.ok };
    }),

  benchmark: publicQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return {
        modelId: input.id,
        tokensPerSecond: 42.5 + Math.random() * 10,
        latency: 120 + Math.random() * 50,
        memoryPeak: 8.5 + Math.random() * 2,
        score: Math.floor(75 + Math.random() * 25),
      };
    }),
});