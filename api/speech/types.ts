import { EventEmitter } from 'events';

/** Unique identifiers */
export type ProviderId = 'kokoro' | 'piper' | 'xtts' | 'fishspeech' | 'chatterbox' | 'dia' | 'whisper';
export type ProviderType = 'tts' | 'stt' | 'hybrid';
export type ModelId = string;
export type VoiceId = string;
export type ProfileId = string;
export type RuntimeId = string;
export type DownloadId = string;
export type DeviceId = string;
export type RequestId = string;

/** Status enumerations */
export enum ModelStatus {
  INSTALLED = 'installed',
  DOWNLOADING = 'downloading',
  AVAILABLE = 'available',
  ERROR = 'error',
}

export enum RuntimeStatus {
  STOPPED = 'stopped',
  STARTING = 'starting',
  RUNNING = 'running',
  ERROR = 'error',
  RESTARTING = 'restarting',
}

export enum DownloadStatus {
  PENDING = 'pending',
  DOWNLOADING = 'downloading',
  PAUSED = 'paused',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
  ERROR = 'error',
}

/** Core manifest types */
export interface ProviderManifest {
  id: ProviderId;
  name: string;
  type: ProviderType;
  version: string;
  description: string;
  author: string;
  license: string;
  models: ModelManifest[];
  voices: VoiceManifest[];
  supportedLanguages: string[];
}

export interface ModelManifest {
  id: ModelId;
  providerId: ProviderId;
  name: string;
  version: string;
  size: number;
  checksum: string;
  checksumAlgorithm: 'sha256' | 'md5';
  downloadUrl: string;
  status: ModelStatus;
  languages: string[];
  capabilities: string[];
  minProviderVersion: string;
  installedPath?: string;
}

export interface VoiceManifest {
  id: VoiceId;
  modelId: ModelId;
  providerId: ProviderId;
  name: string;
  language: string;
  gender: 'male' | 'female' | 'neutral';
  description: string;
  sampleRate: number;
  isDefault: boolean;
}

