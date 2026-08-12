import { AudioBuffer, SpeechError } from '../types.js';

/** Linear interpolation resampler */
export class Resampler {
  /** Resamples audio to target sample rate using linear interpolation */
  static resample(buffer: AudioBuffer, targetSampleRate: number): AudioBuffer {
    if (buffer.format.sampleRate === targetSampleRate) return buffer;
    const ratio = targetSampleRate / buffer.format.sampleRate;
    const bytesPerSample = buffer.format.bitDepth / 8;
    const channels = buffer.format.channels;
    const inputSamples = buffer.data.length / (bytesPerSample * channels);
    const outputSamples = Math.floor(inputSamples * ratio);
    const output = Buffer.alloc(outputSamples * bytesPerSample * channels);

    for (let ch = 0; ch < channels; ch++) {
      for (let i = 0; i < outputSamples; i++) {
        const srcIndex = i / ratio;
        const index0 = Math.floor(srcIndex);
        const index1 = Math.min(index0 + 1, inputSamples - 1);
        const frac = srcIndex - index0;

        const val0 = this.readSample(buffer.data, index0, ch, bytesPerSample, channels);
        const val1 = this.readSample(buffer.data, index1, ch, bytesPerSample, channels);
        const val = val0 + (val1 - val0) * frac;

        this.writeSample(output, i, ch, val, bytesPerSample, channels);
      }
    }

    return {
      data: output,
      format: { ...buffer.format, sampleRate: targetSampleRate },
      duration: (outputSamples / targetSampleRate),
    };
  }

  private static readSample(buffer: Buffer, sampleIndex: number, channel: number, bytesPerSample: number, channels: number): number {
    const offset = (sampleIndex * channels + channel) * bytesPerSample;
    if (bytesPerSample === 1) return buffer.readInt8(offset);
    if (bytesPerSample === 2) return buffer.readInt16LE(offset);
    if (bytesPerSample === 4) return buffer.readInt32LE(offset);
    return 0;
  }

  private static writeSample(buffer: Buffer, sampleIndex: number, channel: number, value: number, bytesPerSample: number, channels: number): void {
    const offset = (sampleIndex * channels + channel) * bytesPerSample;
    if (bytesPerSample === 1) buffer.writeInt8(Math.max(-128, Math.min(127, Math.round(value))), offset);
    else if (bytesPerSample === 2) buffer.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(value))), offset);
    else if (bytesPerSample === 4) buffer.writeInt32LE(Math.max(-2147483648, Math.min(2147483647, Math.round(value))), offset);
  }
}