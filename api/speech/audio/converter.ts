import { AudioFormat, AudioBuffer, SpeechError } from '../types.js';
import { WavUtil } from './wav.js';

/** Audio format converter */
export class AudioConverter {
  /** Converts audio buffer to target format */
  static convert(buffer: AudioBuffer, targetFormat: AudioFormat): AudioBuffer {
    if (buffer.format.format === 'wav' && targetFormat.format === 'pcm') {
      return { data: WavUtil.extractPcm(buffer.data), format: targetFormat, duration: buffer.duration };
    }
    if (buffer.format.format === 'pcm' && targetFormat.format === 'wav') {
      return { data: WavUtil.buildWav(buffer.data, targetFormat), format: targetFormat, duration: buffer.duration };
    }
    throw new SpeechError(`Conversion from ${buffer.format.format} to ${targetFormat.format} not implemented`, 'CONVERT_ERROR');
  }

  /** Converts sample rate (uses nearest-neighbor for simplicity) */
  static convertSampleRate(buffer: AudioBuffer, targetSampleRate: number): AudioBuffer {
    if (buffer.format.sampleRate === targetSampleRate) return buffer;
    const ratio = targetSampleRate / buffer.format.sampleRate;
    const newLength = Math.floor(buffer.data.length * ratio);
    const result = Buffer.alloc(newLength);
    for (let i = 0; i < newLength; i++) {
      result[i] = buffer.data[Math.floor(i / ratio)];
    }
    return {
      data: result,
      format: { ...buffer.format, sampleRate: targetSampleRate },
      duration: buffer.duration / ratio,
    };
  }
}