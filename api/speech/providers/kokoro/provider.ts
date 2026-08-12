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
import { getKokoroManifest } from './manifest.js';
import { defaultKokoroConfig } from './config.js';
import { RuntimeRegistry } from '../../manager/runtimeRegistry.js';
import { generateRequestId, sleep } from '../../utils/helpers.js';
import { emitSpeechGenerated, emitSpeechFailed } from '../../events/speechEvents.js';
import { HttpClient } from '../../runtimes/httpClient.js';

/** Kokoro TTS provider implementation */
export class KokoroProvider extends TTSProvider {
  readonly id: ProviderId = 'kokoro';
  readonly manifest: ProviderManifest;

  constructor(private readonly runtimeRegistry: RuntimeRegistry) {
    super();
    this.manifest = getKokoroManifest();
  }

  /** Initializes the Kokoro provider */
  async initialize(): Promise<void> {
    this.initialized = true;
  }

  /** Shuts down the Kokoro provider */
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
      console.warn(`[KokoroProvider] Failed to fetch dynamic voices from runtime:`, err instanceof Error ? err.message : String(err));
    }

    return this.manifest.voices;
  }

  
  /** Synthesizes speech using Kokoro */
  async synthesize(request: TTSRequest): Promise<TTSResponse> {
    interface RuntimeTTSResponse {
    success: boolean;
    audio: string;
    format: string;
    sample_rate: number;
    duration: number;
    model_id: string;
    voice_id: string;
}
    this.assertInitialized();
    const requestId = generateRequestId();
    const runtime = this.runtimeRegistry.getByProvider(this.id);
    if (!runtime) {
      throw new SpeechError('Kokoro runtime not available', 'RUNTIME_NOT_FOUND', this.id);
    }

    try {
      const client = runtime.getHttpClient();
      const response = await client.post<RuntimeTTSResponse>("/tts", {
    text: request.text,
    provider_id: request.providerId,
    model_id: request.modelId,
    voice_id: request.voiceId,
    profile_id: request.profileId,
    language: request.language,
    speed: request.speed,
    pitch: request.pitch,
    volume: request.volume,
    temperature: request.temperature,
    emotion: request.emotion,
});

const audioBuffer = Buffer.from(response.audio, "base64");

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
      throw new SpeechError(`Kokoro synthesis failed: ${message}`, 'SYNTHESIS_ERROR', this.id, error as Error);
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
      loadTime: latency * 0.3,
      inferenceSpeed: text.length / (latency / 1000),
      rtf: latency / 1000 / (text.length * 0.1),
      memoryUsage: 0,
      timestamp: new Date(),
    };
  }
}