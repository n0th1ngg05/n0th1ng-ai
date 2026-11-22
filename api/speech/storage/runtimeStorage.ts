import { RuntimeConfig, IRuntimeStorage, RuntimeId, ProviderId } from '../types.js';
import { getRuntimeStoragePath } from '../utils/pathUtils.js';
import { ensureDir, readJsonFile, writeJsonFile, fileExists, listFiles, removePath } from '../utils/fileUtils.js';

/** File-based runtime configuration storage */
export class RuntimeStorage implements IRuntimeStorage {
  private readonly storageDir = getRuntimeStoragePath();

  private getFilePath(id: string): string {
    return `${this.storageDir}/${id}.json`;
  }

  /** Gets all runtime configs */
  async getAll(): Promise<RuntimeConfig[]> {
    if (!(await fileExists(this.storageDir))) return [];
    const files = await listFiles(this.storageDir);
    const configs: RuntimeConfig[] = [];
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const config = await readJsonFile<RuntimeConfig>(file);
        configs.push(config);
      } catch { /* skip invalid */ }
    }
    return configs;
  }

  /** Gets a runtime config by ID */
  async get(id: RuntimeId): Promise<RuntimeConfig | undefined> {
    const path = this.getFilePath(id);
    if (!(await fileExists(path))) return undefined;
    try {
      return await readJsonFile<RuntimeConfig>(path);
    } catch {
      return undefined;
    }
  }

  /** Gets runtime config by provider */
  async getByProvider(providerId: ProviderId): Promise<RuntimeConfig | undefined> {
    const all = await this.getAll();
    return all.find((c) => c.providerId === providerId);
  }

  /** Saves a runtime config */
  async save(config: RuntimeConfig): Promise<void> {
    await ensureDir(this.storageDir);
    await writeJsonFile(this.getFilePath(config.id), config);
  }

  /** Deletes a runtime config */
  async delete(id: RuntimeId): Promise<void> {
    const path = this.getFilePath(id);
    if (await fileExists(path)) {
      await removePath(path);
    }
  }
}