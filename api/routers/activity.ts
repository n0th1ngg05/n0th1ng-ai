import { z } from "zod";
import { createRouter, publicQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { activityLogs } from "@db/schema";
import { desc } from "drizzle-orm";

export const activityRouter = createRouter({
  recent: publicQuery
    .input(z.object({ limit: z.number().optional() }).optional())
    .query(async ({ input }) => {
      const db = getDb();
      return db.query.activityLogs.findMany({
        orderBy: [desc(activityLogs.createdAt)],
        limit: input?.limit || 20,
      });
    }),

  create: publicQuery
    .input(z.object({
      action: z.string(),
      entityType: z.string().optional(),
      entityId: z.number().optional(),
      metadata: z.any().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.insert(activityLogs).values({
        action: input.action,
        entityType: input.entityType || null,
        entityId: input.entityId || null,
        metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      });
      return { success: true };
    }),
});
