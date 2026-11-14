# n0th1ng AI Worker Subsystem

The **Worker** is the distributed GPU execution node of n0th1ng AI. It handles intensive workloads including document intelligence, OCR, vision analysis, TTS/STT speech synthesis, and local LLM reasoning.

---

## Hardware Architecture & Dual-GPU Support

The worker natively supports hybrid dual-GPU architectures, such as **AMD Radeon RX 9060 XT (8GB)** paired with **NVIDIA GeForce GTX 1060 (6GB)**:

```text
┌────────────────────────────────────────────────────────────────────────┐
│                        n0th1ng AI Worker Node                          │
├──────────────────────────────────┬─────────────────────────────────────┤
│  AMD GPU (ROCm)                  │  NVIDIA GPU (CUDA)                  │
│  - Port 11434 (Ollama AMD)       │  - Port 11435 (Ollama NVIDIA)       │
│  - nemotron-3.5-bolt:e4b (Res.)  │  - nomic-embed-text (Embeddings)    │
│  - lfm2.5:8b (Doc Analysis)      │  - Port 6103 (Kokoro TTS Engine)    │
│  - qwen3-vl:4b (Vision Tool)     │    using dedicated venv-nvidia      │
└──────────────────────────────────┴─────────────────────────────────────┘
```

---

## Deployment Options

### Option A: Linux Deployment (Docker Compose — Recommended)

Ideal for Ubuntu Server / KDE Plasma running multi-GPU setups without driver collisions:

```bash
cd worker
chmod +x setup-linux.sh entrypoint.sh
sudo ./setup-linux.sh
newgrp docker
docker compose up --build -d
```

- **Host Networking (`network_mode: host`)**: Zero port-mapping overhead; internal services communicate directly on `127.0.0.1`.
- **Storage Partitioning**: Directs Docker data-root, Ollama models, and HuggingFace weights to `/data` (secondary partition).
- **Auto Warm-up**: Automatically pulls and pre-warms `nemotron-3.5-bolt:e4b` in AMD VRAM on container boot.

👉 See **[`PREREQUISITES-AND-SETUP.md`](./PREREQUISITES-AND-SETUP.md)** for the autonomous step-by-step agent playbook.
👉 See **[`README-LINUX.md`](./README-LINUX.md)** for complete operational runbook and test commands.

---

### Option B: Windows Deployment (Native)

For Windows multi-GPU workstations:

1. **Configure `.env`**:
   Copy `.env.example` to `.env` and configure `WORKER_API_KEY`, `HUD_TOKEN`, and `WORKER_DATABASE_URL`.
2. **Start Dual Ollama Servers**:
   ```bash
   python ollama_dual.py
   ```
3. **Launch Worker Runtimes**:
   ```bash
   npm install
   npm run dev
   ```

👉 See **[`SETUP.md`](./SETUP.md)** for Windows setup instructions and database configuration.

---

## Service & Port Reference

| Service | Port | Endpoint | Description |
| :--- | :--- | :--- | :--- |
| **Worker API** | `3001` | `/capabilities`, `/execute`, `/speech` | Core Hono server handling master dispatch |
| **Exposure Gateway** | `3443` | `/status`, `/internal/*` | Authenticated proxy & Cloudflare Tunnel |
| **Worker HUD** | `5173` | `/` | Vite browser dashboard for telemetry |
| **Python Tool Runtime** | `8002` | `/health`, `/execute`, `/analyze` | OCR, layout analysis, Marker PDF, LangGraph |
| **Speech Runtime** | `9000` | `/health`, `/tts`, `/stt` | Central speech dispatch gateway |
| **Kokoro Engine** | `6103` | `/v1/health`, `/v1/audio/speech` | High-speed neural TTS running on NVIDIA CUDA |
| **Ollama Primary (AMD)** | `11434` | `/api/chat`, `/api/tags` | Resident chatbot (`nemotron-3.5-bolt:e4b`) & vision |
| **Ollama Secondary (NVIDIA)**| `11435` | `/api/chat`, `/api/tags` | Auxiliary embeddings & vision fallback |

---

## Required Ollama Models

Pull these models to support all registered worker capabilities:

```bash
# Resident Chatbot (AMD GPU)
ollama pull nemotron-3.5-bolt:e4b

# Document Analysis Pipeline (AMD GPU)
ollama pull lfm2.5:8b

# Vision Analyzer (AMD GPU)
ollama pull qwen3-vl:4b

# Lightweight Vision Alternate
ollama pull minicpm-v4.6:1b
```
