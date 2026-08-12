import { join, resolve, normalize, sep } from 'path';
import { SpeechError } from '../types.js';

/** Gets the base storage directory for speech data */
export function getSpeechBasePath(): string {
  return resolve(process.cwd(), 'data', 'speech');
}

// ── Persisted full-response audio (app/storage/audio/...) ──────────────────
// Sibling of app/api and app/db, NOT under app/api/data/speech above — this
// is the user-facing "generated audio you can replay later" store, kept
// separate from the internal per-provider speech runtime state. process.cwd()
// is app/api when the server boots, so we go up one level to app/, then into
// storage/audio.
function getAudioStorageBasePath(): string {
  return resolve(process.cwd(), '..', 'storage', 'audio');
}

/** Gets the directory where final, concatenated full-response recordings
 * are saved for later replay. */
export function getGeneratedAudioDir(): string {
  return join(getAudioStorageBasePath(), 'generated');
}

/** Gets the full path for a saved full-response recording by id. Always
 * .wav — concatenation always rebuilds a WAV container regardless of what
 * the underlying provider's per-sentence chunks were. */
export function getGeneratedAudioPath(id: string): string {
  return join(getGeneratedAudioDir(), `${sanitizeFilename(id)}.wav`);
}

/** Gets the cache directory for audio (e.g. re-usable synthesis output that
 * isn't a full conversation turn — kept longer than temp, shorter than
 * generated). */
export function getAudioCacheDir(): string {
  return join(getAudioStorageBasePath(), 'cache');
}

export function getAudioCachePath(filename: string): string {
  return join(getAudioCacheDir(), sanitizeFilename(filename));
}

/** Gets the temp directory for audio (short-lived scratch space, e.g.
 * in-progress concatenation work before the final file is renamed into
 * generated/). */
export function getAudioTempDir(): string {
  return join(getAudioStorageBasePath(), 'temp');
}

export function getAudioTempPath(filename: string): string {
  return join(getAudioTempDir(), sanitizeFilename(filename));
}

/** Gets the provider storage path */
export function getProviderPath(providerId: string): string {
  return join(getSpeechBasePath(), 'providers', providerId);
}

/** Gets the model storage path */
export function getModelPath(providerId: string, modelId: string): string {
  return join(getProviderPath(providerId), 'models', modelId);
}

/** Gets the profile storage path */
export function getProfileStoragePath(): string {
  return join(getSpeechBasePath(), 'profiles');
}

/** Gets the runtime storage path */
export function getRuntimeStoragePath(): string {
  return join(getSpeechBasePath(), 'runtimes');
}

/** Gets the download temp path */
export function getDownloadTempPath(downloadId: string): string {
  return join(getSpeechBasePath(), 'downloads', 'temp', downloadId);
}

/** Gets the settings file path */
export function getSettingsPath(): string {
  return join(getSpeechBasePath(), 'settings.json');
}

/** Gets the history file path */
export function getHistoryPath(): string {
  return join(getSpeechBasePath(), 'history.jsonl');
}

/** Sanitizes a filename */
export function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').substring(0, 100);
}

/** Validates that a path is within the speech base path (prevents directory traversal) */
export function validatePathWithinBase(targetPath: string): string {
  const base = getSpeechBasePath();
  const resolved = resolve(normalize(targetPath));
  if (!resolved.startsWith(base + sep) && resolved !== base) {
    throw new SpeechError('Path traversal detected', 'SECURITY_ERROR');
  }
  return resolved;
}