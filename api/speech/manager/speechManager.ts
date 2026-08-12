import {
  TTSRequest,
  TTSResponse,
  STTRequest,
  STTResponse,
  VoiceChatRequest,
  VoiceChatResponse,
  ProviderId,
  ProfileId,
  RequestId,
  SpeechError,
  ITTSProvider,
  ISTTProvider,
} from '../types.js';
import {
    ProviderManager,
} from "./providerManager.js";
import { ModelManager } from './modelManager.js';
import { ProfileManager } from './profileManager.js';
import { RuntimeManager } from './runtimeManager.js';
import { RuntimeRegistry } from './runtimeRegistry.js';
import { DownloadManager } from './downloadManager.js';
import { DeviceManager } from './deviceManager.js';
import { HealthManager } from './healthManager.js';
import { BenchmarkManager } from './benchmarkManager.js';
import { generateRequestId } from '../utils/helpers.js';
import { validateTTSRequest, validateSTTRequest } from '../utils/validation.js';
import { HistoryStorage } from '../storage/historyStorage.js';

function isTTSProvider(provider: unknown): provider is ITTSProvider {
  return !!provider && typeof (provider as ITTSProvider).synthesize === 'function';
}

function isSTTProvider(provider: unknown): provider is ISTTProvider {
  return !!provider && typeof (provider as ISTTProvider).transcribe === 'function';
}

/** Main orchestrator for the speech management system */
export class SpeechManager {
  public readonly providerManager: ProviderManager;
  public readonly modelManager: ModelManager;
  public readonly profileManager: ProfileManager;
  public readonly runtimeManager: RuntimeManager;
  public readonly runtimeRegistry: RuntimeRegistry;
  public readonly downloadManager: DownloadManager;
  public readonly deviceManager: DeviceManager;
  public readonly healthManager: HealthManager;
  public readonly benchmarkManager: BenchmarkManager;
  private historyStorage: HistoryStorage;

  constructor() {
    this.providerManager = new ProviderManager();
    this.modelManager = new ModelManager(this.providerManager);
    this.profileManager = new ProfileManager();
    this.runtimeManager = new RuntimeManager();
    this.runtimeRegistry = new RuntimeRegistry(this.runtimeManager);
    this.downloadManager = new DownloadManager(this.modelManager);
    this.deviceManager = new DeviceManager();
    this.healthManager = new HealthManager(this.providerManager, this.runtimeManager, this.modelManager, this.deviceManager);
    this.benchmarkManager = new BenchmarkManager(this.providerManager);
    this.historyStorage = new HistoryStorage();
  }

  /** Initializes the speech system */
  /** Initializes the speech system */
async initialize(): Promise<void> {

  console.log(
    "\n========== SPEECH SYSTEM =========="
  );

  console.log(
    "[Speech] Initializing..."
  );

  // profileManager must be ready before providers can resolve profiles.
  await this.profileManager.initialize();

  // Dynamically import to avoid resolving the entire providers/ tree at
  // module load time, which caused Vite's SSR fetchModule to time out.
  // registerSpeechProviders itself now loads all 7 providers in parallel.
  const { registerSpeechProviders } = await import("../providers/index.js");

  // These four steps are independent of each other and can run in parallel:
  //   • registerSpeechProviders  – loads + enables all speech providers
  //   • providerManager.initialize – restores persisted provider state
  //   • modelManager.initialize   – restores installed model records
  //   • runtimeManager.initialize – restores runtime configs
  //   • deviceManager.initialize  – reads default mic/speaker settings
  await Promise.all([
    registerSpeechProviders(this.providerManager, this.runtimeRegistry),
    this.providerManager.initialize(),
    this.modelManager.initialize(),
    this.runtimeManager.initialize(),
    this.deviceManager.initialize(),
  ]);

  // healthManager polls providerManager + runtimeManager + modelManager
  // + deviceManager, so it must run after all of the above are done.
  await this.healthManager.initialize();

  console.log(
    "[Speech] Initialization complete."
  );

  console.log(
    "===================================\n"
  );

}

  /** Shuts down the speech system */
  async shutdown(): Promise<void> {
    await this.runtimeManager.stopAllRuntimes();
  }

