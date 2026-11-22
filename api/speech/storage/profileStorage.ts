import { VoiceProfile, IProfileStorage, ProfileId, ProviderId } from '../types.js';
import { getProfileStoragePath } from '../utils/pathUtils.js';
import { ensureDir, readJsonFile, writeJsonFile, fileExists, listFiles, removePath } from '../utils/fileUtils.js';

/** File-based profile storage implementation */
export class ProfileStorage implements IProfileStorage {
  private readonly storageDir = getProfileStoragePath();

  private getFilePath(id: string): string {
    return `${this.storageDir}/${id}.json`;
  }

  /** Gets all stored profiles */
  async getAll(): Promise<VoiceProfile[]> {
    if (!(await fileExists(this.storageDir))) return [];
    const files = await listFiles(this.storageDir);
    const profiles: VoiceProfile[] = [];
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const profile = await readJsonFile<VoiceProfile>(file);
        profiles.push(profile);
      } catch { /* skip invalid */ }
    }
    return profiles;
  }

  /** Gets a profile by ID */
  async get(id: ProfileId): Promise<VoiceProfile | undefined> {
    const path = this.getFilePath(id);
    if (!(await fileExists(path))) return undefined;
    try {
      return await readJsonFile<VoiceProfile>(path);
    } catch {
      return undefined;
    }
  }

  /** Gets the default profile */
  async getDefault(): Promise<VoiceProfile | undefined> {
    const all = await this.getAll();
    return all.find((p) => p.isDefault) || all[0];
  }

  /** Gets profiles by provider */
  async getByProvider(providerId: ProviderId): Promise<VoiceProfile[]> {
    const all = await this.getAll();
    return all.filter((p) => p.providerId === providerId);
  }

  /** Saves a profile */
  async save(profile: VoiceProfile): Promise<void> {
    await ensureDir(this.storageDir);
    await writeJsonFile(this.getFilePath(profile.id), profile);
  }

  /** Deletes a profile */
  async delete(id: ProfileId): Promise<void> {
    const path = this.getFilePath(id);
    if (await fileExists(path)) {
      await removePath(path);
    }
  }
}