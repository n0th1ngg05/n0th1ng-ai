import { ProviderManifest, ModelStatus } from '../../types.js';
import { defaultChatterboxConfig } from './config.js';

/** Chatterbox provider manifest */
export const chatterboxManifest: ProviderManifest = {
  id: 'chatterbox',
  name: 'Chatterbox',
  type: 'hybrid',
  version: '1.0.0',
  description: 'Conversational speech AI with TTS and STT',
  author: 'Resemble AI',
  license: 'MIT',
  supportedLanguages: defaultChatterboxConfig.languages,
  models: [
    {
      id: 'chatterbox-tts',
      providerId: 'chatterbox',
      name: 'Chatterbox TTS',
      version: '1.0.0',
      size: 300000000,
      checksum: '',
      checksumAlgorithm: 'sha256',
      downloadUrl: 'https://huggingface.co/resemble-ai/chatterbox/resolve/main/t3_cfg.pt',
      status: ModelStatus.AVAILABLE,
      languages: ['en'],
      capabilities: ['tts'],
      minProviderVersion: '1.0.0',
    },
    {
      id: 'chatterbox-s3gen',
      providerId: 'chatterbox',
      name: 'Chatterbox S3Gen',
      version: '1.0.0',
      size: 400000000,
      checksum: '',
      checksumAlgorithm: 'sha256',
      downloadUrl: 'https://huggingface.co/resemble-ai/chatterbox/resolve/main/s3gen.pt',
      status: ModelStatus.AVAILABLE,
      languages: ['en'],
      capabilities: ['tts', 'voice-cloning'],
      minProviderVersion: '1.0.0',
    },
    {
      // Was missing from the manifest entirely, so it never reached
      // listModels() even though the chatterbox runtime (127.0.0.1:6102)
      // reports it correctly via /v1/models. status is AVAILABLE (not
      // INSTALLED) to match the runtime's current "loaded": false — flip
      // this to ModelStatus.INSTALLED once the runtime reports loaded: true.
      id: 'chatterbox-turbo',
      providerId: 'chatterbox',
      name: 'Chatterbox Turbo',
      version: '1.0.0',
      size: 300000000,
      checksum: '',
      checksumAlgorithm: 'sha256',
      downloadUrl: 'https://huggingface.co/resemble-ai/chatterbox/resolve/main/t3_cfg_turbo.pt',
      status: ModelStatus.AVAILABLE,
      languages: ['en'],
      capabilities: ['tts'],
      minProviderVersion: '1.0.0',
    },
  ],
  voices: [
    {
      id: 'default',
      modelId: 'chatterbox-tts',
      providerId: 'chatterbox',
      name: 'Default',
      language: 'en',
      gender: 'neutral',
      description: 'Default conversational voice',
      sampleRate: 24000,
      isDefault: true,
    },
    {
      id: 'expressive',
      modelId: 'chatterbox-tts',
      providerId: 'chatterbox',
      name: 'Expressive',
      language: 'en',
      gender: 'neutral',
      description: 'High-emotion expressive voice',
      sampleRate: 24000,
      isDefault: false,
    },
    {
      id: 'calm',
      modelId: 'chatterbox-tts',
      providerId: 'chatterbox',
      name: 'Calm',
      language: 'en',
      gender: 'neutral',
      description: 'Calm, measured conversational voice',
      sampleRate: 24000,
      isDefault: false,
    },
    {
      id: 'narrator',
      modelId: 'chatterbox-tts',
      providerId: 'chatterbox',
      name: 'Narrator',
      language: 'en',
      gender: 'neutral',
      description: 'Authoritative narrator style',
      sampleRate: 24000,
      isDefault: false,
    },
    {
      id: 'cloned_default',
      modelId: 'chatterbox-s3gen',
      providerId: 'chatterbox',
      name: 'Cloned (S3Gen)',
      language: 'en',
      gender: 'neutral',
      description: 'Voice cloning via S3Gen model',
      sampleRate: 24000,
      isDefault: false,
    },
    {
      id: 'turbo_default',
      modelId: 'chatterbox-turbo',
      providerId: 'chatterbox',
      name: 'Default (Turbo)',
      language: 'en',
      gender: 'neutral',
      description: 'Fast low-latency conversational voice',
      sampleRate: 24000,
      isDefault: true,
    },
  ],
};

/** Gets the Chatterbox manifest */
export function getChatterboxManifest(): ProviderManifest {
  return JSON.parse(JSON.stringify(chatterboxManifest));
}