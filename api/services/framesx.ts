// api/services/framesx.ts
//
// FramesX — the video-studio counterpart to services/comfy.ts +
// services/comfyWorkflow.ts. A video job has phases image generation
// doesn't: (1) optional LLM scene planning for long prompts, streamed
// token-by-token, (2) a queue of per-scene ComfyUI renders — each one
// tracked live via ComfyUI's own /ws socket (real step/node progress, not
// polling /history), (3) an ffmpeg merge of all scene outputs.
//
// Every phase reports through a single `emit(event, data)` callback so the
// SSE route (boot.ts's /api/video/stream/:jobId) can relay it straight to
// the browser in real time — LLM tokens as they're generated, which node
// ComfyUI is currently executing, live sampler step/total, per-scene
// completion, and the final merge. The videoJobs map (videoGenerationState.ts)
// is still updated on every emit so status/result polling (page reload,
// resume, or a client that missed the stream) stays accurate as a fallback.
//
// Requires ffmpeg on PATH for merging multi-scene jobs (not needed for a
// single-scene job). For mp4 output, ComfyUI needs the VHS_VideoCombine node
// (from the ComfyUI-VideoHelperSuite custom node pack) — see videoWorkflow.ts.

import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { v4 as uuidv4 } from "uuid";
import WebSocket from "ws";

import { videoJobs, recomputeOverallProgress, type SceneStatus } from "./videoGenerationState";
import { buildVideoWorkflow, buildStage1Workflow, buildStage2Workflow, buildStage3Workflow, type SceneConfig } from "./videoWorkflow";
import { getProvider, getDefaultProvider } from "./providers";

const COMFY_HTTP = "http://127.0.0.1:8188";
const COMFY_WS = "ws://127.0.0.1:8188/ws";
const COMFY_OUTPUT = "D:/AI/ComfyUI/output";
const OLLAMA_URL = "http://localhost:11434/api/generate";

function getPublicGeneratedVideos() {
  return path.join(process.cwd(), "public", "video", "generated");
}

// Server-side console logging — mirrors analyzeStream.ts's [ANALYZE]
// prefix convention. This exists separately from the emit()/SSE stream:
// the browser log only appears while someone has the tab open and
// connected; this is what shows up when tailing the server process
// directly (SSH'd in, no browser, systemd/pm2 logs, etc). High-volume
// events (individual LLM tokens, every websocket progress tick) are
// intentionally NOT logged line-by-line here — same reasoning
// analyzeStream.ts uses for its "thinking" events — that would flood the
// console for no debugging benefit. Progress is logged at a throttled
// interval instead (see logThrottled below).
function log(jobId: string, message: string) {
  console.log(`[FRAMESX] job=${jobId.slice(0, 8)} ${message}`);
}

function logError(jobId: string, message: string, err?: unknown) {
  if (err !== undefined) {
    console.error(`[FRAMESX] job=${jobId.slice(0, 8)} ${message}:`, err);
  } else {
    console.error(`[FRAMESX] job=${jobId.slice(0, 8)} ${message}`);
  }
}

// Sampler progress fires many times per second across a 30-60 step
// generation — logging every tick would drown everything else out. This
// logs at most once every 2s per (job, scene) pair while still relaying
// every single tick to the browser via emit() (SSE isn't throttled, only
// the console is).
const lastProgressLogAt = new Map<string, number>();
function logProgressThrottled(jobId: string, sceneIndex: number, value: number, max: number) {
  const key = `${jobId}:${sceneIndex}`;
  const now = Date.now();
  const last = lastProgressLogAt.get(key) ?? 0;
  if (now - last < 2000 && value < max) return;
  lastProgressLogAt.set(key, now);
  log(jobId, `scene ${sceneIndex} sampling — step ${value}/${max}`);
}

// ── Live event contract ─────────────────────────────────────────────────
// Every event the orchestrator can emit. The SSE route relays these 1:1 as
// `event: <name>` frames — see boot.ts's /api/video/stream/:jobId. Kept as
// one flat union so the frontend has a single source of truth for what it
// might receive on the wire.
export type FramesXEvent =
  | { type: "planning_start"; model: string; targetDurationSeconds: number }
  | { type: "planning_token"; token: string } // raw LLM token, streamed live
  | { type: "planning_done"; scenes: { prompt: string; negativePrompt?: string; durationSeconds: number }[] }
  | { type: "scene_start"; index: number; total: number; prompt: string }
  | { type: "comfy_queued"; index: number; promptId: string }
  | { type: "comfy_node"; index: number; node: string | null } // null = node finished
  | { type: "comfy_progress"; index: number; value: number; max: number } // live sampler step
  | { type: "comfy_cached"; index: number; nodes: string[] }
  | { type: "scene_done"; index: number; filename: string }
  | { type: "scene_error"; index: number; error: string }
  | { type: "merging_start"; sceneCount: number }
  | { type: "merging_done"; videoUrl: string }
  | { type: "done"; result: Record<string, any> }
  | { type: "error"; error: string };

