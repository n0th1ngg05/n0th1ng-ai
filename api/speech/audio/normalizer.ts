import { AudioBuffer, SpeechError } from '../types.js';

/** Audio normalization methods */
export type NormalizationMethod = 'peak' | 'rms' | 'loudness';

/** Audio normalizer */
export class AudioNormalizer {
  /** Normalizes audio to target level */
  static normalize(buffer: AudioBuffer, method: NormalizationMethod = 'peak', targetLevel = 0.95): AudioBuffer {
    if (method === 'peak') return this.peakNormalize(buffer, targetLevel);
    if (method === 'rms') return this.rmsNormalize(buffer, targetLevel);
    return buffer;
  }

  private static peakNormalize(buffer: AudioBuffer, targetLevel: number): AudioBuffer {
    const data = buffer.data;
    let max = 0;
    for (let i = 0; i < data.length; i += 2) {
      const val = Math.abs(data.readInt16LE(i));
      if (val > max) max = val;
    }
    if (max === 0) return buffer;

    const gain = (targetLevel * 32767) / max;
    const output = Buffer.alloc(data.length);
    for (let i = 0; i < data.length; i += 2) {
      const val = data.readInt16LE(i);
      output.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(val * gain))), i);
    }

    return { data: output, format: buffer.format, duration: buffer.duration };
  }

  private static rmsNormalize(buffer: AudioBuffer, targetLevel: number): AudioBuffer {
    const data = buffer.data;
    let sum = 0;
    for (let i = 0; i < data.length; i += 2) {
      const val = data.readInt16LE(i);
      sum += val * val;
    }
    const rms = Math.sqrt(sum / (data.length / 2));
    if (rms === 0) return buffer;

    const gain = (targetLevel * 32767) / rms;
    const output = Buffer.alloc(data.length);
    for (let i = 0; i < data.length; i += 2) {
      const val = data.readInt16LE(i);
      output.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(val * gain))), i);
    }

    return { data: output, format: buffer.format, duration: buffer.duration };
  }
}