import { z } from "zod";
import { createRouter, publicQuery } from "../../middleware";
import { getSpeechManager } from "../lazy-speech-manager";

export const devicesRouter = createRouter({

    inputs: publicQuery

        .query(async () => {

            const mgr = await getSpeechManager();
            return await mgr.getDeviceManager().listInputs();

        }),

    outputs: publicQuery

        .query(async () => {

            const mgr = await getSpeechManager();
            return await mgr.getDeviceManager().listOutputs();

        }),

    defaults: publicQuery

        .query(async () => {

            const mgr = await getSpeechManager();
            return await mgr.getDeviceManager().getDefaults();

        }),

    setDefaultInput: publicQuery

        .input(z.object({ id: z.string() }))

        .mutation(async ({ input }) => {

            const mgr = await getSpeechManager();
            await mgr.getDeviceManager().setDefaultInput(input.id);
            return { success: true };

        }),

    setDefaultOutput: publicQuery

        .input(z.object({ id: z.string() }))

        .mutation(async ({ input }) => {

            const mgr = await getSpeechManager();
            await mgr.getDeviceManager().setDefaultOutput(input.id);
            return { success: true };

        }),

    refresh: publicQuery

        .mutation(async () => {

            const mgr = await getSpeechManager();
            await mgr.getDeviceManager().refreshDevices();
            return { success: true };

        }),

});