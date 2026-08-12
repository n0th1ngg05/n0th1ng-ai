import { TTSProvider } from './ttsProvider.js';
import { STTProvider } from './sttProvider.js';
import { IHybridProvider, TTSRequest, TTSResponse, STTRequest, STTResponse } from '../../types.js';

/** Abstract base class for hybrid TTS+STT providers */
export abstract class HybridProvider extends TTSProvider implements IHybridProvider {
  /** Transcribes audio to text */
  abstract transcribe(request: STTRequest): Promise<STTResponse>;
}