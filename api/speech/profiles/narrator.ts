import { VoiceProfile, ProviderId, ModelId, VoiceId, ProfileId } from '../types.js';

/** Built-in Narrator voice profile */
export const narratorProfile: VoiceProfile = {
  id: 'profile_narrator' as ProfileId,
  name: 'Narrator',
  providerId: 'piper' as ProviderId,
  modelId: 'piper-en' as ModelId,
  voiceId: 'en_US-lessac' as VoiceId,
  speed: 0.95,
  pitch: 1.0,
  temperature: 0.6,
  volume: 1.0,
  emotion: 'calm',
  language: 'en',
  isDefault: false,
  isBuiltIn: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};