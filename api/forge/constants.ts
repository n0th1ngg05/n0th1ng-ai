// ─────────────────────────────────────────────────────────────────────────────
// forge/constants.ts
//
// Every tunable number and fixed location for The Forge lives here — nothing
// below is allowed to be re-hardcoded in a second file (same convention as
// toolRouter.ts owning OLLAMA_GENERATE_URL for the router cascade).
// ─────────────────────────────────────────────────────────────────────────────

// Hardcoded on purpose, NOT env-configurable — the workspace root has exactly
// one location by design. Every session gets its own subdirectory:
// D:\Forge\workspaces\{sessionId}\
export const FORGE_ROOT = "D:\\Forge\\workspaces";

// FALLBACK ONLY — used if a session is somehow created without an explicit
// modelId (shouldn't happen via the UI, which always sends one, but old rows
// or a direct API call without the field need something sane to fall back
// to). The actual model used per-session is session.modelId, chosen at
// creation time from the frontend's dropdown — see forge/router.ts's
// listModels procedure and orchestrator.createSession.
export const FORGE_MODEL =
    process.env.FORGE_MODEL ?? "devstral:24b-small-2505-q6_K";

// Models offered in the frontend's "New Session" dropdown. This is a curated
// allowlist, not "whatever Ollama happens to have pulled" — deliberately:
// letting the model field be arbitrary free text from the frontend would
// mean an unvetted model name reaches callForgeModel with no chance to catch
// a typo before burning a planning call on it. Add a model here once it's
// been pulled and is known to produce parseable JSON actions reliably.
export const OLLAMA_TAGS_URL = "http://localhost:11434/api/tags";
export const OLLAMA_GENERATE_URL = "http://localhost:11434/api/generate";

export const DEFAULT_COMMAND_TIMEOUT_MS = 120_000;

// Installs (npm install, pip install, mvn dependency resolution) routinely
// blow past the default command timeout — they get their own budget.
export const INSTALL_COMMAND_TIMEOUT_MS = 600_000;

// Model calls against a 24B model on local hardware can be slow, especially
// when the GPU is shared with the main chat model.
export const DEFAULT_MODEL_TIMEOUT_MS = 300_000;

export const MAX_ATTEMPTS_PER_TASK = 5;
// The integration check gets a SHORTER leash than regular tasks on purpose —
// per explicit instruction, a failed server-start after every file is
// already written and reviewed is an environment/last-mile issue, not
// something worth grinding 5 attempts on. Try a couple of times (covers a
// simple transient issue, like the server needing an extra second to boot),
// then skip it and move on rather than burning the session's time.
export const MAX_INTEGRATION_CHECK_ATTEMPTS = 2;

export const MAX_CONSECUTIVE_IDENTICAL_ERRORS = 3;