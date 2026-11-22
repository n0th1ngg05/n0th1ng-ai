import { ModelManifest, IModelStorage, ModelId, ProviderId } from '../types.js';
import { getModelPath } from '../utils/pathUtils.js';
import { ensureDir, readJsonFile, writeJsonFile, fileExists, listFiles, removePath } from '../utils/fileUtils.js';
import { sanitizeFilename } from '../utils/pathUtils.js';

/** File-based model storage implementation */
export class ModelStorage implements IModelStorage {
  private readonly manifestFile = 'model.json';

  /** Gets all stored model manifests */
  async getAll(): Promise<ModelManifest[]> {
    const providersPath = getModelPath('', '');
    if (!(await fileExists(providersPath))) return [];
    const models: ModelManifest[] = [];
    const providerDirs = await listFiles(providersPath);
    for (const pDir of providerDirs) {
      const modelDirs = await listFiles(pDir);
      for (const mDir of modelDirs) {
        try {
          const model = await readJsonFile<ModelManifest>(`${mDir}/${this.manifestFile}`);
          models.push(model);
        } catch { /* skip invalid */ }
      }
    }
    return models;
  }

  /** Gets a model manifest by ID */
  async get(id: ModelId): Promise<ModelManifest | undefined> {
    const all = await this.getAll();
    return all.find((m) => m.id === id);
  }

  /** Gets models by provider */
  async getByProvider(providerId: ProviderId): Promise<ModelManifest[]> {
    const path = getModelPath(sanitizeFilename(providerId), '');
    if (!(await fileExists(path))) return [];
    const models: ModelManifest[] = [];
    const dirs = await listFiles(path);
    for (const dir of dirs) {
      try {
        const model = await readJsonFile<ModelManifest>(`${dir}/${this.manifestFile}`);
        models.push(model);
      } catch { /* skip invalid */ }
    }
    return models;
  }

  /** Saves a model manifest */
  async save(model: ModelManifest): Promise<void> {
    const dir = getModelPath(sanitizeFilename(model.providerId), sanitizeFilename(model.id));
    await ensureDir(dir);
    await writeJsonFile(`${dir}/${this.manifestFile}`, model);
  }

  /** Deletes a model manifest */
  async delete(id: ModelId): Promise<void> {
    const model = await this.get(id);
    if (!model) return;
    const dir = getModelPath(sanitizeFilename(model.providerId), sanitizeFilename(id));
    await removePath(dir);
  }
}