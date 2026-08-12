import { speechEvents } from './emitter.js';
import { DownloadId, ModelId, ProviderId } from '../types.js';

/** Emits download started event */
export function emitDownloadStarted(downloadId: DownloadId, modelId: ModelId, providerId: ProviderId): void {
  speechEvents.emit('download:started', { downloadId, modelId, providerId });
}

/** Emits download progress event */
export function emitDownloadProgress(downloadId: DownloadId, progress: number, speed: number, eta: number): void {
  speechEvents.emit('download:progress', { downloadId, progress, speed, eta });
}

/** Emits download completed event */
export function emitDownloadCompleted(downloadId: DownloadId, modelId: ModelId, providerId: ProviderId): void {
  speechEvents.emit('download:completed', { downloadId, modelId, providerId });
}

/** Emits download cancelled event */
export function emitDownloadCancelled(downloadId: DownloadId, modelId: ModelId): void {
  speechEvents.emit('download:cancelled', { downloadId, modelId });
}

/** Emits download error event */
export function emitDownloadError(downloadId: DownloadId, modelId: ModelId, error: string): void {
  speechEvents.emit('download:error', { downloadId, modelId, error });
}