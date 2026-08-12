import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { v4 as uuidv4 } from "uuid";
import WebSocket from "ws";

import { generationJobs } from "./generationState";
import { buildWorkflow } from "./comfyWorkflow";
import { getProvider, getDefaultProvider } from "./providers";
import {
  videoJobs,
  recomputeOverallProgress,
  type SceneStatus,
} from "./videoGenerationState";
import {
  buildStage1Workflow,
  buildStage2Workflow,
  buildStage3Workflow,
  type Stage1Config,
  type Stage2Config,
  type Stage3Config,
} from "./videoWorkflow";

const execFileAsync = promisify(execFile);

const COMFY_URL = "http://127.0.0.1:8188";
const COMFY_WS = "ws://127.0.0.1:8188/ws";
const COMFY_OUTPUT = "D:/AI/ComfyUI/output";

// Same live-progress event shape framesx.ts uses for video (see
// FramesXEvent there) so a future shared frontend progress component can
// consume both without a translation layer. Image gen is always a single
// "scene" so the scene-indexed fields just aren't used here.
export type ImageGenEvent =
  | { type: "queued"; promptId: string }
  | { type: "comfy_node"; node: string | null }
  | { type: "comfy_progress"; value: number; max: number }
  | { type: "comfy_cached"; nodes: string[] }
  | { type: "done"; result: Record<string, any> }
  | { type: "error"; error: string };

export type ImageEmit = (event: ImageGenEvent) => void;

const noopEmit: ImageEmit = () => {};

// Stage 1/2/3 output directories, expressed both ways ComfyUI wants them:
// VHS_LoadImagesPath's `directory` field wants a path relative to the
// ComfyUI output root (e.g. "output/Gen3/"), while our own file checks
// need the absolute Windows path (e.g. "D:/AI/ComfyUI/output/Gen3/").
const STAGE_DIRS = {
  stage1: { relative: "output/Gen3/", absolute: "D:/AI/ComfyUI/output/Gen3" },
  stage2: { relative: "output/Gen3/Stage2/", absolute: "D:/AI/ComfyUI/output/Gen3/Stage2" },
  stage3: { relative: "output/Gen3/Stage3/", absolute: "D:/AI/ComfyUI/output/Gen3/Stage3" },
} as const;

// Folder reorganized from app/LTX/ to app/Comfy/LTX/ per the multi-provider
// layout (app/Comfy/<Provider>/...).
const STAGE4_BAT_PATH = path.join(process.cwd(), "app", "Comfy", "LTX", "stage4_grade_and_encode.bat");

// Lazy eval — avoids process.cwd() running at module parse time in SSR
function getPublicGenerated() {
  return path.join(process.cwd(), "public", "generated");
}

