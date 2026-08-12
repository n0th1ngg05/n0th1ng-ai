import { Readable, Transform } from 'stream';
import { AudioFormat, SpeechError } from '../types.js';

/** Audio stream transformer */
export class AudioStream extends Transform {
  private format: AudioFormat;
  private accumulated = Buffer.alloc(0);

  constructor(format: AudioFormat) {
    super();
    this.format = format;
  }

  /** Gets the audio format */
  getFormat(): AudioFormat {
    return this.format;
  }

  _transform(chunk: Buffer, encoding: BufferEncoding, callback: (error?: Error | null, data?: Buffer) => void): void {
    this.accumulated = Buffer.concat([this.accumulated, chunk]);
    const frameSize = this.format.channels * (this.format.bitDepth / 8);
    const frames = Math.floor(this.accumulated.length / frameSize);
    const outputLength = frames * frameSize;

    if (outputLength > 0) {
      this.push(this.accumulated.subarray(0, outputLength));
      this.accumulated = this.accumulated.subarray(outputLength);
    }

    callback();
  }
}