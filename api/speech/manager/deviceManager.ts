import {
  AudioDevice,
  DeviceId,
  SpeechError,
} from '../types.js';
import { SettingsStorage } from '../storage/settingsStorage.js';
import { emitDeviceChanged } from '../events/speechEvents.js';

/** Manages audio devices */
export class DeviceManager {
  private devices: AudioDevice[] = [];
  private defaultMicrophone?: DeviceId;
  private defaultSpeaker?: DeviceId;
  private settings: SettingsStorage;

  constructor() {
    this.settings = new SettingsStorage();
  }

  /** Initializes device manager */
  async initialize(): Promise<void> {
    this.defaultMicrophone = await this.settings.get<DeviceId>('defaultMicrophone');
    this.defaultSpeaker = await this.settings.get<DeviceId>('defaultSpeaker');
  }

  /** Lists available microphones */
  async listMicrophones(): Promise<AudioDevice[]> {
    return this.devices.filter((d) => d.type === 'microphone');
  }

  /** Lists available speakers */
  async listSpeakers(): Promise<AudioDevice[]> {
    return this.devices.filter((d) => d.type === 'speaker');
  }

  /** Lists audio input devices */
  async listInputs(): Promise<AudioDevice[]> {
    return this.listMicrophones();
  }

  /** Lists audio output devices */
  async listOutputs(): Promise<AudioDevice[]> {
    return this.listSpeakers();
  }

  /** Gets current default devices */
  async getDefaults(): Promise<{ input?: AudioDevice; output?: AudioDevice }> {
    return {
      input: this.getDefaultMicrophone(),
      output: this.getDefaultSpeaker(),
    };
  }

  /** Refreshes available devices */
  async refreshDevices(): Promise<void> {
    return;
  }

  /** Gets all devices */
  async listDevices(): Promise<AudioDevice[]> {
    return [...this.devices];
  }

  /** Sets available devices (called by platform layer) */
  setDevices(devices: AudioDevice[]): void {
    this.devices = devices;
  }

  /** Gets default microphone */
  getDefaultMicrophone(): AudioDevice | undefined {
    return this.devices.find((d) => d.id === this.defaultMicrophone && d.type === 'microphone');
  }

  /** Gets default speaker */
  getDefaultSpeaker(): AudioDevice | undefined {
    return this.devices.find((d) => d.id === this.defaultSpeaker && d.type === 'speaker');
  }

  /** Sets default microphone */
  async setDefaultMicrophone(deviceId: DeviceId): Promise<void> {
    const device = this.devices.find((d) => d.id === deviceId && d.type === 'microphone');
    if (!device) {
      throw new SpeechError(`Microphone ${deviceId} not found`, 'DEVICE_NOT_FOUND');
    }
    this.defaultMicrophone = deviceId;
    await this.settings.set('defaultMicrophone', deviceId);
    emitDeviceChanged({ deviceId, type: 'microphone' });
  }

  /** Sets default input device */
  async setDefaultInput(deviceId: DeviceId): Promise<void> {
    return this.setDefaultMicrophone(deviceId);
  }

  /** Sets default speaker */
  async setDefaultSpeaker(deviceId: DeviceId): Promise<void> {
    const device = this.devices.find((d) => d.id === deviceId && d.type === 'speaker');
    if (!device) {
      throw new SpeechError(`Speaker ${deviceId} not found`, 'DEVICE_NOT_FOUND');
    }
    this.defaultSpeaker = deviceId;
    await this.settings.set('defaultSpeaker', deviceId);
    emitDeviceChanged({ deviceId, type: 'speaker' });
  }

  /** Sets default output device */
  async setDefaultOutput(deviceId: DeviceId): Promise<void> {
    return this.setDefaultSpeaker(deviceId);
  }
}
