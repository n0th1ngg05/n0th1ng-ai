import { BaseProvider } from './provider.js';
import { TTSRequest, TTSResponse, ITTSProvider } from '../../types.js';

/** Abstract base class for TTS providers */
export abstract class TTSProvider extends BaseProvider implements ITTSProvider {
  /** Synthesizes speech from text */
  abstract synthesize(request: TTSRequest): Promise<TTSResponse>;
}