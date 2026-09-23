// api/services/comfyWorkflowFull.ts
//
// Workflow builder for ComfyUI full-pipeline JSONs that use the LiteGraph
// graph format (top-level `nodes[]` array with `widgets_values`), as
// opposed to the flat API format (keyed by node ID string with `inputs`)
// used by the simple single-stage workflow JSONs.
//
// Both new full-pipeline JSONs (flux2-klein-4b-full-pipeline.json and
// flux1-krea-dev-gguf-full-pipeline.json) store parameters in
// `widgets_values` arrays. This builder patches those values then converts
// the whole graph into ComfyUI's flat API submission format.

import fs from "fs";
import path from "path";
import { getProvider } from "./providers";

export interface FullPipelineConfig {
  prompt: string;
  negativePrompt?: string;
  width: number;
  height: number;
  steps: number;         // Pass 1 base generation steps
  cfg: number;           // Pass 1 / Pass 2 CFG (shared for Krea; Klein ignores it)
  sampler: string;       // e.g. "euler"
  scheduler: string;     // used by KSampler-based pipelines (Krea); Flux2Scheduler ignores it
  seed?: number;
  // Upscale section
  upscaleModel?: string;    // e.g. "4x-UltraSharp.pth"
  targetWidth?: number;     // ImageScale target width after ESRGAN
  targetHeight?: number;    // ImageScale target height after ESRGAN
  interpolation?: string;   // ImageScale method e.g. "lanczos"
  hiresSteps?: number;      // Pass 2 KSampler steps
  hiresDenoise?: number;    // Pass 2 KSampler denoise
  providerId: string;
}

// Convert a LiteGraph node to ComfyUI flat API format.
// Flat API nodes look like: { class_type, inputs: {}, _meta: { title } }
// LiteGraph nodes have class_type + widgets_values[], but inputs are
// declared separately as a links array. We only need to patch widgets_values
// (not reconstruct inputs), then let ComfyUI resolve links server-side.
function graphNodeToApiNode(node: any): Record<string, any> {
  return {
    class_type: node.type,
    inputs: buildInputsFromWidgets(node),
    _meta: { title: node.title || node.type },
  };
}

// Build a minimal inputs object from the node's widgets_values.
// ComfyUI's /prompt API uses named inputs; we map positional widget values
// to parameter names based on the node type.
function buildInputsFromWidgets(node: any): Record<string, any> {
  const wv: any[] = node.widgets_values ?? [];
  const t = node.type as string;

  // Text encoder nodes
  if (t === "CLIPTextEncode") return { text: wv[0] ?? "" };

  // Latent image nodes
  if (t === "EmptyFlux2LatentImage") return { batch_size: wv[2] ?? 1 }; // width/height come from linked PrimitiveInt nodes; batch_size is a required widget
  if (t === "EmptyLatentImage") return { width: wv[0] ?? 1024, height: wv[1] ?? 1024, batch_size: wv[2] ?? 1 };

  // Sampler nodes
  if (t === "KSampler") return {
    seed: wv[0] ?? 0,
    control_after_generate: wv[1] ?? "fixed",
    steps: wv[2] ?? 20,
    cfg: wv[3] ?? 4.0,
    sampler_name: wv[4] ?? "euler",
    scheduler: wv[5] ?? "simple",
    denoise: wv[6] ?? 1.0,
  };
  if (t === "KSamplerSelect") return { sampler_name: wv[0] ?? "euler" };
  if (t === "Flux2Scheduler") return { steps: wv[0] ?? 20 };
  if (t === "SamplerCustomAdvanced") return {};
  if (t === "RandomNoise") return { noise_seed: wv[0] ?? 0, control_after_generate: wv[1] ?? "randomize" };
  if (t === "CFGGuider") return { cfg: wv[0] ?? 1.0 };

  // Upscale nodes
  if (t === "UpscaleModelLoader") return { model_name: wv[0] ?? "4x-UltraSharp.pth" };
  if (t === "ImageUpscaleWithModel") return {};
  if (t === "ImageScale") return { upscale_method: wv[0] ?? "lanczos", width: wv[1] ?? 2048, height: wv[2] ?? 2048, crop: wv[3] ?? "disabled" };

  // VAE nodes
  if (t === "VAELoader") return { vae_name: wv[0] ?? "" };
  if (t === "VAEDecode") return {};
  if (t === "VAEEncode") return {};

  // Model loaders
  if (t === "UNETLoader") return { unet_name: wv[0] ?? "", weight_dtype: wv[1] ?? "default" };
  if (t === "UnetLoaderGGUF") return { unet_name: wv[0] ?? "" };
  if (t === "CLIPLoader") return { clip_name: wv[0] ?? "", type: wv[1] ?? "flux2", device: wv[2] ?? "default" };
  if (t === "DualCLIPLoader") return { clip_name1: wv[0] ?? "", clip_name2: wv[1] ?? "", type: wv[2] ?? "flux", device: wv[3] ?? "default" };

  // Primitive values — these provide width/height to downstream nodes via links
  if (t === "PrimitiveInt") return { value: wv[0] ?? 1024 };

  // Save nodes
  if (t === "SaveImage") return { filename_prefix: wv[0] ?? "ComfyUI" };

  // Skip note/markdown nodes
  if (t === "MarkdownNote" || t === "Note") return {};

  // Default fallback
  return {};
}

