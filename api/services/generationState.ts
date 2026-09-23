import { v4 as uuidv4 } from "uuid";

export type GenerationJob = {
  id: string;

  status:
    | "queued"
    | "loading"
    | "sampling"
    | "saving"
    | "completed"
    | "failed";

  progress: number;

  currentStep: number;

  totalSteps: number;

  startedAt: number;

  prompt: string;

  imageUrl?: string;

  // For full-pipeline runs (ESRGAN + hires-fix), the pre-upscale base
  // image is also saved. Both URLs are returned by /api/image/result.
  baseImageUrl?: string;

  generationTime?: number;

  seed?: number;

  error?: string;
};

export const generationJobs =
  new Map<string, GenerationJob>();

export function createJob(
  prompt: string
) {
  const jobId = uuidv4();

  generationJobs.set(jobId, {
    id: jobId,

    status: "queued",

    progress: 0,

    currentStep: 0,

    totalSteps: 4,

    startedAt: Date.now(),

    prompt,
  });

  return jobId;
}