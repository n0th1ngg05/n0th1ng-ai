import fs from "fs";
import path from "path";
import { getProvider, getDefaultProvider } from "./providers";

export interface GenerationConfig {
  prompt: string;
  negativePrompt?: string;
  width: number;
  height: number;
  steps: number;
  cfg: number;
  sampler: string;
  scheduler: string;
  seed?: number;
  // Which registered image provider's JSON to load. Falls back to the
  // first registered image provider if omitted, so existing callers that
  // don't pass this (pre-dropdown UI, old REST bodies) keep working.
  providerId?: string;
}

function resolveWorkflowPath(providerId?: string) {
  const provider = providerId ? getProvider(providerId) : getDefaultProvider("image");

  if (!provider) {
    throw new Error(`Unknown image provider id: "${providerId}"`);
  }
  if (provider.mediaType !== "image") {
    throw new Error(`Provider "${provider.id}" is not an image provider`);
  }
  if (!provider.jsonFile) {
    throw new Error(`Provider "${provider.id}" has no jsonFile configured`);
  }

  return path.join(process.cwd(), "Comfy", provider.folder, provider.jsonFile);
}

export function buildWorkflow(
  config: GenerationConfig
) {

  const workflowPath = resolveWorkflowPath(config.providerId);

  const workflow =
    JSON.parse(
      fs.readFileSync(
        workflowPath,
        "utf8"
      )
    );

  // API format: flat object keyed by node ID string.
  // Each node has class_type, inputs, and _meta.title —
  // no top-level nodes array, no widgets_values.
  const nodes =
    Object.values(workflow) as any[];

  const positive =
    nodes.find(
      (n: any) =>
        n.class_type === "CLIPTextEncode" &&
        n._meta?.title?.includes("Positive")
    );

  const negative =
    nodes.find(
      (n: any) =>
        n.class_type === "CLIPTextEncode" &&
        n._meta?.title?.includes("Negative")
    );

  const latent =
    nodes.find(
      (n: any) =>
        n.class_type === "EmptySD3LatentImage"
    );

  const sampler =
    nodes.find(
      (n: any) =>
        n.class_type === "KSampler"
    );

  if (positive)
    positive.inputs.text =
      config.prompt;

  if (negative)
    negative.inputs.text =
      config.negativePrompt || "";

  if (latent) {
    latent.inputs.width =
      config.width;

    latent.inputs.height =
      config.height;
  }

  if (sampler) {
    sampler.inputs.seed =
      config.seed ??
      Math.floor(
        Math.random() *
        Number.MAX_SAFE_INTEGER
      );

    sampler.inputs.steps =
      config.steps;

    sampler.inputs.cfg =
      config.cfg;

    sampler.inputs.sampler_name =
      config.sampler;

    sampler.inputs.scheduler =
      config.scheduler;
  }

  return workflow;

}