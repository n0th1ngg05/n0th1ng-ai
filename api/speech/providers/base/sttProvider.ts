import { BaseProvider } from './provider.js';
import { STTRequest, STTResponse, ISTTProvider } from '../../types.js';

/** Abstract base class for STT providers */
export abstract class STTProvider extends BaseProvider implements ISTTProvider {
  /** Transcribes audio to text */
  abstract transcribe(request: STTRequest): Promise<STTResponse>;
}