/** Voice Profile */
export interface VoiceProfile {
  id: ProfileId;
  name: string;
  providerId: ProviderId;
  modelId: ModelId;
  voiceId: VoiceId;
  speed: number;
  pitch: number;
  temperature: number;
  volume: number;
  emotion: string;
  language: string;
  isDefault: boolean;
  isBuiltIn: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** TTS/STT request/response types */
export interface TTSRequest {
  text: string;
  providerId?: ProviderId;
  modelId?: ModelId;
  voiceId?: VoiceId;
  profileId?: ProfileId;
  speed?: number;
  pitch?: number;
  temperature?: number;
  volume?: number;
  emotion?: string;
  language?: string;
  format?: 'wav' | 'mp3' | 'ogg' | 'pcm';
  sampleRate?: number;
}

export interface TTSResponse {
  audioData: Buffer;
  format: string;
  sampleRate: number;
  duration: number;
  providerId: ProviderId;
  modelId: ModelId;
  voiceId: VoiceId;
}

export interface STTRequest {
  audioData: Buffer;
  format: string;
  sampleRate: number;
  providerId?: ProviderId;
  modelId?: ModelId;
  language?: string;
  channels?: number;
}

export interface STTResponse {
  text: string;
  confidence: number;
  providerId: ProviderId;
  modelId: ModelId;
  language: string;
  segments: TranscriptionSegment[];
}

export interface TranscriptionSegment {
  start: number;
  end: number;
  text: string;
  confidence: number;
}

/** Voice Chat */
export interface VoiceChatRequest {
  audioData: Buffer;
  format: string;
  sampleRate: number;
  profileId?: ProfileId;
  language?: string;
  channels?: number;
}

export interface VoiceChatResponse {
  transcription: STTResponse;
  response: TTSResponse;
}

/** Runtime configuration and health */
export interface RuntimeConfig {
  id: RuntimeId;
  providerId: ProviderId;
  port: number;
  host: string;
  pythonPath: string;
  scriptPath: string;
  args: string[];
  env: Record<string, string>;
  timeout: number;
  maxRetries: number;
  heartbeatInterval: number;
}

export interface RuntimeHealth {
  status: RuntimeStatus;
  pid?: number;
  port: number;
  uptime: number;
  memoryUsage: number;
  cpuUsage: number;
  lastPing: Date;
  error?: string;
}

/** Download task */
export interface DownloadTask {
  id: DownloadId;
  modelId: ModelId;
  providerId: ProviderId;
  url: string;
  destinationPath: string;
  totalBytes: number;
  downloadedBytes: number;
  status: DownloadStatus;
  speed: number;
  eta: number;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Audio device */
export interface AudioDevice {
  id: DeviceId;
  name: string;
  type: 'microphone' | 'speaker';
  isDefault: boolean;
  sampleRate: number;
  channels: number;
  format: string;
}

/** Benchmarking */
export interface BenchmarkResult {
  id: string;
  providerId: ProviderId;
  modelId: ModelId;
  voiceId?: VoiceId;
  type: 'tts' | 'stt';
  latency: number;
  loadTime: number;
  inferenceSpeed: number;
  rtf: number;
  memoryUsage: number;
  timestamp: Date;
}

export interface BenchmarkConfig {
  providerId: ProviderId;
  modelId: ModelId;
  voiceId?: VoiceId;
  iterations: number;
  warmupIterations: number;
  text?: string;
  audioData?: Buffer;
}

/** Health reporting */
export interface HealthReport {
  overall: 'healthy' | 'degraded' | 'unhealthy';
  providers: ProviderHealth[];
  runtimes: RuntimeHealth[];
  models: ModelHealth[];
  devices: DeviceHealth[];
  timestamp: Date;
}

export interface ProviderHealth {
  providerId: ProviderId;
  status: 'healthy' | 'unhealthy' | 'unknown';
  models: number;
  error?: string;
}

export interface ModelHealth {
  modelId: ModelId;
  providerId: ProviderId;
  status: 'healthy' | 'corrupted' | 'missing' | 'unknown';
  path?: string;
  error?: string;
}

export interface DeviceHealth {
  deviceId: DeviceId;
  type: 'microphone' | 'speaker';
  status: 'available' | 'unavailable' | 'error';
  error?: string;
}

/** Provider interfaces */
export interface IBaseProvider {
  readonly id: ProviderId;
  readonly manifest: ProviderManifest;
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
  health(): Promise<ProviderHealth>;
  listModels(): Promise<ModelManifest[]>;
  listVoices(): Promise<VoiceManifest[]>;
  benchmark(config: BenchmarkConfig): Promise<BenchmarkResult>;
}

export interface ITTSProvider extends IBaseProvider {
  synthesize(request: TTSRequest): Promise<TTSResponse>;
}

export interface ISTTProvider extends IBaseProvider {
  transcribe(request: STTRequest): Promise<STTResponse>;
}

export interface IHybridProvider extends ITTSProvider, ISTTProvider {}

/** Event map for typed events */
export interface SpeechEventMap {
  'provider:installed': { providerId: ProviderId; manifest: ProviderManifest };
  'provider:removed': { providerId: ProviderId };
  'provider:enabled': { providerId: ProviderId };
  'provider:disabled': { providerId: ProviderId };
  'runtime:started': { runtimeId: RuntimeId; providerId: ProviderId };
  'runtime:stopped': { runtimeId: RuntimeId; providerId: ProviderId };
  'runtime:error': { runtimeId: RuntimeId; providerId: ProviderId; error: string };
  'download:started': { downloadId: DownloadId; modelId: ModelId; providerId: ProviderId };
  'download:progress': { downloadId: DownloadId; progress: number; speed: number; eta: number };
  'download:completed': { downloadId: DownloadId; modelId: ModelId; providerId: ProviderId };
  'download:cancelled': { downloadId: DownloadId; modelId: ModelId };
  'download:error': { downloadId: DownloadId; modelId: ModelId; error: string };
  'speech:generated': { requestId: RequestId; providerId: ProviderId; duration: number };
  'speech:failed': { requestId: RequestId; providerId: ProviderId; error: string };
  'transcription:completed': { requestId: RequestId; providerId: ProviderId; text: string };
  'transcription:failed': { requestId: RequestId; providerId: ProviderId; error: string };
  'benchmark:completed': { result: BenchmarkResult };
  'benchmark:failed': { providerId: ProviderId; modelId: ModelId; error: string };
  'device:changed': { deviceId: DeviceId; type: 'microphone' | 'speaker' };
  'profile:created': { profile: VoiceProfile };
  'profile:updated': { profile: VoiceProfile };
  'profile:deleted': { profileId: ProfileId };
}

/** Audio types */
export interface AudioFormat {
  sampleRate: number;
  channels: number;
  bitDepth: number;
  format: 'pcm' | 'wav' | 'mp3' | 'ogg';
}

export interface AudioBuffer {
  data: Buffer;
  format: AudioFormat;
  duration: number;
}

/** Storage interfaces */
export interface IProviderStorage {
  getAll(): Promise<ProviderManifest[]>;
  get(id: ProviderId): Promise<ProviderManifest | undefined>;
  save(manifest: ProviderManifest): Promise<void>;
  delete(id: ProviderId): Promise<void>;
}

export interface IModelStorage {
  getAll(): Promise<ModelManifest[]>;
  get(id: ModelId): Promise<ModelManifest | undefined>;
  getByProvider(providerId: ProviderId): Promise<ModelManifest[]>;
  save(model: ModelManifest): Promise<void>;
  delete(id: ModelId): Promise<void>;
}

export interface IProfileStorage {
  getAll(): Promise<VoiceProfile[]>;
  get(id: ProfileId): Promise<VoiceProfile | undefined>;
  getDefault(): Promise<VoiceProfile | undefined>;
  getByProvider(providerId: ProviderId): Promise<VoiceProfile[]>;
  save(profile: VoiceProfile): Promise<void>;
  delete(id: ProfileId): Promise<void>;
}

export interface IRuntimeStorage {
  getAll(): Promise<RuntimeConfig[]>;
  get(id: RuntimeId): Promise<RuntimeConfig | undefined>;
  getByProvider(providerId: ProviderId): Promise<RuntimeConfig | undefined>;
  save(config: RuntimeConfig): Promise<void>;
  delete(id: RuntimeId): Promise<void>;
}

export interface SpeechHistoryEntry {
  id: string;
  type: 'tts' | 'stt' | 'voicechat';
  providerId: ProviderId;
  modelId: ModelId;
  timestamp: Date;
  duration: number;
  input: unknown;
  output: unknown;
}

export interface IHistoryStorage {
  getAll(): Promise<SpeechHistoryEntry[]>;
  get(id: string): Promise<SpeechHistoryEntry | undefined>;
  save(entry: SpeechHistoryEntry): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface ISettingsStorage {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  getAll(): Promise<Record<string, unknown>>;
}

/** Error types */
export class SpeechError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly providerId?: ProviderId,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'SpeechError';
    Object.setPrototypeOf(this, SpeechError.prototype);
  }
}

/** Typed event emitter wrapper */
export class TypedEventEmitter<TEvents extends Record<string, unknown>> {
  private emitter = new EventEmitter();

  emit<TEvent extends keyof TEvents>(event: TEvent, payload: TEvents[TEvent]): boolean {
    return this.emitter.emit(event as string, payload);
  }

  on<TEvent extends keyof TEvents>(event: TEvent, handler: (payload: TEvents[TEvent]) => void): void {
    this.emitter.on(event as string, handler as (...args: unknown[]) => void);
  }

  off<TEvent extends keyof TEvents>(event: TEvent, handler: (payload: TEvents[TEvent]) => void): void {
    this.emitter.off(event as string, handler as (...args: unknown[]) => void);
  }

  once<TEvent extends keyof TEvents>(event: TEvent, handler: (payload: TEvents[TEvent]) => void): void {
    this.emitter.once(event as string, handler as (...args: unknown[]) => void);
  }

  removeAllListeners(event?: keyof TEvents): void {
    this.emitter.removeAllListeners(event as string);
  }

  listenerCount(event: keyof TEvents): number {
    return this.emitter.listenerCount(event as string);
  }
}