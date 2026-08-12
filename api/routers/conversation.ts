import { z } from "zod";
import { createRouter, publicQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { conversations, messages, messageToolCalls } from "@db/schema";
import { eq, desc, like, inArray, asc } from "drizzle-orm";

export const conversationRouter = createRouter({
  list: publicQuery.query(async () => {
    const db = getDb();
    const convs = await db.query.conversations.findMany({
      orderBy: [desc(conversations.updatedAt)],
    });
    // Get last message for each conversation
    const result = [];
    for (const conv of convs) {
      const lastMsg = await db.query.messages.findFirst({
        where: eq(messages.conversationId, conv.id),
        orderBy: [desc(messages.createdAt)],
      });
      result.push({ ...conv, lastMessage: lastMsg });
    }
    return result;
  }),

  getById: publicQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      const conv = await db.query.conversations.findFirst({
        where: eq(conversations.id, input.id),
      });
      const msgs = await db.query.messages.findMany({
        where: eq(messages.conversationId, input.id),
        orderBy: [messages.createdAt],
      });

      // Attach the tool-call trail for any extended-thinking messages in
      // this conversation, so re-opening a conversation from history can
      // fully reconstruct the round-by-round view chat.js renders live —
      // previously message.thinking/toolCalls were referenced by the
      // frontend but nothing ever populated them, since messages only
      // stored `content`. Skipped entirely (0 extra queries) when the
      // conversation has no extended messages, which is the common case.
      const extendedIds = msgs.filter((m) => m.isExtended).map((m) => m.id);
      const toolCallsByMessageId = new Map();
      if (extendedIds.length > 0) {
        const allToolCalls = await db.query.messageToolCalls.findMany({
          where: inArray(messageToolCalls.messageId, extendedIds),
          orderBy: [asc(messageToolCalls.round), asc(messageToolCalls.id)],
        });
        for (const call of allToolCalls) {
          const list = toolCallsByMessageId.get(call.messageId) ?? [];
          list.push(call);
          toolCallsByMessageId.set(call.messageId, list);
        }
      }

      const msgsWithToolCalls = msgs.map((m) => ({
        ...m,
        toolCalls: toolCallsByMessageId.get(m.id) ?? [],
      }));

      return { ...conv, messages: msgsWithToolCalls };
    }),

  create: publicQuery
    .input(z.object({ title: z.string(), modelId: z.string(), folderId: z.number().optional() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const result = await db.insert(conversations).values({
        title: input.title,
        modelId: input.modelId,
        folderId: input.folderId || null,
      });
      return { id: Number(result[0].insertId) };
    }),

  update: publicQuery
    .input(z.object({ id: z.number(), title: z.string().optional(), isPinned: z.boolean().optional(), folderId: z.number().optional() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const { id, ...data } = input;
      await db.update(conversations)
        .set(data)
        .where(eq(conversations.id, id));
      return { success: true };
    }),

  delete: publicQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.delete(messages).where(eq(messages.conversationId, input.id));
      await db.delete(conversations).where(eq(conversations.id, input.id));
      return { success: true };
    }),

  search: publicQuery
    .input(z.object({ query: z.string() }))
    .query(async ({ input }) => {
      const db = getDb();
      const msgs = await db.query.messages.findMany({
        where: like(messages.content, `%${input.query}%`),
        orderBy: [desc(messages.createdAt)],
        limit: 20,
      });
      return msgs;
    }),
});