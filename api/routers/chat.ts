import { z } from "zod";
import { createRouter, publicQuery } from "../middleware";
// NOTE: Do NOT statically import speechManager here.
// Use the lazy accessor so Vite's SSR module runner doesn't time out
// trying to eagerly resolve the entire 11-file speech manager tree.
import { getSpeechManager } from "../speech/lazy-speech-manager";

export const chatRouter = createRouter({
  generate: publicQuery
    .input(
      z.object({
        model: z.string(),
        prompt: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      console.log("CHAT REQUEST MODEL:", input.model);

      const response = await fetch(
        "http://localhost:11434/api/generate",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: input.model,
            prompt: input.prompt,
            stream: false,
          }),
        }
      );

      const data = await response.json();

      // Generate speech (lazy — only instantiates SpeechManager on first call)
      const mgr = await getSpeechManager();
      const speech = await mgr.synthesize({
        text: data.response,
        profileId: "profile_assistant",
      });

      return {
        response: data.response,

        speech: {
          audio: speech.audioData.toString("base64"),
          format: speech.format,
          sampleRate: speech.sampleRate,
          duration: speech.duration,
          voice: speech.voiceId,
        },
      };
    }),
});