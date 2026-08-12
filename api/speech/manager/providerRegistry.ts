import type {
  IBaseProvider,
  ProviderId,
} from "../types.js";

class ProviderRegistry {

  private providers =
    new Map<
      ProviderId,
      IBaseProvider
    >();

  register(
    provider: IBaseProvider
  ): void {

    this.providers.set(
      provider.id,
      provider
    );

  }

  unregister(
    id: ProviderId
  ): void {

    this.providers.delete(id);

  }

  get(
    id: ProviderId
  ): IBaseProvider | undefined {

    return this.providers.get(id);

  }

  getAll(): IBaseProvider[] {

    return [
      ...this.providers.values()
    ];

  }

  has(
    id: ProviderId
  ): boolean {

    return this.providers.has(id);

  }

  getTTSProviders() {

    return this.getAll().filter(
      provider =>
        provider.manifest.capabilities.tts
    );

  }

  getSTTProviders() {

    return this.getAll().filter(
      provider =>
        provider.manifest.capabilities.stt
    );

  }

  async initialize(): Promise<void> {

    for (
      const provider
      of this.providers.values()
    ) {

      try {

        await provider.initialize();

      } catch (err) {

        console.error(
          `[Speech] Failed to initialize ${provider.id}`,
          err
        );

      }

    }

  }

}

