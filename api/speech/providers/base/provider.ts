import {
  ProviderManifest,
  ModelManifest,
  VoiceManifest,
  ProviderHealth,
  BenchmarkConfig,
  BenchmarkResult,
  IBaseProvider,
  ProviderId,
  SpeechError,
} from '../../types.js';

/** Abstract base class for all speech providers */
export abstract class BaseProvider implements IBaseProvider {
  abstract readonly id: ProviderId;
  abstract readonly manifest: ProviderManifest;
  protected initialized = false;

  /** Initializes the provider */
  abstract initialize(): Promise<void>;

  /** Shuts down the provider */
  abstract shutdown(): Promise<void>;

  /** Returns provider health status */
  abstract health(): Promise<ProviderHealth>;

  /** Lists available models */
  abstract listModels(): Promise<ModelManifest[]>;

  /** Lists available voices */
  abstract listVoices(): Promise<VoiceManifest[]>;

  /** Runs a benchmark */
  abstract benchmark(config: BenchmarkConfig): Promise<BenchmarkResult>;

  /** Checks if the provider is initialized */
  isInitialized(): boolean {
    return this.initialized;
  }

  /** Asserts that the provider is initialized */
  protected assertInitialized(): void {
    if (!this.initialized) {
      throw new SpeechError(`Provider ${this.id} is not initialized`, 'PROVIDER_NOT_INITIALIZED', this.id);
    }
  }
}