import { ProviderId } from '../../types.js';

/** Kokoro provider configuration */
export interface KokoroConfig {
  providerId: ProviderId;
  defaultModel: string;
  defaultVoice: string;
  sampleRate: number;
  maxTextLength: number;
  languages: string[];
}

export const defaultKokoroConfig: KokoroConfig = {
  providerId: 'kokoro',
  defaultModel: 'kokoro-82M',
  defaultVoice: 'af_bella',
  sampleRate: 24000,
  maxTextLength: 10000,
  languages: ['en'],
};