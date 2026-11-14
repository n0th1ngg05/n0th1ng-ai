FROM nvidia/cuda:12.1.1-runtime-ubuntu22.04

# Prevent interactive prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1
ENV NODE_ENV=production

# Install essential system dependencies, build tools, audio libraries, and Python 3.11
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    gnupg \
    git \
    build-essential \
    pkg-config \
    ffmpeg \
    sox \
    libsox-fmt-all \
    libgl1 \
    libglib2.0-0 \
    software-properties-common \
    net-tools \
    iputils-ping \
    && add-apt-repository -y ppa:deadsnakes/ppa \
    && apt-get update && apt-get install -y --no-install-recommends \
    python3.11 \
    python3.11-venv \
    python3.11-dev \
    python3.11-distutils \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && curl -fsSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared \
    && chmod +x /usr/local/bin/cloudflared \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app/worker

# Install Node dependencies
COPY package.json package-lock.json ./
RUN npm install

# Install HUD dependencies
COPY hud/package.json hud/package-lock.json ./hud/
RUN cd hud && npm install

# Copy application files
COPY . .

# Normalize line endings and set execution permission for shell scripts
RUN sed -i 's/\r$//' entrypoint.sh && chmod +x entrypoint.sh

# 1. python-runtime venv (PyTorch CPU for Surya OCR, PaddleOCR, Marker)
RUN python3.11 -m venv /app/worker/python-runtime/.venv \
    && /app/worker/python-runtime/.venv/bin/pip install --no-cache-dir --upgrade pip setuptools wheel \
    && /app/worker/python-runtime/.venv/bin/pip install --no-cache-dir torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cpu \
    && /app/worker/python-runtime/.venv/bin/pip install --no-cache-dir paddlepaddle \
    && /app/worker/python-runtime/.venv/bin/pip install --no-cache-dir -r /app/worker/python-runtime/python-requirements.txt

# 2. speech-runtime venv
RUN python3.11 -m venv /app/worker/speech-runtime/.venv \
    && /app/worker/speech-runtime/.venv/bin/pip install --no-cache-dir --upgrade pip setuptools wheel \
    && /app/worker/speech-runtime/.venv/bin/pip install --no-cache-dir -r /app/worker/speech-runtime/requirements-linux.txt

# 3. Kokoro venv-nvidia (CUDA 12.1 PyTorch dedicated for NVIDIA GTX 1060)
RUN python3.11 -m venv /app/worker/speech-runtime/engines/kokoro/venv-nvidia \
    && /app/worker/speech-runtime/engines/kokoro/venv-nvidia/bin/pip install --no-cache-dir --upgrade pip setuptools wheel \
    && /app/worker/speech-runtime/engines/kokoro/venv-nvidia/bin/pip install --no-cache-dir torch==2.3.1 torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121 \
    && /app/worker/speech-runtime/engines/kokoro/venv-nvidia/bin/pip install --no-cache-dir -r /app/worker/speech-runtime/engines/kokoro/requirements-linux.txt

# Set dedicated Kokoro environment variables
ENV KOKORO_PYTHON=/app/worker/speech-runtime/engines/kokoro/venv-nvidia/bin/python

# Ports: Worker (3001), Exposure (3443), HUD (5173), Python (8002), Speech (9000), Kokoro (6103)
EXPOSE 3001 3443 5173 8002 9000 6103

ENTRYPOINT ["/app/worker/entrypoint.sh"]
