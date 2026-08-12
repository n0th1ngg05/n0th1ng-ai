import { z } from "zod";
import { createRouter, publicQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { workflows } from "@db/schema";
import { eq, desc } from "drizzle-orm";

export const workflowRouter = createRouter({
  list: publicQuery.query(async () => {
    const db = getDb();
    return db.query.workflows.findMany({
      orderBy: [desc(workflows.createdAt)],
    });
  }),

  getById: publicQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      return db.query.workflows.findFirst({
        where: eq(workflows.id, input.id),
      });
    }),

  create: publicQuery
    .input(z.object({
      name: z.string(),
      description: z.string().optional(),
      nodes: z.array(z.any()),
      edges: z.array(z.any()),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const result = await db.insert(workflows).values({
        name: input.name,
        description: input.description || null,
        nodes: JSON.stringify(input.nodes),
        edges: JSON.stringify(input.edges),
      });
      return { id: Number(result[0].insertId) };
    }),

  duplicate: publicQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const original = await db.query.workflows.findFirst({
        where: eq(workflows.id, input.id),
      });
      if (!original) throw new Error("Workflow not found");
      const result = await db.insert(workflows).values({
        name: `${original.name} (Copy)`,
        description: original.description,
        nodes: original.nodes,
        edges: original.edges,
      });
      return { id: Number(result[0].insertId) };
    }),

  delete: publicQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.delete(workflows).where(eq(workflows.id, input.id));
      return { success: true };
    }),
});
