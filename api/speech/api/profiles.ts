import { z } from "zod";
import { createRouter, publicQuery } from "../../middleware";
import { getSpeechManager } from "../lazy-speech-manager";

export const profilesRouter = createRouter({

    list: publicQuery

        .query(async () => {

            const mgr = await getSpeechManager();
            return await mgr.getProfileManager().listProfiles();

        }),

    get: publicQuery

        .input(z.object({ id: z.string() }))

        .query(async ({ input }) => {

            const mgr = await getSpeechManager();
            return await mgr.getProfileManager().getProfile(input.id);

        }),

    create: publicQuery

        .input(

            z.object({

                name: z.string(),

                provider: z.string(),

                model: z.string(),

                voice: z.string(),

                language: z.string().optional(),

                speed: z.number().optional(),

                pitch: z.number().optional(),

                volume: z.number().optional(),

                emotion: z.string().optional(),

                temperature: z.number().optional(),

            })

        )

        .mutation(async ({ input }) => {

            const mgr = await getSpeechManager();
            return await mgr.getProfileManager().createProfile(input);

        }),

    update: publicQuery

        .input(

            z.object({

                id: z.string(),

                updates: z.record(z.string(), z.any()),

            })

        )

        .mutation(async ({ input }) => {

            const mgr = await getSpeechManager();
            return await mgr.getProfileManager().updateProfile(input.id, input.updates);

        }),

    delete: publicQuery

        .input(z.object({ id: z.string() }))

        .mutation(async ({ input }) => {

            const mgr = await getSpeechManager();
            await mgr.getProfileManager().deleteProfile(input.id);
            return { success: true };

        }),

    duplicate: publicQuery

        .input(z.object({ id: z.string(), name: z.string() }))

        .mutation(async ({ input }) => {

            const mgr = await getSpeechManager();
            return await mgr.getProfileManager().duplicateProfile(input.id, input.name);

        }),

    setDefault: publicQuery

        .input(z.object({ id: z.string() }))

        .mutation(async ({ input }) => {

            const mgr = await getSpeechManager();
            await mgr.getProfileManager().setDefaultProfile(input.id);
            return { success: true };

        }),

});