import {
  VoiceProfile,
  ProfileId,
  ProviderId,
  ModelId,
  VoiceId,
  SpeechError,
} from '../types.js';
import { ProfileStorage } from '../storage/profileStorage.js';
import { emitProfileCreated, emitProfileUpdated, emitProfileDeleted } from '../events/speechEvents.js';
import { assistantProfile, narratorProfile, roboticProfile, corporateProfile, friendlyProfile } from '../profiles/index.js';
import { sanitizeProfileValues, validateVoiceProfile } from '../utils/validation.js';

/** Manages voice profiles */
export class ProfileManager {
  private storage: ProfileStorage;
  private builtInProfiles: VoiceProfile[];

  constructor() {
    this.storage = new ProfileStorage();
    this.builtInProfiles = [assistantProfile, narratorProfile, roboticProfile, corporateProfile, friendlyProfile];
  }

  /** Initializes built-in profiles */
  async initialize(): Promise<void> {
    for (const profile of this.builtInProfiles) {
      const existing = await this.storage.get(profile.id);
      if (!existing) {
        await this.storage.save(profile);
      }
    }
  }

  /** Creates a new profile */
  async createProfile(profile: Omit<VoiceProfile, 'id' | 'createdAt' | 'updatedAt'>): Promise<VoiceProfile> {
    validateVoiceProfile(profile);
    const sanitized = sanitizeProfileValues(profile as Record<string, unknown>);
    const newProfile: VoiceProfile = {
      ...profile,
      ...sanitized,
      id: `profile_${Date.now()}` as ProfileId,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await this.storage.save(newProfile);
    emitProfileCreated({ profile: newProfile });
    return newProfile;
  }

  /** Gets a profile by ID */
  async getProfile(id: ProfileId): Promise<VoiceProfile | undefined> {
    return this.storage.get(id);
  }

  /** Gets all profiles */
  async getAllProfiles(): Promise<VoiceProfile[]> {
    return this.storage.getAll();
  }

  /** Lists all profiles */
  async listProfiles(): Promise<VoiceProfile[]> {
    return this.getAllProfiles();
  }

  /** Duplicates an existing profile with a new name */
  async duplicateProfile(id: ProfileId, name: string): Promise<VoiceProfile> {
    const existing = await this.getProfile(id);
    if (!existing) {
      throw new SpeechError(`Profile ${id} not found`, 'PROFILE_NOT_FOUND');
    }

    const duplicate: VoiceProfile = {
      ...existing,
      id: `profile_${Date.now()}` as ProfileId,
      name,
      isDefault: false,
      isBuiltIn: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await this.storage.save(duplicate);
    emitProfileCreated({ profile: duplicate });
    return duplicate;
  }

  /** Sets the default profile */
  async setDefaultProfile(id: ProfileId): Promise<void> {
    const profile = await this.getProfile(id);
    if (!profile) {
      throw new SpeechError(`Profile ${id} not found`, 'PROFILE_NOT_FOUND');
    }

    const allProfiles = await this.getAllProfiles();
    for (const existing of allProfiles) {
      if (existing.id === id && !existing.isDefault) {
        existing.isDefault = true;
        existing.updatedAt = new Date();
        await this.storage.save(existing);
      } else if (existing.isDefault && existing.id !== id) {
        existing.isDefault = false;
        existing.updatedAt = new Date();
        await this.storage.save(existing);
      }
    }
  }

  /** Gets the default profile */
  async getDefaultProfile(): Promise<VoiceProfile | undefined> {
    return this.storage.getDefault();
  }

  /** Gets profiles by provider */
  async getProfilesByProvider(providerId: ProviderId): Promise<VoiceProfile[]> {
    return this.storage.getByProvider(providerId);
  }

  /** Updates a profile */
  async updateProfile(id: ProfileId, updates: Partial<VoiceProfile>): Promise<VoiceProfile> {
    const existing = await this.storage.get(id);
    if (!existing) {
      throw new SpeechError(`Profile ${id} not found`, 'PROFILE_NOT_FOUND');
    }
    const updated: VoiceProfile = {
      ...existing,
      ...updates,
      id: existing.id,
      updatedAt: new Date(),
    };
    validateVoiceProfile(updated);
    await this.storage.save(updated);
    emitProfileUpdated({ profile: updated });
    return updated;
  }

  /** Deletes a profile */
  async deleteProfile(id: ProfileId): Promise<void> {
    const existing = await this.storage.get(id);
    if (!existing) {
      throw new SpeechError(`Profile ${id} not found`, 'PROFILE_NOT_FOUND');
    }
    if (existing.isBuiltIn) {
      throw new SpeechError('Cannot delete built-in profile', 'PROFILE_PROTECTED');
    }
    await this.storage.delete(id);
    emitProfileDeleted({ profileId: id });
  }

  /** Resolves profile for a request */
  async resolveProfile(profileId?: ProfileId, providerId?: ProviderId, modelId?: ModelId, voiceId?: VoiceId): Promise<VoiceProfile> {
    if (profileId) {
      const profile = await this.getProfile(profileId);
      if (profile) return profile;
    }
    if (providerId && modelId && voiceId) {
      return {
        id: 'temp' as ProfileId,
        name: 'Temporary',
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
    const defaultProfile = await this.getDefaultProfile();
    if (defaultProfile) return defaultProfile;
    throw new SpeechError('No profile could be resolved', 'PROFILE_NOT_FOUND');
  }
}


