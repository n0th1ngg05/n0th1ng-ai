import { ProviderId } from '../../types.js';

/** Piper provider configuration */
export interface PiperConfig {
  providerId: ProviderId;
  defaultModel: string;
  defaultVoice: string;
  sampleRate: number;
  maxTextLength: number;
  languages: string[];
}

export const defaultPiperConfig: PiperConfig = {
  providerId: 'piper',
  defaultModel: 'piper-en',
  defaultVoice: 'en_US-lessac',
  sampleRate: 22050,
  maxTextLength: 10000,
  languages: ['en'],
};