import { AudioFormat, AudioBuffer, SpeechError } from '../types.js';

/** WAV file utilities */
export class WavUtil {
  /** Parses WAV header and returns audio format */
  static parseHeader(buffer: Buffer): AudioFormat {
    if (buffer.toString('ascii', 0, 4) !== 'RIFF') {
      throw new SpeechError('Invalid WAV file: missing RIFF header', 'AUDIO_PARSE_ERROR');
    }
    if (buffer.toString('ascii', 8, 12) !== 'WAVE') {
      throw new SpeechError('Invalid WAV file: missing WAVE header', 'AUDIO_PARSE_ERROR');
    }

    const channels = buffer.readUInt16LE(22);
    const sampleRate = buffer.readUInt32LE(24);
    const bitDepth = buffer.readUInt16LE(34);

    return {
      sampleRate,
      channels,
      bitDepth,
      format: 'wav',
    };
  }

  /** Builds a WAV file from PCM data */
  static buildWav(pcmData: Buffer, format: AudioFormat): Buffer {
    const byteRate = format.sampleRate * format.channels * (format.bitDepth / 8);
    const blockAlign = format.channels * (format.bitDepth / 8);
    const dataSize = pcmData.length;

    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + dataSize, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(format.channels, 22);
    header.writeUInt32LE(format.sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(format.bitDepth, 34);
    header.write('data', 36);
    header.writeUInt32LE(dataSize, 40);

    return Buffer.concat([header, pcmData]);
  }

  /** Extracts PCM data from WAV buffer */
  static extractPcm(wavBuffer: Buffer): Buffer {
    const dataOffset = this.findDataOffset(wavBuffer);
    return wavBuffer.subarray(dataOffset);
  }

  private static findDataOffset(buffer: Buffer): number {
    for (let i = 12; i < buffer.length - 8; i++) {
      if (buffer.toString('ascii', i, i + 4) === 'data') {
        return i + 8;
      }
    }
    return 44;
  }

  /** Concatenates multiple WAV buffers (e.g. one per streamed sentence,
   * in sequence order) into a single continuous WAV file with one header.
   *
   * Naively concatenating raw WAV bytes back-to-back produces a corrupt
   * file — every chunk after the first still has its own RIFF/fmt/data
   * header embedded mid-stream, which most players either choke on or
   * read as garbage/silence. This instead parses the format from the
   * first chunk, strips every chunk down to raw PCM, concatenates the
   * PCM only, and rebuilds one correct header sized for the full thing.
   *
   * All chunks are assumed to share the same format (sample rate/channels/
   * bit depth) — true here since every chunk in a single response comes
   * from the same provider+voice call. Throws if given an empty array. */
  static concat(chunks: Buffer[]): Buffer {
    if (chunks.length === 0) {
      throw new SpeechError('Cannot concatenate zero WAV chunks', 'AUDIO_PARSE_ERROR');
    }
    if (chunks.length === 1) {
      return chunks[0];
    }

    const format = this.parseHeader(chunks[0]);
    const pcmParts = chunks.map((chunk) => this.extractPcm(chunk));
    const joinedPcm = Buffer.concat(pcmParts);

    return this.buildWav(joinedPcm, format);
  }
}