import { AudioBuffer, SpeechError } from '../types.js';

/** Silence detection configuration */
export interface SilenceConfig {
  threshold: number;
  minSilenceDuration: number;
  minSpeechDuration: number;
}

/** Silence detection result */
export interface SilenceResult {
  isSpeech: boolean;
  speechStart: number;
  speechEnd: number;
  segments: { start: number; end: number }[];
}

/** Energy-based silence detection */
export class SilenceDetector {
  private config: SilenceConfig;

  constructor(config?: Partial<SilenceConfig>) {
    this.config = {
      threshold: config?.threshold || 0.01,
      minSilenceDuration: config?.minSilenceDuration || 0.3,
      minSpeechDuration: config?.minSpeechDuration || 0.2,
    };
  }

  /** Detects speech segments in audio buffer */
  detect(buffer: AudioBuffer): SilenceResult {
    const sampleRate = buffer.format.sampleRate;
    const frameSize = Math.floor(sampleRate * 0.02);
    const frames = Math.floor(buffer.data.length / frameSize);
    const energies: number[] = [];

    for (let i = 0; i < frames; i++) {
      const frame = buffer.data.subarray(i * frameSize, (i + 1) * frameSize);
      energies.push(this.calculateEnergy(frame));
    }

    const isSpeech = energies.map((e) => e > this.config.threshold);
    const segments: { start: number; end: number }[] = [];
    let start: number | null = null;

    for (let i = 0; i < isSpeech.length; i++) {
      if (isSpeech[i] && start === null) {
        start = i;
      } else if (!isSpeech[i] && start !== null) {
        const duration = (i - start) * 0.02;
        if (duration >= this.config.minSpeechDuration) {
          segments.push({ start: start * 0.02, end: i * 0.02 });
        }
        start = null;
      }
    }

    if (start !== null) {
      const duration = (isSpeech.length - start) * 0.02;
      if (duration >= this.config.minSpeechDuration) {
        segments.push({ start: start * 0.02, end: isSpeech.length * 0.02 });
      }
    }

    return {
      isSpeech: segments.length > 0,
      speechStart: segments[0]?.start || 0,
      speechEnd: segments[segments.length - 1]?.end || 0,
      segments,
    };
  }

  private calculateEnergy(frame: Buffer): number {
    let sum = 0;
    for (let i = 0; i < frame.length; i += 2) {
      const sample = frame.readInt16LE(i);
      sum += sample * sample;
    }
    return Math.sqrt(sum / (frame.length / 2)) / 32768;
  }
}