import { z } from "zod";
import { createRouter, publicQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { messages, messageToolCalls } from "@db/schema";
import { eq } from "drizzle-orm";

// Shared shape for one persisted tool call — mirrors the AgentEvent stream
// from services/agentLoop.ts (round / tool_call / tool_result) plus that
// round's thinking trace, so the whole extended-thinking session can be
// reconstructed later exactly as it was rendered live in chat.js.
// arguments: was z.record(z.string()) — too strict. Small local models
// (qwen3:0.6b, lfm2.5-thinking:1.2b in toolRouter.ts's Stage 3) routinely
// emit bare JSON.parse()'d arguments objects with non-string values (bare
// numbers/booleans) even when the tool schema in tools.ts declares every
// param as "string" — the model just doesn't reliably quote them. Under
// the old schema, ANY one non-string value anywhere in a session's whole
// toolCalls array failed the entire createWithToolCalls mutation (it's one
// transaction), silently dropping every tool call for that message — which
// is why message_tool_calls stayed completely empty. z.coerce.string() on
// each value fixes this at the boundary instead of relying on upstream
// code to always emit strings.
const toolCallInput = z.object({
  round: z.number(),
  instruction: z.string().optional(),
  tool: z.string(),
  arguments: z.record(z.coerce.string()).optional(),
  result: z.string().optional(),
  success: z.boolean().default(true),
  error: z.string().optional(),
  thinking: z.string().optional(),
});

export const messageRouter = createRouter({
  create: publicQuery
    .input(
      z.object({
        conversationId: z.number(),
        role: z.enum(["user", "assistant", "system"]),
        content: z.string(),
        // Reasoning/thinking trace for this message. Used by BOTH regular
        // chat (single concatenated `thinking` blob from /api/chat/stream)
        // and extended mode (see createWithToolCalls below for the fuller
        // extended-mode path) — kept here too so a plain create() call from
        // the regular chat flow can still attach thinking without needing
        // the tool-calls variant.
        thinking: z.string().optional(),
        isExtended: z.boolean().optional(),
        executionSummary: z.string().optional(),
        tokensUsed: z.number().optional(),
        responseTime: z.number().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        console.log("MESSAGE INPUT:", input);

        const db = getDb();

        const result = await db.insert(messages).values(input);

        console.log("MESSAGE INSERT RESULT:", result);

        return {
          id: Number(result[0].insertId),
        };
      } catch (err) {
        console.error("MESSAGE CREATE ERROR:", err);
        throw err;
      }
    }),

  // Persists a full extended-thinking (agent loop) assistant message in one
  // call: the message row itself (content = the loop's finalAnswer,
  // thinking = the overall/last-round trace, executionSummary = the
  // post-loop synthesis pass text from synthesizeExecutionSummary, see
  // services/agentLoop.ts) plus every individual tool call as a row in
  // message_tool_calls. Wrapped in a single DB transaction so a message
  // is never left without its tool-call rows (or vice versa) if something
  // fails partway through — chat.js should call this instead of the plain
  // create() mutation whenever the response came from /api/chat/agent-stream.
  createWithToolCalls: publicQuery
    .input(
      z.object({
        conversationId: z.number(),
        content: z.string(),
        thinking: z.string().optional(),
        executionSummary: z.string().optional(),
        tokensUsed: z.number().optional(),
        responseTime: z.number().optional(),
        toolCalls: z.array(toolCallInput).default([]),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();

      try {
        console.log(
          `MESSAGE (extended) INPUT: conversationId=${input.conversationId}` +
          ` toolCalls=${input.toolCalls.length} contentLen=${input.content.length}`
        );

        return await db.transaction(async (tx) => {
          const messageResult = await tx.insert(messages).values({
            conversationId: input.conversationId,
            role: "assistant" as const,
            content: input.content,
            thinking: input.thinking,
            isExtended: true,
            executionSummary: input.executionSummary,
            tokensUsed: input.tokensUsed,
            responseTime: input.responseTime,
          });

          const messageId = Number(messageResult[0].insertId);

          if (input.toolCalls.length > 0) {
            await tx.insert(messageToolCalls).values(
              input.toolCalls.map((call) => ({
                messageId,
                round: call.round,
                instruction: call.instruction,
                tool: call.tool,
                arguments: call.arguments,
                result: call.result,
                success: call.success,
                error: call.error,
                thinking: call.thinking,
              }))
            );
          }

          console.log(`MESSAGE (extended) INSERT RESULT: messageId=${messageId}`);

          return { id: messageId };
        });
      } catch (err) {
        // Loud on purpose: a failure here means the WHOLE extended-thinking
        // session (message + every tool call) silently fails to persist —
        // the client only console.errors this and the user sees nothing
        // wrong, since the already-rendered live response looks fine. This
        // was previously indistinguishable from a quiet no-op; now it's
        // impossible to miss in the server log.
        console.error("═══════════════════════════════════════════════════");
        console.error("MESSAGE createWithToolCalls ERROR — session NOT saved:");
        console.error("  conversationId:", input.conversationId);
        console.error("  toolCalls count:", input.toolCalls.length);
        console.error("  error:", err);
        console.error("═══════════════════════════════════════════════════");
        throw err;
      }
    }),

  list: publicQuery
    .input(
      z.object({
        conversationId: z.number(),
      })
    )
    .query(async ({ input }) => {
      const db = getDb();

      const rows = await db.query.messages.findMany({
        where: eq(messages.conversationId, input.conversationId),
        orderBy: [messages.createdAt],
      });

      // Attach tool calls only for messages that are actually flagged as
      // extended — avoids an extra query per plain message on ordinary
      // conversations, which is the overwhelming majority of traffic.
      const extendedIds = rows.filter((m) => m.isExtended).map((m) => m.id);
      if (extendedIds.length === 0) {
        return rows.map((m) => ({ ...m, toolCalls: [] as (typeof messageToolCalls.$inferSelect)[] }));
      }

      const allToolCalls = await db.query.messageToolCalls.findMany({
        where: (tc, { inArray }) => inArray(tc.messageId, extendedIds),
        orderBy: (tc, { asc }) => [asc(tc.round), asc(tc.id)],
      });

      const byMessageId = new Map<number, typeof allToolCalls>();
      for (const call of allToolCalls) {
        const list = byMessageId.get(call.messageId) ?? [];
        list.push(call);
        byMessageId.set(call.messageId, list);
      }

      return rows.map((m) => ({
        ...m,
        toolCalls: byMessageId.get(m.id) ?? [],
      }));
    }),

  delete: publicQuery
    .input(
      z.object({
        id: z.number(),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();

      // message_tool_calls has ON DELETE CASCADE at the DB level (see
      // migration_extended_thinking.sql), so this alone also removes any
      // associated tool-call rows — no separate cleanup needed here.
      await db.delete(messages).where(eq(messages.id, input.id));

      return {
        success: true,
      };
    }),
});