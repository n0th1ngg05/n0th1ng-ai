// ─────────────────────────────────────────────────────────────────────────────
// forgex/router.ts
//
// tRPC procedures for ForgeX. Mirrors forge/router.ts's shape exactly.
// ─────────────────────────────────────────────────────────────────────────────

import { z } from "zod";
import { createRouter, publicQuery } from "../middleware";
import * as db from "./db";
import * as processManager from "./processManager";
import { OLLAMA_TAGS_URL } from "./constants";
import { listOpenRouterModels } from "../services/openRouter";

export const forgexRouter = createRouter({
    create: publicQuery
        .input(z.object({ goal: z.string(), modelId: z.string() }))
        .mutation(async ({ input }) => {
            try {
                const session = await db.createSession(input.goal, input.modelId);
                // Fire and forget — same pattern as forge's orchestrator.
                // The subprocess runs for as long as Claude Code decides to
                // run; the request returns as soon as it's launched.
                void processManager.startSession(
                    session.id,
                    input.goal,
                    input.modelId,
                    session.workspacePath
                );
                return session;
            } catch (err) {
                console.error("[FORGEX][ROUTER] forgex.create failed:", err);
                throw err;
            }
        }),

    // Same live-Ollama-query approach as forge.listModels — no hardcoded
    // allowlist, reflects whatever is actually pulled right now.
    listModels: publicQuery.query(async () => {
        const ollamaModels: { id: string; label: string }[] = [];
        try {
            const res = await fetch(OLLAMA_TAGS_URL);
            if (res.ok) {
                const data = await res.json();
                const models: { name: string }[] = data?.models ?? [];
                ollamaModels.push(
                    ...models.map((m) => ({
                        id: m.name,
                        label: `${m.name} (Ollama - Local)`,
                    }))
                );
            }
        } catch (err) {
            console.error("[FORGEX][ROUTER] Failed to reach Ollama for model list:", err);
        }

        const openRouterModels = listOpenRouterModels().map((m) => ({
            id: m.id,
            label: `${m.label} (OpenRouter - API)`,
        }));

        return [...ollamaModels, ...openRouterModels];
    }),

    list: publicQuery.query(async () => {
        try {
            return await db.listSessions();
        } catch (err) {
            console.error("[FORGEX][ROUTER] forgex.list failed:", err);
            throw err;
        }
    }),

    getById: publicQuery
        .input(z.object({ id: z.string() }))
        .query(async ({ input }) => {
            return db.getSession(input.id);
        }),

    // Sends a message into the ALREADY-RUNNING claude process's stdin — see
    // processManager.sendInput. Only works while status is 'running'; the
    // frontend gates the input the same way it gates Forge's follow-up bar,
    // but here it's a real live conversation, not a new appended task.
    sendInput: publicQuery
        .input(z.object({ sessionId: z.string(), text: z.string() }))
        .mutation(async ({ input }) => {
            try {
                await processManager.sendInput(input.sessionId, input.text);
                return { success: true };
            } catch (err) {
                console.error("[FORGEX][ROUTER] forgex.sendInput failed:", err);
                throw err;
            }
        }),

    stop: publicQuery
        .input(z.object({ id: z.string() }))
        .mutation(async ({ input }) => {
            await processManager.stopSession(input.id);
            return { success: true };
        }),
});