type Emit = (event: FramesXEvent) => void;

// ── Types ────────────────────────────────────────────────────────────────

export interface VideoGenerationInput {
  prompt: string;
  negativePrompt?: string;
  width?: number;
  height?: number;
  length?: number;
  frameRate?: number;
  fps?: number;
  steps?: number;
  cfg?: number;
  seed?: number;
  format?: "webp" | "mp4";
  targetDurationSeconds?: number;
  sceneCountOverride?: number;
  planningModel?: string;
  // Which registered video provider executes each planned scene. The LLM
  // planning phase (planScenes/evenSplitScenes) is provider-agnostic - it
  // only decides *what* each scene shows and how long it runs. This
  // field only changes *how* each scene gets rendered once planned.
  // Defaults to the first registered video provider if omitted.
  providerId?: string;
}

interface PlannedScene {
  prompt: string;
  negativePrompt?: string;
  durationSeconds: number;
}

const SINGLE_SCENE_THRESHOLD_SECONDS = 6;

// ── Phase 1: LLM scene planning (streamed) ─────────────────────────────
//
// Uses Ollama's stream:true NDJSON mode instead of the stream:false call
// the image path uses — every generated token is relayed live via
// emit("planning_token") as it arrives, so the frontend can show the model
// "thinking" in real time before the final scene JSON is parsed out.

async function planScenes(
  jobId: string,
  prompt: string,
  targetDurationSeconds: number,
  model: string,
  emit: Emit
): Promise<PlannedScene[]> {
  const planningPrompt = `
You are a cinematic scene planner for an AI video generator. Break the
following video concept into a sequence of consecutive scenes that together
tell one continuous story, in the same visual style and setting, so they can
be generated separately and then stitched back-to-back into one video.

Rules:
- Total duration across all scenes must sum to approximately ${targetDurationSeconds} seconds.
- Each scene should be 3-6 seconds.
- Each scene's prompt must be a complete, standalone, richly detailed visual
  description (camera angle, subject, motion, lighting) — the generator has
  no memory of other scenes, so do not write things like "continues from
  before".
- Keep subject, setting, and visual style IDENTICAL across all scenes so the
  cuts look continuous — only the action/camera should change scene to scene.
- Respond with ONLY a JSON array, no prose, no markdown fences. Each element:
  {"prompt": "...", "negativePrompt": "...", "durationSeconds": number}

Video concept:
${prompt}
`;

  emit({ type: "planning_start", model, targetDurationSeconds });
  log(jobId, `planning scenes with model=${model} target=${targetDurationSeconds}s`);

  const response = await fetch(OLLAMA_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, prompt: planningPrompt, stream: true }),
  });

  if (!response.ok || !response.body) {
    logError(jobId, "scene planning request to Ollama failed");
    throw new Error("Scene planning failed: LLM request error");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;
      let chunk: any;
      try {
        chunk = JSON.parse(line);
      } catch {
        continue; // partial/malformed line — skip, next read will resync
      }

      if (chunk.response) {
        fullText += chunk.response;
        emit({ type: "planning_token", token: chunk.response });
      }
      if (chunk.done) break;
    }
  }

  let scenes: PlannedScene[];
  try {
    scenes = JSON.parse(fullText.trim());
  } catch {
    const match = fullText.match(/\[[\s\S]*\]/);
    if (!match) {
      logError(jobId, "scene planner returned non-JSON output");
      throw new Error("Scene planning failed: model did not return valid JSON");
    }
    scenes = JSON.parse(match[0]);
  }

  if (!Array.isArray(scenes) || scenes.length === 0) {
    logError(jobId, "scene planner returned an empty scene list");
    throw new Error("Scene planning failed: empty scene list");
  }

  log(jobId, `planning done — ${scenes.length} scene(s) planned`);
  emit({ type: "planning_done", scenes });
  return scenes;
}

function evenSplitScenes(
  prompt: string,
  negativePrompt: string | undefined,
  targetDurationSeconds: number,
  sceneCount: number
): PlannedScene[] {
  const perScene = targetDurationSeconds / sceneCount;
  return Array.from({ length: sceneCount }, () => ({
    prompt,
    negativePrompt,
    durationSeconds: perScene,
  }));
}

// ── Phase 2: single-scene ComfyUI render, tracked over /ws ─────────────
//
// Opens a dedicated WebSocket per scene (ComfyUI scopes messages by
// clientId, and clientId must match what was sent to /prompt — see
// resolveComfyClientId below), listens for `executing` (which node is
// running), `progress` (live sampler value/max — this is the actual
// current-step/total-steps the KSampler/LTXVScheduler reports, not an
// estimate), and `executed`/completion, then reads /history once for the
// final output filename.

function resolveComfyClientId(jobId: string, sceneIndex: number) {
  return `framesx-${jobId}-${sceneIndex}`;
}

