import {
  DownloadTask,
  DownloadId,
  ModelId,
  ProviderId,
  DownloadStatus,
  ModelStatus,
  SpeechError,
} from '../types.js';
import { HttpDownloader } from '../utils/downloader.js';
import { emitDownloadStarted, emitDownloadProgress, emitDownloadCompleted, emitDownloadCancelled, emitDownloadError } from '../events/downloadEvents.js';
import { verifyFileChecksum } from '../utils/checksum.js';
import { getDownloadTempPath } from '../utils/pathUtils.js';
import { ensureDir, removePath } from '../utils/fileUtils.js';
import { ModelManager } from './modelManager.js';

/** Manages model downloads */
export class DownloadManager {
  private activeDownloads = new Map<DownloadId, { task: DownloadTask; downloader: HttpDownloader }>();
  private downloadHistory: DownloadTask[] = [];

  constructor(private readonly modelManager: ModelManager) {}

  /** Starts a model download */
  async startDownload(modelId: ModelId, providerId: ProviderId): Promise<DownloadTask> {
    const model = await this.modelManager.getModel(modelId);
    if (!model) {
      throw new SpeechError(`Model ${modelId} not found`, 'MODEL_NOT_FOUND');
    }

    const downloadId = `dl_${Date.now()}_${Math.random().toString(36).substring(2, 9)}` as DownloadId;
    const task: DownloadTask = {
      id: downloadId,
      modelId,
      providerId,
      url: model.downloadUrl,
      destinationPath: model.installedPath || getDownloadTempPath(downloadId),
      totalBytes: model.size,
      downloadedBytes: 0,
      status: DownloadStatus.DOWNLOADING,
      speed: 0,
      eta: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await ensureDir(task.destinationPath);
    await this.modelManager.updateModelStatus(modelId, ModelStatus.DOWNLOADING);

    const downloader = new HttpDownloader();
    downloader.on('progress', (progress: { downloadedBytes: number; totalBytes: number; speed: number; eta: number }) => {
      task.downloadedBytes = progress.downloadedBytes;
      task.speed = progress.speed;
      task.eta = progress.eta;
      task.updatedAt = new Date();
      emitDownloadProgress(downloadId, progress.downloadedBytes / progress.totalBytes, progress.speed, progress.eta);
    });

    this.activeDownloads.set(downloadId, { task, downloader });
    this.downloadHistory.push(task);
    emitDownloadStarted(downloadId, modelId, providerId);

    this.executeDownload(downloadId, task, model.checksum, model.checksumAlgorithm).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      emitDownloadError(downloadId, modelId, message);
    });

    return task;
  }

  /** Queues a model download */
  async queueDownload(options: { provider: ProviderId; model: ModelId }): Promise<DownloadTask> {
    return this.startDownload(options.model, options.provider);
  }

  /** Pauses a download */
  async pauseDownload(downloadId: DownloadId): Promise<void> {
    const active = this.activeDownloads.get(downloadId);
    if (!active) {
      throw new SpeechError(`Download ${downloadId} not found`, 'DOWNLOAD_NOT_FOUND');
    }

    active.downloader.cancel();
    active.task.status = DownloadStatus.PAUSED;
    active.task.updatedAt = new Date();
  }

  /** Resumes a paused download */
  async resumeDownload(downloadId: DownloadId): Promise<void> {
    const active = this.activeDownloads.get(downloadId);
    if (!active) {
      throw new SpeechError(`Download ${downloadId} not found`, 'DOWNLOAD_NOT_FOUND');
    }

    if (active.task.status !== DownloadStatus.PAUSED) {
      throw new SpeechError(`Download ${downloadId} is not paused`, 'DOWNLOAD_NOT_PAUSED');
    }

    const model = await this.modelManager.getModel(active.task.modelId);
    if (!model) {
      throw new SpeechError(`Model ${active.task.modelId} not found`, 'MODEL_NOT_FOUND');
    }

    const downloader = new HttpDownloader();
    downloader.on('progress', (progress: { downloadedBytes: number; totalBytes: number; speed: number; eta: number }) => {
      active.task.downloadedBytes = progress.downloadedBytes;
      active.task.speed = progress.speed;
      active.task.eta = progress.eta;
      active.task.updatedAt = new Date();
      emitDownloadProgress(downloadId, progress.downloadedBytes / progress.totalBytes, progress.speed, progress.eta);
    });

    active.downloader = downloader;
    active.task.status = DownloadStatus.DOWNLOADING;
    this.executeDownload(downloadId, active.task, model.checksum, model.checksumAlgorithm).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      emitDownloadError(downloadId, active.task.modelId, message);
    });
  }

  /** Cancels a download */
  async cancelDownload(downloadId: DownloadId): Promise<void> {
    const active = this.activeDownloads.get(downloadId);
    if (!active) {
      throw new SpeechError(`Download ${downloadId} not found`, 'DOWNLOAD_NOT_FOUND');
    }
    active.downloader.cancel();
    active.task.status = DownloadStatus.CANCELLED;
    this.activeDownloads.delete(downloadId);
    emitDownloadCancelled(downloadId, active.task.modelId);
    await removePath(active.task.destinationPath);
  }

  /** Gets active download */
  getDownload(downloadId: DownloadId): DownloadTask | undefined {
    return this.activeDownloads.get(downloadId)?.task;
  }

  /** Gets all active downloads */
  getActiveDownloads(): DownloadTask[] {
    return Array.from(this.activeDownloads.values()).map((d) => d.task);
  }

  /** Gets download history */
  getHistory(): DownloadTask[] {
    return [...this.downloadHistory];
  }

  /** Gets progress for a download */
  getProgress(downloadId: DownloadId): DownloadTask | undefined {
    return this.getDownload(downloadId);
  }

  /** Removes an installed model */
  async removeModel(providerId: ProviderId, modelId: ModelId): Promise<void> {
    await this.modelManager.deleteModel(modelId);
  }

  private async executeDownload(downloadId: DownloadId, task: DownloadTask, checksum: string, algorithm: 'sha256' | 'md5'): Promise<void> {
    const { downloader } = this.activeDownloads.get(downloadId)!;
    try {
      await downloader.download(task);
      const valid = await verifyFileChecksum(`${task.destinationPath}/${task.modelId}`, checksum, algorithm);
      if (!valid) {
        throw new SpeechError('Checksum verification failed', 'CHECKSUM_ERROR');
      }
      task.status = DownloadStatus.COMPLETED;
      await this.modelManager.updateModelStatus(task.modelId, ModelStatus.INSTALLED);
      emitDownloadCompleted(downloadId, task.modelId, task.providerId);
    } catch (error) {
      task.status = DownloadStatus.ERROR;
      task.error = error instanceof Error ? error.message : String(error);
      await this.modelManager.updateModelStatus(task.modelId, ModelStatus.ERROR);
      throw error;
    } finally {
      this.activeDownloads.delete(downloadId);
    }
  }
}
