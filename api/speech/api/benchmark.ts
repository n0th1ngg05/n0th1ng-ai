import { z } from "zod";
import { createRouter, publicQuery } from "../../middleware";
import { getSpeechManager } from "../lazy-speech-manager";

export const benchmarkRouter = createRouter({

    run: publicQuery

        .input(

            z.object({

                provider: z.enum(['kokoro','piper','xtts','fishspeech','chatterbox','dia','whisper']).optional(),

                model: z.string().optional(),

                voice: z.string().optional(),

            })

        )

        .mutation(async ({ input }) => {

            const mgr = await getSpeechManager();
            return await mgr.getBenchmarkManager().runBenchmark({
                providerId: input.provider!,
                modelId: input.model,
                voiceId: input.voice,
            });

        }),

    history: publicQuery

        .query(async () => {

            const mgr = await getSpeechManager();
            return await mgr.getBenchmarkManager().getBenchmarkHistory();

        }),

});