import { z } from "zod";
import { createRouter, publicQuery } from "../../middleware";
import { getSpeechManager } from "../lazy-speech-manager";

export const voicesRouter = createRouter({

    list: publicQuery

        .query(async () => {

            const mgr = await getSpeechManager();
            return await mgr.getProviderManager().listVoices();

        }),

    byProvider: publicQuery

        .input(

            z.object({

                provider: z.enum(['kokoro','piper','xtts','fishspeech','chatterbox','dia','whisper']),

            })

        )

        .query(async ({ input }) => {

            const mgr = await getSpeechManager();
            return await mgr.getProviderManager().listVoices(

                input.provider

            );

        }),

    byModel: publicQuery

        .input(

            z.object({

                provider: z.enum(['kokoro','piper','xtts','fishspeech','chatterbox','dia','whisper']),

                model: z.string(),

            })

        )

        .query(async ({ input }) => {

            const mgr = await getSpeechManager();
            return await mgr.getProviderManager().listVoices(

                input.provider,

                input.model

            );

        }),

    get: publicQuery

        .input(

            z.object({

                provider: z.enum(['kokoro','piper','xtts','fishspeech','chatterbox','dia','whisper']),

                model: z.string(),

                voice: z.string(),

            })

        )

        .query(async ({ input }) => {

            const mgr = await getSpeechManager();
            return await mgr.getProviderManager().getVoice(

                input.provider,

                input.model,

                input.voice

            );

        }),

    search: publicQuery

        .input(

            z.object({

                query: z.string(),

            })

        )

        .query(async ({ input }) => {

            const mgr = await getSpeechManager();
            return await mgr.getProviderManager().searchVoices(

                input.query

            );

        }),

});