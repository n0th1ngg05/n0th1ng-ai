import { speechEvents } from './emitter.js';
import { RequestId, ProviderId, TTSResponse, STTResponse, BenchmarkResult, ModelId } from '../types.js';

/** Emits speech generation success event */
export function emitSpeechGenerated(requestId: RequestId, providerId: ProviderId, duration: number): void {
  speechEvents.emit('speech:generated', { requestId, providerId, duration });
}

/** Emits speech generation failure event */
export function emitSpeechFailed(requestId: RequestId, providerId: ProviderId, error: string): void {
  speechEvents.emit('speech:failed', { requestId, providerId, error });
}

/** Emits benchmark completion event */
export function emitBenchmarkCompleted(result: BenchmarkResult): void {
  speechEvents.emit('benchmark:completed', { result });
}

/** Emits benchmark failure event */
export function emitBenchmarkFailed(providerId: ProviderId, modelId: ModelId, error: string): void {
  speechEvents.emit('benchmark:failed', { providerId, modelId, error });
}

/** Emits transcription completion event */
export function emitTranscriptionCompleted(requestId: RequestId, providerId: ProviderId, text: string): void {
  speechEvents.emit('transcription:completed', { requestId, providerId, text });
}

/** Emits transcription failure event */
export function emitTranscriptionFailed(requestId: RequestId, providerId: ProviderId, error: string): void {
  speechEvents.emit('transcription:failed', { requestId, providerId, error });
}

export { speechEvents };