export async function generateFluxImage(
  jobId: string,
  {
    prompt,
    negativePrompt,
    width = 512,
    height = 512,
    // Distilled Flux variants (schnell, Klein) want ~4 steps / low cfg.
    // 20/1 was a stale SDXL-era default that never matched either
    // workflow JSON's own steps=4 setting - callers that don't pass
    // explicit values now get values consistent with the actual model.
    steps = 4,
    cfg = 1.5,
    denoise = 1,
    batchSize = 1,
    sampler = "euler",
    scheduler = "simple",
    seed,
    providerId,
  }: {
    prompt: string;
    negativePrompt?: string;
    width?: number;
    height?: number;
    steps?: number;
    cfg?: number;
    denoise?: number;
    batchSize?: number;
    sampler?: string;
    scheduler?: string;
    seed?: number;
    providerId?: string;
  },
  emit: ImageEmit = noopEmit
) {
  const PUBLIC_GENERATED = getPublicGenerated();

  const finalSeed =
    seed ?? Math.floor(Math.random() * 999999999999999);

  const workflow = buildWorkflow({
  prompt,
  negativePrompt,
  width,
  height,
  seed: finalSeed,
  steps,
  cfg,
  sampler,
  scheduler,
  providerId,
});

  const startTime = Date.now();
  const clientId = `image-${jobId}`;

  const promptResponse = await fetch(`${COMFY_URL}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: workflow, client_id: clientId }),
  });

  if (!promptResponse.ok) {
    const errorText = await promptResponse.text();
    emit({ type: "error", error: `ComfyUI Prompt Error: ${errorText}` });
    throw new Error(`ComfyUI Prompt Error: ${errorText}`);
  }

  const promptData = await promptResponse.json();
  const promptId = promptData.prompt_id;

  if (!promptId) {
    emit({ type: "error", error: "Failed to create ComfyUI job" });
    throw new Error("Failed to create ComfyUI job");
  }

  generationJobs.set(jobId, {
    ...generationJobs.get(jobId)!,
    status: "loading",
    progress: 10,
  });
  emit({ type: "queued", promptId });

  // ── Real progress via ComfyUI's /ws socket ──
  // Previously this was a fake progress bar: a fixed 1200-iteration poll
  // loop that computed `percent` from loop count, not from anything
  // ComfyUI actually reported. currentStep/totalSteps were similarly
  // estimated from elapsed iterations, not the sampler's real step. This
  // now uses the same live /ws tracking framesx.ts already uses for
  // video (executing/progress/execution_error messages scoped by
  // client_id + prompt_id), so status polling and the new SSE stream
  // both reflect ComfyUI's actual state.
  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(`${COMFY_WS}?clientId=${clientId}`);
    let settled = false;
    let lastStep = 0;
    let totalSteps = steps;

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        ws.close();
        reject(new Error("Generation timeout"));
      }
    }, 20 * 60 * 1000); // 20 min ceiling

    ws.on("message", (raw: WebSocket.RawData, isBinary: boolean) => {
      if (isBinary) return;
      let msg: any;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      const data = msg.data;
      if (!data || data.prompt_id !== promptId) return;

      if (msg.type === "executing") {
        const node = data.node as string | null;
        emit({ type: "comfy_node", node });
        if (node === null) {
          clearTimeout(timeout);
          generationJobs.set(jobId, {
            ...generationJobs.get(jobId)!,
            status: "saving",
            progress: 95,
          });
          if (!settled) {
            settled = true;
            ws.close();
            resolve();
          }
        } else {
          generationJobs.set(jobId, {
            ...generationJobs.get(jobId)!,
            status: "sampling",
          });
        }
      } else if (msg.type === "progress") {
        lastStep = data.value;
        totalSteps = data.max || totalSteps;
        const pct = Math.min(90, Math.round((lastStep / totalSteps) * 90));
        generationJobs.set(jobId, {
          ...generationJobs.get(jobId)!,
          status: "sampling",
          progress: pct,
          currentStep: lastStep,
          totalSteps,
        });
        emit({ type: "comfy_progress", value: lastStep, max: totalSteps });
      } else if (msg.type === "execution_cached") {
        emit({ type: "comfy_cached", nodes: data.nodes ?? [] });
      } else if (msg.type === "execution_error") {
        clearTimeout(timeout);
        const err = `ComfyUI execution error: ${data.exception_message ?? "unknown error"}`;
        emit({ type: "error", error: err });
        if (!settled) {
          settled = true;
          ws.close();
          reject(new Error(err));
        }
      }
    });

    ws.on("error", (err: Error) => {
      clearTimeout(timeout);
      const message = `ComfyUI websocket error: ${err.message}`;
      emit({ type: "error", error: message });
      if (!settled) {
        settled = true;
        reject(new Error(message));
      }
    });
  });

  const historyResponse = await fetch(`${COMFY_URL}/history/${promptId}`);
  if (!historyResponse.ok) {
    const err = `Failed to fetch ComfyUI history: ${historyResponse.status}`;
    emit({ type: "error", error: err });
    throw new Error(err);
  }
  const historyData = await historyResponse.json();

  if (!historyData || !historyData[promptId]) {
    emit({ type: "error", error: "Generation timeout" });
    throw new Error("Generation timeout");
  }

  const outputs = historyData[promptId].outputs;

  const saveNode = Object.values(outputs).find(
    (node: any) => node?.images?.length
  );

  if (!saveNode) {
    throw new Error("No image output node found");
  }

  const image = (saveNode as any)?.images?.[0];

  if (!image) {
    throw new Error("Image not found in output");
  }

  console.log("IMAGE:", image);
  console.log("FILENAME:", image.filename);

  const sourceFile = path.join(COMFY_OUTPUT, image.filename);
  const extension = path.extname(image.filename);
  const filename = `${uuidv4()}${extension}`;
  const destinationFile = path.join(PUBLIC_GENERATED, filename);

  generationJobs.set(jobId, {
    ...generationJobs.get(jobId)!,
    status: "saving",
    progress: 95,
    currentStep: steps,
    totalSteps: steps,
  });

  try {
    console.log("SOURCE FILE:", sourceFile);
    await fs.access(sourceFile);
  } catch {
    throw new Error(`Output image missing: ${sourceFile}`);
  }

  const buffer = await fs.readFile(sourceFile);

  await fs.mkdir(PUBLIC_GENERATED, { recursive: true });
  console.log("DESTINATION:", destinationFile);

  await fs.writeFile(destinationFile, buffer);
  await new Promise((resolve) => setTimeout(resolve, 500));

  const generationTime = Math.round((Date.now() - startTime) / 1000);
  console.log("SETTING JOB COMPLETE");

  generationJobs.set(jobId, {
    ...generationJobs.get(jobId)!,
    status: "completed",
    progress: 100,
    currentStep: steps,
    totalSteps: steps,
    imageUrl: `/generated/${filename}`,
    generationTime,
    seed: finalSeed,
  });

  const result = {
    seed: finalSeed,
    generationTime,
    imageUrl: `/generated/${filename}`,
    width,
    height,
  };

  emit({ type: "done", result });

  return result;
}

// ============================================================
// 3-stage LTX pipeline: base gen -> upscale/refine -> interpolate/restore
// -> (stage 4, ffmpeg grade/encode, run as a subprocess afterward).
// Same submit -> poll /history -> read outputs pattern as
// generateFluxImage above, just looped across three separate workflow
// JSONs with a scene-status update between each.
// ============================================================

async function submitAndAwaitPrompt(
  workflow: Record<string, unknown>,
  onProgress: (percent: number) => void
): Promise<any> {
  const promptResponse = await fetch(`${COMFY_URL}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: workflow }),
  });

  if (!promptResponse.ok) {
    const errorText = await promptResponse.text();
    throw new Error(`ComfyUI Prompt Error: ${errorText}`);
  }

  const promptData = await promptResponse.json();
  const promptId = promptData.prompt_id;

  if (!promptId) {
    throw new Error("Failed to create ComfyUI job");
  }

  let historyData: any = null;

  for (let attempt = 0; attempt < 1200; attempt++) {
    await new Promise((r) => setTimeout(r, 1000));

    onProgress(Math.min(90, Math.round((attempt / 1200) * 90)));

    const historyResponse = await fetch(`${COMFY_URL}/history/${promptId}`);

    if (!historyResponse.ok) {
      console.error("History fetch failed:", historyResponse.status);
      continue;
    }

    historyData = await historyResponse.json();

    if (historyData && historyData[promptId]) break;
  }

  if (!historyData || !historyData[promptId]) {
    throw new Error("Generation timeout");
  }

  return historyData[promptId];
}

