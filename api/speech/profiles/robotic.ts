import { VoiceProfile, ProviderId, ModelId, VoiceId, ProfileId } from '../types.js';

/** Built-in Robotic voice profile */
export const roboticProfile: VoiceProfile = {
  id: 'profile_robotic' as ProfileId,
  name: 'Robotic',
  providerId: 'xtts' as ProviderId,
  modelId: 'xtts-v2' as ModelId,
  voiceId: 'default' as VoiceId,
  speed: 1.1,
  pitch: 0.8,
  temperature: 0.3,
  volume: 0.85,
  emotion: 'neutral',
  language: 'en',
  isDefault: false,
  isBuiltIn: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};