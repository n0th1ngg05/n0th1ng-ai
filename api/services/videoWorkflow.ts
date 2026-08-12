import fs from "fs";
import path from "path";
import { getProvider, getDefaultProvider, type ProviderDefinition } from "./providers";

export interface SceneConfig {
  prompt: string;
  negativePrompt?: string;
  width: number;
  height: number;
  length: number;
  frameRate: number;
  fps: number;
  steps: number;
  cfg: number;
  seed?: number;
  format: "webp" | "mp4";
  // Which registered video provider to use for this scene. Falls back to
  // the first registered video provider if omitted.
  providerId?: string;
}

// ============================================================
// UI-format -> API-format conversion
//
// ComfyUI's /prompt endpoint only accepts API format (flat object keyed
// by node ID string, each node = { class_type, inputs, _meta }).
// text_to_video_wan.json (and any workflow exported via ComfyUI's
// "Save" rather than "Save (API Format)") is UI format instead: a
// top-level `nodes` array with `widgets_values` positional arrays and a
// separate `links` array describing wiring. These are NOT
// interchangeable - submitting UI format directly to /prompt fails.
//
// This converts UI format to API format generically, using each node's
// `inputs` array (for socket-driven inputs) and `widgets_values` (for
// widget inputs, in the order ComfyUI's frontend serializes them) plus
// the `links` array to resolve which upstream node/slot feeds each
// socket input. Works for any UI-format workflow, not just Wan's -
// needed because there is no guarantee every future provider's JSON
// will already be in API format.
function convertUiFormatToApiFormat(uiWorkflow: any): Record<string, any> {
  if (!uiWorkflow.nodes || !Array.isArray(uiWorkflow.nodes)) {
    // Already API format (flat object, no top-level `nodes` array).
    return uiWorkflow;
  }

  const linksById = new Map<number, any>();
  for (const link of uiWorkflow.links ?? []) {
    // link shape: [link_id, origin_node_id, origin_slot, target_node_id, target_slot, type]
    linksById.set(link[0], link);
  }

  const apiWorkflow: Record<string, any> = {};

  for (const node of uiWorkflow.nodes) {
    const nodeId = String(node.id);
    const inputs: Record<string, any> = {};

    // Socket inputs: resolve via the link that feeds each named input.
    for (const inputDef of node.inputs ?? []) {
      if (inputDef.link == null) continue;
      const link = linksById.get(inputDef.link);
      if (!link) continue;
      const [, originNodeId, originSlot] = link;
      inputs[inputDef.name] = [String(originNodeId), originSlot];
    }

    // Widget inputs: ComfyUI serializes these positionally into
    // widgets_values in the same order the node definition declares
    // widget-backed inputs. We don't have that declaration order at
    // runtime, so instead we rely on each node type's known widget
    // input names being assigned by the caller after conversion (see
    // applyWidgetValuesByNodeType below) rather than guessing order
    // generically - guessing wrong here silently corrupts a workflow.
    apiWorkflow[nodeId] = {
      class_type: node.type,
      inputs,
      _meta: { title: node.title ?? node.type },
      __widgets_values: node.widgets_values ?? [],
    };
  }

  return apiWorkflow;
}

// Known widget-value orderings for node types we actually use in
// UI-format provider JSONs. Extend this map when a new UI-format
// provider is registered with a node type not yet listed here.
const WIDGET_VALUE_MAP: Record<string, string[]> = {
  CLIPTextEncode: ["text"],
  VAELoader: ["vae_name"],
  CLIPLoader: ["clip_name", "type", "device"],
  UNETLoader: ["unet_name", "weight_dtype"],
  EmptyHunyuanLatentVideo: ["width", "height", "length", "batch_size"],
  KSampler: ["seed", "control_after_generate", "steps", "cfg", "sampler_name", "scheduler", "denoise"],
  ModelSamplingSD3: ["shift"],
  SaveAnimatedWEBP: ["filename_prefix", "fps", "lossless", "quality", "method", "compress_level"],
  SaveWEBM: ["filename_prefix", "codec", "fps", "crf"],
};

