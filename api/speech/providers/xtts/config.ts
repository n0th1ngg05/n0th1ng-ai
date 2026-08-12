import { ProviderId } from '../../types.js';

/** XTTS provider configuration */
export interface XTTSConfig {
  providerId: ProviderId;
  defaultModel: string;
  defaultVoice: string;
  sampleRate: number;
  maxTextLength: number;
  languages: string[];
  supportsVoiceCloning: boolean;
}

export const defaultXTTSConfig: XTTSConfig = {
  providerId: 'xtts',
  defaultModel: 'xtts-v2',
  defaultVoice: 'default',
  sampleRate: 24000,
  maxTextLength: 10000,
  languages: ['en', 'es', 'fr', 'de', 'it', 'pt', 'pl', 'tr', 'ru', 'nl', 'cs', 'ar', 'zh', 'ja', 'hu', 'ko'],
  supportsVoiceCloning: true,
};