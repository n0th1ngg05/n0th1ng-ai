import { SpeechError } from '../types.js';
import {
  DEFAULT_SPEED,
  DEFAULT_PITCH,
  DEFAULT_TEMPERATURE,
  DEFAULT_VOLUME,
  MAX_TEXT_LENGTH,
  SUPPORTED_LANGUAGES,
  AUDIO_FORMATS,
} from './constants.js';

/** Validates TTS request parameters */
export function validateTTSRequest(request: unknown): asserts request is { text: string } {
  if (!request || typeof request !== 'object') {
    throw new SpeechError('Invalid TTS request: must be an object', 'VALIDATION_ERROR');
  }
  const r = request as Record<string, unknown>;
  if (typeof r.text !== 'string' || r.text.length === 0) {
    throw new SpeechError('TTS request must contain non-empty text', 'VALIDATION_ERROR');
  }
  if (r.text.length > MAX_TEXT_LENGTH) {
    throw new SpeechError(`Text exceeds maximum length of ${MAX_TEXT_LENGTH}`, 'VALIDATION_ERROR');
  }
}

/** Validates STT request parameters */
export function validateSTTRequest(request: unknown): asserts request is { audioData: Buffer; format: string; sampleRate: number } {
  if (!request || typeof request !== 'object') {
    throw new SpeechError('Invalid STT request: must be an object', 'VALIDATION_ERROR');
  }
  const r = request as Record<string, unknown>;
  if (!Buffer.isBuffer(r.audioData) || r.audioData.length === 0) {
    throw new SpeechError('STT request must contain non-empty audioData buffer', 'VALIDATION_ERROR');
  }
  if (typeof r.format !== 'string' || !AUDIO_FORMATS.includes(r.format as typeof AUDIO_FORMATS[number])) {
    throw new SpeechError(`Unsupported audio format. Supported: ${AUDIO_FORMATS.join(', ')}`, 'VALIDATION_ERROR');
  }
  if (typeof r.sampleRate !== 'number' || r.sampleRate < 8000 || r.sampleRate > 192000) {
    throw new SpeechError('Invalid sample rate', 'VALIDATION_ERROR');
  }
}

/** Validates a voice profile */
export function validateVoiceProfile(profile: unknown): void {
  if (!profile || typeof profile !== 'object') {
    throw new SpeechError('Invalid profile: must be an object', 'VALIDATION_ERROR');
  }
  const p = profile as Record<string, unknown>;
  if (typeof p.name !== 'string' || p.name.length === 0) {
    throw new SpeechError('Profile name is required', 'VALIDATION_ERROR');
  }
  if (typeof p.providerId !== 'string') {
    throw new SpeechError('Profile providerId is required', 'VALIDATION_ERROR');
  }
  if (typeof p.modelId !== 'string') {
    throw new SpeechError('Profile modelId is required', 'VALIDATION_ERROR');
  }
  if (typeof p.voiceId !== 'string') {
    throw new SpeechError('Profile voiceId is required', 'VALIDATION_ERROR');
  }
  if (typeof p.speed === 'number' && (p.speed < 0.5 || p.speed > 2.0)) {
    throw new SpeechError('Speed must be between 0.5 and 2.0', 'VALIDATION_ERROR');
  }
  if (typeof p.pitch === 'number' && (p.pitch < 0.5 || p.pitch > 2.0)) {
    throw new SpeechError('Pitch must be between 0.5 and 2.0', 'VALIDATION_ERROR');
  }
  if (typeof p.temperature === 'number' && (p.temperature < 0.0 || p.temperature > 1.0)) {
    throw new SpeechError('Temperature must be between 0.0 and 1.0', 'VALIDATION_ERROR');
  }
  if (typeof p.volume === 'number' && (p.volume < 0.0 || p.volume > 1.0)) {
    throw new SpeechError('Volume must be between 0.0 and 1.0', 'VALIDATION_ERROR');
  }
  if (typeof p.language === 'string' && !SUPPORTED_LANGUAGES.includes(p.language)) {
    throw new SpeechError(`Unsupported language: ${p.language}`, 'VALIDATION_ERROR');
  }
}

/** Sanitizes profile values to defaults */
export function sanitizeProfileValues(profile: Record<string, unknown>): Record<string, unknown> {
  return {
    ...profile,
    speed: typeof profile.speed === 'number' ? Math.max(0.5, Math.min(2.0, profile.speed)) : DEFAULT_SPEED,
    pitch: typeof profile.pitch === 'number' ? Math.max(0.5, Math.min(2.0, profile.pitch)) : DEFAULT_PITCH,
    temperature: typeof profile.temperature === 'number' ? Math.max(0.0, Math.min(1.0, profile.temperature)) : DEFAULT_TEMPERATURE,
    volume: typeof profile.volume === 'number' ? Math.max(0.0, Math.min(1.0, profile.volume)) : DEFAULT_VOLUME,
    emotion: typeof profile.emotion === 'string' ? profile.emotion : DEFAULT_EMOTION,
  };
}

/** Validates a provider ID */
export function validateProviderId(id: unknown): string {
  if (typeof id !== 'string' || id.length === 0) {
    throw new SpeechError('Provider ID must be a non-empty string', 'VALIDATION_ERROR');
  }
  return id;
}

/** Validates a model ID */
export function validateModelId(id: unknown): string {
  if (typeof id !== 'string' || id.length === 0) {
    throw new SpeechError('Model ID must be a non-empty string', 'VALIDATION_ERROR');
  }
  return id;
}