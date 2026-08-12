import { ProviderId, RequestId } from '../types.js';

/** Generates a UUID v4 string */
export function generateId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Generates a request ID */
export function generateRequestId(): RequestId {
  return `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/** Formats bytes to human readable string */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

/** Formats duration in seconds to mm:ss */
export function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

/** Calculates ETA in seconds */
export function calculateETA(downloadedBytes: number, totalBytes: number, speed: number): number {
  if (speed <= 0) return Infinity;
  const remaining = totalBytes - downloadedBytes;
  return Math.ceil(remaining / speed);
}

/** Deep clones a serializable object */
export function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

/** Checks if a value is a plain object */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && value.constructor === Object;
}

/** Waits for a specified duration */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Retries an async operation with exponential backoff */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number,
  baseDelay = 1000
): Promise<T> {
  let lastError: Error | undefined;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      if (i < maxRetries - 1) {
        await sleep(baseDelay * Math.pow(2, i));
      }
    }
  }
  throw lastError;
}

/** Normalizes a provider ID */
export function normalizeProviderId(id: string): ProviderId {
  const normalized = id.toLowerCase().trim() as ProviderId;
  return normalized;
}