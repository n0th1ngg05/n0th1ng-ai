import { z } from "zod";
import { createRouter, publicQuery } from "../../middleware";
import { getSpeechManager } from "../lazy-speech-manager";

export const sttRouter = createRouter({

    transcribe: publicQuery

        .input(

            z.object({

                audio: z.string(),

                provider: z.enum(['kokoro','piper','xtts','fishspeech','chatterbox','dia','whisper']).optional(),

                model: z.string().optional(),

                language: z.string().optional(),

            })

        )

        .mutation(async ({ input }) => {

            const mgr = await getSpeechManager();
            return await mgr.transcribe({

                audio: input.audio,

                provider: input.provider,

                model: input.model,

                language: input.language,

            } as any);

        }),

});