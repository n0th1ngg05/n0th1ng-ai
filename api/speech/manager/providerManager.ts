import {
  IBaseProvider,
  ProviderManifest,
  ProviderId,
  ProviderHealth,
  SpeechError,
  VoiceManifest,
} from '../types.js';
import { ProviderStorage } from '../storage/providerStorage.js';
import { emitProviderInstalled, emitProviderRemoved, emitProviderEnabled, emitProviderDisabled } from '../events/providerEvents.js';

// NOTE: getWorkers/removeOfflineWorkers from '../../services/cluster.js' are
// imported LAZILY inside listVoices() below, not at module top level.
//
// cluster.ts pulls in toolExecutor.ts (executeClusterTool), which in turn
// imports python-runtime/client.ts, which imports toolExecutor.ts back —
// an existing circular value-import inside the tools subsystem. That cycle
// was previously never reachable from the speech module graph. A top-level
// `import ... from cluster.js` here made it reachable: boot.ts -> speech/
// index.ts -> speechManager.ts -> providerManager.ts -> cluster.ts -> ...,
// which is what caused Vite's SSR module runner to hang/timeout loading
// boot.ts (fetchModule invoke timeout).
//
// A dynamic import() defers resolution until listVoices() actually runs,
// after the initial module graph has already settled, so it can't
// contribute to a load-time cycle. Behavior is otherwise identical.

// ── Distributed voice aggregation ────────────────────────────────────────
// The Node speech layer talks to two kinds of speech runtimes:
//   1. The LOCAL runtime — providers registered directly in this process
//      (this.providers / this.getAllProviders()).
//   2. REMOTE WORKER runtimes — separate machines on the cluster that also
//      run a speech runtime and expose their own voice list over HTTP.
//
// The frontend must NEVER talk to workers directly (per architecture), so
// all merging happens here, inside listVoices(). The REST/tRPC contract
// (voices.ts) and the frontend (voice.js) are unchanged — they still just
// call listVoices() / GET /voices and get back an array of voice objects;
// the objects now simply carry extra `location` / `workers` metadata.

/** A voice as reported by a remote worker's /speech endpoint. */
interface RemoteVoiceManifest {
  id: string;
  modelId: string;
  providerId: ProviderId;
  name: string;
  language: string;
  gender: 'male' | 'female' | 'neutral';
  description?: string;
  sampleRate?: number;
  isDefault?: boolean;
}

export interface WorkerRef {
  id: string;
  hostname: string;
}

/** Voice shape returned to callers (REST/tRPC/frontend). Backward compatible
 *  superset of VoiceManifest — every original field is still present. */
export interface AggregatedVoiceManifest extends VoiceManifest {
  location: 'local' | 'worker' | 'local+worker';
  workers: WorkerRef[];
}

const WORKER_SPEECH_TIMEOUT_MS = 8000;

/**
 * Fetches the voice list from a single worker's speech runtime, reusing the
 * same proxy shape already used by ClusterHttpClient
 * (POST http://{ip}:{port}/speech, body: { method, url, body }).
 * Returns [] (never throws) if the worker is unreachable or errors —
 * callers simply skip an offline/broken worker rather than failing the
 * whole aggregation.
 */
async function fetchWorkerVoices(worker: {
  id: string;
  hostname: string;
  ip: string;
  port: number;
}): Promise<RemoteVoiceManifest[]> {

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WORKER_SPEECH_TIMEOUT_MS);

  try {

    const response = await fetch(
      `http://${worker.ip}:${worker.port}/speech`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'GET', url: '/voices' }),
        signal: controller.signal,
      }
    );

    if (!response.ok) {
      console.warn(`[Speech] Worker ${worker.hostname} /voices returned ${response.status}`);
      return [];
    }

    const data = await response.json() as unknown;

    // Accept either a raw array or { voices: [...] } — mirrors the local
    // listVoices() return shape flexibility.
    const voices = Array.isArray(data)
      ? data
      : (data as { voices?: unknown } | null)?.voices;

    return Array.isArray(voices) ? voices : [];

  } catch (err) {

    console.warn(`[Speech] Worker ${worker.hostname} voice fetch failed:`, err);
    return [];

  } finally {

    clearTimeout(timeout);

  }

}

/** Dedupe key: same provider + same voice id = same voice, regardless of
 *  which runtime(s) it's served from. */
function voiceKey(providerId: string, voiceId: string, modelId?: string): string {
  // modelId is included in the dedup key because some providers (e.g.
  // Chatterbox: chatterbox-tts + chatterbox-turbo) share the same cloned
  // reference voice across multiple models. Keying only on
  // (providerId, voiceId) collapsed those into a single Map entry,
  // silently dropping the copy for every model but whichever won
  // insertion order — which is why a cloned voice like "kerry_condon"
  // could show up under one model's dropdown but not another's even
  // though the worker reported it for both.
  return `${providerId}::${modelId ?? ''}::${voiceId}`;
}