function applyWidgetValuesByNodeType(apiWorkflow: Record<string, any>) {
  for (const node of Object.values(apiWorkflow)) {
    const n = node as any;
    const values: any[] = n.__widgets_values ?? [];
    const names = WIDGET_VALUE_MAP[n.class_type];
    if (names) {
      names.forEach((name, i) => {
        if (i < values.length) n.inputs[name] = values[i];
      });
    }
    delete n.__widgets_values;
  }
  return apiWorkflow;
}

function loadWorkflowAsApiFormat(jsonPath: string): Record<string, any> {
  const raw = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  const converted = convertUiFormatToApiFormat(raw);
  return applyWidgetValuesByNodeType(converted);
}

// ============================================================
// Generic single-stage video builder (replaces the old fixed NODE map,
// which only worked for one specific LTX_Video.json layout). Finds nodes
// by class_type the same way comfyWorkflow.ts does for Flux, since
// different single-stage video providers (LTX single-stage vs Wan) have
// completely different node layouts and node IDs.
// ============================================================

function resolveVideoProvider(providerId?: string): ProviderDefinition {
  const provider = providerId ? getProvider(providerId) : getDefaultProvider("video");
  if (!provider) throw new Error(`Unknown video provider id: "${providerId}"`);
  if (provider.mediaType !== "video") throw new Error(`Provider "${provider.id}" is not a video provider`);
  return provider;
}

export function buildVideoWorkflow(config: SceneConfig, filenamePrefix: string) {
  const provider = resolveVideoProvider(config.providerId);

  if (provider.executor !== "single-stage") {
    throw new Error(
      `buildVideoWorkflow() called with provider "${provider.id}" which uses executor "${provider.executor}" - use buildStage1/2/3Workflow instead for ltx-3-stage providers`
    );
  }
  if (!provider.jsonFile) {
    throw new Error(`Provider "${provider.id}" has no jsonFile configured`);
  }

  const jsonPath = path.join(process.cwd(), "Comfy", provider.folder, provider.jsonFile);
  const workflow = loadWorkflowAsApiFormat(jsonPath);
  const nodes = Object.values(workflow) as any[];

  const positive = nodes.find(
    (n) => n.class_type === "CLIPTextEncode" && (n._meta?.title?.includes("Positive") || !n._meta?.title?.includes("Negative"))
  );
  const negative = nodes.find((n) => n.class_type === "CLIPTextEncode" && n._meta?.title?.includes("Negative"));
  const latent = nodes.find((n) => n.class_type === "EmptyLTXVLatentVideo" || n.class_type === "EmptyHunyuanLatentVideo");
  const conditioning = nodes.find((n) => n.class_type === "LTXVConditioning");
  const scheduler = nodes.find((n) => n.class_type === "LTXVScheduler");
  const sampler = nodes.find((n) => n.class_type === "SamplerCustom" || n.class_type === "KSampler");
  const saveWebp = nodes.find((n) => n.class_type === "SaveAnimatedWEBP");
  const saveWebm = nodes.find((n) => n.class_type === "SaveWEBM");

  if (positive) positive.inputs.text = config.prompt;
  if (negative) negative.inputs.text = config.negativePrompt || "";

  if (latent) {
    latent.inputs.width = config.width;
    latent.inputs.height = config.height;
    latent.inputs.length = config.length;
  }

  if (conditioning) conditioning.inputs.frame_rate = config.frameRate;
  if (scheduler) scheduler.inputs.steps = config.steps;

  if (sampler) {
    if ("cfg" in sampler.inputs) sampler.inputs.cfg = config.cfg;
    if ("noise_seed" in sampler.inputs) {
      sampler.inputs.noise_seed = config.seed ?? Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
    }
    if ("seed" in sampler.inputs) {
      sampler.inputs.seed = config.seed ?? Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
    }
    if ("steps" in sampler.inputs) sampler.inputs.steps = config.steps;
  }

  if (config.format === "mp4") {
    const decodeNode = Object.keys(workflow).find((k) => workflow[k].class_type === "VAEDecode");
    workflow["__video_combine__"] = {
      inputs: {
        frame_rate: config.fps,
        loop_count: 0,
        filename_prefix: filenamePrefix,
        format: "video/h264-mp4",
        pix_fmt: "yuv420p",
        crf: 19,
        save_metadata: true,
        pingpong: false,
        save_output: true,
        images: decodeNode ? [decodeNode, 0] : ["8", 0],
      },
      class_type: "VHS_VideoCombine",
      _meta: { title: "Video Combine (mp4)" },
    };
    // Old fixed-shape webp save node, if present, is disabled rather than
    // deleted - keeps node IDs stable for any other code inspecting them.
    if (saveWebp) saveWebp.inputs.filename_prefix = `${filenamePrefix}_unused_webp`;
  } else if (saveWebp) {
    saveWebp.inputs.filename_prefix = filenamePrefix;
    saveWebp.inputs.fps = config.fps;
  } else if (saveWebm) {
    saveWebm.inputs.filename_prefix = filenamePrefix;
    saveWebm.inputs.fps = config.fps;
  }

  return workflow;
}

