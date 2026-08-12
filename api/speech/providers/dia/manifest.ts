import { ProviderManifest } from '../../types.js';

/** Returns the Dia provider manifest */
export function getDiaManifest(): ProviderManifest {

  return {

    id: 'dia',

    name: 'Dia',

    type: 'tts',

    description:
      'Dia is a high-quality neural text-to-speech model optimized for expressive and natural speech generation.',

    version: '1.0.0',

    author: 'Nari Labs',

    website: 'https://github.com/nari-labs/dia',

    license: 'Apache-2.0',

    supportedLanguages: ['en'],

    capabilities: {

      tts: true,

      stt: false,

      voiceConversion: false,

      streaming: true,

      multilingual: false,

      voiceCloning: false,

    },

    models: [

      {
        id: 'dia-1.6b',

        name: 'Dia 1.6B',

        description: 'Default Dia speech synthesis model — 1.6B parameters.',

        size: 1600000000,

        languages: ['en'],

        default: true,

        providerId: 'dia',
        version: '1.0.0',
        checksum: '',
        checksumAlgorithm: 'sha256',
        downloadUrl: 'https://huggingface.co/nari-labs/Dia-1.6B/resolve/main/model.safetensors',
        status: 'available' as any,
        capabilities: ['tts'],
        minProviderVersion: '1.0.0',
      },

    ],

    voices: [

      {
        id: 'default',
        providerId: 'dia',
        modelId: 'dia-1.6b',
        name: 'Default',
        description: 'Default Dia voice',
        gender: 'neutral',
        language: 'en',
        sampleRate: 44100,
        isDefault: true,
      },

      {
        id: 'speaker_s1',
        providerId: 'dia',
        modelId: 'dia-1.6b',
        name: 'Speaker 1',
        description: 'First speaker — for dialogue mode [S1]',
        gender: 'neutral',
        language: 'en',
        sampleRate: 44100,
        isDefault: false,
      },

      {
        id: 'speaker_s2',
        providerId: 'dia',
        modelId: 'dia-1.6b',
        name: 'Speaker 2',
        description: 'Second speaker — for dialogue mode [S2]',
        gender: 'neutral',
        language: 'en',
        sampleRate: 44100,
        isDefault: false,
      },

      {
        id: 'expressive',
        providerId: 'dia',
        modelId: 'dia-1.6b',
        name: 'Expressive',
        description: 'High-emotion expressive rendering',
        gender: 'neutral',
        language: 'en',
        sampleRate: 44100,
        isDefault: false,
      },

    ],

  };

}