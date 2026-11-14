#!/usr/bin/env bash
set -e

echo "=========================================================="
echo "          Starting n0th1ng AI Worker Daemon               "
echo "  Hardware Target: AMD RX 9060 XT (ROCm) + GTX 1060 (CUDA)"
echo "=========================================================="

OLLAMA_AMD_URL="${OLLAMA_AMD_HOST:-http://127.0.0.1:11434}"
OLLAMA_NVIDIA_URL="${OLLAMA_NVIDIA_HOST:-http://127.0.0.1:11435}"
PRIMARY_MODEL="${PRIMARY_LLM_MODEL:-nemotron-3.5-bolt:e4b}"

# ── 1. Wait for Ollama Dual Instances ──────────────────────────────────
echo "[WORKER STARTUP] Waiting for Ollama AMD (${OLLAMA_AMD_URL})..."
until curl -s "${OLLAMA_AMD_URL}/api/tags" > /dev/null 2>&1; do
    echo "  [WAIT] Ollama AMD is starting up..."
    sleep 2
done
echo "  [OK] Ollama AMD is online."

echo "[WORKER STARTUP] Waiting for Ollama NVIDIA (${OLLAMA_NVIDIA_URL})..."
until curl -s "${OLLAMA_NVIDIA_URL}/api/tags" > /dev/null 2>&1; do
    echo "  [WAIT] Ollama NVIDIA is starting up..."
    sleep 2
done
echo "  [OK] Ollama NVIDIA is online."

# ── 2. Primary Chatbot Resident Model (nemotron-3.5-bolt:e4b) ─────────
echo "[WORKER STARTUP] Checking primary resident model '${PRIMARY_MODEL}' on AMD GPU..."
TAGS=$(curl -s "${OLLAMA_AMD_URL}/api/tags" || echo "")

if echo "$TAGS" | grep -q "\"${PRIMARY_MODEL}\""; then
    echo "  [OK] Model '${PRIMARY_MODEL}' already pulled."
else
    echo "  [PULL] Model '${PRIMARY_MODEL}' not found. Pulling now to /data/models/ollama..."
    curl -X POST "${OLLAMA_AMD_URL}/api/pull" -d "{\"name\": \"${PRIMARY_MODEL}\", \"stream\": false}"
    echo "  [OK] Model '${PRIMARY_MODEL}' downloaded successfully."
fi

echo "[WORKER STARTUP] Pre-warming '${PRIMARY_MODEL}' into RX 9060 XT VRAM (keep_alive: -1)..."
curl -s -X POST "${OLLAMA_AMD_URL}/api/generate" \
    -H "Content-Type: application/json" \
    -d "{\"model\": \"${PRIMARY_MODEL}\", \"prompt\": \"status\", \"keep_alive\": -1}" > /dev/null || true
echo "  [OK] '${PRIMARY_MODEL}' is resident in AMD VRAM."

# ── 3. Background Verification of Tool Models ───────────────────────────
(
    for tool_model in "lfm2.5:8b" "qwen3-vl:4b"; do
        if ! echo "$TAGS" | grep -q "\"${tool_model}\""; then
            echo "  [BACKGROUND] Pulling worker tool model '${tool_model}' on AMD Ollama..."
            curl -s -X POST "${OLLAMA_AMD_URL}/api/pull" -d "{\"name\": \"${tool_model}\", \"stream\": false}" > /dev/null 2>&1 || true
            echo "  [BACKGROUND] '${tool_model}' is ready."
        fi
    done
) &

# ── 4. Verify Virtual Environments ──────────────────────────────────────
echo "[WORKER STARTUP] Verifying Python runtimes..."
if [ ! -f "/app/worker/python-runtime/.venv/bin/python" ]; then
    echo "  [WARN] python-runtime .venv missing, creating..."
    python3.11 -m venv /app/worker/python-runtime/.venv
    /app/worker/python-runtime/.venv/bin/pip install --no-cache-dir torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cpu
    /app/worker/python-runtime/.venv/bin/pip install --no-cache-dir paddlepaddle -r /app/worker/python-runtime/python-requirements.txt
fi

if [ ! -f "/app/worker/speech-runtime/engines/kokoro/venv-nvidia/bin/python" ]; then
    echo "  [WARN] Kokoro venv-nvidia missing, creating..."
    python3.11 -m venv /app/worker/speech-runtime/engines/kokoro/venv-nvidia
    /app/worker/speech-runtime/engines/kokoro/venv-nvidia/bin/pip install --no-cache-dir torch==2.3.1 torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121
    /app/worker/speech-runtime/engines/kokoro/venv-nvidia/bin/pip install --no-cache-dir -r /app/worker/speech-runtime/engines/kokoro/requirements-linux.txt
fi

export KOKORO_PYTHON="/app/worker/speech-runtime/engines/kokoro/venv-nvidia/bin/python"

# ── 5. Start Worker Services (npm run dev) ──────────────────────────────
echo "=========================================================="
echo "  Launching Worker Node + Exposure + Vite HUD             "
echo "  Worker API   : http://localhost:3001                    "
echo "  Exposure     : http://localhost:3443                    "
echo "  HUD Interface: http://localhost:5173                    "
echo "=========================================================="

exec npm run dev