async function renderScene(
  jobId: string,
  sceneIndex: number,
  total: number,
  config: SceneConfig,
  emit: Emit
): Promise<{ sourceFile: string; filename: string }> {
  const job = videoJobs.get(jobId)!;
  const scene = job.scenes[sceneIndex];

  emit({ type: "scene_start", index: sceneIndex, total, prompt: config.prompt });
  log(jobId, `scene ${sceneIndex + 1}/${total} starting — ${config.width}x${config.height}, ${config.steps} steps, format=${config.format}`);

  const filenamePrefix = `framesx_${jobId}_scene${sceneIndex}`;
  const workflow = buildVideoWorkflow(config, filenamePrefix);
  const clientId = resolveComfyClientId(jobId, sceneIndex);

  const promptResponse = await fetch(`${COMFY_HTTP}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: workflow, client_id: clientId }),
  });

  if (!promptResponse.ok) {
    const errorText = await promptResponse.text();
    const err = `ComfyUI Prompt Error (scene ${sceneIndex}): ${errorText}`;
    logError(jobId, `scene ${sceneIndex} ComfyUI /prompt submission failed — ${errorText}`);
    emit({ type: "scene_error", index: sceneIndex, error: err });
    throw new Error(err);
  }

  const promptData = await promptResponse.json();
  const promptId = promptData.prompt_id;

  if (!promptId) {
    const err = `Failed to create ComfyUI job for scene ${sceneIndex}`;
    logError(jobId, `scene ${sceneIndex} — ComfyUI returned no prompt_id`);
    emit({ type: "scene_error", index: sceneIndex, error: err });
    throw new Error(err);
  }

  log(jobId, `scene ${sceneIndex} queued on ComfyUI — promptId=${promptId}`);
  emit({ type: "comfy_queued", index: sceneIndex, promptId });

  scene.status = "loading";
  scene.progress = 5;
  videoJobs.set(jobId, { ...job, status: "loading" });
  recomputeOverallProgress(jobId);

  // ── Live tracking over ComfyUI's own websocket ──
  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(`${COMFY_WS}?clientId=${clientId}`);
    let settled = false;
    let lastStep = 0;
    let totalSteps = config.steps;

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        ws.close();
        reject(new Error(`Generation timeout on scene ${sceneIndex}`));
      }
    }, 30 * 60 * 1000); // 30 min ceiling per scene

    ws.on("message", (raw: WebSocket.RawData, isBinary: boolean) => {
      if (isBinary) return; // preview image bytes — not needed here, skip

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
        emit({ type: "comfy_node", index: sceneIndex, node });

        if (node === null) {
          // Execution finished for this prompt_id.
          log(jobId, `scene ${sceneIndex} ComfyUI execution finished`);
          scene.status = "saving";
          scene.progress = 95;
          videoJobs.set(jobId, { ...videoJobs.get(jobId)!, status: "saving" });
          recomputeOverallProgress(jobId);

          clearTimeout(timeout);
          if (!settled) {
            settled = true;
            ws.close();
            resolve();
          }
        } else {
          scene.status = "sampling";
          videoJobs.set(jobId, { ...videoJobs.get(jobId)!, status: "sampling" });
        }
      } else if (msg.type === "progress") {
        lastStep = data.value;
        totalSteps = data.max || totalSteps;
        const pct = Math.min(90, Math.round((lastStep / totalSteps) * 90));

        scene.status = "sampling";
        scene.progress = pct;
        videoJobs.set(jobId, { ...videoJobs.get(jobId)!, status: "sampling" });
        recomputeOverallProgress(jobId);

        logProgressThrottled(jobId, sceneIndex, lastStep, totalSteps);
        emit({ type: "comfy_progress", index: sceneIndex, value: lastStep, max: totalSteps });
      } else if (msg.type === "execution_cached") {
        log(jobId, `scene ${sceneIndex} — ${(data.nodes ?? []).length} node(s) cached`);
        emit({ type: "comfy_cached", index: sceneIndex, nodes: data.nodes ?? [] });
      } else if (msg.type === "execution_error") {
        clearTimeout(timeout);
        const err = `ComfyUI execution error on scene ${sceneIndex}: ${data.exception_message ?? "unknown error"}`;
        logError(jobId, `scene ${sceneIndex} ComfyUI execution_error`, data.exception_message ?? data);
        emit({ type: "scene_error", index: sceneIndex, error: err });
        if (!settled) {
          settled = true;
          ws.close();
          reject(new Error(err));
        }
      }
    });

    ws.on("error", (err: Error) => {
      clearTimeout(timeout);
      logError(jobId, `scene ${sceneIndex} ComfyUI websocket error`, err);
      if (!settled) {
        settled = true;
        reject(new Error(`ComfyUI websocket error on scene ${sceneIndex}: ${err.message}`));
      }
    });
  });

  // ── Pull the final output filename from /history now that execution's done ──
  const historyResponse = await fetch(`${COMFY_HTTP}/history/${promptId}`);
  if (!historyResponse.ok) {
    logError(jobId, `scene ${sceneIndex} — failed to fetch ComfyUI history`);
    throw new Error(`Failed to fetch history for scene ${sceneIndex}`);
  }
  const historyData = await historyResponse.json();
  const outputs = historyData[promptId]?.outputs;

  if (!outputs) {
    logError(jobId, `scene ${sceneIndex} — no outputs recorded in ComfyUI history`);
    throw new Error(`No outputs recorded for scene ${sceneIndex}`);
  }

  const outputNode = Object.values(outputs).find(
    (node: any) => node?.images?.length || node?.gifs?.length
  ) as any;

  if (!outputNode) {
    logError(jobId, `scene ${sceneIndex} — no video output node found in ComfyUI history`);
    throw new Error(`No video output node found for scene ${sceneIndex}`);
  }

  const fileEntry = (outputNode.gifs?.[0] ?? outputNode.images?.[0]) as
    | { filename: string; subfolder?: string }
    | undefined;

  if (!fileEntry) {
    logError(jobId, `scene ${sceneIndex} — output file entry missing`);
    throw new Error(`Output file missing in scene ${sceneIndex} result`);
  }

  const sourceFile = path.join(COMFY_OUTPUT, fileEntry.subfolder ?? "", fileEntry.filename);

  try {
    await fs.access(sourceFile);
  } catch {
    logError(jobId, `scene ${sceneIndex} — output file missing on disk: ${sourceFile}`);
    throw new Error(`Scene ${sceneIndex} output missing on disk: ${sourceFile}`);
  }

  scene.status = "completed";
  scene.progress = 100;
  scene.outputPath = sourceFile;
  videoJobs.set(jobId, { ...videoJobs.get(jobId)! });
  recomputeOverallProgress(jobId);

  log(jobId, `scene ${sceneIndex + 1}/${total} complete — ${fileEntry.filename}`);
  emit({ type: "scene_done", index: sceneIndex, filename: fileEntry.filename });

  return { sourceFile, filename: fileEntry.filename };
}

// ── Phase 2b: LTX 3-stage scene render (base gen -> upscale/refine ->
// interpolate/restore -> ffmpeg grade/encode), used when the selected
// video provider's executor is "ltx-3-stage". Reuses the same WS-tracking
// approach as renderScene, run three times (once per ComfyUI stage) plus
// a subprocess call for the ffmpeg stage. Emits the same event shapes
// renderScene does (scene_start/comfy_queued/comfy_node/comfy_progress/
// scene_done/scene_error) so the SSE relay and frontend don't need to
// know which executor rendered a given scene - only ltxStage on the
// scene status differs, and that's additive (see videoGenerationState.ts).

async function submitAndTrackComfyPrompt(
  jobId: string,
  sceneIndex: number,
  stageLabel: string,
  workflow: Record<string, any>,
  emit: Emit,
  approxSteps: number
): Promise<{ promptId: string }> {
  const clientId = `framesx-${jobId}-${sceneIndex}-${stageLabel.replace(/\s+/g, "")}`;

  const promptResponse = await fetch(`${COMFY_HTTP}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: workflow, client_id: clientId }),
  });

  if (!promptResponse.ok) {
    const errorText = await promptResponse.text();
    const err = `ComfyUI Prompt Error (scene ${sceneIndex}, ${stageLabel}): ${errorText}`;
    logError(jobId, `scene ${sceneIndex} ${stageLabel} ComfyUI /prompt submission failed — ${errorText}`);
    emit({ type: "scene_error", index: sceneIndex, error: err });
    throw new Error(err);
  }

  const promptData = await promptResponse.json();
  const promptId = promptData.prompt_id;
  if (!promptId) {
    const err = `Failed to create ComfyUI job for scene ${sceneIndex} ${stageLabel}`;
    logError(jobId, `scene ${sceneIndex} ${stageLabel} — ComfyUI returned no prompt_id`);
    emit({ type: "scene_error", index: sceneIndex, error: err });
    throw new Error(err);
  }

  log(jobId, `scene ${sceneIndex} ${stageLabel} queued on ComfyUI — promptId=${promptId}`);
  emit({ type: "comfy_queued", index: sceneIndex, promptId });

  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(`${COMFY_WS}?clientId=${clientId}`);
    let settled = false;
    let lastStep = 0;
    let totalSteps = approxSteps;

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        ws.close();
        reject(new Error(`Generation timeout on scene ${sceneIndex} ${stageLabel}`));
      }
    }, 30 * 60 * 1000);

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
        emit({ type: "comfy_node", index: sceneIndex, node });
        if (node === null) {
          log(jobId, `scene ${sceneIndex} ${stageLabel} ComfyUI execution finished`);
          clearTimeout(timeout);
          if (!settled) {
            settled = true;
            ws.close();
            resolve();
          }
        }
      } else if (msg.type === "progress") {
        lastStep = data.value;
        totalSteps = data.max || totalSteps;
        const pct = Math.min(90, Math.round((lastStep / totalSteps) * 90));
        logProgressThrottled(jobId, sceneIndex, lastStep, totalSteps);
        emit({ type: "comfy_progress", index: sceneIndex, value: lastStep, max: totalSteps });
      } else if (msg.type === "execution_cached") {
        emit({ type: "comfy_cached", index: sceneIndex, nodes: data.nodes ?? [] });
      } else if (msg.type === "execution_error") {
        clearTimeout(timeout);
        const err = `ComfyUI execution error on scene ${sceneIndex} ${stageLabel}: ${data.exception_message ?? "unknown error"}`;
        logError(jobId, `scene ${sceneIndex} ${stageLabel} ComfyUI execution_error`, data.exception_message ?? data);
        emit({ type: "scene_error", index: sceneIndex, error: err });
        if (!settled) {
          settled = true;
          ws.close();
          reject(new Error(err));
        }
      }
    });

    ws.on("error", (err: Error) => {
      clearTimeout(timeout);
      logError(jobId, `scene ${sceneIndex} ${stageLabel} ComfyUI websocket error`, err);
      if (!settled) {
        settled = true;
        reject(new Error(`ComfyUI websocket error on scene ${sceneIndex} ${stageLabel}: ${err.message}`));
      }
    });
  });

  return { promptId };
}

