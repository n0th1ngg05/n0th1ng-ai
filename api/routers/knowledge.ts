import { z } from "zod";
import { createRouter, publicQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { knowledgeEntries } from "@db/schema";
import { eq, desc, like } from "drizzle-orm";

export const knowledgeRouter = createRouter({
  list: publicQuery
    .input(z.object({ search: z.string().optional(), tags: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const db = getDb();
      if (input?.search) {
        return db.query.knowledgeEntries.findMany({
          where: like(knowledgeEntries.title, `%${input.search}%`),
          orderBy: [desc(knowledgeEntries.relevanceScore)],
          limit: 50,
        });
      }
      return db.query.knowledgeEntries.findMany({
        orderBy: [desc(knowledgeEntries.relevanceScore)],
        limit: 50,
      });
    }),

  getById: publicQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      return db.query.knowledgeEntries.findFirst({
        where: eq(knowledgeEntries.id, input.id),
      });
    }),

  create: publicQuery
    .input(z.object({
      title: z.string(),
      content: z.string(),
      sourceType: z.enum(["conversation", "research", "file", "manual"]).optional(),
      tags: z.array(z.string()).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const result = await db.insert(knowledgeEntries).values({
        title: input.title,
        content: input.content,
        sourceType: input.sourceType || "manual",
        tags: input.tags || [],
        relevanceScore: 0.5 + Math.random() * 0.5,
      });
      return { id: Number(result[0].insertId) };
    }),

  delete: publicQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.delete(knowledgeEntries).where(eq(knowledgeEntries.id, input.id));
      return { success: true };
    }),
});
