import { VoiceProfile, ProviderId, ModelId, VoiceId, ProfileId } from '../types.js';

/** Built-in Corporate voice profile */
export const corporateProfile: VoiceProfile = {
  id: 'profile_corporate' as ProfileId,
  name: 'Corporate',
  providerId: 'dia' as ProviderId,
  modelId: 'dia-1.6B' as ModelId,
  voiceId: 'default' as VoiceId,
  speed: 1.0,
  pitch: 1.0,
  temperature: 0.5,
  volume: 0.95,
  emotion: 'professional',
  language: 'en',
  isDefault: false,
  isBuiltIn: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};