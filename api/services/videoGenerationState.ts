import { v4 as uuidv4 } from "uuid";

export type SceneStatus = {
  index: number;
  prompt: string;
  status: "queued" | "loading" | "sampling" | "saving" | "completed" | "failed";
  progress: number; // 0-100
  outputPath?: string;
  error?: string;
  // Only set when this scene is rendered via an ltx-3-stage provider.
  // Lets the UI show "Scene 2/3 - Stage 2/4 (upscale/refine)" instead of
  // a single opaque progress bar per scene, without changing anything
  // for single-stage providers (Flux/Wan) which never set this.
  ltxStage?: {
    current: 1 | 2 | 3 | 4; // 4 = ffmpeg grade/encode
    label: string;
  };
};

export type VideoJob = {
  id: string;

  status:
    | "queued"
    | "planning"
    | "loading"
    | "sampling"
    | "merging"
    | "saving"
    | "completed"
    | "failed";

  // 0-100. NOT a 0-1 fraction — frontend must NOT multiply this by 100
  // again. This is the single most common bug when consuming this field.
  progress: number;

  prompt: string;

  sceneCount: number;
  scenes: SceneStatus[];
  currentSceneIndex: number;

  startedAt: number;

  videoUrl?: string;
  generationTime?: number;
  seed?: number;
  error?: string;
};

export const videoJobs = new Map<string, VideoJob>();

export function createVideoJob(prompt: string) {
  const jobId = uuidv4();

  videoJobs.set(jobId, {
    id: jobId,
    status: "queued",
    progress: 0,
    prompt,
    sceneCount: 1,
    scenes: [],
    currentSceneIndex: 0,
    startedAt: Date.now(),
  });

  return jobId;
}

// Recomputes the job's overall 0-100 progress from its scenes (each scene's
// own `progress` is also 0-100) so status/result polling always reflects
// real per-scene state instead of a hand-tracked running total that can
// drift.
export function recomputeOverallProgress(jobId: string) {
  const job = videoJobs.get(jobId);
  if (!job || job.scenes.length === 0) return;

  const perScenePct = 100 / job.scenes.length;
  const total = job.scenes.reduce((sum, s) => sum + (s.progress / 100) * perScenePct, 0);

  videoJobs.set(jobId, {
    ...job,
    progress: Math.min(95, Math.round(total)), // reserve 95-100 for the merge/save step
  });
}