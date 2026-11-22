/**
 * Cloud mode switch.
 *
 * Set CLOUD_MODE=true in .env and every cloud-specific default below flips on
 * at once. Each default can still be overridden individually (see the
 * ENABLE_* / LLM_FALLBACK_* variables in .env-cloud.example).
 *
 * With CLOUD_MODE unset or false nothing changes: the server behaves exactly
 * like the local workstation build.
 *
 * IMPORTANT: this module must be the first import in api/boot.ts, because it
 * may set NODE_ENV before ./env.ts reads it.
 */
import "dotenv/config";

function truthy(value: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes((value ?? "").trim().toLowerCase());
}

/** Boolean env var with a default used when the variable is unset or blank. */
function flag(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return defaultValue;
  return truthy(raw);
}

function baseUrl(value: string | undefined, fallback: string): string {
  return (value?.trim() || fallback).replace(/\/+$/, "");
}

export const isCloudMode = truthy(process.env.CLOUD_MODE);

// Cloud mode always runs the production server (static frontend + API on one
// port). Without this the Hono server would never start listening.
if (isCloudMode && !process.env.NODE_ENV) {
  process.env.NODE_ENV = "production";
}

// ── Model backends ──────────────────────────────────────────────────────────
// Inference (chat/generate). On the cloud Master this normally points at a GPU
// worker's Ollama; leave it unset to run on the OpenRouter fallback only.
export const OLLAMA_BASE_URL = baseUrl(process.env.OLLAMA_BASE_URL, "http://localhost:11434");
// Embeddings (memory + RAG). Defaults to the same Ollama; on the cloud Master
// it can point at a small local Ollama container so memory keeps working while
// the GPU worker is offline.
export const OLLAMA_EMBED_URL = baseUrl(process.env.OLLAMA_EMBED_URL, OLLAMA_BASE_URL);
export const OLLAMA_EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL?.trim() || "nomic-embed-text";

export const COMFYUI_URL = baseUrl(process.env.COMFYUI_URL, "http://127.0.0.1:8188");

// ── Feature switches ────────────────────────────────────────────────────────
export const cloud = {
  isCloudMode,

  /** Python / speech / PersonaPlex runtimes that spawn local processes. */
  localRuntimes: flag("ENABLE_LOCAL_RUNTIMES", !isCloudMode),
  /** ESP32 companion service (opens its own port, default 3005). */
  companion: flag("ENABLE_COMPANION", !isCloudMode),
  /** Forge / ForgeX: they execute shell commands and spawn Claude Code. */
  // Forge/ForgeX are parked for now: off everywhere unless ENABLE_FORGE=true is set explicitly.
  forge: flag("ENABLE_FORGE", false),

  /**
   * When the Ollama backend is unreachable, send chat to an OpenRouter model
   * instead. This sends the prompt to a third party, so it is off for the
   * local workstation build and on in cloud mode (set LLM_FALLBACK_ENABLED=false
   * to keep every prompt on your own hardware).
   */
  llmFallback: flag("LLM_FALLBACK_ENABLED", isCloudMode),
  /** OpenRouter model id used by the fallback (with or without "openrouter:"). */
  llmFallbackModel:
    process.env.LLM_FALLBACK_MODEL?.trim() || "google/gemma-4-31b-it:free",
};

export function assertLocalRuntimes(feature: string): void {
  if (!cloud.localRuntimes) {
    throw new Error(
      `${feature} is disabled on this server (local runtimes are off in cloud mode). Run it on a GPU worker instead.`,
    );
  }
}

export function assertForge(feature: string): void {
  if (!cloud.forge) {
    throw new Error(`${feature} is disabled on this server (set ENABLE_FORGE=true to enable).`);
  }
}

/**
 * Fails fast on settings that would make a public deployment unsafe or broken,
 * and warns about optional-but-recommended ones. No-op outside cloud mode.
 */
export function validateCloudConfig(): void {
  if (!isCloudMode) return;

  const missing: string[] = [];
  for (const name of ["APP_SECRET", "DATABASE_URL", "PRODUCTION_ORIGIN"]) {
    if (!process.env[name]?.trim()) missing.push(name);
  }
  if (missing.length > 0) {
    throw new Error(
      `CLOUD_MODE is on but required settings are missing: ${missing.join(", ")}. See .env-cloud.example.`,
    );
  }

  const warnings: string[] = [];
  if (!process.env.WEBAUTHN_RP_ID?.trim() || !process.env.WEBAUTHN_ORIGIN?.trim()) {
    warnings.push("WEBAUTHN_RP_ID / WEBAUTHN_ORIGIN not set: passkey login may not work on your domain.");
  }
  if (cloud.llmFallback && !process.env.OPENROUTER_API_KEY?.trim()) {
    warnings.push("LLM_FALLBACK_ENABLED is on but OPENROUTER_API_KEY is empty: the fallback cannot run.");
  }
  if (process.env.CF_ACCESS_REQUIRED !== "true" && process.env.CF_ACCESS_ENFORCED !== "true") {
    warnings.push("CF_ACCESS_REQUIRED is not true: the server is protected by its own login only.");
  }
  for (const w of warnings) console.warn(`[CLOUD] WARNING: ${w}`);
}

export function logCloudSummary(): void {
  if (!isCloudMode) return;
  console.log(
    "[CLOUD] CLOUD_MODE on |",
    `ollama=${OLLAMA_BASE_URL} embed=${OLLAMA_EMBED_URL} |`,
    `localRuntimes=${cloud.localRuntimes} companion=${cloud.companion} forge=${cloud.forge} |`,
    `llmFallback=${cloud.llmFallback ? cloud.llmFallbackModel : "off"}`,
  );
}
