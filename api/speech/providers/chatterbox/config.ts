import { ProviderId } from '../../types.js';

/** Chatterbox provider configuration */
export interface ChatterboxConfig {
  providerId: ProviderId;
  defaultModel: string;
  defaultVoice: string;
  sampleRate: number;
  maxTextLength: number;
  languages: string[];
}

export const defaultChatterboxConfig: ChatterboxConfig = {
  providerId: 'chatterbox',
  defaultModel: 'chatterbox-1',
  defaultVoice: 'default',
  sampleRate: 24000,
  maxTextLength: 10000,
  languages: ['en'],
};