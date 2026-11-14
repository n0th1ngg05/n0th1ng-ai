#!/usr/bin/env bash
# ==============================================================================
# setup-linux.sh — Host Preparation for n0th1ng AI Worker (Dual-GPU Ubuntu)
# Run with: sudo ./setup-linux.sh
# ==============================================================================
set -e

if [ "$EUID" -ne 0 ]; then
    echo "ERROR: Please run this script with sudo: sudo ./setup-linux.sh"
    exit 1
fi

ACTUAL_USER="${SUDO_USER:-$USER}"
echo "=========================================================="
echo "  Setting up Host Environment for AI Worker on Ubuntu     "
echo "  Target User: ${ACTUAL_USER}                             "
echo "=========================================================="

# ── 1. Detect GPUs ──────────────────────────────────────────────────────
echo ""
echo "==> 1. Checking GPU Hardware..."
lspci | grep -Ei "vga|3d|display" || true

if command -v nvidia-smi > /dev/null 2>&1; then
    echo "[OK] NVIDIA driver detected:"
    nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv,noheader
else
    echo "[WARN] nvidia-smi not found. Ensure NVIDIA proprietary drivers are installed."
fi

if [ -e "/dev/kfd" ] && [ -d "/dev/dri" ]; then
    echo "[OK] AMD ROCm device nodes (/dev/kfd, /dev/dri) detected."
else
    echo "[WARN] /dev/kfd or /dev/dri not found. Ensure AMD ROCm drivers are loaded."
fi

# ── 2. Storage Setup on Secondary Partition (/data) ─────────────────────
echo ""
echo "==> 2. Setting up Storage Directories on /data..."
STORAGE_PATH="/data"

if [ ! -d "${STORAGE_PATH}" ]; then
    echo "[INFO] Creating ${STORAGE_PATH} directory..."
    mkdir -p "${STORAGE_PATH}"
fi

mkdir -p "${STORAGE_PATH}/docker"
mkdir -p "${STORAGE_PATH}/models/ollama"
mkdir -p "${STORAGE_PATH}/models/huggingface"

chown -R "${ACTUAL_USER}:${ACTUAL_USER}" "${STORAGE_PATH}/models"
chmod -R 775 "${STORAGE_PATH}/models"

echo "[OK] Storage directories ready at ${STORAGE_PATH}."

# ── 3. Install Docker and Docker Compose ─────────────────────────────────
echo ""
echo "==> 3. Installing / Updating Docker & Docker Compose..."
if ! command -v docker > /dev/null 2>&1; then
    apt-get update
    apt-get install -y ca-certificates curl gnupg lsb-release
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg --yes
    chmod a+r /etc/apt/keyrings/docker.gpg
    echo \
      "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
      $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
    apt-get update
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    echo "[OK] Docker installed."
else
    echo "[OK] Docker is already installed."
fi

# ── 3.1. Install Host Toolchains (Node.js 20 LTS, Python 3.11, Cloudflared) ─
echo ""
echo "==> 3.1. Installing Host Toolchains (Node.js 20, Python 3.11, Cloudflared)..."
apt-get install -y --no-install-recommends \
    ca-certificates curl gnupg git build-essential pkg-config \
    ffmpeg sox libsox-fmt-all libgl1 libglib2.0-0 software-properties-common \
    net-tools iputils-ping jq openssl

# Node.js 20 LTS
if ! command -v node > /dev/null 2>&1 || [ "$(node -v | cut -d'.' -f1)" != "v20" ]; then
    echo "[INFO] Installing Node.js 20.x..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
    echo "[OK] Node.js $(node -v) and npm $(npm -v) installed."
else
    echo "[OK] Node.js $(node -v) is already installed."
fi

# Python 3.11
if ! command -v python3.11 > /dev/null 2>&1; then
    echo "[INFO] Installing Python 3.11..."
    add-apt-repository -y ppa:deadsnakes/ppa
    apt-get update
    apt-get install -y python3.11 python3.11-venv python3.11-dev python3-pip
    echo "[OK] Python $(python3.11 --version) installed."
else
    echo "[OK] Python $(python3.11 --version) is already installed."
fi

# Cloudflared
if ! command -v cloudflared > /dev/null 2>&1; then
    echo "[INFO] Installing cloudflared..."
    curl -fsSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared
    chmod +x /usr/local/bin/cloudflared
    echo "[OK] cloudflared installed."
else
    echo "[OK] cloudflared is already installed."
fi

# ── 4. Install NVIDIA Container Toolkit ─────────────────────────────────
echo ""
echo "==> 4. Configuring NVIDIA Container Toolkit..."
if ! command -v nvidia-ctk > /dev/null 2>&1; then
    curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg --yes
    curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list | \
      sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | \
      tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
    apt-get update
    apt-get install -y nvidia-container-toolkit
    nvidia-ctk runtime configure --runtime=docker
    echo "[OK] NVIDIA Container Toolkit installed and configured."
else
    echo "[OK] NVIDIA Container Toolkit already present."
fi

# ── 5. Configure Docker Daemon (/data/docker & NVIDIA runtime) ──────────
echo ""
echo "==> 5. Configuring Docker Daemon (/etc/docker/daemon.json)..."
cat <<EOF > /etc/docker/daemon.json
{
  "data-root": "${STORAGE_PATH}/docker",
  "default-runtime": "nvidia",
  "runtimes": {
    "nvidia": {
      "path": "nvidia-container-runtime",
      "runtimeArgs": []
    }
  }
}
EOF

systemctl daemon-reload
systemctl restart docker
echo "[OK] Docker daemon restarted with /data/docker data-root."

# ── 6. User Groups (Docker, Video, Render) ──────────────────────────────
echo ""
echo "==> 6. Adding user '${ACTUAL_USER}' to docker, video, render groups..."
usermod -aG docker "${ACTUAL_USER}"
usermod -aG video "${ACTUAL_USER}"
usermod -aG render "${ACTUAL_USER}"
echo "[OK] Group permissions updated."

# ── 7. Generate .env if missing ─────────────────────────────────────────
echo ""
echo "==> 7. Initializing .env configuration..."
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}"

if [ ! -f ".env" ]; then
    echo "[INFO] Generating .env from .env.example with secure random keys..."
    cp .env.example .env
    RAND_API_KEY=$(openssl rand -hex 32)
    RAND_HUD_TOKEN=$(openssl rand -hex 16)
    sed -i "s/replace_with_worker_api_key_32_chars/${RAND_API_KEY}/" .env
    sed -i "s/replace_with_hud_token_16_chars/${RAND_HUD_TOKEN}/" .env
    chown "${ACTUAL_USER}:${ACTUAL_USER}" .env
    echo "[OK] .env generated with WORKER_API_KEY and HUD_TOKEN."
else
    echo "[OK] Existing .env file found."
fi

echo ""
echo "=========================================================="
echo "  Setup Complete!                                         "
echo "  To launch the worker stack:                             "
echo "    1. Log out and back in (or run: newgrp docker)        "
echo "    2. cd ${SCRIPT_DIR}                                   "
echo "    3. docker compose up --build -d                       "
echo "                                                          "
echo "  Interfaces:                                             "
echo "    - HUD Dashboard: http://localhost:5173                "
echo "    - Worker Status: http://localhost:3001/ping           "
echo "    - AMD Ollama   : http://localhost:11434               "
echo "    - NVIDIA Ollama: http://localhost:11435               "
echo "=========================================================="
