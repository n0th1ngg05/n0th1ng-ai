import { VoiceProfile, ProviderId, ModelId, VoiceId, ProfileId } from '../types.js';

/** Built-in Assistant voice profile */
export const assistantProfile: VoiceProfile = {
  id: 'profile_assistant' as ProfileId,
  name: 'Assistant',
  providerId: 'kokoro' as ProviderId,
  modelId: 'kokoro-82M' as ModelId,
  voiceId: 'af_bella' as VoiceId,
  speed: 1.0,
  pitch: 1.0,
  temperature: 0.7,
  volume: 0.9,
  emotion: 'neutral',
  language: 'en',
  isDefault: true,
  isBuiltIn: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};