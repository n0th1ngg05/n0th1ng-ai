import { get } from 'https';
import { createWriteStream } from 'fs';
import { EventEmitter } from 'events';
import { SpeechError, DownloadTask, DownloadStatus } from '../types.js';
import { ensureDir, removePath } from './fileUtils.js';
import { getDownloadTempPath } from './pathUtils.js';
import { DOWNLOAD_CHUNK_SIZE, DOWNLOAD_TIMEOUT } from './constants.js';

interface DownloadProgress {
  downloadedBytes: number;
  totalBytes: number;
  speed: number;
  eta: number;
}

/** Event-based HTTP downloader with resume support */
export class HttpDownloader extends EventEmitter {
  private abortController = new AbortController();
  private startTime = Date.now();
  private lastDownloaded = 0;
  private speedInterval?: NodeJS.Timeout;

  /** Downloads a file from URL to destination */
  async download(task: DownloadTask): Promise<void> {
    const tempPath = getDownloadTempPath(task.id);
    await ensureDir(tempPath);

    const filePath = `${tempPath}/${task.modelId}`;
    const fileStream = createWriteStream(filePath, { flags: 'a' });

    let downloadedBytes = task.downloadedBytes;
    const headers: Record<string, string> = {};
    if (downloadedBytes > 0) {
      headers['Range'] = `bytes=${downloadedBytes}-`;
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.abortController.abort();
        reject(new SpeechError('Download timeout', 'DOWNLOAD_TIMEOUT'));
      }, DOWNLOAD_TIMEOUT);

      const req = get(
        task.url,
        { headers, signal: this.abortController.signal as unknown as AbortSignal },
        (res) => {
          const totalBytes = parseInt(res.headers['content-length'] || '0', 10) + downloadedBytes;
          this.startSpeedTracking(totalBytes, downloadedBytes);

          res.on('data', (chunk: Buffer) => {
            downloadedBytes += chunk.length;
            fileStream.write(chunk);
            this.emit('progress', {
              downloadedBytes,
              totalBytes,
              speed: this.calculateSpeed(downloadedBytes),
              eta: this.calculateETA(downloadedBytes, totalBytes),
            });
          });

          res.on('end', () => {
            fileStream.end();
            clearTimeout(timeout);
            this.stopSpeedTracking();
            resolve();
          });

          res.on('error', (err) => {
            fileStream.destroy();
            clearTimeout(timeout);
            this.stopSpeedTracking();
            reject(new SpeechError(`Download failed: ${err.message}`, 'DOWNLOAD_ERROR'));
          });
        }
      );

      req.on('error', (err) => {
        fileStream.destroy();
        clearTimeout(timeout);
        this.stopSpeedTracking();
        reject(new SpeechError(`Request failed: ${err.message}`, 'DOWNLOAD_ERROR'));
      });
    });
  }

  /** Cancels the active download */
  cancel(): void {
    this.abortController.abort();
    this.stopSpeedTracking();
  }

  private startSpeedTracking(totalBytes: number, initialBytes: number): void {
    this.lastDownloaded = initialBytes;
    this.startTime = Date.now();
    this.speedInterval = setInterval(() => {
      this.emit('progress', {
        downloadedBytes: this.lastDownloaded,
        totalBytes,
        speed: this.calculateSpeed(this.lastDownloaded),
        eta: this.calculateETA(this.lastDownloaded, totalBytes),
      });
    }, 1000);
  }

  private stopSpeedTracking(): void {
    if (this.speedInterval) {
      clearInterval(this.speedInterval);
      this.speedInterval = undefined;
    }
  }

  private calculateSpeed(downloadedBytes: number): number {
    const elapsed = (Date.now() - this.startTime) / 1000;
    return elapsed > 0 ? downloadedBytes / elapsed : 0;
  }

  private calculateETA(downloadedBytes: number, totalBytes: number): number {
    const speed = this.calculateSpeed(downloadedBytes);
    return speed > 0 ? Math.ceil((totalBytes - downloadedBytes) / speed) : 0;
  }
}