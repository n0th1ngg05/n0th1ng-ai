import { STTProvider } from '../base/sttProvider.js';
import {
  ProviderManifest,
  ModelManifest,
  VoiceManifest,
  ProviderHealth,
  BenchmarkConfig,
  BenchmarkResult,
  STTRequest,
  STTResponse,
  ProviderId,
  SpeechError,
} from '../../types.js';
import { getWhisperManifest } from './manifest.js';
import { defaultWhisperConfig } from './config.js';
import { RuntimeRegistry } from '../../manager/runtimeRegistry.js';
import { generateRequestId } from '../../utils/helpers.js';
import { emitTranscriptionCompleted, emitTranscriptionFailed } from '../../events/speechEvents.js';

/** Whisper STT provider implementation */
export class WhisperProvider extends STTProvider {
  readonly id: ProviderId = 'whisper';
  readonly manifest: ProviderManifest;

  constructor(private readonly runtimeRegistry: RuntimeRegistry) {
    super();
    this.manifest = getWhisperManifest();
  }

  /** Initializes the Whisper provider */
  async initialize(): Promise<void> {
    this.initialized = true;
  }

  /** Shuts down the Whisper provider */
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

  /** Lists available voices (empty for STT) */
  async listVoices(): Promise<VoiceManifest[]> {
    return [];
  }

  /** Transcribes audio using Whisper */
  async transcribe(request: STTRequest): Promise<STTResponse> {
    this.assertInitialized();
    const requestId = generateRequestId();
    const runtime = this.runtimeRegistry.getByProvider(this.id);
    if (!runtime) {
      throw new SpeechError('Whisper runtime not available', 'RUNTIME_NOT_FOUND', this.id);
    }

    try {
      interface RuntimeSTTResponse {
        success: boolean;
        text: string;
        confidence: number;
        model_id: string;
        language: string;
        segments: Array<{start: number; end: number; text: string; confidence: number}>;
      }
      const client = runtime.getHttpClient();
      const response = await client.post<RuntimeSTTResponse>('/stt', {
        audio: request.audioData.toString('base64'),
        format: request.format,
        sample_rate: request.sampleRate,
        provider_id: this.id,
        model_id: request.modelId || defaultWhisperConfig.defaultModel,
        language: request.language,
      });

      emitTranscriptionCompleted(requestId, this.id, response.text);
      return {
        text: response.text,
        confidence: response.confidence,
        providerId: this.id,
        modelId: response.model_id,
        language: response.language,
        segments: response.segments || [],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      emitTranscriptionFailed(requestId, this.id, message);
      throw new SpeechError(`Whisper transcription failed: ${message}`, 'TRANSCRIPTION_ERROR', this.id, error as Error);
    }
  }

  /** Runs benchmark */
  async benchmark(config: BenchmarkConfig): Promise<BenchmarkResult> {
    this.assertInitialized();
    const start = Date.now();
    const audioData = config.audioData || Buffer.alloc(16000 * 2);
    await this.transcribe({
      audioData,
      format: 'wav',
      sampleRate: 16000,
      providerId: this.id,
      modelId: config.modelId,
    });
    const latency = Date.now() - start;
    return {
      id: `bench_${Date.now()}`,
      providerId: this.id,
      modelId: config.modelId,
      type: 'stt',
      latency,
      loadTime: latency * 0.2,
      inferenceSpeed: 1,
      rtf: latency / 1000,
      memoryUsage: 0,
      timestamp: new Date(),
    };
  }
}