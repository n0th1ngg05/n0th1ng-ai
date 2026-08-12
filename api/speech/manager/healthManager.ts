import {
  HealthReport,
  ProviderHealth,
  RuntimeHealth,
  ModelHealth,
  DeviceHealth,
  SpeechError,
} from '../types.js';
import { ProviderManager } from './providerManager.js';
import { RuntimeManager } from './runtimeManager.js';
import { ModelManager } from './modelManager.js';
import { DeviceManager } from './deviceManager.js';

/** Monitors system health */
export class HealthManager {
  constructor(
    private readonly providerManager: ProviderManager,
    private readonly runtimeManager: RuntimeManager,
    private readonly modelManager: ModelManager,
    private readonly deviceManager: DeviceManager
  ) {}

  /** Initializes the health subsystem */
async initialize(): Promise<void> {

  console.log(
    "[Speech] Running startup health checks..."
  );

  try {

    await this.getHealthReport();

    console.log(
      "[Speech] Health checks completed."
    );

  } catch (err) {

    console.error(
      "[Speech] Health initialization failed:",
      err
    );

  }

}

  /** Gets complete health report */
  async getHealthReport(): Promise<HealthReport> {
    const [providers, runtimes, models, devices] = await Promise.all([
      this.getProviderHealth(),
      this.getRuntimeHealth(),
      this.getModelHealth(),
      this.getDeviceHealth(),
    ]);

    const overall = this.calculateOverallHealth(providers, runtimes, models, devices);

    return {
      overall,
      providers,
      runtimes,
      models,
      devices,
      timestamp: new Date(),
    };
  }

  private async getProviderHealth(): Promise<ProviderHealth[]> {
    return this.providerManager.getHealth();
  }

  private getRuntimeHealth(): RuntimeHealth[] {
    return this.runtimeManager.getAllRuntimes().map((r) => r.health());
  }

  private async getModelHealth(): Promise<ModelHealth[]> {
    const installed = await this.modelManager.getInstalledModels();
    const health: ModelHealth[] = [];
    for (const model of installed) {
      const valid = await this.modelManager.verifyModel(model.id);
      health.push({
        modelId: model.id,
        providerId: model.providerId,
        status: valid ? 'healthy' : 'corrupted',
      });
    }
    return health;
  }

  private async getDeviceHealth(): Promise<DeviceHealth[]> {
    const mics = await this.deviceManager.listMicrophones();
    const speakers = await this.deviceManager.listSpeakers();
    return [
      ...mics.map((d) => ({ deviceId: d.id, type: 'microphone' as const, status: 'available' as const })),
      ...speakers.map((d) => ({ deviceId: d.id, type: 'speaker' as const, status: 'available' as const })),
    ];
  }

  private calculateOverallHealth(
    providers: ProviderHealth[],
    runtimes: RuntimeHealth[],
    models: ModelHealth[],
    devices: DeviceHealth[]
  ): HealthReport['overall'] {
    const allHealthy = [...providers, ...runtimes.map((r) => ({ status: r.status === 'running' ? 'healthy' : 'unhealthy' as const })), ...models, ...devices]
      .every((h) => h.status === 'healthy' || h.status === 'available');
    const anyUnhealthy = [...providers, ...runtimes.map((r) => ({ status: r.status === 'running' ? 'healthy' : 'unhealthy' as const })), ...models, ...devices]
      .some((h) => h.status === 'unhealthy' || h.status === 'corrupted' || h.status === 'error');
    if (allHealthy) return 'healthy';
    if (anyUnhealthy) return 'degraded';
    return 'unhealthy';
  }
}