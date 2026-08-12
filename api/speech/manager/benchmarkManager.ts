import {
  BenchmarkResult,
  BenchmarkConfig,
  ProviderId,
  ModelId,
  VoiceId,
  SpeechError,
} from '../types.js';
import { ProviderManager, providerManager } from './providerManager.js';
import { emitBenchmarkCompleted, emitBenchmarkFailed } from '../events/speechEvents.js';
import { BENCHMARK_WARMUP_ITERATIONS, BENCHMARK_DEFAULT_ITERATIONS } from '../utils/constants.js';

/** Manages benchmarking */
export class BenchmarkManager {
  constructor(private readonly providerManager: ProviderManager) {}

  /** Runs benchmark for a provider/model */
  async runBenchmark(config: BenchmarkConfig): Promise<BenchmarkResult> {
    const provider = this.providerManager.getProvider(config.providerId);
    if (!provider) {
      throw new SpeechError(`Provider ${config.providerId} not found`, 'PROVIDER_NOT_FOUND');
    }

    const iterations = config.iterations || BENCHMARK_DEFAULT_ITERATIONS;
    const warmup = config.warmupIterations || BENCHMARK_WARMUP_ITERATIONS;

    try {
      for (let i = 0; i < warmup; i++) {
        await provider.benchmark({ ...config, iterations: 1 });
      }

      let totalLatency = 0;
      let totalLoadTime = 0;
      let totalMemory = 0;

      for (let i = 0; i < iterations; i++) {
        const result = await provider.benchmark({ ...config, iterations: 1 });
        totalLatency += result.latency;
        totalLoadTime += result.loadTime;
        totalMemory += result.memoryUsage;
      }

      const result: BenchmarkResult = {
        id: `bench_${Date.now()}`,
        providerId: config.providerId,
        modelId: config.modelId,
        voiceId: config.voiceId,
        type: 'tts',
        latency: totalLatency / iterations,
        loadTime: totalLoadTime / iterations,
        inferenceSpeed: 0,
        rtf: 0,
        memoryUsage: totalMemory / iterations,
        timestamp: new Date(),
      };

      emitBenchmarkCompleted(result);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      emitBenchmarkFailed(config.providerId, config.modelId, message);
      throw new SpeechError(`Benchmark failed: ${message}`, 'BENCHMARK_ERROR', config.providerId, error as Error);
    }
  }
  async getBenchmarkHistory(): Promise<BenchmarkResult[]> {
    return [];
  }
}
  
