import { z } from "zod";
import { createRouter, publicQuery } from "../../middleware";
import { getSpeechManager } from "../lazy-speech-manager";

/**
 * Manual force start/stop for the shared speech runtime process
 * (speech-runtime/main.py). By default this process lazy-boots on the
 * first real TTS/STT request (see runtimeManager.startRuntime()). These
 * endpoints let the Settings UI force a pre-warm or force a kill instead
 * of waiting for that first request / for it to sit idle.
 */
export const runtimeRouter = createRouter({
  status: publicQuery.query(async () => {
    const mgr = await getSpeechManager();
    const runtimes = mgr.runtimeManager.getAllRuntimes();

    return runtimes.map((r) => ({
      id: r.getConfig().id,
      providerId: r.getConfig().providerId,
      port: r.getConfig().port,
      status: r.getStatus(),
    }));
  }),

  // Force pre-warm: boots the shared runtime immediately rather than
  // waiting for the first TTS/STT call. Any provider id works here since
  // all providers share the one process — kokoro is just a reasonable
  // default trigger.
  start: publicQuery
    .input(
      z.object({
        providerId: z
          .enum([
            "kokoro",
            "piper",
            "xtts",
            "fishspeech",
            "chatterbox",
            "dia",
            "whisper",
          ])
          .default("kokoro"),
      })
    )
    .mutation(async ({ input }) => {
      const mgr = await getSpeechManager();
      const runtime = await mgr.runtimeManager.startRuntime(
        input.providerId
      );

      return {
        success: true,
        status: runtime.getStatus(),
      };
    }),

  // Force kill: stops every runtime the manager currently knows about.
  // There is only ever one shared runtime process in practice, but this
  // covers a rare desync where a stale entry exists in the map.
  stop: publicQuery.mutation(async () => {
    const mgr = await getSpeechManager();
    await mgr.runtimeManager.stopAllRuntimes();

    return { success: true };
  }),
});