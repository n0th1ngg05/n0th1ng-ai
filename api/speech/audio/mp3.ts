import { SpeechError } from '../types.js';

/** MP3 frame header parser */
export interface MP3FrameInfo {
  sampleRate: number;
  channels: number;
  bitrate: number;
  duration: number;
}

/** MP3 utilities */
export class Mp3Util {
  /** Parses basic MP3 info from buffer */
  static parseInfo(buffer: Buffer): MP3FrameInfo {
    let offset = 0;
    if (buffer.toString('ascii', 0, 3) === 'ID3') {
      const id3Size = this.parseID3Size(buffer, 6);
      offset = 10 + id3Size;
    }

    const frameHeader = this.findFrameHeader(buffer, offset);
    if (!frameHeader) {
      throw new SpeechError('Invalid MP3 file: no frame header found', 'AUDIO_PARSE_ERROR');
    }

    const version = (frameHeader[1] >> 3) & 0x3;
    const layer = (frameHeader[1] >> 1) & 0x3;
    const bitrateIndex = (frameHeader[2] >> 4) & 0xF;
    const sampleRateIndex = (frameHeader[2] >> 2) & 0x3;
    const channelMode = (frameHeader[3] >> 6) & 0x3;

    const sampleRates = [44100, 48000, 32000, 0];
    const sampleRate = sampleRates[sampleRateIndex] / (version === 0 ? 2 : 1);

    const channels = channelMode === 3 ? 1 : 2;

    const bitrates = [0, 32000, 40000, 48000, 56000, 64000, 80000, 96000, 112000, 128000, 160000, 192000, 224000, 256000, 320000, 0];
    const bitrate = bitrates[bitrateIndex];

    const frameSize = this.calculateFrameSize(bitrate, sampleRate, layer, version);
    const frameCount = Math.floor((buffer.length - offset) / frameSize);
    const duration = frameCount * 1152 / sampleRate;

    return { sampleRate, channels, bitrate, duration };
  }

  private static parseID3Size(buffer: Buffer, offset: number): number {
    let size = 0;
    for (let i = 0; i < 4; i++) {
      size = (size << 7) | (buffer[offset + i] & 0x7F);
    }
    return size;
  }

  private static findFrameHeader(buffer: Buffer, start: number): Buffer | null {
    for (let i = start; i < buffer.length - 4; i++) {
      if (buffer[i] === 0xFF && (buffer[i + 1] & 0xE0) === 0xE0) {
        return buffer.subarray(i, i + 4);
      }
    }
    return null;
  }

  private static calculateFrameSize(bitrate: number, sampleRate: number, layer: number, version: number): number {
    const samples = layer === 3 ? 384 : 1152;
    const coeff = version === 3 ? 144 : 72;
    return Math.floor((coeff * bitrate) / sampleRate) + (layer === 3 ? 0 : 0);
  }
}