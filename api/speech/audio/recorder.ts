import { EventEmitter } from 'events';
import { AudioFormat, AudioBuffer, SpeechError } from '../types.js';
import { DEFAULT_SAMPLE_RATE, DEFAULT_CHANNELS, DEFAULT_BIT_DEPTH } from '../utils/constants.js';

/** Audio recorder configuration */
export interface RecorderConfig {
  sampleRate: number;
  channels: number;
  bitDepth: number;
  bufferSize: number;
  deviceId?: string;
}

/** Audio recorder */
export class AudioRecorder extends EventEmitter {
  private recording = false;
  private chunks: Buffer[] = [];
  private config: RecorderConfig;

  constructor(config?: Partial<RecorderConfig>) {
    super();
    this.config = {
      sampleRate: config?.sampleRate || DEFAULT_SAMPLE_RATE,
      channels: config?.channels || DEFAULT_CHANNELS,
      bitDepth: config?.bitDepth || DEFAULT_BIT_DEPTH,
      bufferSize: config?.bufferSize || 4096,
      deviceId: config?.deviceId,
    };
  }

  /** Starts recording */
  start(): void {
    if (this.recording) {
      throw new SpeechError('Already recording', 'RECORDER_ERROR');
    }
    this.recording = true;
    this.chunks = [];
    this.emit('start');
  }

  /** Stops recording and returns audio buffer */
  stop(): AudioBuffer {
    if (!this.recording) {
      throw new SpeechError('Not recording', 'RECORDER_ERROR');
    }
    this.recording = false;
    const data = Buffer.concat(this.chunks);
    const duration = data.length / (this.config.sampleRate * this.config.channels * (this.config.bitDepth / 8));
    this.emit('stop', { data, format: this.getFormat(), duration });
    return {
      data,
      format: this.getFormat(),
      duration,
    };
  }

  /** Feeds audio data (called by platform-specific backend) */
  feed(data: Buffer): void {
    if (!this.recording) return;
    this.chunks.push(data);
    this.emit('data', data);
  }

  /** Checks if currently recording */
  isRecording(): boolean {
    return this.recording;
  }

  private getFormat(): AudioFormat {
    return {
      sampleRate: this.config.sampleRate,
      channels: this.config.channels,
      bitDepth: this.config.bitDepth,
      format: 'pcm',
    };
  }
}