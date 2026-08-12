import { TTSProvider } from '../base/ttsProvider.js';
import {
  ProviderManifest,
  ModelManifest,
  VoiceManifest,
  ProviderHealth,
  BenchmarkConfig,
  BenchmarkResult,
  TTSRequest,
  TTSResponse,
  ProviderId,
  SpeechError,
} from '../../types.js';
import { getDiaManifest } from './manifest.js';
import { defaultDiaConfig } from './config.js';
import { RuntimeRegistry } from '../../manager/runtimeRegistry.js';
import { generateRequestId } from '../../utils/helpers.js';
import { emitSpeechGenerated, emitSpeechFailed } from '../../events/speechEvents.js';

/** Dia TTS provider implementation */
export class DiaProvider extends TTSProvider {
  readonly id: ProviderId = 'dia';
  readonly manifest: ProviderManifest;

  constructor(private readonly runtimeRegistry: RuntimeRegistry) {
    super();
    this.manifest = getDiaManifest();
  }

  /** Initializes the Dia provider */
  async initialize(): Promise<void> {
    this.initialized = true;
  }

  /** Shuts down the Dia provider */
  async shutdown(): Promise<void> {
    this.initialized = false;
  }

  /** Returns provider health */
  async health(): Promise<ProviderHealth> {
    const runtime = this.runtimeRegistry.getByProvider(this.id);
    return {
      providerId: this.id,
      status: runtime?.health().status === 'running' ? 'healthy' : 'unhealthy',
      models: this.manifest.models.length,
    };
  }

  /** Lists available models */
  async listModels(): Promise<ModelManifest[]> {
    return this.manifest.models;
  }

  /** Lists available voices */
  async listVoices(): Promise<VoiceManifest[]> {
    return this.manifest.voices;
  }

  /** Synthesizes speech using Dia */
  async synthesize(request: TTSRequest): Promise<TTSResponse> {
    this.assertInitialized();
    const requestId = generateRequestId();
    const runtime = this.runtimeRegistry.getByProvider(this.id);
    if (!runtime) {
      throw new SpeechError('Dia runtime not available', 'RUNTIME_NOT_FOUND', this.id);
    }

    try {
      interface RuntimeTTSResponse {
        success: boolean;
        audio: string;
        format: string;
        sample_rate: number;
        duration: number;
        model_id: string;
        voice_id: string;
      }
      const client = runtime.getHttpClient();
      const response = await client.post<RuntimeTTSResponse>('/tts', {
        text: request.text,
        provider_id: this.id,
        voice_id: request.voiceId || defaultDiaConfig.defaultVoice,
        model_id: request.modelId || defaultDiaConfig.defaultModel,
        language: request.language || 'en',
        speed: request.speed,
      });

      const audioBuffer = Buffer.from(response.audio, 'base64');
      emitSpeechGenerated(requestId, this.id, response.duration);
      return {
        audioData: audioBuffer,
        format: response.format,
        sampleRate: response.sample_rate,
        duration: response.duration,
        providerId: this.id,
        modelId: response.model_id,
        voiceId: response.voice_id,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      emitSpeechFailed(requestId, this.id, message);
      throw new SpeechError(`Dia synthesis failed: ${message}`, 'SYNTHESIS_ERROR', this.id, error as Error);
    }
  }

  /** Runs benchmark */
  async benchmark(config: BenchmarkConfig): Promise<BenchmarkResult> {
    this.assertInitialized();
    const start = Date.now();
    const text = config.text || 'Hello world, this is a benchmark test.';
    await this.synthesize({
      text,
      providerId: this.id,
      modelId: config.modelId,
      voiceId: config.voiceId,
    });
    const latency = Date.now() - start;
    return {
      id: `bench_${Date.now()}`,
      providerId: this.id,
      modelId: config.modelId,
      voiceId: config.voiceId,
      type: 'tts',
      latency,
      loadTime: latency * 0.4,
      inferenceSpeed: text.length / (latency / 1000),
      rtf: latency / 1000 / (text.length * 0.1),
      memoryUsage: 0,
      timestamp: new Date(),
    };
  }
}