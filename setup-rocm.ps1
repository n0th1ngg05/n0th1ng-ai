# ==============================================================================
# setup-rocm.ps1 — Worker Machine AMD ROCm Setup
# Run this from:  d:\AI\Chatbot\worker\
#
# BEFORE running this script:
#   1. AMD Adrenalin driver installed
#   2. AMD ROCm / HIP SDK installed
#   3. Python 3.12 in PATH  (verify: python --version)
#
# Usage:
#   .\setup-rocm.ps1
# ==============================================================================

$ErrorActionPreference = "Stop"
$ROCM_INDEX = "https://download.pytorch.org/whl/rocm6.2"
$PADDLE_INDEX = "https://www.paddlepaddle.org.cn/whl/windows/rocm/stable.html"

function Write-Step($msg) {
    Write-Host "`n==> $msg" -ForegroundColor Cyan
}

function Write-Done($msg) {
    Write-Host "    OK: $msg" -ForegroundColor Green
}

# ------------------------------------------------------------------------------
Write-Step "1/3 — python-runtime"
# ------------------------------------------------------------------------------

$pyRuntime = "$PSScriptRoot\python-runtime"

Write-Host "    Creating fresh venv..." -ForegroundColor Yellow
if (Test-Path "$pyRuntime\.venv") {
    Remove-Item -Recurse -Force "$pyRuntime\.venv"
}
python -m venv "$pyRuntime\.venv"

& "$pyRuntime\.venv\Scripts\pip.exe" install --upgrade pip

Write-Host "    Installing CPU PyTorch (python-runtime uses torch for OCR/vision - CPU is fine)..." -ForegroundColor Yellow
& "$pyRuntime\.venv\Scripts\pip.exe" install `
    torch==2.5.1 torchvision==0.20.1 torchaudio==2.5.1

Write-Host "    Installing PaddlePaddle ROCm..." -ForegroundColor Yellow
& "$pyRuntime\.venv\Scripts\pip.exe" install paddlepaddle-rocm `
    -f $PADDLE_INDEX

Write-Host "    Installing all other requirements..." -ForegroundColor Yellow
& "$pyRuntime\.venv\Scripts\pip.exe" install -r "$pyRuntime\requirements-rocm.txt"

Write-Done "python-runtime done"

# ------------------------------------------------------------------------------
Write-Step "2/3 — speech-runtime"
# ------------------------------------------------------------------------------

$speechRuntime = "$PSScriptRoot\speech-runtime"

Write-Host "    Creating fresh venv..." -ForegroundColor Yellow
if (Test-Path "$speechRuntime\.venv") {
    Remove-Item -Recurse -Force "$speechRuntime\.venv"
}
python -m venv "$speechRuntime\.venv"

& "$speechRuntime\.venv\Scripts\pip.exe" install --upgrade pip

Write-Host "    Installing ROCm PyTorch..." -ForegroundColor Yellow
& "$speechRuntime\.venv\Scripts\pip.exe" install `
    torch==2.12.1 torchvision==0.27.1 torchaudio==2.11.0 `
    --index-url $ROCM_INDEX

Write-Host "    Installing all other requirements (incl. onnxruntime-directml)..." -ForegroundColor Yellow
& "$speechRuntime\.venv\Scripts\pip.exe" install -r "$speechRuntime\requirements-rocm.txt"

Write-Done "speech-runtime done"

# ------------------------------------------------------------------------------
Write-Step "3/3 — kokoro-runtime"
# ------------------------------------------------------------------------------

$kokoroRuntime = "$PSScriptRoot\speech-runtime\engines\kokoro"

Write-Host "    Creating fresh venv..." -ForegroundColor Yellow
if (Test-Path "$kokoroRuntime\.venv") {
    Remove-Item -Recurse -Force "$kokoroRuntime\.venv"
}
python -m venv "$kokoroRuntime\.venv"

& "$kokoroRuntime\.venv\Scripts\pip.exe" install --upgrade pip

Write-Host "    Installing ROCm PyTorch..." -ForegroundColor Yellow
& "$kokoroRuntime\.venv\Scripts\pip.exe" install `
    torch==2.13.0 `
    --index-url $ROCM_INDEX

Write-Host "    Installing all other requirements..." -ForegroundColor Yellow
& "$kokoroRuntime\.venv\Scripts\pip.exe" install -r "$kokoroRuntime\requirements-rocm.txt"

Write-Done "kokoro-runtime done"

# ------------------------------------------------------------------------------
Write-Step "Sanity checks"
# ------------------------------------------------------------------------------

Write-Host "`n--- python-runtime GPU check ---" -ForegroundColor Magenta
& "$pyRuntime\.venv\Scripts\python.exe" -c "import torch; print('torch:', torch.__version__); print('GPU available:', torch.cuda.is_available()); print('GPU:', torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'not detected - check ROCm SDK')"

Write-Host "`n--- speech-runtime GPU check ---" -ForegroundColor Magenta
& "$speechRuntime\.venv\Scripts\python.exe" -c "import torch; print('torch:', torch.__version__); print('GPU available:', torch.cuda.is_available()); print('GPU:', torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'not detected - check ROCm SDK')"

Write-Host "`n--- kokoro-runtime GPU check ---" -ForegroundColor Magenta
& "$kokoroRuntime\.venv\Scripts\python.exe" -c "import torch; print('torch:', torch.__version__); print('GPU available:', torch.cuda.is_available())"

Write-Host "`n=== All done! ===" -ForegroundColor Green
Write-Host "If all three show 'GPU available: True', you are good to go." -ForegroundColor Green
Write-Host "Now run:  npm install  then  npm run dev" -ForegroundColor Yellow
