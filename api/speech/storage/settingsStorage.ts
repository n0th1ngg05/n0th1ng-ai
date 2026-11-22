import { ISettingsStorage } from '../types.js';
import { getSettingsPath } from '../utils/pathUtils.js';
import { ensureDir, readJsonFile, writeJsonFile, fileExists } from '../utils/fileUtils.js';

/** File-based settings storage */
export class SettingsStorage implements ISettingsStorage {
  private readonly filePath = getSettingsPath();
  private cache: Record<string, unknown> = {};

  /** Gets a setting value */
  async get<T>(key: string): Promise<T | undefined> {
    await this.load();
    return this.cache[key] as T | undefined;
  }

  /** Sets a setting value */
  async set<T>(key: string, value: T): Promise<void> {
    await this.load();
    this.cache[key] = value;
    await this.persist();
  }

  /** Deletes a setting */
  async delete(key: string): Promise<void> {
    await this.load();
    delete this.cache[key];
    await this.persist();
  }

  /** Gets all settings */
  async getAll(): Promise<Record<string, unknown>> {
    await this.load();
    return { ...this.cache };
  }

  private async load(): Promise<void> {
    if (Object.keys(this.cache).length > 0) return;
    if (await fileExists(this.filePath)) {
      try {
        this.cache = await readJsonFile<Record<string, unknown>>(this.filePath);
      } catch {
        this.cache = {};
      }
    }
  }

  private async persist(): Promise<void> {
    await ensureDir(this.filePath);
    await writeJsonFile(this.filePath, this.cache);
  }
}