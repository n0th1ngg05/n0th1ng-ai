import { z } from "zod";
import { createRouter, publicQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { generatedImages } from "@db/schema";
import { eq, desc } from "drizzle-orm";
import { generationJobs } from "../services/generationState";
import { createJob } from "../services/generationState";
import { runGeneration } from "../services/backgroundGeneration";
import fs from "node:fs/promises";
import path from "node:path";

import { generateFluxImage } from "../services/comfy";

export const imageRouter = createRouter({
  list: publicQuery.query(async () => {
    const db = getDb();

    return db.query.generatedImages.findMany({
      orderBy: [desc(generatedImages.createdAt)],
    });
  }),

  getById: publicQuery
.input(
  z.object({
    id: z.number(),
  })
)
    .query(async ({ input }) => {
      const db = getDb();

      return db.query.generatedImages.findFirst({
        where: eq(
          generatedImages.id,
          input.id
        ),
      });
    }),

    status: publicQuery
  .input(
    z.object({
      jobId: z.string(),
    })
  )
  .query(({ input }) => {
    const job =
      generationJobs.get(
        input.jobId
      );

    if (!job) {
      return {
        status: "unknown",

        progress: 0,

        currentStep: 0,

        totalSteps: 0,
      };
    }

    return job;
  }),

  result: publicQuery
  .input(
    z.object({
      jobId: z.string(),
    })
  )
  .query(({ input }) => {
    const job =
      generationJobs.get(
        input.jobId
      );

    if (!job) {
      return null;
    }

    return {
      imageUrl:
        job.imageUrl,

      seed:
        job.seed,

      generationTime:
        job.generationTime,

      status:
        job.status,
    };
  }),
  
  generate: publicQuery
.input(
  z.object({
    prompt: z.string().min(1),
    negativePrompt: z.string().optional(),

    width: z.number().default(512),
    height: z.number().default(512),

    steps: z.number().default(20),
    cfg: z.number().default(1),
    denoise: z.number().default(1),
    batchSize: z.number().default(1),

    sampler: z.string().default("euler"),
    scheduler: z.string().default("simple"),

    seed: z.number().optional(),
  })
)
    .mutation(async ({ input }) => {
      const jobId =
        createJob(
          input.prompt
        );

      runGeneration(
  jobId,
  {
    prompt:
      input.prompt,

    negativePrompt:
      input.negativePrompt,

    width:
      input.width,

    height:
      input.height,

    steps:
      input.steps,

    cfg:
      input.cfg,

    denoise:
      input.denoise,

    batchSize:
      input.batchSize,

    sampler:
      input.sampler,

    scheduler:
      input.scheduler,

    seed:
      input.seed,
  }
).catch(console.error);

      return {
        success: true,

        jobId,
      };
    }),

  create: publicQuery
    .input(
      z.object({
        prompt: z.string(),

        negativePrompt:
          z.string().optional(),

        modelUsed:
          z.string().optional(),

        resolution:
          z.string().optional(),

        steps:
          z.number().optional(),

        sampler:
          z.string().optional(),

        seed:
          z.number().optional(),

        generationTime:
          z.number().optional(),

        gpuUsage:
          z.number().optional(),

        vramUsage:
          z.number().optional(),

        imageUrl:
          z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();

      const result =
        await db
          .insert(generatedImages)
          .values({
            ...input,

            negativePrompt:
              input.negativePrompt ??
              null,

            modelUsed:
              input.modelUsed ??
              null,

            resolution:
              input.resolution ??
              null,

            steps:
              input.steps ??
              null,

            sampler:
              input.sampler ??
              null,

            seed:
              input.seed ??
              null,

            generationTime:
              input.generationTime ??
              null,

            gpuUsage:
              input.gpuUsage ??
              null,

            vramUsage:
              input.vramUsage ??
              null,

            imageUrl:
              input.imageUrl ??
              null,
          });

      return {
        id: Number(
          result[0].insertId
        ),
      };
    }),

  delete: publicQuery
  .input(
    z.object({
      id: z.number(),
    })
  )
  .mutation(async ({ input }) => {

    const db = getDb();

    const image =
      await db.query.generatedImages.findFirst({
        where: eq(
          generatedImages.id,
          input.id
        ),
      });

    if (!image) {
      throw new Error(
        "Image not found"
      );
    }

    if (image.imageUrl) {

      try {

        const relativePath =
          image.imageUrl.replace(
            /^\//,
            ""
          );

        const absolutePath =
          path.join(
            process.cwd(),
            "public",
            relativePath
          );

        console.log(
          "Deleting file:",
          absolutePath
        );

        await fs.unlink(
          absolutePath
        );

      } catch (err) {

        console.warn(
          "File delete failed:",
          err
        );

      }
    }

    await db
      .delete(generatedImages)
      .where(
        eq(
          generatedImages.id,
          input.id
        )
      );

    return {
      success: true,
    };
  }),
});