import { VoiceProfile, ProviderId, ModelId, VoiceId, ProfileId } from '../types.js';

/** Built-in Friendly voice profile */
export const friendlyProfile: VoiceProfile = {
  id: 'profile_friendly' as ProfileId,
  name: 'Friendly',
  providerId: 'fishspeech' as ProviderId,
  modelId: 'fishspeech-v1' as ModelId,
  voiceId: 'default' as VoiceId,
  speed: 1.05,
  pitch: 1.05,
  temperature: 0.75,
  volume: 0.9,
  emotion: 'happy',
  language: 'en',
  isDefault: false,
  isBuiltIn: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};