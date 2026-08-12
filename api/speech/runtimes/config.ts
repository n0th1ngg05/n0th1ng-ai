import path from "path";
import { RuntimeConfig, RuntimeId, ProviderId } from "../types.js";

/**
 * Builds the runtime config for a provider. All providers currently point
 * at the same shared port (the single multi-provider Python process), so
 * `port` will be the same value (SPEECH_RUNTIME_PORT, default 9000) for
 * every call — only the id/providerId differ per provider.
 */
export function createDefaultRuntimeConfig(
  providerId: ProviderId,
  port: number
): RuntimeConfig {

  return {

    id: `runtime_${providerId}_${port}` as RuntimeId,

    providerId,

    port,

    host: "127.0.0.1",

    pythonPath: path.resolve(
    process.cwd(),
    "speech-runtime",
    ".venv",
    "Scripts",
    "python.exe"
),

    scriptPath: path.resolve(
      process.cwd(),
      "speech-runtime",
      "main.py"
    ),

    args: [],

    env: {
      SPEECH_RUNTIME_PORT: String(port),
    },

    timeout: 30000,

    maxRetries: 3,

    heartbeatInterval: 5000,

  };

}