// ============================================================
// 3-stage pipeline (stage1_base_generation_final.json,
// stage2_upscale_refine_final.json, stage3_interpolate_restore_final.json)
//
// These are separate workflow files with different node ID layouts
// per stage (stage2's sampler is node 103 not 72, stage3 has no
// prompt/sampler nodes at all). Kept as distinct build functions
// rather than forcing one shared NODE map, since forcing a shared
// map across genuinely different graphs is how node lookups go
// silently undefined.
// ============================================================

export interface Stage1Config {
  prompt: string;
  negativePrompt?: string;
  width: number;
  height: number;
  length: number;
  frameRate: number;
  steps: number;
  cfg: number;
  seed?: number;
  providerId?: string; // defaults to first registered ltx-3-stage video provider
}

export interface Stage2Config {
  prompt: string;
  negativePrompt?: string;
  frameRate: number;
  steps: number;
  cfg: number;
  scaleBy: number;
  seed?: number;
  providerId?: string;
  /** Directory stage 1 wrote its PNG sequence to, relative to ComfyUI's
   *  input-resolution root (matches VHS_LoadImagesPath's `directory` field
   *  convention already used in stage2_upscale_refine_final.json, e.g.
   *  "output/Gen3/"). */
  stage1OutputDir: string;
}

export interface Stage3Config {
  providerId?: string;
  /** Directory stage 2 wrote its PNG sequence to (VHS_LoadImagesPath
   *  `directory` convention, e.g. "output/Gen3/Stage2/"). */
  stage2OutputDir: string;
  faceRestoreVisibility?: number; // default 0.5, matches stage3 JSON default
  rifeMultiplier?: number; // default 2 (24fps -> 48fps)
}

const STAGE1_NODE = {
  positive: "6",
  negative: "7",
  vaeDecode: "8",
  savePreviewWebp: "41",
  latent: "70",
  scheduler: "71",
  sampler: "72",
  samplerSelect: "73",
  conditioning: "69",
  saveFrames: "91",
} as const;

const STAGE2_NODE = {
  positive: "6",
  negative: "7",
  vaeDecode: "8",
  conditioning: "69",
  scheduler: "71",
  loadFrames: "100",
  vaeEncode: "101",
  latentUpscale: "102",
  sampler: "103",
  saveFrames: "104",
} as const;

const STAGE3_NODE = {
  loadFrames: "100",
  faceRestore: "110",
  rife: "120",
  saveFrames: "121",
  savePreviewWebp: "122",
} as const;

function resolveLtxProvider(providerId?: string): ProviderDefinition {
  const provider = providerId ? getProvider(providerId) : getDefaultProvider("video");
  if (!provider) throw new Error(`Unknown video provider id: "${providerId}"`);
  if (provider.executor !== "ltx-3-stage") {
    throw new Error(`Provider "${provider.id}" is not an ltx-3-stage provider`);
  }
  return provider;
}

