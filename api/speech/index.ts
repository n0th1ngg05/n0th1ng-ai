import { createRouter } from "../middleware";

// ──────────────────────────────────────────────────────────────────────────────
// IMPORTANT: Do NOT statically import speechManager here.
// Doing so forces Vite's SSR module runner to eagerly evaluate the entire
// 11-file manager tree at module-graph time, which overruns the 60 s
// fetchModule RPC timeout. All consumer files (tts, stt, …) must use the
// lazy accessor from `./lazy-speech-manager` instead.
// ──────────────────────────────────────────────────────────────────────────────

import { ttsRouter } from "./api/tts";
import { sttRouter } from "./api/stt";
import { providersRouter } from "./api/providers";
import { modelsRouter } from "./api/models";
import { voicesRouter } from "./api/voices";
import { profilesRouter } from "./api/profiles";
import { downloadsRouter } from "./api/downloads";
import { devicesRouter } from "./api/devices";
import { benchmarkRouter } from "./api/benchmark";
import { voiceChatRouter } from "./api/voiceChat";
import { runtimeRouter } from "./api/runtime";

/**
 * Initializes the complete Speech Management System.
 * Called once from boot.ts after the Vite SSR module graph is stable.
 */
export async function initializeSpeechSystem() {
  const { initializeLazySpeechManager } = await import("./lazy-speech-manager");
  await initializeLazySpeechManager();
}

/**
 * Speech Router
 */
export const speechRouter = createRouter({
  tts: ttsRouter,
  stt: sttRouter,
  providers: providersRouter,
  models: modelsRouter,
  voices: voicesRouter,
  profiles: profilesRouter,
  downloads: downloadsRouter,
  devices: devicesRouter,
  benchmark: benchmarkRouter,
  voiceChat: voiceChatRouter,
  runtime: runtimeRouter,
});

export * from "./types";