  /** Performs TTS */
  async synthesize(request: TTSRequest): Promise<TTSResponse> {
    validateTTSRequest(request);
    const requestId = generateRequestId();
    const profile = await this.profileManager.resolveProfile(
      request.profileId,
      request.providerId,
      request.modelId,
      request.voiceId
    );

    const provider = this.providerManager.getProvider(profile.providerId);
    if (!provider) {
      throw new SpeechError(`Provider ${profile.providerId} not available`, 'PROVIDER_NOT_FOUND');
    }

    await this.runtimeManager.startRuntime(profile.providerId);

    if (!isTTSProvider(provider)) {
      throw new SpeechError(`Provider ${profile.providerId} does not support TTS`, 'NOT_SUPPORTED');
    }

    console.log(`[SPEECH] TTS request → provider=${profile.providerId} model=${profile.modelId} voice=${profile.voiceId} chars=${request.text.length}`);

    const response = await provider.synthesize({
      ...request,
      providerId: profile.providerId,
      modelId: profile.modelId,
      voiceId: profile.voiceId,
      speed: request.speed ?? profile.speed,
      pitch: request.pitch ?? profile.pitch,
      temperature: request.temperature ?? profile.temperature,
      volume: request.volume ?? profile.volume,
      emotion: request.emotion ?? profile.emotion,
      language: request.language ?? profile.language,
    });

    console.log(`[SPEECH] TTS response ← provider=${response.providerId} duration=${response.duration?.toFixed(2)}s format=${response.format}`);

    await this.historyStorage.save({
      id: requestId,
      type: 'tts',
      providerId: profile.providerId,
      modelId: profile.modelId,
      timestamp: new Date(),
      duration: response.duration,
      input: request,
      output: response,
    });

    return response;
  }


  /** Performs STT */
  async transcribe(request: STTRequest): Promise<STTResponse> {
    validateSTTRequest(request);
    const requestId = generateRequestId();
    const providerId = request.providerId || 'whisper';
    const provider = this.providerManager.getProvider(providerId);
    if (!provider) {
      throw new SpeechError(`Provider ${providerId} not available`, 'PROVIDER_NOT_FOUND');
    }

    await this.runtimeManager.startRuntime(providerId);

    if (!isSTTProvider(provider)) {
      throw new SpeechError(`Provider ${providerId} does not support STT`, 'NOT_SUPPORTED');
    }

    console.log(`[SPEECH] STT request → provider=${providerId} format=${request.format} size=${request.audioData.length}B`);

    const response = await provider.transcribe(request);

    console.log(`[SPEECH] STT response ← provider=${providerId} text="${response.text?.slice(0, 60)}${(response.text?.length ?? 0) > 60 ? '...' : ''}"`);
    await this.historyStorage.save({
      id: requestId,
      type: 'stt',
      providerId,
      modelId: request.modelId || 'whisper-base',
      timestamp: new Date(),
      duration: 0,
      input: request,
      output: response,
    });

    return response;
  }

  /** Performs voice chat (STT + TTS) */
  async voiceChat(request: VoiceChatRequest): Promise<VoiceChatResponse> {
    const requestId = generateRequestId();
    const transcription = await this.transcribe({
      audioData: request.audioData,
      format: request.format,
      sampleRate: request.sampleRate,
      language: request.language,
    });

    const response = await this.synthesize({
      text: transcription.text,
      profileId: request.profileId,
      language: request.language,
    });

    await this.historyStorage.save({
      id: requestId,
      type: 'voicechat',
      providerId: response.providerId,
      modelId: response.modelId,
      timestamp: new Date(),
      duration: response.duration,
      input: request,
      output: { transcription, response },
    });

    return { transcription, response };
  }
  getProviderManager(): ProviderManager {
    return this.providerManager;
}

getModelManager(): ModelManager {
    return this.modelManager;
}

getRuntimeManager(): RuntimeManager {
    return this.runtimeManager;
}

getProfileManager(): ProfileManager {
    return this.profileManager;
}

getDownloadManager(): DownloadManager {
    return this.downloadManager;
}

getBenchmarkManager(): BenchmarkManager {
    return this.benchmarkManager;
}

getDeviceManager(): DeviceManager {
    return this.deviceManager;
}

getHealthManager(): HealthManager {
    return this.healthManager;
}
}

export const speechManager = new SpeechManager();