function setSceneStage(jobId: string, sceneIndex: number, current: 1 | 2 | 3 | 4, label: string, progress: number) {
  const job = videoJobs.get(jobId)!;
  const scene = job.scenes[sceneIndex];
  scene.ltxStage = { current, label };
  scene.progress = progress;
  scene.status = current === 4 ? "saving" : "sampling";
  videoJobs.set(jobId, { ...job });
  recomputeOverallProgress(jobId);
}

async function renderSceneLTX3Stage(
  jobId: string,
  sceneIndex: number,
  total: number,
  config: SceneConfig,
  emit: Emit
): Promise<{ sourceFile: string; filename: string }> {
  const provider = getProvider(config.providerId!) ?? getDefaultProvider("video");
  emit({ type: "scene_start", index: sceneIndex, total, prompt: config.prompt });
  log(jobId, `scene ${sceneIndex + 1}/${total} starting (ltx-3-stage, provider=${provider.id})`);

  const runId = `${jobId}_scene${sceneIndex}`;

  // ---- Stage 1: base generation ----
  //
  // IMPORTANT: Stage 1 uses ComfyUI's built-in SaveImage node which saves
  // frames flat under output/ using filename_prefix. Stage 2 reads them via
  // VHS_LoadImagesPath which requires a *directory*. We resolve this by
  // appending "/frame" to the prefix so SaveImage creates a subdirectory:
  //   output/framesx_..._stage1/frame_00001.png  ← actual file
  //   output/framesx_..._stage1/                 ← directory Stage 2 reads
  setSceneStage(jobId, sceneIndex, 1, "Base generation", 5);
  const stage1Dir = `framesx_${runId}_stage1`; // subdirectory name under output/
  const stage1Prefix = `${stage1Dir}/frame`;   // SaveImage prefix → creates the subdir
  const stage1Workflow = buildStage1Workflow(
    {
      prompt: config.prompt,
      negativePrompt: config.negativePrompt,
      width: config.width,
      height: config.height,
      length: config.length,
      frameRate: config.frameRate,
      steps: config.steps,
      cfg: config.cfg,
      seed: config.seed,
      providerId: provider.id,
    },
    stage1Prefix
  );
  await submitAndTrackComfyPrompt(jobId, sceneIndex, "stage1", stage1Workflow, emit, config.steps);

  // ---- Stage 2: upscale + refine ----
  setSceneStage(jobId, sceneIndex, 2, "Upscale / refine", 30);
  const stage2Dir = `framesx_${runId}_stage2`;
  const stage2Prefix = `${stage2Dir}/frame`;
  const stage2Workflow = buildStage2Workflow(
    {
      prompt: config.prompt,
      negativePrompt: config.negativePrompt,
      frameRate: config.frameRate,
      steps: Math.max(4, Math.round(config.steps * 0.8)),
      cfg: config.cfg,
      scaleBy: 1.5,
      seed: config.seed,
      providerId: provider.id,
      // VHS_LoadImagesPath expects the directory containing the saved PNGs
      stage1OutputDir: `output/${stage1Dir}/`,
    },
    stage2Prefix
  );
  await submitAndTrackComfyPrompt(jobId, sceneIndex, "stage2", stage2Workflow, emit, config.steps);

  // ---- Stage 3: interpolate + face restore ----
  setSceneStage(jobId, sceneIndex, 3, "Interpolate / restore", 60);
  const stage3Dir = `framesx_${runId}_stage3`;
  const stage3FramesPrefix = `${stage3Dir}/frame`;
  const stage3PreviewPrefix = `framesx_${runId}_stage3_preview`;
  const stage3Workflow = buildStage3Workflow(
    {
      providerId: provider.id,
      // VHS_LoadImagesPath expects the directory containing Stage 2's saved PNGs
      stage2OutputDir: `output/${stage2Dir}/`,
      faceRestoreVisibility: 0.5,
      rifeMultiplier: 2,
    },
    stage3FramesPrefix,
    stage3PreviewPrefix
  );
  await submitAndTrackComfyPrompt(jobId, sceneIndex, "stage3", stage3Workflow, emit, 1);

  // ---- Stage 4: ffmpeg encode PNG sequence → H.264 MP4 ----
  //
  // Stage 3 (RIFE VFI + face restore) outputs a PNG frame sequence under
  // COMFY_OUTPUT/{stage3Dir}/frame_00001.png, frame_00002.png, etc.
  // We encode those frames directly with runFfmpeg — no external batch file.
  setSceneStage(jobId, sceneIndex, 4, "Grade / encode", 90);

  const stage3FramesDir = path.join(COMFY_OUTPUT, stage3Dir);
  const sourceFile = path.join(stage3FramesDir, "output_web_h264.mp4");

  // ffmpeg image2 demuxer: stage3FramesPrefix is "{stage3Dir}/frame",
  // so SaveImage writes frame_00001_.png, frame_00002_.png … inside stage3Dir.
  const framePattern = path.join(stage3FramesDir, "frame_%05d_.png");

  try {
    log(jobId, `scene ${sceneIndex} stage4 encoding PNG sequence → ${sourceFile}`);
    await runFfmpeg(jobId, [
      "-y",
      "-framerate", String(config.fps ?? 24),
      "-i", framePattern,
      "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
      "-c:v", "libx264",
      "-preset", "fast",
      "-crf", "18",
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      sourceFile,
    ]);
  } catch (err) {
    const errMsg = `Stage 4 (ffmpeg encode) failed for scene ${sceneIndex}: ${err}`;
    logError(jobId, errMsg);
    emit({ type: "scene_error", index: sceneIndex, error: errMsg });
    throw new Error(errMsg);
  }

  const job = videoJobs.get(jobId)!;
  const scene = job.scenes[sceneIndex];
  scene.status = "completed";
  scene.progress = 100;
  scene.outputPath = sourceFile;
  videoJobs.set(jobId, { ...job });
  recomputeOverallProgress(jobId);

  log(jobId, `scene ${sceneIndex + 1}/${total} complete (ltx-3-stage) — ${sourceFile}`);
  emit({ type: "scene_done", index: sceneIndex, filename: path.basename(sourceFile) });

  return { sourceFile, filename: path.basename(sourceFile) };
}