// The core: patch target nodes in the graph, then emit ComfyUI flat API
// format. Links are preserved because ComfyUI resolves them server-side.
export function buildFullPipelineWorkflow(config: FullPipelineConfig): Record<string, any> {
  const provider = getProvider(config.providerId);
  if (!provider || !provider.jsonFile) {
    throw new Error(`Provider "${config.providerId}" not found or has no jsonFile`);
  }

  const workflowPath = path.join(process.cwd(), "Comfy", provider.folder, provider.jsonFile);
  const raw = JSON.parse(fs.readFileSync(workflowPath, "utf8"));

  // Detect format: graph format has a top-level `nodes` array.
  const nodes: any[] = Array.isArray(raw.nodes) ? raw.nodes : Object.values(raw);
  const links: any[] = raw.links ?? [];

  const finalSeed = config.seed ?? Math.floor(Math.random() * 999999999999999);

  // -- Patch node widget values --
  for (const node of nodes) {
    const t = node.type as string;
    const wv: any[] = node.widgets_values ?? [];

    if (t === "CLIPTextEncode") {
      const title: string = node.title ?? "";
      if (title.toLowerCase().includes("positive") || title.toLowerCase().includes("pos")) {
        wv[0] = config.prompt;
      } else if (title.toLowerCase().includes("negative") || title.toLowerCase().includes("neg")) {
        const DEFAULT_NEG = "cartoon, anime, CGI, 3D render, toy car, unrealistic reflections, plastic body, distorted car, incorrect proportions, warped wheels, malformed headlights, duplicate car, floating vehicle, excessive motion blur, oversaturated colors, artificial lighting, low detail, blurry, low resolution, noisy image, excessive HDR, crushed blacks, blown highlights, watermark, text, logo";
        wv[0] = (config.negativePrompt && config.negativePrompt.trim().length > 0)
          ? config.negativePrompt.trim()
          : DEFAULT_NEG;
      }
    }

    if (t === "EmptyLatentImage") {
      wv[0] = config.width;
      wv[1] = config.height;
    }

    if (t === "PrimitiveInt") {
      const title: string = node.title ?? "";
      if (title.toLowerCase() === "width") wv[0] = config.width;
      if (title.toLowerCase() === "height") wv[0] = config.height;
    }

    // Pass 1 KSampler (base generation) -- identified by title
    if (t === "KSampler") {
      const title: string = node.title ?? "";
      const isPass2 = title.toLowerCase().includes("pass 2") || title.toLowerCase().includes("hires");
      if (!isPass2) {
        // Pass 1
        wv[0] = finalSeed;
        wv[1] = "fixed";         // prevent ComfyUI from re-randomizing the seed
        wv[2] = config.steps;    // steps index
        wv[3] = config.cfg;      // cfg index
        wv[4] = config.sampler;  // sampler_name
        wv[5] = config.scheduler; // scheduler
        wv[6] = 1.0;             // denoise = 1 for base pass
      } else {
        // Pass 2 (hires-fix)
        wv[0] = finalSeed;
        wv[1] = "fixed";
        wv[2] = config.hiresSteps ?? 16;    // pass 2 steps
        wv[3] = config.cfg;                  // same cfg
        wv[4] = config.sampler;
        wv[5] = config.scheduler;
        wv[6] = config.hiresDenoise ?? 0.5; // hires denoise
      }
    }

    // KSamplerSelect — Klein pipeline uses this to pick the sampler.
    // It feeds SamplerCustomAdvanced via a link; we must patch wv[0] here.
    if (t === "KSamplerSelect") {
      wv[0] = config.sampler;
    }

    // Flux2Scheduler (Klein pipeline uses this instead of KSampler)
    if (t === "Flux2Scheduler") {
      const title: string = node.title ?? "";
      const isPass2 = title.toLowerCase().includes("pass 2") || title.toLowerCase().includes("scheduler (pass 2)");
      wv[0] = isPass2 ? (config.hiresSteps ?? 12) : config.steps;
    }

    // CFGGuider -- CFG for Klein pipeline
    if (t === "CFGGuider") {
      wv[0] = config.cfg;
    }

    // RandomNoise -- seed
    if (t === "RandomNoise") {
      wv[0] = finalSeed;
      wv[1] = "fixed"; // prevent ComfyUI from re-randomizing
    }

    // Upscale model
    if (t === "UpscaleModelLoader" && config.upscaleModel) {
      wv[0] = config.upscaleModel;
    }

    // ImageScale -- target size + interpolation
    if (t === "ImageScale") {
      if (config.interpolation) wv[0] = config.interpolation;
      if (config.targetWidth)   wv[1] = config.targetWidth;
      if (config.targetHeight)  wv[2] = config.targetHeight;
    }

    node.widgets_values = wv;
  }

  // -- Convert graph to flat API format --
  // The flat API format is a plain object keyed by string node ID.
  // We reconstruct `inputs` from the links array so ComfyUI can wire nodes.
  const linkMap = new Map<number, [number, number]>(); // linkId -> [srcNodeId, srcSlotIdx]
  for (const link of links) {
    // link = [linkId, srcNodeId, srcSlotIdx, dstNodeId, dstSlotIdx, type]
    linkMap.set(link[0], [link[1], link[2]]);
  }

  // Build a lookup of node outputs: nodeId -> list of output slot types
  const nodeById = new Map<number, any>();
  for (const node of nodes) nodeById.set(node.id, node);

  const apiWorkflow: Record<string, any> = {};

  for (const node of nodes) {
    const t = node.type as string;
    // Skip display/note nodes -- they have no class_type in ComfyUI
    if (t === "MarkdownNote" || t === "Note" || t === "NoteWithSave") continue;

    const inputs: Record<string, any> = {};

    // Wire inputs from the links array
    for (const inp of (node.inputs ?? [])) {
      if (inp.link == null) continue;
      const src = linkMap.get(inp.link);
      if (!src) continue;
      inputs[inp.name] = [String(src[0]), src[1]];
    }

    // Wire widget values as named inputs (only if not already wired by a link)
    const widgetInputs = buildInputsFromWidgets(node);
    for (const [k, v] of Object.entries(widgetInputs)) {
      if (inputs[k] === undefined) {
        inputs[k] = v;
      }
    }

    apiWorkflow[String(node.id)] = {
      class_type: t,
      inputs,
      _meta: { title: node.title ?? t },
    };
  }

  return apiWorkflow;
}