function loadStageWorkflow(providerId: string | undefined, stageFile: string | undefined, stageName: string) {
  const provider = resolveLtxProvider(providerId);
  if (!stageFile) {
    throw new Error(`Provider "${provider.id}" has no ${stageName} configured`);
  }
  const stagePath = path.join(process.cwd(), "Comfy", provider.folder, stageFile);
  return JSON.parse(fs.readFileSync(stagePath, "utf8"));
}

export function buildStage1Workflow(config: Stage1Config, filenamePrefix: string) {
  const provider = resolveLtxProvider(config.providerId);
  const workflow = loadStageWorkflow(config.providerId, provider.stage1File, "stage1File");

  const positive = workflow[STAGE1_NODE.positive];
  const negative = workflow[STAGE1_NODE.negative];
  const latent = workflow[STAGE1_NODE.latent];
  const scheduler = workflow[STAGE1_NODE.scheduler];
  const sampler = workflow[STAGE1_NODE.sampler];
  const conditioning = workflow[STAGE1_NODE.conditioning];

  if (positive) positive.inputs.text = config.prompt;
  if (negative) negative.inputs.text = config.negativePrompt || "";

  if (latent) {
    latent.inputs.width = config.width;
    latent.inputs.height = config.height;
    latent.inputs.length = config.length;
  }

  if (conditioning) conditioning.inputs.frame_rate = config.frameRate;
  if (scheduler) scheduler.inputs.steps = config.steps;

  if (sampler) {
    sampler.inputs.cfg = config.cfg;
    sampler.inputs.noise_seed =
      config.seed ?? Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
  }

  workflow[STAGE1_NODE.saveFrames].inputs.filename_prefix = filenamePrefix;

  return workflow;
}

export function buildStage2Workflow(config: Stage2Config, filenamePrefix: string) {
  const provider = resolveLtxProvider(config.providerId);
  const workflow = loadStageWorkflow(config.providerId, provider.stage2File, "stage2File");

  const positive = workflow[STAGE2_NODE.positive];
  const negative = workflow[STAGE2_NODE.negative];
  const conditioning = workflow[STAGE2_NODE.conditioning];
  const scheduler = workflow[STAGE2_NODE.scheduler];
  const loadFrames = workflow[STAGE2_NODE.loadFrames];
  const latentUpscale = workflow[STAGE2_NODE.latentUpscale];
  const sampler = workflow[STAGE2_NODE.sampler];

  if (positive) positive.inputs.text = config.prompt;
  if (negative) negative.inputs.text = config.negativePrompt || "";
  if (conditioning) conditioning.inputs.frame_rate = config.frameRate;
  if (scheduler) scheduler.inputs.steps = config.steps;
  if (loadFrames) loadFrames.inputs.directory = config.stage1OutputDir;
  if (latentUpscale) latentUpscale.inputs.scale_by = config.scaleBy;

  if (sampler) {
    sampler.inputs.cfg = config.cfg;
    sampler.inputs.noise_seed =
      config.seed ?? Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
  }

  workflow[STAGE2_NODE.saveFrames].inputs.filename_prefix = filenamePrefix;

  return workflow;
}

export function buildStage3Workflow(
  config: Stage3Config,
  framesFilenamePrefix: string,
  previewFilenamePrefix: string
) {
  const provider = resolveLtxProvider(config.providerId);
  const workflow = loadStageWorkflow(config.providerId, provider.stage3File, "stage3File");

  const loadFrames = workflow[STAGE3_NODE.loadFrames];
  const faceRestore = workflow[STAGE3_NODE.faceRestore];
  const rife = workflow[STAGE3_NODE.rife];

  if (loadFrames) loadFrames.inputs.directory = config.stage2OutputDir;
  if (faceRestore) {
    faceRestore.inputs.visibility = config.faceRestoreVisibility ?? 0.5;
  }
  if (rife) rife.inputs.multiplier = config.rifeMultiplier ?? 2;

  workflow[STAGE3_NODE.saveFrames].inputs.filename_prefix = framesFilenamePrefix;
  workflow[STAGE3_NODE.savePreviewWebp].inputs.filename_prefix = previewFilenamePrefix;

  return workflow;
}