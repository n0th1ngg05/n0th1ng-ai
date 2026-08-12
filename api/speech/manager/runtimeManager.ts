import {
  RuntimeConfig,
  RuntimeId,
  ProviderId,
  RuntimeStatus,
  SpeechError,
} from '../types.js';
import { RuntimeStorage } from '../storage/runtimeStorage.js';
import { RuntimeFactory } from '../runtimes/runtimeFactory.js';
import { Runtime } from "../runtimes/runtime.js";
import { emitRuntimeStarted, emitRuntimeStopped, emitRuntimeError } from '../events/runtimeEvents.js';
import { createDefaultRuntimeConfig } from '../runtimes/config.js';

/**
 * Manages runtime lifecycle.
 *
 * IMPORTANT: The Python speech runtime is a single multi-provider process
 * (speech-runtime/main.py) already started once at app boot, listening on
 * SPEECH_RUNTIME_PORT (default 9000). Every provider (kokoro, whisper,
 * piper, xtts, dia, fishspeech, chatterbox) is served by that SAME process
 * — this manager does not spawn a separate Python process per provider.
 */
export class RuntimeManager {
  private runtimes = new Map<RuntimeId, Runtime>();
  private storage: RuntimeStorage;
  private readonly sharedPort = Number(process.env.SPEECH_RUNTIME_PORT) || 9000;
  private sharedRuntimeId?: RuntimeId;

  constructor() {
    this.storage = new RuntimeStorage();
  }

  /** Restores runtime configurations on startup */
async initialize(): Promise<void> {

  const configs =
    await this.storage.getAll();

  console.log(
    `[Speech] Restoring ${configs.length} runtime configuration(s)...`
  );

  console.log(
    `[Speech] All providers share one runtime on port ${this.sharedPort}`
  );

}

  /** Gets (or creates) the single shared runtime configuration used by every provider */
  async createRuntimeConfig(providerId: ProviderId): Promise<RuntimeConfig> {
    const existing = await this.storage.getByProvider(providerId);
    if (existing && existing.port === this.sharedPort) return existing;

    const config = createDefaultRuntimeConfig(providerId, this.sharedPort);
    await this.storage.save(config);
    return config;
  }

  /** Starts (connects to) the shared runtime for a provider */
  async startRuntime(providerId: ProviderId): Promise<Runtime> {
    console.log("========== START RUNTIME ==========");
    console.log("Provider:", providerId, "-> shared runtime on port", this.sharedPort);

    const config = await this.createRuntimeConfig(providerId);

    // All providers reuse the single shared runtime instance/connection.
    if (this.sharedRuntimeId) {
      const existing = this.runtimes.get(this.sharedRuntimeId);
      if (existing && existing.getStatus() === RuntimeStatus.RUNNING) {
        return existing;
      }
    }

    const runtime = RuntimeFactory.create(config);
    this.runtimes.set(config.id, runtime);
    this.sharedRuntimeId = config.id;

    try {
      await runtime.start();
      emitRuntimeStarted(config.id, providerId);
      return runtime;
    } catch (error) {
      this.runtimes.delete(config.id);
      this.sharedRuntimeId = undefined;
      const message = error instanceof Error ? error.message : String(error);
      emitRuntimeError(config.id, providerId, message);
      throw new SpeechError(`Failed to start runtime: ${message}`, 'RUNTIME_START_ERROR');
    }
  }

  /** Stops a runtime */
  async stopRuntime(runtimeId: RuntimeId): Promise<void> {
    const runtime = this.runtimes.get(runtimeId);
    if (!runtime) {
      throw new SpeechError(`Runtime ${runtimeId} not found`, 'RUNTIME_NOT_FOUND');
    }
    await runtime.stop();
    this.runtimes.delete(runtimeId);
    if (this.sharedRuntimeId === runtimeId) {
      this.sharedRuntimeId = undefined;
    }
    emitRuntimeStopped(runtimeId, runtime.getConfig().providerId);
  }

  /** Stops all runtimes */
  async stopAllRuntimes(): Promise<void> {
    for (const [id, runtime] of this.runtimes) {
      try {
        await runtime.stop();
        emitRuntimeStopped(id, runtime.getConfig().providerId);
      } catch { /* ignore */ }
    }
    this.runtimes.clear();
    this.sharedRuntimeId = undefined;
  }

  /** Restarts a runtime */
  async restartRuntime(runtimeId: RuntimeId): Promise<Runtime> {
    const runtime = this.runtimes.get(runtimeId);
    if (!runtime) {
      throw new SpeechError(`Runtime ${runtimeId} not found`, 'RUNTIME_NOT_FOUND');
    }
    const providerId = runtime.getConfig().providerId;
    await this.stopRuntime(runtimeId);
    return this.startRuntime(providerId);
  }

  /** Gets a runtime by ID */
  getRuntime(id: RuntimeId): Runtime | undefined {
    return this.runtimes.get(id);
  }

  /** Gets all active runtimes */
  getAllRuntimes(): Runtime[] {
    return Array.from(this.runtimes.values());
  }

  /** Gets runtime by provider (always resolves to the single shared runtime, once started) */
  getRuntimeByProvider(providerId: ProviderId): Runtime | undefined {
    if (this.sharedRuntimeId) {
      return this.runtimes.get(this.sharedRuntimeId);
    }
    return Array.from(this.runtimes.values()).find((r) => r.getConfig().providerId === providerId);
  }

  /** Returns all saved runtime configurations */
async getRuntimeConfigs(): Promise<RuntimeConfig[]> {

  return this.storage.getAll();

}
}