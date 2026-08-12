import { z } from "zod";
import { createRouter, publicQuery } from "../../middleware";
import { getSpeechManager } from "../lazy-speech-manager";

export const modelsRouter = createRouter({

    list: publicQuery

        .query(async () => {

            const mgr = await getSpeechManager();
            return await mgr.getModelManager().listModels();

        }),

    installed: publicQuery

        .query(async () => {

            const mgr = await getSpeechManager();
            return await mgr.getModelManager().listInstalledModels();

        }),

    downloadable: publicQuery

        .query(async () => {

            const mgr = await getSpeechManager();
            return await mgr.getModelManager().listDownloadableModels();

        }),

    get: publicQuery

        .input(z.object({ id: z.string() }))

        .query(async ({ input }) => {

            const mgr = await getSpeechManager();
            return await mgr.getModelManager().getModel(input.id);

        }),

    install: publicQuery

        .input(z.object({ id: z.string() }))

        .mutation(async ({ input }) => {

            const mgr = await getSpeechManager();
            await mgr.getModelManager().installModel(input.id);
            return { success: true };

        }),

    uninstall: publicQuery

        .input(z.object({ id: z.string() }))

        .mutation(async ({ input }) => {

            const mgr = await getSpeechManager();
            await mgr.getModelManager().uninstallModel(input.id);
            return { success: true };

        }),

    update: publicQuery

        .input(z.object({ id: z.string() }))

        .mutation(async ({ input }) => {

            const mgr = await getSpeechManager();
            await mgr.getModelManager().updateModel(input.id);
            return { success: true };

        }),

    validate: publicQuery

        .input(z.object({ id: z.string() }))

        .query(async ({ input }) => {

            const mgr = await getSpeechManager();
            return await mgr.getModelManager().validateModel(input.id);

        }),

});