function runFfmpeg(jobId: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    log(jobId, `ffmpeg ${args.join(" ")}`);
    const proc = spawn("ffmpeg", args);
    let stderr = "";
    proc.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    proc.on("error", (err: Error) => {
      logError(jobId, "ffmpeg failed to start (is it on PATH?)", err);
      reject(new Error(`ffmpeg not available or failed to start: ${err.message}`));
    });
    proc.on("close", (code: number | null) => {
      if (code === 0) {
        resolve();
      } else {
        logError(jobId, `ffmpeg exited with code ${code}`, stderr.slice(-2000));
        reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-2000)}`));
      }
    });
  });
}

/**
 * Transcode a single animated WebP file to a proper MP4 using libx264.
 * This is needed because ffmpeg's concat demuxer cannot read animated WebP
 * (ANIM/ANMF chunks) — codec parameters (width/height) are unspecified until
 * the file is fully decoded.
 */
async function transcodeWebpToMp4(jobId: string, inputWebp: string, outputMp4: string): Promise<void> {
  await runFfmpeg(jobId, [
    "-y",
    "-i", inputWebp,
    "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2", // ensure even dimensions for libx264
    "-c:v", "libx264",
    "-preset", "fast",
    "-crf", "18",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    outputMp4,
  ]);
}

async function mergeScenes(
  jobId: string,
  sceneFiles: string[],
  destinationFile: string,
  format: "webp" | "mp4"
): Promise<void> {
  // Detect whether the actual scene files are animated WebP (WAN 2.1 outputs
  // animated WebP even when the requested format is mp4). The concat demuxer
  // with -c copy cannot handle animated WebP because ffmpeg cannot determine
  // codec parameters (width/height) from the ANIM/ANMF chunk format.
  const inputsAreWebp = sceneFiles.every((f) => f.toLowerCase().endsWith(".webp"));

  if (format === "mp4" && inputsAreWebp) {
    // Transcode each WebP scene to a temp MP4, then concat-copy into the final file.
    const tempMp4s: string[] = [];
    try {
      for (let i = 0; i < sceneFiles.length; i++) {
        const tmpOut = `${destinationFile}.scene${i}.tmp.mp4`;
        log(jobId, `transcoding scene ${i + 1}/${sceneFiles.length} WebP → MP4`);
        await transcodeWebpToMp4(jobId, sceneFiles[i], tmpOut);
        tempMp4s.push(tmpOut);
      }

      if (tempMp4s.length === 1) {
        // Single scene — just rename/move the temp file
        await fs.rename(tempMp4s[0], destinationFile);
        tempMp4s.length = 0; // already moved, skip cleanup
        return;
      }

      // Concat the temp MP4s (they are now proper H.264 streams)
      const listFile = destinationFile + ".concat.txt";
      const listContent = tempMp4s.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n");
      await fs.writeFile(listFile, listContent, "utf8");
      try {
        await runFfmpeg(jobId, ["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", destinationFile]);
      } finally {
        await fs.unlink(listFile).catch(() => {});
      }
    } finally {
      // Clean up temp MP4s
      for (const tmp of tempMp4s) {
        await fs.unlink(tmp).catch(() => {});
      }
    }
    return;
  }

  // ── Standard path (native mp4 inputs, or webp output) ────────────────────
  if (sceneFiles.length === 1) {
    const buffer = await fs.readFile(sceneFiles[0]);
    await fs.writeFile(destinationFile, buffer);
    return;
  }

  const listFile = destinationFile + ".concat.txt";
  const listContent = sceneFiles.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n");
  await fs.writeFile(listFile, listContent, "utf8");

  try {
    if (format === "mp4") {
      await runFfmpeg(jobId, ["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", destinationFile]);
    } else {
      await runFfmpeg(jobId, ["-y", "-f", "concat", "-safe", "0", "-i", listFile, destinationFile]);
    }
  } finally {
    await fs.unlink(listFile).catch(() => {});
  }
}

// ── Orchestrator ─────────────────────────────────────────────────────────

export async function generateFramesXVideo(jobId: string, input: VideoGenerationInput, emit: Emit) {
  const PUBLIC_GENERATED = getPublicGeneratedVideos();
  await fs.mkdir(PUBLIC_GENERATED, { recursive: true });

  const provider = input.providerId ? getProvider(input.providerId) : getDefaultProvider("video");
  if (!provider) {
    throw new Error(`Unknown video provider id: "${input.providerId}"`);
  }

  // stage4_grade_and_encode.bat always produces mp4 - force it here so the
  // final mergeScenes() concat/copy step doesn't mislabel the output
  // extension when the caller left format at its webp default.
  const format = provider.executor === "ltx-3-stage" ? "mp4" : input.format ?? "webp";
  const width = input.width ?? provider.defaults.width ?? 768;
  const height = input.height ?? provider.defaults.height ?? 512;
  const frameRate = input.frameRate ?? provider.defaults.frameRate ?? 25;
  const fps = input.fps ?? provider.defaults.fps ?? 24;
  const steps = input.steps ?? provider.defaults.steps ?? 30;
  const cfg = input.cfg ?? provider.defaults.cfg ?? 3;
  const startTime = Date.now();

  log(jobId, `starting — prompt="${input.prompt.slice(0, 80)}${input.prompt.length > 80 ? "..." : ""}"`);

  const job = videoJobs.get(jobId)!;

  let planned: PlannedScene[];

  const wantsMultiScene =
    (input.targetDurationSeconds ?? 0) > SINGLE_SCENE_THRESHOLD_SECONDS ||
    (input.sceneCountOverride ?? 1) > 1;

  if (!wantsMultiScene) {
    planned = [
      {
        prompt: input.prompt,
        negativePrompt: input.negativePrompt,
        durationSeconds: input.targetDurationSeconds ?? (input.length ?? 193) / fps,
      },
    ];
  } else if (input.sceneCountOverride && input.sceneCountOverride > 1) {
    log(jobId, `manual scene split — ${input.sceneCountOverride} scenes`);
    planned = evenSplitScenes(
      input.prompt,
      input.negativePrompt,
      input.targetDurationSeconds ?? input.sceneCountOverride * 5,
      input.sceneCountOverride
    );
  } else {
    if (!input.planningModel) {
      logError(jobId, "multi-scene request missing planningModel");
      throw new Error("planningModel is required when requesting a multi-scene video");
    }
    videoJobs.set(jobId, { ...job, status: "planning" });
    planned = await planScenes(jobId, input.prompt, input.targetDurationSeconds!, input.planningModel, emit);
  }

  const sceneStatuses: SceneStatus[] = planned.map((p, i) => ({
    index: i,
    prompt: p.prompt,
    status: "queued",
    progress: 0,
  }));

  videoJobs.set(jobId, {
    ...videoJobs.get(jobId)!,
    status: "loading",
    sceneCount: planned.length,
    scenes: sceneStatuses,
  });

  const renderedFiles: string[] = [];
  const finalSeed = input.seed ?? Math.floor(Math.random() * 999999999999999);

  log(jobId, `using provider "${provider.id}" (executor=${provider.executor})`);

  for (let i = 0; i < planned.length; i++) {
    const scenePlan = planned[i];

    videoJobs.set(jobId, { ...videoJobs.get(jobId)!, currentSceneIndex: i });

    const sceneConfig: SceneConfig = {
      prompt: scenePlan.prompt,
      negativePrompt: scenePlan.negativePrompt ?? input.negativePrompt,
      width,
      height,
      length: Math.round(scenePlan.durationSeconds * fps),
      frameRate,
      fps,
      steps,
      cfg,
      seed: finalSeed + i,
      format,
      providerId: provider.id,
    };

    const { sourceFile } =
      provider.executor === "ltx-3-stage"
        ? await renderSceneLTX3Stage(jobId, i, planned.length, sceneConfig, emit)
        : await renderScene(jobId, i, planned.length, sceneConfig, emit);
    renderedFiles.push(sourceFile);
  }

  videoJobs.set(jobId, { ...videoJobs.get(jobId)!, status: "merging", progress: 96 });
  log(jobId, `merging ${planned.length} scene(s) — format=${format}`);
  emit({ type: "merging_start", sceneCount: planned.length });

  const extension = format === "mp4" ? ".mp4" : ".webp";
  const filename = `${uuidv4()}${extension}`;
  const destinationFile = path.join(PUBLIC_GENERATED, filename);

  await mergeScenes(jobId, renderedFiles, destinationFile, format);

  const videoUrl = `/video/generated/${filename}`;
  log(jobId, `merge complete — ${videoUrl}`);
  emit({ type: "merging_done", videoUrl });

  const generationTime = Math.round((Date.now() - startTime) / 1000);
  const totalDurationSeconds = planned.reduce((sum, p) => sum + p.durationSeconds, 0);

  log(jobId, `done — total ${generationTime}s, ${totalDurationSeconds}s of video across ${planned.length} scene(s)`);

  videoJobs.set(jobId, {
    ...videoJobs.get(jobId)!,
    status: "completed",
    progress: 100,
    videoUrl,
    generationTime,
    seed: finalSeed,
  });

  return {
    seed: finalSeed,
    generationTime,
    videoUrl,
    width,
    height,
    format,
    sceneCount: planned.length,
    scenes: planned,
    durationSeconds: totalDurationSeconds,
    frameRate,
    fps,
    prompt: input.prompt,
    negativePrompt: input.negativePrompt,
  };
}

// ── Entry point called from the route (boot.ts) ─────────────────────────
//
// Owns the DB write on top of generateFramesXVideo. Dynamic import for
// db/schema for the same reason backgroundGeneration.ts does it on the
// image side — keeps this module free of a static import Vite's SSR
// module runner would try to resolve at boot time.
export async function runFramesXGeneration(jobId: string, input: VideoGenerationInput, emit: Emit) {
  try {
    const { getDb } = await import("../queries/connection");
    const { generatedVideos } = await import("@db/schema");

    const result = await generateFramesXVideo(jobId, input, emit);

    const provider = input.providerId ? getProvider(input.providerId) : getDefaultProvider("video");

    const db = getDb();
    const insert = await db.insert(generatedVideos).values({
      prompt: input.prompt,
      negativePrompt: input.negativePrompt ?? null,
      provider: provider?.id ?? null,
      modelUsed: provider?.label ?? "unknown",
      resolution: `${result.width}x${result.height}`,
      steps: input.steps ?? 30,
      cfg: input.cfg ?? 3,
      sampler: provider?.executor === "ltx-3-stage" ? "res_multistep" : "euler",
      scheduler: provider?.executor === "ltx-3-stage" ? "LTXVScheduler" : "simple",
      seed: result.seed,
      frameRate: result.frameRate,
      length: input.length ?? null,
      fps: result.fps,
      durationSeconds: result.durationSeconds,
      format: result.format,
      sceneCount: result.sceneCount,
      scenes: result.scenes,
      planningModel: input.planningModel ?? null,
      generationTime: result.generationTime,
      gpuUsage: null,
      vramUsage: null,
      videoUrl: result.videoUrl,
    });

    const final = {
      success: true,
      id: Number(insert[0].insertId),
      ...result,
    };

    log(jobId, `saved to generated_videos as id=${final.id}`);
    emit({ type: "done", result: final });

    return final;
  } catch (error) {
    logError(jobId, "generation failed", error);

    const message = error instanceof Error ? error.message : String(error);

    const existingJob = videoJobs.get(jobId);
    if (existingJob) {
      videoJobs.set(jobId, { ...existingJob, status: "failed", error: message });
    }

    emit({ type: "error", error: message });
    throw error;
  }
}