import { z } from "zod";
import { createRouter, publicQuery } from "../../middleware";
import { getSpeechManager } from "../lazy-speech-manager";

export const voiceChatRouter = createRouter({

    process: publicQuery

        .input(

            z.object({

                audioData: z.string(),

                format: z.string(),

                sampleRate: z.number(),

                profileId: z.string().optional(),

                language: z.string().optional(),

            })

        )

        .mutation(async ({ input }) => {

            const mgr = await getSpeechManager();
            return await mgr.voiceChat({

                audioData: Buffer.from(input.audioData, "base64"),

                format: input.format,

                sampleRate: input.sampleRate,

                profileId: input.profileId,

                language: input.language,

            });

        }),

});