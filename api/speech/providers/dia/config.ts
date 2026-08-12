import { ProviderId } from '../../types.js';

/** Dia provider configuration */
export interface DiaConfig {
  providerId: ProviderId;
  defaultModel: string;
  defaultVoice: string;
  sampleRate: number;
  maxTextLength: number;
  languages: string[];
}

export const defaultDiaConfig: DiaConfig = {
  providerId: 'dia',
  defaultModel: 'dia-1.6B',
  defaultVoice: 'default',
  sampleRate: 24000,
  maxTextLength: 10000,
  languages: ['en'],
};