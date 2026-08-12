import { EventEmitter } from 'events';
import { AudioBuffer, SpeechError } from '../types.js';

/** Audio player */
export class AudioPlayer extends EventEmitter {
  private playing = false;
  private currentBuffer?: AudioBuffer;

  /** Plays an audio buffer */
  play(buffer: AudioBuffer): void {
    if (this.playing) {
      this.stop();
    }
    this.playing = true;
    this.currentBuffer = buffer;
    this.emit('play', buffer);
    setTimeout(() => {
      this.stop();
    }, buffer.duration * 1000);
  }

  /** Stops playback */
  stop(): void {
    if (!this.playing) return;
    this.playing = false;
    this.emit('stop');
  }

  /** Checks if playing */
  isPlaying(): boolean {
    return this.playing;
  }
}