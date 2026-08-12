import { speechEvents } from './emitter.js';
import { ProviderId, ProviderManifest } from '../types.js';

/** Emits provider installed event */
export function emitProviderInstalled(providerId: ProviderId, manifest: ProviderManifest): void {
  speechEvents.emit('provider:installed', { providerId, manifest });
}

/** Emits provider removed event */
export function emitProviderRemoved(providerId: ProviderId): void {
  speechEvents.emit('provider:removed', { providerId });
}

/** Emits provider enabled event */
export function emitProviderEnabled(providerId: ProviderId): void {
  speechEvents.emit('provider:enabled', { providerId });
}

/** Emits provider disabled event */
export function emitProviderDisabled(providerId: ProviderId): void {
  speechEvents.emit('provider:disabled', { providerId });
}