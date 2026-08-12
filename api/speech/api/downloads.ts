import { z } from "zod";
import { createRouter, publicQuery } from "../../middleware";
import { getSpeechManager } from "../lazy-speech-manager";

export const downloadsRouter = createRouter({

    queue: publicQuery

        .input(

            z.object({

                provider: z.enum(['kokoro', 'piper', 'xtts', 'fishspeech', 'chatterbox', 'dia', 'whisper']),

                model: z.string(),

            })

        )

        .mutation(async ({ input }) => {

            const mgr = await getSpeechManager();
            return await mgr.downloadManager.queueDownload({
                provider: input.provider,
                model: input.model,
            });

        }),

    pause: publicQuery

        .input(

            z.object({

                id: z.string(),

            })

        )

        .mutation(async ({ input }) => {

            const mgr = await getSpeechManager();
            await mgr.downloadManager.pauseDownload(input.id);

            return { success: true };

        }),

    resume: publicQuery

        .input(

            z.object({

                id: z.string(),

            })

        )

        .mutation(async ({ input }) => {

            const mgr = await getSpeechManager();
            await mgr.downloadManager.resumeDownload(input.id);

            return { success: true };

        }),

    cancel: publicQuery

        .input(

            z.object({

                id: z.string(),

            })

        )

        .mutation(async ({ input }) => {

            const mgr = await getSpeechManager();
            await mgr.downloadManager.cancelDownload(input.id);

            return { success: true };

        }),

    remove: publicQuery

        .input(

            z.object({

                provider: z.enum(['kokoro', 'piper', 'xtts', 'fishspeech', 'chatterbox', 'dia', 'whisper']),

                model: z.string(),

            })

        )

        .mutation(async ({ input }) => {

            const mgr = await getSpeechManager();
            await mgr.downloadManager.removeModel(input.provider, input.model);

            return { success: true };

        }),

    progress: publicQuery

        .input(

            z.object({

                id: z.string(),

            })

        )

        .query(async ({ input }) => {

            const mgr = await getSpeechManager();
            return mgr.downloadManager.getProgress(input.id);

        }),

    active: publicQuery

        .query(async () => {

            const mgr = await getSpeechManager();
            return mgr.downloadManager.getActiveDownloads();

        }),

    history: publicQuery

        .query(async () => {

            const mgr = await getSpeechManager();
            return mgr.downloadManager.getHistory();

        }),

});