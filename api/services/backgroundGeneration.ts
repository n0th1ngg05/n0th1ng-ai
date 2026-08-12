import { getDb } from "../queries/connection";
import { generatedImages } from "@db/schema";
import { generationJobs } from "./generationState";
import { getProvider, getDefaultProvider } from "./providers";
import type { ImageEmit } from "./comfy";

// ✅ NOT imported statically at the top — dynamic import inside the function
// prevents Vite's module runner from trying to resolve comfy.ts at init time

export async function runGeneration(
  jobId: string,
  input: {
    prompt: string;
    negativePrompt?: string;
    width: number;
    height: number;
    steps: number;
    cfg: number;
    denoise: number;
    batchSize: number;
    sampler: string;
    scheduler: string;
    seed?: number;
    providerId?: string; // defaults to first registered image provider
  },
  emit?: ImageEmit
) {
  try {
    // Dynamic import — only resolves when the function is actually called,
    // not at module initialization time
    const { generateFluxImage } = await import("./comfy");

    const db = getDb();

    const job = generationJobs.get(jobId);

    if (!job) {
      throw new Error("Generation job not found");
    }

    const provider = input.providerId ? getProvider(input.providerId) : getDefaultProvider("image");
    if (!provider) {
      throw new Error(`Unknown image provider id: "${input.providerId}"`);
    }

    generationJobs.set(jobId, {
      ...job,
      status: "loading",
      progress: 5,
    });

    const result = await generateFluxImage(
      jobId,
      {
        prompt: input.prompt,
        negativePrompt: input.negativePrompt,
        width: input.width,
        height: input.height,
        steps: input.steps,
        cfg: input.cfg,
        denoise: input.denoise,
        batchSize: input.batchSize,
        sampler: input.sampler,
        scheduler: input.scheduler,
        seed: input.seed,
        providerId: provider.id,
      },
      emit
    );

    const insert = await db.insert(generatedImages).values({
      prompt: input.prompt,
      negativePrompt: input.negativePrompt ?? null,
      provider: provider.id,
      modelUsed: provider.label,
      resolution: `${input.width}x${input.height}`,
      steps: input.steps,
      sampler: input.sampler,
      cfg: input.cfg,
      denoise: input.denoise,
      batchSize: input.batchSize,
      scheduler: input.scheduler,
      seed: result.seed,
      generationTime: result.generationTime,
      gpuUsage: null,
      vramUsage: null,
      imageUrl: result.imageUrl,
    });

    generationJobs.set(jobId, {
      ...generationJobs.get(jobId)!,
      status: "completed",
      progress: 100,
      currentStep: 4,
      imageUrl: result.imageUrl,
      generationTime: result.generationTime,
      seed: result.seed,
    });

    return {
      success: true,
      id: Number(insert[0].insertId),
      imageUrl: result.imageUrl,
      generationTime: result.generationTime,
      seed: result.seed,
    };
  } catch (error) {
    console.error("Generation Error:", error);

    const existingJob = generationJobs.get(jobId);

    if (existingJob) {
      generationJobs.set(jobId, {
        ...existingJob,
        status: "failed",
        progress: 0,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    throw error;
  }
}