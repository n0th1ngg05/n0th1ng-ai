import {
  ModelManifest,
  ModelId,
  ProviderId,
  ModelStatus,
  SpeechError,
} from '../types.js';
import { ModelStorage } from '../storage/modelStorage.js';
import { ProviderManager } from './providerManager.js';

/** Manages speech model lifecycle */
export class ModelManager {
  private storage: ModelStorage;

  constructor(private readonly providerManager: ProviderManager) {
    this.storage = new ModelStorage();
  }

  /** Restores model registry on startup */
async initialize(): Promise<void> {

    const models = await this.storage.getAll();

    console.log(`[Speech] Restoring ${models.length} model(s)...`);

    for (const model of models) {
      if (model.status === ModelStatus.INSTALLED) {
        const valid = await this.verifyModel(model.id);

        if (!valid) {
          console.warn(`[Speech] Missing model files: ${model.id}`);
          model.status = ModelStatus.AVAILABLE;
          await this.storage.save(model);
        }
      }
    }
  }

  async isInstalled(id: ModelId): Promise<boolean> {
    const model = await this.storage.get(id);
    return !!model && model.status === ModelStatus.INSTALLED;
  }

  /** Lists all models */
  async listModels(): Promise<ModelManifest[]> {
    return this.getAllModels();
  }

  /** Lists installed models */
  async listInstalledModels(): Promise<ModelManifest[]> {
    return this.getInstalledModels();
  }

  /** Lists downloadable models */
  async listDownloadableModels(): Promise<ModelManifest[]> {
    return this.getAvailableModels();
  }

  /** Installs a model by ID or manifest */
  async installModel(modelOrId: ModelManifest | ModelId): Promise<void> {
    const model = typeof modelOrId === 'string' ? await this.getModel(modelOrId) : modelOrId;
    if (!model) {
      throw new SpeechError(`Model ${typeof modelOrId === 'string' ? modelOrId : modelOrId.id} not found`, 'MODEL_NOT_FOUND');
    }

    model.status = ModelStatus.INSTALLED;
    model.installedPath = `data/speech/providers/${model.providerId}/models/${model.id}`;
    await this.storage.save(model);
  }

  /** Uninstalls a model by ID */
  async uninstallModel(id: ModelId): Promise<void> {
    await this.deleteModel(id);
  }

  /** Updates model metadata or status */
  async updateModel(id: ModelId): Promise<void> {
    const model = await this.getModel(id);
    if (!model) {
      throw new SpeechError(`Model ${id} not found`, 'MODEL_NOT_FOUND');
    }
    await this.storage.save(model);
  }

  /** Validates whether a model is installed and available */
  async validateModel(id: ModelId): Promise<boolean> {
    return this.verifyModel(id);
  }

  async getAllModels(): Promise<ModelManifest[]> {
    return this.storage.getAll();
  }

  /** Gets model by ID */
  async getModel(id: ModelId): Promise<ModelManifest | undefined> {
    return this.storage.get(id);
  }

  /** Gets models by provider */
  async getModelsByProvider(providerId: ProviderId): Promise<ModelManifest[]> {
    return this.storage.getByProvider(providerId);
  }

  /** Gets installed models */
  async getInstalledModels(): Promise<ModelManifest[]> {
    const all = await this.getAllModels();
    return all.filter((m) => m.status === ModelStatus.INSTALLED);
  }

  /** Gets available models for download */
  async getAvailableModels(): Promise<ModelManifest[]> {
    const all = await this.getAllModels();
    return all.filter((m) => m.status === ModelStatus.AVAILABLE);
  }

  /** Deletes a model */
  async deleteModel(id: ModelId): Promise<void> {
    const model = await this.storage.get(id);
    if (!model) {
      throw new SpeechError(`Model ${id} not found`, 'MODEL_NOT_FOUND');
    }
    await this.storage.delete(id);
  }

  /** Updates model status */
  async updateModelStatus(id: ModelId, status: ModelStatus): Promise<void> {
    const model = await this.storage.get(id);
    if (!model) {
      throw new SpeechError(`Model ${id} not found`, 'MODEL_NOT_FOUND');
    }
    model.status = status;
    await this.storage.save(model);
  }

  /** Verifies model installation */
  async verifyModel(id: ModelId): Promise<boolean> {
    const model = await this.storage.get(id);
    if (!model || !model.installedPath) return false;
    const { fileExists } = await import('../utils/fileUtils.js');
    return fileExists(model.installedPath);
  }
}


