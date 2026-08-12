import { z } from "zod";
import { createRouter, publicQuery } from "../../middleware";
import { getSpeechManager } from "../lazy-speech-manager";

export const ttsRouter = createRouter({

    synthesize: publicQuery

        .input(

            z.object({

                text: z.string().min(1),

                provider: z.enum(['kokoro','piper','xtts','fishspeech','chatterbox','dia','whisper']).optional(),

                model: z.string().optional(),

                voice: z.string().optional(),

                profile: z.string().optional(),

                language: z.string().optional(),

                speed: z.number().optional(),

                pitch: z.number().optional(),

                volume: z.number().optional(),

                stream: z.boolean().optional(),

            })

        )

        .mutation(async ({ input }) => {

            const mgr = await getSpeechManager();
            return mgr.synthesize({

                text: input.text,

                providerId: input.provider as any,

                profileId: input.profile,

                language: input.language,

                speed: input.speed,

                pitch: input.pitch,

                volume: input.volume,

            });

        }),

});