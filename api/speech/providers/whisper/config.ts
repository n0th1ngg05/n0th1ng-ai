import { ProviderId } from '../../types.js';

/** Whisper provider configuration */
export interface WhisperConfig {
  providerId: ProviderId;
  defaultModel: string;
  sampleRate: number;
  languages: string[];
}

export const defaultWhisperConfig: WhisperConfig = {
  providerId: 'whisper',
  defaultModel: 'whisper-base',
  sampleRate: 16000,
  languages: ['en', 'zh', 'de', 'es', 'ru', 'fr', 'ja', 'pt', 'tr', 'pl', 'ca', 'nl', 'ar', 'sv', 'it'],
};