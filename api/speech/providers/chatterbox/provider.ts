import { HybridProvider } from '../base/hybridProvider.js';
import {
  ProviderManifest,
  ModelManifest,
  VoiceManifest,
  ProviderHealth,
  BenchmarkConfig,
  BenchmarkResult,
  TTSRequest,
  TTSResponse,
  STTRequest,
  STTResponse,
  ProviderId,
  SpeechError,
} from '../../types.js';
import { getChatterboxManifest } from './manifest.js';
import { defaultChatterboxConfig } from './config.js';
import { RuntimeRegistry } from '../../manager/runtimeRegistry.js';
import { generateRequestId } from '../../utils/helpers.js';
import { emitSpeechGenerated, emitSpeechFailed, emitTranscriptionCompleted, emitTranscriptionFailed } from '../../events/speechEvents.js';
import { HttpClient } from '../../runtimes/httpClient.js';

/** Chatterbox hybrid provider implementation */
export class ChatterboxProvider extends HybridProvider {
  readonly id: ProviderId = 'chatterbox';
  readonly manifest: ProviderManifest;

  constructor(private readonly runtimeRegistry: RuntimeRegistry) {
    super();
    this.manifest = getChatterboxManifest();
  }

  /** Initializes the Chatterbox provider */
  async initialize(): Promise<void> {
    this.initialized = true;
  }

  /** Shuts down the Chatterbox provider */
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
    let client;
    const runtime = this.runtimeRegistry.getByProvider(this.id);
    
    if (runtime) {
      client = runtime.getHttpClient();
    } else {
      const port = process.env.SPEECH_RUNTIME_PORT || 9000;
      client = new HttpClient(`http://127.0.0.1:${port}`);
    }

    try {
      const res = await client.get<{ voices: any[] }>('/voices');
      if (res?.voices && Array.isArray(res.voices)) {
        const myVoices = res.voices.filter(v => v.providerId === this.id);
        if (myVoices.length > 0) {
          return myVoices as VoiceManifest[];
        }
      }
    } catch (err) {
      console.warn(`[ChatterboxProvider] Failed to fetch dynamic voices from runtime:`, err instanceof Error ? err.message : String(err));
    }

    return this.manifest.voices;
  }

  /** Synthesizes speech using Chatterbox */
  async synthesize(request: TTSRequest): Promise<TTSResponse> {
    this.assertInitialized();
    const requestId = generateRequestId();
    const runtime = this.runtimeRegistry.getByProvider(this.id);
    if (!runtime) {
      throw new SpeechError('Chatterbox runtime not available', 'RUNTIME_NOT_FOUND', this.id);
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
        voice_id: request.voiceId || defaultChatterboxConfig.defaultVoice,
        model_id: request.modelId || defaultChatterboxConfig.defaultModel,
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
      throw new SpeechError(`Chatterbox synthesis failed: ${message}`, 'SYNTHESIS_ERROR', this.id, error as Error);
    }
  }

  /** Transcribes audio using Chatterbox */
  async transcribe(request: STTRequest): Promise<STTResponse> {
    this.assertInitialized();
    const requestId = generateRequestId();
    const runtime = this.runtimeRegistry.getByProvider(this.id);
    if (!runtime) {
      throw new SpeechError('Chatterbox runtime not available', 'RUNTIME_NOT_FOUND', this.id);
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
      throw new SpeechError(`Chatterbox transcription failed: ${message}`, 'TRANSCRIPTION_ERROR', this.id, error as Error);
    }
  }

  /** Runs benchmark */
  async benchmark(config: BenchmarkConfig): Promise<BenchmarkResult> {
    this.assertInitialized();
    const start = Date.now();
    if (config.type === 'stt' && config.audioData) {
      await this.transcribe({
        audioData: config.audioData,
        format: 'wav',
        sampleRate: 16000,
        providerId: this.id,
        modelId: config.modelId,
      });
    } else {
      const text = config.text || 'Hello world, this is a benchmark test.';
      await this.synthesize({
        text,
        providerId: this.id,
        modelId: config.modelId,
        voiceId: config.voiceId,
      });
    }
    const latency = Date.now() - start;
    return {
      id: `bench_${Date.now()}`,
      providerId: this.id,
      modelId: config.modelId,
      voiceId: config.voiceId,
      type: config.type,
      latency,
      loadTime: latency * 0.3,
      inferenceSpeed: 1,
      rtf: latency / 1000,
      memoryUsage: 0,
      timestamp: new Date(),
    };
  }
}