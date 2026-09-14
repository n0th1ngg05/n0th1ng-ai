"""MP3 utilities."""
from typing import Optional
import io

from runtime.exceptions import AudioError


class Mp3Util:
    """MP3 format utilities."""

    @staticmethod
    def decode(mp3_data: bytes) -> tuple[bytes, int, int]:
        """Decode MP3 to PCM. Returns (pcm_data, sample_rate, channels)."""
        try:
            import soundfile as sf
            import io as bio
            data, sample_rate = sf.read(bio.BytesIO(mp3_data), dtype="float32")
            if data.ndim == 1:
                channels = 1
            else:
                channels = data.shape[1]
            # Convert float32 to int16 PCM
            pcm = (data * 32767).astype("int16").tobytes()
            return pcm, int(sample_rate), channels
        except ImportError:
            raise AudioError("soundfile required for MP3 decoding")
        except Exception as e:
            raise AudioError(f"MP3 decode error: {e}")

    @staticmethod
    def encode(pcm_data: bytes, sample_rate: int, channels: int = 1) -> bytes:
        """Encode PCM to MP3."""
        try:
            import soundfile as sf
            import io as bio
            dtype = "int16"
            arr = __import__("numpy").frombuffer(pcm_data, dtype=dtype).astype("float32") / 32768.0
            if channels > 1:
                arr = arr.reshape(-1, channels)
            buf = bio.BytesIO()
            sf.write(buf, arr, sample_rate, format="MP3")
            return buf.getvalue()
        except ImportError:
            raise AudioError("soundfile required for MP3 encoding")
        except Exception as e:
            raise AudioError(f"MP3 encode error: {e}")