function updateScene(jobId: string, index: number, patch: Partial<SceneStatus>) {
  const job = videoJobs.get(jobId);
  if (!job) return;

  const scenes = [...job.scenes];
  scenes[index] = { ...scenes[index], ...patch };

  videoJobs.set(jobId, { ...job, scenes, currentSceneIndex: index });
  recomputeOverallProgress(jobId);
}

export async function generateLtxVideoPipeline(
  jobId: string,
  {
    prompt,
    negativePrompt,
    width = 640,
    height = 352,
    length = 193,
    frameRate = 24,
    seed,
  }: {
    prompt: string;
    negativePrompt?: string;
    width?: number;
    height?: number;
    length?: number;
    frameRate?: number;
    seed?: number;
  }
) {
  const startTime = Date.now();
  const finalSeed = seed ?? Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
  const runId = uuidv4();

  const job = videoJobs.get(jobId);
  if (!job) throw new Error(`Video job ${jobId} not found`);

  videoJobs.set(jobId, {
    ...job,
    status: "loading",
    sceneCount: 4,
    scenes: [
      { index: 0, prompt, status: "queued", progress: 0 },
      { index: 1, prompt, status: "queued", progress: 0 },
      { index: 2, prompt: "", status: "queued", progress: 0 },
      { index: 3, prompt: "", status: "queued", progress: 0 },
    ],
    currentSceneIndex: 0,
  });

  // ---- Stage 1: base generation ----
  updateScene(jobId, 0, { status: "sampling", progress: 0 });

  const stage1Prefix = `ltx_stage1_base_${runId}`;
  const stage1Workflow = buildStage1Workflow(
    {
      prompt,
      negativePrompt,
      width,
      height,
      length,
      frameRate,
      steps: 10,
      cfg: 1.5,
      seed: finalSeed,
    } satisfies Stage1Config,
    stage1Prefix
  );

  await submitAndAwaitPrompt(stage1Workflow, (pct) =>
    updateScene(jobId, 0, { progress: pct })
  );
  updateScene(jobId, 0, { status: "completed", progress: 100, outputPath: STAGE_DIRS.stage1.absolute });

  // ---- Stage 2: latent upscale + refine ----
  videoJobs.set(jobId, { ...videoJobs.get(jobId)!, status: "sampling" });
  updateScene(jobId, 1, { status: "sampling", progress: 0 });

  const stage2Prefix = `ltx_stage2_upscaled_${runId}`;
  const stage2Workflow = buildStage2Workflow(
    {
      prompt,
      negativePrompt,
      frameRate,
      steps: 8,
      cfg: 1.5,
      scaleBy: 1.5,
      seed: finalSeed,
      stage1OutputDir: STAGE_DIRS.stage1.relative,
    } satisfies Stage2Config,
    stage2Prefix
  );

  await submitAndAwaitPrompt(stage2Workflow, (pct) =>
    updateScene(jobId, 1, { progress: pct })
  );
  updateScene(jobId, 1, { status: "completed", progress: 100, outputPath: STAGE_DIRS.stage2.absolute });

  // ---- Stage 3: interpolate + face restore ----
  updateScene(jobId, 2, { status: "sampling", progress: 0 });

  const stage3FramesPrefix = `ltx_stage3_interpolated_${runId}`;
  const stage3PreviewPrefix = `ltx_stage3_preview_${runId}`;
  const stage3Workflow = buildStage3Workflow(
    {
      stage2OutputDir: STAGE_DIRS.stage2.relative,
      faceRestoreVisibility: 0.5,
      rifeMultiplier: 2,
    } satisfies Stage3Config,
    stage3FramesPrefix,
    stage3PreviewPrefix
  );

  await submitAndAwaitPrompt(stage3Workflow, (pct) =>
    updateScene(jobId, 2, { progress: pct })
  );
  updateScene(jobId, 2, { status: "completed", progress: 100, outputPath: STAGE_DIRS.stage3.absolute });

  // ---- Stage 4: grade + encode (ffmpeg via .bat, not ComfyUI) ----
  videoJobs.set(jobId, { ...videoJobs.get(jobId)!, status: "merging" });
  updateScene(jobId, 3, { status: "sampling", progress: 10 });

  try {
    await execFileAsync(STAGE4_BAT_PATH, [], {
      cwd: path.dirname(STAGE4_BAT_PATH),
      windowsHide: true,
      timeout: 30 * 60 * 1000, // 30 min ceiling for three ffmpeg encodes
    });
  } catch (err) {
    updateScene(jobId, 3, { status: "failed", error: String(err) });
    videoJobs.set(jobId, {
      ...videoJobs.get(jobId)!,
      status: "failed",
      error: `Stage 4 encode failed: ${err}`,
    });
    throw err;
  }

  updateScene(jobId, 3, { status: "completed", progress: 100, outputPath: STAGE_DIRS.stage3.absolute });

  // stage4_grade_and_encode.bat writes output_web_h264.mp4 (and two other
  // variants) into OUTPUT_DIR, which is set to the stage3 folder in the
  // .bat's own config block. Copy the web-preset file into the app's
  // public directory the same way generateFluxImage does for images.
  const PUBLIC_GENERATED = path.join(process.cwd(), "public", "generated");
  await fs.mkdir(PUBLIC_GENERATED, { recursive: true });

  const sourceVideo = path.join(STAGE_DIRS.stage3.absolute.replace(/\//g, path.sep), "output_web_h264.mp4");
  const destFilename = `${runId}.mp4`;
  const destVideo = path.join(PUBLIC_GENERATED, destFilename);

  await fs.copyFile(sourceVideo, destVideo);

  const generationTime = Math.round((Date.now() - startTime) / 1000);

  videoJobs.set(jobId, {
    ...videoJobs.get(jobId)!,
    status: "completed",
    progress: 100,
    videoUrl: `/generated/${destFilename}`,
    generationTime,
    seed: finalSeed,
  });

  return {
    seed: finalSeed,
    generationTime,
    videoUrl: `/generated/${destFilename}`,
  };
}