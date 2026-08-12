import { speechEvents } from './emitter.js';
import { RuntimeId, ProviderId } from '../types.js';

/** Emits runtime started event */
export function emitRuntimeStarted(runtimeId: RuntimeId, providerId: ProviderId): void {
  speechEvents.emit('runtime:started', { runtimeId, providerId });
}

/** Emits runtime stopped event */
export function emitRuntimeStopped(runtimeId: RuntimeId, providerId: ProviderId): void {
  speechEvents.emit('runtime:stopped', { runtimeId, providerId });
}

/** Emits runtime error event */
export function emitRuntimeError(runtimeId: RuntimeId, providerId: ProviderId, error: string): void {
  speechEvents.emit('runtime:error', { runtimeId, providerId, error });
}