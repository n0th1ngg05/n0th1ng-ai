import { ProviderId } from '../../types.js';

/** Fish Speech provider configuration */
export interface FishSpeechConfig {
  providerId: ProviderId;
  defaultModel: string;
  defaultVoice: string;
  sampleRate: number;
  maxTextLength: number;
  languages: string[];
}

export const defaultFishSpeechConfig: FishSpeechConfig = {
  providerId: 'fishspeech',
  defaultModel: 'fishspeech-v1',
  defaultVoice: 'default',
  sampleRate: 44100,
  maxTextLength: 10000,
  languages: ['en', 'zh', 'ja'],
};