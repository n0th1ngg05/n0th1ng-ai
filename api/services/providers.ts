// api/services/providers.ts
//
// Explicit registry of generation providers. Each entry maps a stable
// `id` (used in API requests, stored in generatedImages/generatedVideos.
// provider) to a folder + JSON file (or set of files, for LTX's 3-stage
// pipeline) under app/Comfy/.
//
// Deliberately NOT a live folder scan — per user's own call, new JSONs are
// registered here explicitly. This keeps the dropdown predictable (a
// half-downloaded or malformed JSON sitting in a folder won't silently
// appear as a selectable option) and keeps the DB's `provider` column
// meaningful across renames.

export type MediaType = "image" | "video";
export type Executor = "single-stage" | "ltx-3-stage";

export interface ProviderDefinition {
  id: string; // stable, stored in DB - never rename once used in production
  label: string; // shown in the dropdown
  mediaType: MediaType;
  executor: Executor;
  folder: string; // relative to app/Comfy/
  // single-stage: exactly one JSON file for the whole generation.
  // ltx-3-stage: three JSON files, one per pipeline stage.
  jsonFile?: string; // single-stage only
  stage1File?: string; // ltx-3-stage only
  stage2File?: string; // ltx-3-stage only
  stage3File?: string; // ltx-3-stage only
  // Default params shown/used when this provider is selected. Kept here
  // rather than hardcoded in comfy.ts/framesx.ts so adding a provider
  // doesn't require touching generation code, only this file.
  defaults: {
    width?: number;
    height?: number;
    steps?: number;
    cfg?: number;
    frameRate?: number;
    fps?: number;
    length?: number;
  };
}

export const PROVIDERS: ProviderDefinition[] = [
  {
    id: "flux1-schnell",
    label: "FLUX.1 [schnell]",
    mediaType: "image",
    executor: "single-stage",
    folder: "Flux.1",
    jsonFile: "RTX_4050_Workflow.json",
    defaults: { width: 512, height: 512, steps: 4, cfg: 1 },
  },
  {
    id: "flux2-klein",
    label: "FLUX.2 Klein 4B",
    mediaType: "image",
    executor: "single-stage",
    folder: "Flux.2",
    jsonFile: "RTX_4050_Workflow_Flux2.json",
    defaults: { width: 512, height: 512, steps: 4, cfg: 1.5 },
  },
  {
    id: "ltx-2b-0.9.8-distilled",
    label: "LTX-Video 2B (0.9.8 distilled)",
    mediaType: "video",
    executor: "ltx-3-stage",
    folder: "LTX",
    stage1File: "stage1_base_generation_final.json",
    stage2File: "stage2_upscale_refine_final.json",
    stage3File: "stage3_interpolate_restore_final.json",
    defaults: { width: 640, height: 352, length: 193, frameRate: 24, steps: 10, cfg: 1.5 },
  },
  {
    id: "wan2.1-1.3b-t2v",
    label: "Wan 2.1 T2V (1.3B)",
    mediaType: "video",
    executor: "single-stage",
    folder: "WAN2.1",
    jsonFile: "text_to_video_wan.json",
    defaults: { width: 832, height: 480, length: 81, fps: 16, steps: 30, cfg: 6 },
  },
];

export function getProvider(id: string): ProviderDefinition | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

export function listProviders(mediaType?: MediaType): ProviderDefinition[] {
  if (!mediaType) return PROVIDERS;
  return PROVIDERS.filter((p) => p.mediaType === mediaType);
}

export function getDefaultProvider(mediaType: MediaType): ProviderDefinition {
  const provider = PROVIDERS.find((p) => p.mediaType === mediaType);
  if (!provider) {
    throw new Error(`No providers registered for mediaType "${mediaType}"`);
  }
  return provider;
}