import { VoiceProfile, ProviderId, ModelId, VoiceId, ProfileId } from '../types.js';

/** Template for custom voice profiles */
export function createCustomProfile(
  name: string,
  providerId: ProviderId,
  modelId: ModelId,
  voiceId: VoiceId
): VoiceProfile {
  return {
    id: `profile_custom_${Date.now()}` as ProfileId,
    name,
    providerId,
    modelId,
    voiceId,
    speed: 1.0,
    pitch: 1.0,
    temperature: 0.7,
    volume: 1.0,
    emotion: 'neutral',
    language: 'en',
    isDefault: false,
    isBuiltIn: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}