# Speech Providers — Install & Model Guide

## Step 0 — Activate your venv
```powershell
d:\AI\Chatbot\app\speech-runtime\.venv\Scripts\activate
```

---

## Already Working (no action needed)
| Provider | Status | Notes |
|---|---|---|
| ✅ **Kokoro** | Ready | `kokoro==0.9.4` installed, downloads model automatically from HF |
| ✅ **Whisper** | Ready | `faster-whisper==1.2.1` installed, downloads model automatically from HF |

---

## Providers Needing Install

### 1. Piper — `pip install piper-tts`
Piper is different from the others — **it does NOT auto-download models**. You must download each voice's `.onnx` file manually and place it in the right folder.

```powershell
pip install piper-tts
```

**Model download** — go to https://huggingface.co/rhasspy/piper-voices and download the `.onnx` + `.onnx.json` pair for each voice you want. Place them here:

```
speech-runtime/models/piper/
├── en_US-lessac/
│   ├── en_US-lessac-medium.onnx
│   └── en_US-lessac-medium.onnx.json
├── en_US-ryan/
│   ├── en_US-ryan-high.onnx
│   └── en_US-ryan-high.onnx.json
├── en_GB-alan/
│   ├── en_GB-alan-medium.onnx
│   └── en_GB-alan-medium.onnx.json
...
```

> **Quick download for Lessac (most popular):**
> ```powershell
> $voice = "en_US-lessac"
> $dir = "d:\AI\Chatbot\app\speech-runtime\models\piper\$voice"
> mkdir $dir -Force
> Invoke-WebRequest "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/$voice-medium.onnx" -OutFile "$dir\$voice-medium.onnx"
> Invoke-WebRequest "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/$voice-medium.onnx.json" -OutFile "$dir\$voice-medium.onnx.json"
> ```

---

### 2. XTTS — `pip install TTS`
XTTS comes via Coqui's `TTS` package. **Auto-downloads model (~1.5GB) on first use.**

```powershell
pip install TTS
```

> Model is cached to `~/.local/share/tts/` on first request. No manual steps needed.

---

### 3. Chatterbox — `pip install chatterbox-tts`
**Auto-downloads from HuggingFace on first use** (~700MB total).

```powershell
pip install chatterbox-tts
```

> Model downloads to HuggingFace cache (`~/.cache/huggingface/`). No manual steps needed.

---

### 4. Dia — install from source (no pip package yet)
**Auto-downloads from HuggingFace on first use** (~3GB for 1.6B model), then caches locally to `models/dia/`.

```powershell
pip install git+https://github.com/nari-labs/dia.git
```

> Requires a GPU with ~6GB VRAM for the 1.6B model. Will be slow on CPU.

---

### 5. Fish Speech — install from source
**Auto-downloads from HuggingFace on first use**, caches to `models/fishspeech/`.

```powershell
pip install git+https://github.com/fishaudio/fish-speech.git
```

> Requires `huggingface_hub` (likely already installed). Model is ~750MB.

---

## Model Storage Layout

```
speech-runtime/
└── models/
    ├── piper/                  ← Manual download required
    │   ├── en_US-lessac/
    │   │   ├── *.onnx
    │   │   └── *.onnx.json
    │   └── en_US-ryan/
    │       └── ...
    ├── dia/                    ← Auto-downloaded on first request
    │   └── dia-1.6b/
    ├── fishspeech/             ← Auto-downloaded on first request
    │   └── fishspeech-1.5/
    └── chatterbox/             ← Uses HF cache, no local copy
```

> XTTS uses its own internal cache (`~/.local/share/tts/`) managed by Coqui.

---

## Error Handling
All 5 providers will give a **clear error message** in the UI if:
- The package isn't installed → tells you exactly which `pip install` to run
- The model file isn't found → tells you exactly where to download it

They won't crash the runtime — the error is returned to the frontend as a TTS failure message.

---

## GPU VRAM Requirements (rough estimates)

| Provider | VRAM Needed |
|---|---|
| Piper | CPU only (no GPU) |
| Kokoro | ~1GB |
| Whisper (large-v3) | ~4GB |
| XTTS v2 | ~4-5GB |
| Chatterbox | ~2-3GB |
| Fish Speech 1.5 | ~3-4GB |
| Dia 1.6B | ~6-8GB |
