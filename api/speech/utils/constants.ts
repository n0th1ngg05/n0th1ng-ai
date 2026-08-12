/** Default configuration constants for the speech management system */
export const DEFAULT_SAMPLE_RATE = 22050;
export const DEFAULT_CHANNELS = 1;
export const DEFAULT_BIT_DEPTH = 16;
export const DEFAULT_AUDIO_FORMAT = 'wav' as const;

export const DEFAULT_SPEED = 1.0;
export const DEFAULT_PITCH = 1.0;
export const DEFAULT_TEMPERATURE = 0.7;
export const DEFAULT_VOLUME = 1.0;
export const DEFAULT_EMOTION = 'neutral';

export const MAX_TEXT_LENGTH = 10000;
export const MAX_AUDIO_DURATION = 300;
export const MAX_DOWNLOAD_RETRIES = 3;
export const DOWNLOAD_CHUNK_SIZE = 1024 * 1024;
export const DOWNLOAD_TIMEOUT = 300000;

export const RUNTIME_START_TIMEOUT = 30000;
export const RUNTIME_STOP_TIMEOUT = 10000;
export const RUNTIME_HEARTBEAT_INTERVAL = 5000;
export const RUNTIME_MAX_RETRIES = 3;

export const BENCHMARK_WARMUP_ITERATIONS = 2;
export const BENCHMARK_DEFAULT_ITERATIONS = 10;

export const PROVIDER_IDS = ['kokoro', 'piper', 'xtts', 'fishspeech', 'chatterbox', 'dia', 'whisper'] as const;

export const SUPPORTED_LANGUAGES = [
  'en', 'es', 'fr', 'de', 'it', 'pt', 'zh', 'ja', 'ko', 'ru', 'ar', 'hi'
];

export const AUDIO_FORMATS = ['wav', 'mp3', 'ogg', 'pcm', 'webm'] as const;