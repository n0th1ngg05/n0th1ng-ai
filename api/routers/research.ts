import { z } from "zod";
import { createRouter, publicQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { researchCollections, researchDocuments } from "@db/schema";
import { eq, like } from "drizzle-orm";

export const researchRouter = createRouter({
  listCollections: publicQuery.query(async () => {
    const db = getDb();
    return db.query.researchCollections.findMany();
  }),

  getCollection: publicQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      const collection = await db.query.researchCollections.findFirst({
        where: eq(researchCollections.id, input.id),
      });
      const docs = await db.query.researchDocuments.findMany({
        where: eq(researchDocuments.collectionId, input.id),
      });
      return { ...collection, documents: docs };
    }),

  createDocument: publicQuery
    .input(z.object({
      title: z.string(),
      content: z.string().optional(),
      source: z.string().optional(),
      collectionId: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const result = await db.insert(researchDocuments).values({
        title: input.title,
        content: input.content || null,
        source: input.source || null,
        collectionId: input.collectionId || null,
      });
      return { id: Number(result[0].insertId) };
    }),

  search: publicQuery
    .input(z.object({ query: z.string() }))
    .query(async ({ input }) => {
      const db = getDb();
      return db.query.researchDocuments.findMany({
        where: like(researchDocuments.title, `%${input.query}%`),
        limit: 20,
      });
    }),
});
