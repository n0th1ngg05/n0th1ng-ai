import { ProviderManifest, IProviderStorage, ProviderId } from '../types.js';
import { getProviderPath } from '../utils/pathUtils.js';
import { ensureDir, readJsonFile, writeJsonFile, fileExists, listFiles } from '../utils/fileUtils.js';
import { sanitizeFilename } from '../utils/pathUtils.js';

/** File-based provider storage implementation */
export class ProviderStorage implements IProviderStorage {
  private readonly manifestFile = 'manifest.json';

  /** Gets all stored provider manifests */
  async getAll(): Promise<ProviderManifest[]> {
    const providersPath = getProviderPath('');
    if (!(await fileExists(providersPath))) return [];
    const dirs = await listFiles(providersPath);
    const manifests: ProviderManifest[] = [];
    for (const dir of dirs) {
      try {
        const manifest = await readJsonFile<ProviderManifest>(`${dir}/${this.manifestFile}`);
        manifests.push(manifest);
      } catch { /* skip invalid */ }
    }
    return manifests;
  }

  /** Gets a provider manifest by ID */
  async get(id: ProviderId): Promise<ProviderManifest | undefined> {
    const path = `${getProviderPath(sanitizeFilename(id))}/${this.manifestFile}`;
    if (!(await fileExists(path))) return undefined;
    try {
      return await readJsonFile<ProviderManifest>(path);
    } catch {
      return undefined;
    }
  }

  /** Saves a provider manifest */
  async save(manifest: ProviderManifest): Promise<void> {
    const dir = getProviderPath(sanitizeFilename(manifest.id));
    await ensureDir(dir);
    await writeJsonFile(`${dir}/${this.manifestFile}`, manifest);
  }

  /** Deletes a provider manifest */
  async delete(id: ProviderId): Promise<void> {
    const dir = getProviderPath(sanitizeFilename(id));
    const { removePath } = await import('../utils/fileUtils.js');
    await removePath(dir);
  }
}