/**
 * openRouter.ts
 *
 * Service for interacting with the OpenRouter API (https://openrouter.ai).
 * OpenRouter exposes an OpenAI-compatible REST API, so the same chat/completions
 * endpoint works for all models — just swap the model ID.
 *
 * A single OPENROUTER_API_KEY in .env covers every model on the platform.
 * The `:free` suffix on a model ID (e.g. `nvidia/nemotron-3-ultra-550b-a55b:free`)
 * is just part of the model name, not a separate config value.
 *
 * How model IDs work across the app:
 *   - Frontend receives: `openrouter:nvidia/nemotron-3-ultra-550b-a55b:free`
 *   - The `openrouter:` prefix is the routing signal — boot.ts / agentLoop.ts
 *     check for it and call this service instead of Ollama.
 *   - This service strips the prefix before sending to the API.
 */

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

// ── Curated allow-list of OpenRouter models ─────────────────────────────────
// Add more entries here as you get access to them. The `id` is the exact
// OpenRouter model ID (used in the API call), `label` is the display name.
// The frontend will render: "<label> (OpenRouter - API)"
export const OPENROUTER_MODELS: { id: string; label: string }[] = [
  {
    id: "nvidia/nemotron-3-ultra-550b-a55b:free",
    label: "Nemotron Ultra 550B A55B",
  },
  {
    id: "google/gemma-4-31b-it:free",
    label: "Gemma 4 31B",
  },
  {
    id: "nvidia/nemotron-3-super-120b-a12b:free",
    label: "Nemotron Super 120B A12B",
  },
  {
    id: "google/gemma-4-26b-a4b-it:free",
    label: "Gemma 4 26B A4B",
  },
  {
    id: "openai/gpt-oss-20b:free",
    label: "GPT-OSS 20B",
  },
  {
    id: "nvidia/nemotron-3-nano-30b-a3b:free",
    label: "Nemotron Nano 30B A3B",
  },
  {
    id: "inclusionai/ling-3.0-tiny:free",
    label: "Ling 3.0 Tiny",
  },
  {
    id: "cohere/north-mini-code:free",
    label: "North Mini Code",
  },
  {
    id: "poolside/laguna-s-2.1:free",
    label: "Laguna S 2.1",
  },
  {
    id: "poolside/laguna-xs-2.1:free",
    label: "Laguna XS 2.1",
  },

  // Add more here, e.g.:
  // { id: "meta-llama/llama-3.3-70b-instruct:free", label: "Llama 3.3 70B" },
  // { id: "deepseek/deepseek-chat-v3-0324:free", label: "DeepSeek V3" },
];

// ── Prefix used to identify OpenRouter models in model IDs ──────────────────
export const OPENROUTER_PREFIX = "openrouter:";

/** Returns true if the model ID refers to an OpenRouter model. */
export function isOpenRouterModel(modelId: string): boolean {
  return modelId.startsWith(OPENROUTER_PREFIX);
}

/**
 * Strips the `openrouter:` prefix to get the raw model ID for API calls.
 * Safe to call on IDs that already don't have the prefix.
 */
export function toOpenRouterId(modelId: string): string {
  return modelId.startsWith(OPENROUTER_PREFIX)
    ? modelId.slice(OPENROUTER_PREFIX.length)
    : modelId;
}

/** Returns the model list formatted for the frontend dropdowns. */
export function listOpenRouterModels() {
  return OPENROUTER_MODELS.map((m) => ({
    id: `${OPENROUTER_PREFIX}${m.id}`,
    label: m.label,
  }));
}

// ── Core API call ────────────────────────────────────────────────────────────

function getApiKey(): string {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    throw new Error(
      "[OpenRouter] OPENROUTER_API_KEY is not set in .env"
    );
  }
  return key;
}

export interface OpenRouterMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Core streaming chat call. Returns a raw `Response` with an SSE body.
 * Callers are responsible for consuming the stream.
 */
export async function chatWithOpenRouter(
  modelId: string,
  messages: OpenRouterMessage[],
  signal?: AbortSignal
): Promise<Response> {
  const rawModelId = toOpenRouterId(modelId);
  const apiKey = getApiKey();

  const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": "http://localhost", // required by OpenRouter
      "X-Title": "NothingAI",
    },
    body: JSON.stringify({
      model: rawModelId,
      messages,
      stream: true,
    }),
    signal,
  });

  return response;
}

/**
 * Higher-level: takes a single prompt string + optional system prompt,
 * calls OpenRouter in streaming mode, and asynchronously yields text chunks.
 *
 * Mimics the shape of Ollama's NDJSON stream so callers can treat both
 * the same way: each yielded value is a plain text token (not JSON).
 */
export async function* streamOpenRouterGenerate(
  modelId: string,
  prompt: string,
  systemPrompt?: string,
  signal?: AbortSignal
): AsyncGenerator<string> {
  const messages: OpenRouterMessage[] = [];
  if (systemPrompt) {
    messages.push({ role: "system", content: systemPrompt });
  }
  messages.push({ role: "user", content: prompt });

  const response = await chatWithOpenRouter(modelId, messages, signal);

  if (!response.ok || !response.body) {
    const errText = await response.text().catch(() => "");
    throw new Error(
      `[OpenRouter] API returned ${response.status}: ${errText}`
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("data: ")) continue;
      const json = trimmed.slice("data: ".length);
      if (json === "[DONE]") return;

      try {
        const parsed = JSON.parse(json);
        const token: string | undefined =
          parsed?.choices?.[0]?.delta?.content;
        if (token) yield token;
      } catch {
        // Malformed line — skip silently
      }
    }
  }
}

/**
 * Non-streaming version: collects the full response and returns it as a string.
 * Used for conversation summarization and other single-shot tasks.
 */
export async function generateWithOpenRouter(
  modelId: string,
  prompt: string,
  systemPrompt?: string
): Promise<string> {
  let result = "";
  for await (const token of streamOpenRouterGenerate(modelId, prompt, systemPrompt)) {
    result += token;
  }
  return result;
}
