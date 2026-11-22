/**
 * LLM router: decides which backend serves a chat request.
 *
 *   1. OpenRouter models ("openrouter:...") always go to OpenRouter.
 *   2. Ollama models go to the configured Ollama (OLLAMA_BASE_URL, normally a
 *      GPU worker) while it is reachable.
 *   3. If Ollama is unreachable and the fallback is enabled (cloud mode),
 *      the request is served by an OpenRouter model instead.
 */
import { OLLAMA_BASE_URL, cloud } from "./cloud";
import { isOpenRouterModel, OPENROUTER_PREFIX } from "../services/openRouter";

const HEALTH_TTL_MS = 10_000;
const HEALTH_TIMEOUT_MS = 2_500;

let cached: { ok: boolean; at: number } | null = null;
let inflight: Promise<boolean> | null = null;

/** Cached reachability check of the Ollama backend (GET /api/tags). */
export async function isOllamaReachable(force = false): Promise<boolean> {
  if (!force && cached && Date.now() - cached.at < HEALTH_TTL_MS) return cached.ok;
  if (inflight) return inflight;

  inflight = (async () => {
    let ok = false;
    try {
      const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
        signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
      });
      ok = res.ok;
    } catch {
      ok = false;
    }
    cached = { ok, at: Date.now() };
    inflight = null;
    return ok;
  })();
  return inflight;
}

/** Call when a real request to Ollama failed, so the next request re-routes at once. */
export function markOllamaDown(): void {
  cached = { ok: false, at: Date.now() };
}

/** True when a usable OpenRouter fallback is configured. */
export function fallbackAvailable(): boolean {
  return cloud.llmFallback && !!process.env.OPENROUTER_API_KEY?.trim() && !!cloud.llmFallbackModel;
}

export function fallbackModelId(): string {
  const id = cloud.llmFallbackModel;
  return id.startsWith(OPENROUTER_PREFIX) ? id : `${OPENROUTER_PREFIX}${id}`;
}

export interface ResolvedModel {
  model: string;
  usedFallback: boolean;
}

/** Picks the model that should actually serve a chat request. */
export async function resolveChatModel(requested: string): Promise<ResolvedModel> {
  if (isOpenRouterModel(requested)) return { model: requested, usedFallback: false };
  // Fallback not configured (local mode): behave exactly as before, no health check.
  if (!fallbackAvailable()) return { model: requested, usedFallback: false };
  if (await isOllamaReachable()) return { model: requested, usedFallback: false };
  if (fallbackAvailable()) return { model: fallbackModelId(), usedFallback: true };
  return { model: requested, usedFallback: false };
}
