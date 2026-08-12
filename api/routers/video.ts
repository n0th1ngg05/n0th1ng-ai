import { z } from "zod";
import { createRouter, publicQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { generatedVideos } from "@db/schema";
import { eq, desc } from "drizzle-orm";
import fs from "node:fs/promises";
import path from "node:path";
import { createVideoJob, videoJobs } from "../services/videoGenerationState";
import { generateLtxVideoPipeline } from "../services/comfy";

export const videoRouter = createRouter({
  list: publicQuery.query(async () => {
    const db = getDb();
    return db.query.generatedVideos.findMany({
      orderBy: [desc(generatedVideos.createdAt)],
    });
  }),

  getById: publicQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      return db.query.generatedVideos.findFirst({
        where: eq(generatedVideos.id, input.id),
      });
    }),

  delete: publicQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();

      const video = await db.query.generatedVideos.findFirst({
        where: eq(generatedVideos.id, input.id),
      });

      if (!video) {
        throw new Error("Video not found");
      }

      if (video.videoUrl) {
        try {
          const relativePath = video.videoUrl.replace(/^\//, "");
          const absolutePath = path.join(process.cwd(), "public", relativePath);
          await fs.unlink(absolutePath);
        } catch (err) {
          console.warn("Video file delete failed:", err);
        }
      }

      await db.delete(generatedVideos).where(eq(generatedVideos.id, input.id));

      return { success: true };
    }),

  // Kicks off the 3-stage LTX pipeline (base gen -> upscale/refine ->
  // interpolate/restore -> stage4 ffmpeg grade/encode). Returns immediately
  // with a jobId; poll getStatus for progress the same way image generation
  // jobs are polled via generationJobs.
  generate: publicQuery
    .input(
      z.object({
        prompt: z.string().min(1),
        negativePrompt: z.string().optional(),
        width: z.number().int().positive().optional(),
        height: z.number().int().positive().optional(),
        length: z.number().int().positive().optional(),
        frameRate: z.number().int().positive().optional(),
        seed: z.number().int().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const jobId = createVideoJob(input.prompt);

      // Fire and forget — status is polled via getStatus, same pattern
      // generateFluxImage's callers already use for image jobs.
      generateLtxVideoPipeline(jobId, input)
        .then(async (result) => {
          const db = getDb();
          await db.insert(generatedVideos).values({
            prompt: input.prompt,
            negativePrompt: input.negativePrompt,
            modelUsed: "ltxv-2b-0.9.8-distilled-fp8",
            resolution: `${input.width ?? 640}x${input.height ?? 352}`,
            seed: result.seed,
            frameRate: input.frameRate ?? 24,
            length: input.length ?? 193,
            fps: 48, // post RIFE 2x interpolation
            format: "mp4",
            sceneCount: 4, // 4 pipeline stages, not scenes in the multi-shot sense
            generationTime: result.generationTime,
            videoUrl: result.videoUrl,
          });
        })
        .catch((err) => {
          console.error(`LTX pipeline failed for job ${jobId}:`, err);
        });

      return { jobId };
    }),

  getStatus: publicQuery
    .input(z.object({ jobId: z.string() }))
    .query(({ input }) => {
      const job = videoJobs.get(input.jobId);
      if (!job) throw new Error(`Video job ${input.jobId} not found`);
      return job;
    }),
});