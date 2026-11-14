# Linux Dual-GPU Worker Deployment (Ubuntu + KDE Plasma)

Complete deployment guide for running the **n0th1ng AI Worker** on Ubuntu Server / KDE Plasma with a dual-GPU configuration:
- **AMD Radeon RX 9060 XT (8GB)**: ROCm backend for Ollama (Port `11434`), hosting `nemotron-3.5-bolt:e4b` as an always-resident chatbot, plus `lfm2.5:8b` and `qwen3-vl:4b`.
- **NVIDIA GeForce GTX 1060 (6GB)**: CUDA backend for Kokoro TTS Engine (Port `6103`) and secondary Ollama (Port `11435`).
- **CPU (Ryzen 5 5500) & RAM (16GB)**: Runs Node.js Worker, Exposure Service, Vite HUD, and CPU-based Python document tools (PaddleOCR, Surya, Marker).

---

## 1. Storage & Partitioning Layout

Disk split: **100 GB Primary (`/`)** and **100 GB Secondary (`/data`)**.

Ensure your secondary partition is mounted to `/data` in `/etc/fstab`:
```bash
# Example: Check your partition with lsblk
lsblk

# Ensure /data exists and is mounted
sudo mkdir -p /data
# If /dev/nvme0n1p3 (or similar) is your 100GB partition:
# sudo mount /dev/nvme0n1p3 /data
```

The stack places heavy storage onto `/data`:
- `/data/docker` — Docker container images and build layers.
- `/data/models/ollama` — Shared Ollama models directory.
- `/data/models/huggingface` — Hugging Face cache for document/TTS models.

---

## 2. One-Time Host Setup

> **Note for AI Assistant / Antigravity Agent:**
> For an automated, phase-by-phase execution protocol covering every prerequisite and verification test, see **[`PREREQUISITES-AND-SETUP.md`](./PREREQUISITES-AND-SETUP.md)**.

From the `worker` directory on your Linux server, run the automated setup script:

```bash
cd /path/to/worker
chmod +x setup-linux.sh entrypoint.sh
sudo ./setup-linux.sh
```

This script:
1. Installs Docker CE & Docker Compose.
2. Installs and configures the **NVIDIA Container Toolkit** for Docker.
3. Moves Docker storage to `/data/docker` and sets NVIDIA as the default runtime.
4. Grants user permissions for AMD ROCm device nodes (`/dev/kfd`, `/dev/dri`) via `video` and `render` groups.
5. Generates `.env` with auto-generated secure tokens (`WORKER_API_KEY`, `HUD_TOKEN`).

Apply user group permissions (or log out and back in):
```bash
newgrp docker
```

---

## 3. Starting the Worker Stack

Launch all services with Docker Compose:

```bash
docker compose up --build -d
```

### What Happens on Startup (Flow):
1. **Ollama AMD** boots on `http://127.0.0.1:11434` accessing the RX 9060 XT.
2. **Ollama NVIDIA** boots on `http://127.0.0.1:11435` accessing the GTX 1060.
3. **Startup Entrypoint** waits for both Ollama servers to become healthy.
4. **Primary Model Warm-up**: It pulls `nemotron-3.5-bolt:e4b` (if not already downloaded) and loads it into AMD VRAM with `keep_alive: -1`.
5. **Background Pulls**: Verifies and pulls required tool models (`lfm2.5:8b` and `qwen3-vl:4b`).
6. **Worker Services Start**: Launches Node.js (`server.ts`), exposure service (`exposureService.ts`), and HUD (`npm run hud:dev`).
7. **Runtimes Online**: Python Tool Runtime (`:8002`) and Speech Runtime (`:9000`) spawn. Speech automatically starts the Kokoro Engine (`:6103`) inside `venv-nvidia` on the GTX 1060.

---

## 4. Service Endpoints & Verification

| Service | Port | Endpoint / URL | Purpose |
| :--- | :--- | :--- | :--- |
| **Worker HUD** | `5173` | http://localhost:5173 | Web GUI Dashboard |
| **Worker API** | `3001` | http://localhost:3001/capabilities | Health, tools, telemetry |
| **Exposure Service** | `3443` | http://localhost:3443/status | Cloudflare Tunnel status |
| **Python Runtime** | `8002` | http://localhost:8002/health | OCR, Layout, Vision, LangGraph |
| **Speech Runtime** | `9000` | http://localhost:9000/health | TTS / STT Gateway |
| **Kokoro Engine** | `6103` | http://localhost:6103/v1/health | Dedicated CUDA TTS Engine |
| **Ollama AMD** | `11434`| http://localhost:11434/api/tags | RX 9060 XT (Chatbot & Vision) |
| **Ollama NVIDIA**| `11435`| http://localhost:11435/api/tags | GTX 1060 (Embeddings & Auxiliary)|

### Quick Verification Commands:
```bash
# Check running containers
docker compose ps

# Tail all logs live
docker compose logs -f

# Check AMD Ollama loaded models
curl -s http://localhost:11434/api/ps | jq

# Test speech synthesis via Kokoro
curl -s -X POST http://localhost:9000/tts \
  -H "Content-Type: application/json" \
  -d '{"text": "Hello from n0th1ng AI on Linux", "voice": "af_heart"}' \
  --output test_speech.wav

# Check GPU VRAM allocation
nvidia-smi
rocm-smi
```

---

## 5. Lifecycle Management

```bash
# Stop all services
docker compose down

# Restart the stack
docker compose restart

# View logs for a specific service
docker compose logs -f worker
docker compose logs -f ollama-amd
docker compose logs -f ollama-nvidia
```
