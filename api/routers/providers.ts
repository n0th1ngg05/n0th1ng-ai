import { z } from "zod";
import { createRouter, publicQuery } from "../middleware";
import { listProviders, type MediaType } from "../services/providers";

const COMFY_URL = "http://127.0.0.1:8188";

// Fallback values when ComfyUI is offline
const FALLBACK_SAMPLERS = ["euler", "euler_ancestral", "dpmpp_2m", "dpmpp_sde", "dpmpp_2m_sde", "dpmpp_3m_sde", "heun", "lcm", "ddim"];
const FALLBACK_SCHEDULERS = ["simple", "normal", "karras", "exponential", "sgm_uniform", "beta", "ddim_uniform"];
const FALLBACK_UPSCALE_MODELS = ["4x-UltraSharp.pth"];
const FALLBACK_INTERPOLATIONS = ["lanczos", "bicubic", "bilinear", "nearest-exact", "area"];

export const providersRouter = createRouter({
  // Returns the provider list for a given media type, in the shape the
  // dropdown needs (id + label only - defaults/file paths stay server-side,
  // no reason to leak folder layout to the client).
  list: publicQuery
    .input(z.object({ mediaType: z.enum(["image", "video"]) }))
    .query(({ input }) => {
      const providers = listProviders(input.mediaType as MediaType);
      return providers.map((p) => ({
        id: p.id,
        label: p.label,
        executor: p.executor,
        defaults: p.defaults,
        upscaleDefaults: p.upscaleDefaults,
      }));
    }),

  // Fetches live option lists from ComfyUI's /object_info API so the
  // frontend dropdowns always reflect what is actually installed/available.
  // Falls back to safe hardcoded values if ComfyUI is not reachable.
  comfyOptions: publicQuery.query(async () => {
    try {
      const [kSamplerRes, upscaleRes, imageScaleRes] = await Promise.all([
        fetch(`${COMFY_URL}/object_info/KSampler`, { signal: AbortSignal.timeout(3000) }),
        fetch(`${COMFY_URL}/object_info/UpscaleModelLoader`, { signal: AbortSignal.timeout(3000) }),
        fetch(`${COMFY_URL}/object_info/ImageScale`, { signal: AbortSignal.timeout(3000) }),
      ]);

      const kSampler = await kSamplerRes.json();
      const upscale = await upscaleRes.json();
      const imageScale = await imageScaleRes.json();

      // sampler_name and scheduler: [["euler","heun",...], {tooltip:"..."}]
      // The first element IS the array of values (not {value:[...]})
      const samplerNames = kSampler?.KSampler?.input?.required?.sampler_name;
      const samplers: string[] = (Array.isArray(samplerNames?.[0]) ? samplerNames[0] : null) ?? FALLBACK_SAMPLERS;
      const schedulerNames = kSampler?.KSampler?.input?.required?.scheduler;
      const schedulers: string[] = (Array.isArray(schedulerNames?.[0]) ? schedulerNames[0] : null) ?? FALLBACK_SCHEDULERS;
      // UpscaleModelLoader: ["COMBO", { multiselect: false, options: [...models] }]
      const upscaleRaw = upscale?.UpscaleModelLoader?.input?.required?.model_name;
      const upscaleModels: string[] = upscaleRaw?.[1]?.options ?? FALLBACK_UPSCALE_MODELS;
      // ImageScale upscale_method: same array format as sampler_name
      const interpNames = imageScale?.ImageScale?.input?.required?.upscale_method;
      const interpolations: string[] = (Array.isArray(interpNames?.[0]) ? interpNames[0] : null) ?? FALLBACK_INTERPOLATIONS;

      return { samplers, schedulers, upscaleModels, interpolations };
    } catch {
      // ComfyUI offline or slow — return safe fallbacks so the UI still works
      return {
        samplers: FALLBACK_SAMPLERS,
        schedulers: FALLBACK_SCHEDULERS,
        upscaleModels: FALLBACK_UPSCALE_MODELS,
        interpolations: FALLBACK_INTERPOLATIONS,
      };
    }
  }),
});