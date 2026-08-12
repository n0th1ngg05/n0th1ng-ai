// ─────────────────────────────────────────────────────────────────────────────
// forge/router.ts
//
// tRPC procedures for The Forge, following routers/workflow.ts's shape.
// Typed request/response calls the UI hits directly — session CRUD, status,
// pause/resume. Anything streaming lives in forge/routes.ts instead.
// ─────────────────────────────────────────────────────────────────────────────

import { z } from "zod";
import { createRouter, publicQuery } from "../middleware";
import * as orchestrator from "./orchestrator";
import * as db from "./db";
import * as execWorker from "./execWorker";
import { listStackProfiles } from "./stacks/registry";
import { FORGE_MODEL, OLLAMA_TAGS_URL } from "./constants";
import { listOpenRouterModels } from "../services/openRouter";

export const forgeRouter = createRouter({
    create: publicQuery
        .input(
            z.object({
                goal: z.string(),
                stackProfileId: z.string(),
                // Optional on the wire for backward compatibility, but the
                // frontend's New Session modal always sends one explicitly —
                // falls back to the constants.ts default only if omitted.
                modelId: z.string().optional(),
                // Only meaningful when stackProfileId === 'general' — the
                // user's free-text language/framework description.
                customStack: z.string().optional(),
            })
        )
        .mutation(async ({ input }) => {
            try {
                const session = await orchestrator.createSession(
                    input.goal,
                    input.stackProfileId,
                    input.modelId ?? FORGE_MODEL,
                    input.customStack ?? null
                );
                // Fire and forget — same pattern as runGeneration/createJob in
                // boot.ts. The request returns immediately; the drive loop runs
                // for as long as it takes.
                void orchestrator.driveSessionToCompletion(session.id);
                return session;
            } catch (err) {
                // Belt-and-suspenders: orchestrator.createSession already logs
                // in detail, but this guarantees the failure is visible in the
                // terminal even if that changes later, and gives the client a
                // real message instead of a bare 500 with no body.
                console.error("[FORGE][ROUTER] forge.create failed:", err);
                throw err;
            }
        }),

    // Populates the session rail (left sidebar) — every session, most
    // recently updated first. Was referenced by forge.js from the start but
    // never actually added here, hence the 404s.
    list: publicQuery.query(async () => {
        try {
            return await db.listSessions();
        } catch (err) {
            console.error("[FORGE][ROUTER] forge.list failed:", err);
            throw err;
        }
    }),

    // Populates the frontend's model dropdown by asking Ollama directly what
    // is actually pulled RIGHT NOW — genuinely dynamic, not a maintained list
    // in code. Whatever you `ollama pull`, it shows up here on next dropdown
    // open; whatever you remove, it drops off. No allowlist, no manual
    // curation, no editing this file every time a new model gets pulled.
    listModels: publicQuery.query(async () => {
        const ollamaModels: { id: string; label: string }[] = [];
        try {
            const res = await fetch(OLLAMA_TAGS_URL);
            if (res.ok) {
                const data = await res.json();
                const models: { name: string; size?: number }[] = data?.models ?? [];
                ollamaModels.push(
                    ...models.map((m) => ({
                        id: m.name,
                        label: `${m.name} (Ollama - Local)`,
                    }))
                );
            } else {
                console.error(`[FORGE][ROUTER] Ollama /api/tags returned ${res.status}`);
            }
        } catch (err) {
            console.error("[FORGE][ROUTER] Failed to reach Ollama for model list:", err);
        }

        const openRouterModels = listOpenRouterModels().map((m) => ({
            id: m.id,
            label: `${m.label} (OpenRouter - API)`,
        }));

        return [...ollamaModels, ...openRouterModels];
    }),

    getById: publicQuery
        .input(z.object({ id: z.string() }))
        .query(async ({ input }) => {
            return db.getSession(input.id);
        }),

    pause: publicQuery
        .input(z.object({ id: z.string() }))
        .mutation(async ({ input }) => {
            await orchestrator.pauseSession(input.id);
            return { success: true };
        }),

    resume: publicQuery
        .input(z.object({ id: z.string() }))
        .mutation(async ({ input }) => {
            await orchestrator.resumeSession(input.id);
            return { success: true };
        }),

    getTaskTree: publicQuery
        .input(z.object({ sessionId: z.string() }))
        .query(async ({ input }) => {
            return db.getTaskTree(input.sessionId);
        }),

    getTaskLog: publicQuery
        .input(z.object({ taskId: z.string() }))
        .query(async ({ input }) => {
            return db.getIterationsForTask(input.taskId);
        }),

    listStacks: publicQuery.query(() => {
        return listStackProfiles().map((p) => ({
            id: p.id,
            packageManager: p.packageManager,
            devServerPort: p.devServerPort,
        }));
    }),

    // Minimal chat/follow-up interface: send a message to a done/blocked/
    // paused session. Becomes a new task appended after everything currently
    // in the tree — see orchestrator.addFollowUp for the full reasoning.
    // Rejected server-side (not just in the UI) if the session is actively
    // running, since a follow-up landing mid-iteration would race the loop.
    followUp: publicQuery
        .input(z.object({ sessionId: z.string(), message: z.string() }))
        .mutation(async ({ input }) => {
            try {
                await orchestrator.addFollowUp(input.sessionId, input.message);
                return { success: true };
            } catch (err) {
                console.error("[FORGE][ROUTER] forge.followUp failed:", err);
                throw err;
            }
        }),

    // The ONLY way a human write ever touches a workspace outside the agent
    // loop itself: manual intervention while PAUSED. Hard-gated on status —
    // rejected in any other state so a human edit can never race the loop.
    writeFileManually: publicQuery
        .input(
            z.object({
                sessionId: z.string(),
                path: z.string(),
                content: z.string(),
            })
        )
        .mutation(async ({ input }) => {
            const session = await db.getSession(input.sessionId);
            if (!session) throw new Error("Session not found");
            if (session.status !== "paused") {
                throw new Error(
                    "Manual writes are only allowed while the session is paused"
                );
            }
            await execWorker.writeFile(input.sessionId, input.path, input.content);
            return { success: true };
        }),
});