/** Manages speech provider registration and lifecycle */
export class ProviderManager {
  private providers = new Map<ProviderId, IBaseProvider>();
  private enabled = new Set<ProviderId>();
  private storage: ProviderStorage;

  constructor() {
    this.storage = new ProviderStorage();
  }

  private isInitialized(provider: IBaseProvider): boolean {
    const maybeInit = (provider as { isInitialized?: () => boolean }).isInitialized;
    return typeof maybeInit === 'function' ? maybeInit.call(provider) : false;
  }

  /** Registers a provider */
  async registerProvider(provider: IBaseProvider): Promise<void> {
    console.log(
    `[Speech] ProviderManager -> Registered ${provider.id}`
);
    if (this.providers.has(provider.id)) {
      throw new SpeechError(`Provider ${provider.id} already registered`, 'PROVIDER_EXISTS');
    }
    this.providers.set(provider.id, provider);
    await this.storage.save(provider.manifest);
    emitProviderInstalled(provider.id, provider.manifest);
  }

  /** Unregisters a provider */
  async unregisterProvider(id: ProviderId): Promise<void> {
    const provider = this.providers.get(id);
    if (!provider) {
      throw new SpeechError(`Provider ${id} not found`, 'PROVIDER_NOT_FOUND');
    }

    if (this.isInitialized(provider)) {
      await provider.shutdown();
    }

    this.providers.delete(id);
    this.enabled.delete(id);
    await this.storage.delete(id);
    emitProviderRemoved(id);
  }

  /** Gets a provider by ID */
  getProvider(id: ProviderId): IBaseProvider | undefined {
    return this.providers.get(id);
  }

  /** Gets all registered providers */
  getAllProviders(): IBaseProvider[] {
    return Array.from(this.providers.values());
  }

  /** Gets all enabled providers */
  getEnabledProviders(): IBaseProvider[] {
    return this.getAllProviders().filter((p) => this.enabled.has(p.id));
  }

  /** Enables a provider */
  async enableProvider(id: ProviderId): Promise<void> {
    const provider = this.providers.get(id);
    if (!provider) {
      throw new SpeechError(`Provider ${id} not found`, 'PROVIDER_NOT_FOUND');
    }

    if (!this.isInitialized(provider)) {
      await provider.initialize();
    }

    this.enabled.add(id);
    emitProviderEnabled(id);
  }

  /** Disables a provider */
  async disableProvider(id: ProviderId): Promise<void> {
    const provider = this.providers.get(id);
    if (provider && this.isInitialized(provider)) {
      await provider.shutdown();
    }

    this.enabled.delete(id);
    emitProviderDisabled(id);
  }

  /** Checks if provider is enabled */
  isEnabled(id: ProviderId): boolean {
    return this.enabled.has(id);
  }

  /** Gets provider manifest */
  async getManifest(id: ProviderId): Promise<ProviderManifest | undefined> {
    return this.storage.get(id);
  }

  /** Gets all manifests */
  async getAllManifests(): Promise<ProviderManifest[]> {
    return this.storage.getAll();
  }

  /** Gets all provider manifests from the registry */
  listProviders(): ProviderManifest[] {
    return this.getAllProviders().map((provider) => provider.manifest);
  }

