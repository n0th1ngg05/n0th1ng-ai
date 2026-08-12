import { TypedEventEmitter, SpeechEventMap } from '../types.js';

/** Global typed event emitter for speech system events */
export class SpeechEventEmitter extends TypedEventEmitter<SpeechEventMap> {
  private static instance: SpeechEventEmitter;

  private constructor() {
    super();
  }

  /** Gets the singleton instance */
  static getInstance(): SpeechEventEmitter {
    if (!SpeechEventEmitter.instance) {
      SpeechEventEmitter.instance = new SpeechEventEmitter();
    }
    return SpeechEventEmitter.instance;
  }
}

/** Convenience export for the global emitter */
export const speechEvents = SpeechEventEmitter.getInstance();