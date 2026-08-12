import { z } from "zod";
import { createRouter, publicQuery } from "../../middleware";
import { getSpeechManager } from "../lazy-speech-manager";

export const providersRouter = createRouter({

    list: publicQuery

        .query(async () => {

            const mgr = await getSpeechManager();
            return await mgr.getProviderManager().listProviders();

        }),

    get: publicQuery

        .input(

            z.object({

                id: z.enum(['kokoro','piper','xtts','fishspeech','chatterbox','dia','whisper']),

            })

        )

        .query(async ({ input }) => {

            const mgr = await getSpeechManager();
            return await mgr.getProviderManager().getProvider(

                input.id

            );

        }),

    enable: publicQuery

        .input(

            z.object({

                id: z.enum(['kokoro','piper','xtts','fishspeech','chatterbox','dia','whisper']),

            })

        )

        .mutation(async ({ input }) => {

            const mgr = await getSpeechManager();
            await mgr.getProviderManager().enableProvider(

                input.id

            );

            return {

                success: true,

            };

        }),

    disable: publicQuery

        .input(

            z.object({

                id: z.enum(['kokoro','piper','xtts','fishspeech','chatterbox','dia','whisper']),

            })

        )

        .mutation(async ({ input }) => {

            const mgr = await getSpeechManager();
            await mgr.getProviderManager().disableProvider(

                input.id

            );

            return {

                success: true,

            };

        }),

    health: publicQuery

        .input(

            z.object({

                id: z.enum(['kokoro','piper','xtts','fishspeech','chatterbox','dia','whisper']),

            })

        )

        .query(async ({ input }) => {

            const mgr = await getSpeechManager();
            return await mgr.getProviderManager().health(

                input.id

            );

        }),

});