  /**
   * Gets all voices, optionally filtered by provider and model.
   *
   * Aggregates voices from the LOCAL runtime and every ONLINE worker that
   * has a speech runtime, deduping any voice that exists on more than one
   * runtime into a single entry with merged `location`/`workers` metadata.
   * A worker that's offline or unreachable is simply skipped — it never
   * fails the whole call.
   *
   * Signature and return type stay a superset of the original
   * (AggregatedVoiceManifest extends VoiceManifest), so every existing
   * caller (voices.ts, frontend) keeps working unchanged.
   */
  async listVoices(providerId?: ProviderId, modelId?: string): Promise<AggregatedVoiceManifest[]> {
    const providers = providerId ? [this.getProvider(providerId)].filter(Boolean) as IBaseProvider[] : this.getAllProviders();

    // ── Local voices ──────────────────────────────────────────────────────
    const localVoiceLists = await Promise.all(providers.map((provider) => provider.listVoices()));
    const localVoices = localVoiceLists.flat();

    // ── Remote worker voices ─────────────────────────────────────────────
    // Lazily import cluster.ts here (see the top-of-file note) instead of
    // at module load time, to avoid contributing to the tools subsystem's
    // circular import chain during boot.
    const { getWorkers, removeOfflineWorkers } = await import('../../services/cluster.js');

    // Purge stale entries first (same convention as executeClusterTool in
    // cluster.ts) so a worker whose heartbeat has timed out isn't queried
    // and made to wait out the full timeout for nothing.
    removeOfflineWorkers();

    // Only workers that are online AND report a speech runtime are queried.
    // Any worker that fails to respond in time is skipped (see
    // fetchWorkerVoices — it never throws).
    const speechWorkers = getWorkers().filter(
      (w) => w.online && w.runtimes?.speech
    );

    const remoteResults = await Promise.all(
      speechWorkers.map(async (worker) => ({
        worker: { id: worker.id, hostname: worker.hostname } as WorkerRef,
        voices: await fetchWorkerVoices(worker),
      }))
    );

    // ── Merge + dedupe ───────────────────────────────────────────────────
    const merged = new Map<string, AggregatedVoiceManifest>();

    for (const voice of localVoices) {
      const key = voiceKey(voice.providerId, voice.id, voice.modelId);
      merged.set(key, {
        ...voice,
        location: 'local',
        workers: [],
      });
    }

    for (const { worker, voices } of remoteResults) {
      for (const voice of voices) {

        if (providerId && voice.providerId !== providerId) continue;

        const key = voiceKey(voice.providerId, voice.id, voice.modelId);
        const existing = merged.get(key);

        if (existing) {
          // Already present (local, or from a different worker) — merge in
          // this worker and upgrade location if needed.
          if (!existing.workers.some((w) => w.id === worker.id)) {
            existing.workers.push(worker);
          }
          existing.location = existing.location === 'local' || existing.location === 'local+worker'
            ? 'local+worker'
            : 'worker';
        } else {
          merged.set(key, {
            id: voice.id,
            modelId: voice.modelId,
            providerId: voice.providerId,
            name: voice.name,
            language: voice.language,
            gender: voice.gender,
            description: voice.description ?? '',
            sampleRate: voice.sampleRate ?? 0,
            isDefault: voice.isDefault ?? false,
            location: 'worker',
            workers: [worker],
          });
        }

      }
    }

    const allVoices = [...merged.values()];

    return modelId ? allVoices.filter((voice) => voice.modelId === modelId) : allVoices;
  }

  /** Gets a specific voice by provider, model, and voice ID */
  async getVoice(providerId: ProviderId, modelId: string, voiceId: string): Promise<import('../types.js').VoiceManifest | undefined> {
    const provider = this.getProvider(providerId);
    if (!provider) {
      throw new SpeechError(`Provider ${providerId} not found`, 'PROVIDER_NOT_FOUND');
    }

    const voices = await provider.listVoices();
    return voices.find((voice) => voice.modelId === modelId && voice.id === voiceId);
  }

  /** Searches voices across all providers */
  async searchVoices(query: string): Promise<AggregatedVoiceManifest[]> {
    const voices = await this.listVoices();
    const normalized = query.trim().toLowerCase();
    return voices.filter((voice) =>
      voice.name.toLowerCase().includes(normalized) ||
      voice.id.toLowerCase().includes(normalized) ||
      voice.language.toLowerCase().includes(normalized)
    );
  }

  /** Initializes all registered providers */
  async initialize(): Promise<void> {
    const manifests = await this.storage.getAll();

    console.log(`[Speech] Restoring ${manifests.length} provider(s)...`);

    for (const manifest of manifests) {
      const provider = this.providers.get(manifest.id);
      if (!provider) {
        continue;
      }

      try {
        if (!this.isInitialized(provider)) {
          await provider.initialize();
        }

        console.log(`[Speech] Provider ready: ${provider.id}`);
      } catch (err) {
        console.error(`[Speech] Failed to initialize provider ${provider.id}:`, err);
      }
    }
  }

  /** Returns health for all providers */
  async getHealth(): Promise<ProviderHealth[]> {
    const results: ProviderHealth[] = [];
    for (const provider of this.providers.values()) {
      try {
        results.push(await provider.health());
      } catch {
        results.push({ providerId: provider.id, status: 'unhealthy', models: 0, error: 'Health check failed' });
      }
    }
    return results;
  }

  /** Returns health for a specific provider */
  async health(id: ProviderId): Promise<ProviderHealth>;
  async health(): Promise<ProviderHealth[]>;
  async health(id?: ProviderId): Promise<ProviderHealth | ProviderHealth[]> {
    if (id) {
      const provider = this.getProvider(id);
      if (!provider) {
        throw new SpeechError(`Provider ${id} not found`, 'PROVIDER_NOT_FOUND');
      }

      try {
        return await provider.health();
      } catch {
        return { providerId: provider.id, status: 'unhealthy', models: 0, error: 'Health check failed' };
      }
    }

    return this.getHealth();
  }
}