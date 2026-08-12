import { Runtime } from '../runtimes/runtime.js';
import { ProviderId, RuntimeId, SpeechError } from '../types.js';
import { RuntimeManager } from './runtimeManager.js';

/** Registry mapping providers to their runtimes */
export class RuntimeRegistry {
  constructor(private readonly runtimeManager: RuntimeManager) {}

  /** Gets runtime by provider ID */
  getByProvider(providerId: ProviderId): Runtime | undefined {
    return this.runtimeManager.getRuntimeByProvider(providerId);
  }

  /** Gets runtime by ID */
  getById(runtimeId: RuntimeId): Runtime | undefined {
    return this.runtimeManager.getRuntime(runtimeId);
  }

  /** Registers a runtime for a provider */
  register(providerId: ProviderId, runtime: Runtime): void {
    // Runtime is managed by RuntimeManager, this registry provides lookup
  }

  /** Gets HTTP port for a provider */
  getPort(providerId: ProviderId): number {
    const runtime = this.getByProvider(providerId);
    if (!runtime) {
      throw new SpeechError(`No runtime for provider ${providerId}`, 'RUNTIME_NOT_FOUND');
    }
    return runtime.getConfig().port;
  }
}