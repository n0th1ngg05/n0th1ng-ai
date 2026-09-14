# ==============================================================================
# check-gpu.ps1 - Worker GPU and ROCm Health Check
# Run from: D:\AI\worker\
# Usage: .\check-gpu.ps1
# ==============================================================================

function Write-Header($msg) {
    Write-Host "`n======================================" -ForegroundColor Cyan
    Write-Host "  $msg" -ForegroundColor Cyan
    Write-Host "======================================" -ForegroundColor Cyan
}

function Write-OK($msg)   { Write-Host "  [OK]   $msg" -ForegroundColor Green }
function Write-WARN($msg) { Write-Host "  [WARN] $msg" -ForegroundColor Yellow }
function Write-FAIL($msg) { Write-Host "  [FAIL] $msg" -ForegroundColor Red }

# ------------------------------------------------------------------------------
Write-Header "1. GPU Detection (Windows)"
# ------------------------------------------------------------------------------

$gpus = Get-WmiObject Win32_VideoController | Select-Object Name, DriverVersion, Status
foreach ($gpu in $gpus) {
    if ($gpu.Name -match "AMD|Radeon|RX") {
        Write-OK "AMD GPU : $($gpu.Name)"
        Write-OK "Driver  : $($gpu.DriverVersion)"
    } elseif ($gpu.Name -match "NVIDIA") {
        Write-WARN "NVIDIA GPU found (not target): $($gpu.Name)"
    } elseif ($gpu.Name -match "Parsec") {
        Write-WARN "Virtual display: $($gpu.Name) (Parsec remote)"
    } else {
        Write-WARN "Other display: $($gpu.Name)"
    }
}

# ------------------------------------------------------------------------------
Write-Header "2. ROCm / HIP SDK Installation"
# ------------------------------------------------------------------------------

$rocmPath1 = "C:\Program Files\AMD\ROCm"
$rocmPath2 = "C:\Program Files\AMD HIP SDK"

if (Test-Path $rocmPath1) {
    $ver = Get-ChildItem $rocmPath1 | Select-Object -ExpandProperty Name
    Write-OK "ROCm found at: $rocmPath1"
    Write-OK "Version(s): $($ver -join ', ')"
} else {
    Write-FAIL "ROCm NOT found at: $rocmPath1"
}

if (Test-Path $rocmPath2) {
    Write-OK "HIP SDK found at: $rocmPath2"
} else {
    Write-WARN "HIP SDK not at $rocmPath2 (may be bundled inside ROCm path)"
}

$hipcc = Get-Command hipcc -ErrorAction SilentlyContinue
if ($hipcc) {
    Write-OK "hipcc in PATH: $($hipcc.Source)"
} else {
    Write-WARN "hipcc not in PATH (not required if using pip-based ROCm SDK)"
}

# Check pip-installed ROCm SDK packages in speech-runtime venv
Write-Host "`n  Checking pip-installed ROCm SDK packages..." -ForegroundColor Gray
$venvPip = "$PSScriptRoot\speech-runtime\.venv\Scripts\pip.exe"
if (Test-Path $venvPip) {
    $rocmPkgs = & $venvPip list 2>$null | Select-String "rocm"
    if ($rocmPkgs) {
        foreach ($pkg in $rocmPkgs) { Write-OK "pip: $($pkg.Line.Trim())" }
    } else {
        Write-FAIL "ROCm SDK pip packages not found in speech-runtime venv"
    }
} else {
    Write-WARN "speech-runtime venv not found, skipping pip ROCm check"
}

# ------------------------------------------------------------------------------
Write-Header "3. PyTorch GPU Check - python-runtime"
# ------------------------------------------------------------------------------

$pyPython = "$PSScriptRoot\python-runtime\.venv\Scripts\python.exe"
if (Test-Path $pyPython) {
    $result = & $pyPython -c "import torch; v=torch.__version__; a=torch.cuda.is_available(); g=torch.cuda.get_device_name(0) if a else 'N/A'; print(v+'|'+str(a)+'|'+g)" 2>&1
    if ($result -match "\|") {
        $parts = $result -split "\|"
        $torchVer = $parts[0].Trim()
        $gpuAvail = $parts[1].Trim()
        $gpuName  = $parts[2].Trim()
        Write-OK  "torch version : $torchVer"
        if ($gpuAvail -eq "True") {
            Write-OK  "GPU available : True"
            Write-OK  "GPU name      : $gpuName"
        } else {
            Write-FAIL "GPU available : False (got: $torchVer)"
        }
    } else {
        Write-FAIL "torch import failed: $result"
    }
} else {
    Write-FAIL "python-runtime venv not found"
}

# ------------------------------------------------------------------------------
Write-Header "4. PyTorch GPU Check - speech-runtime"
# ------------------------------------------------------------------------------

$speechPython = "$PSScriptRoot\speech-runtime\.venv\Scripts\python.exe"
if (Test-Path $speechPython) {
    $result = & $speechPython -c "import torch; v=torch.__version__; a=torch.cuda.is_available(); g=torch.cuda.get_device_name(0) if a else 'N/A'; print(v+'|'+str(a)+'|'+g)" 2>&1
    if ($result -match "\|") {
        $parts = $result -split "\|"
        $torchVer = $parts[0].Trim()
        $gpuAvail = $parts[1].Trim()
        $gpuName  = $parts[2].Trim()
        Write-OK  "torch version : $torchVer"
        if ($gpuAvail -eq "True") {
            Write-OK  "GPU available : True"
            Write-OK  "GPU name      : $gpuName"
        } else {
            Write-FAIL "GPU available : False (got: $torchVer)"
        }
    } else {
        Write-FAIL "torch import failed: $result"
    }
} else {
    Write-FAIL "speech-runtime venv not found"
}

# ------------------------------------------------------------------------------
Write-Header "5. PyTorch GPU Check - kokoro-runtime"
# ------------------------------------------------------------------------------

$kokoroPython = "$PSScriptRoot\speech-runtime\engines\kokoro\.venv\Scripts\python.exe"
if (Test-Path $kokoroPython) {
    $result = & $kokoroPython -c "import torch; v=torch.__version__; a=torch.cuda.is_available(); g=torch.cuda.get_device_name(0) if a else 'N/A'; print(v+'|'+str(a)+'|'+g)" 2>&1
    if ($result -match "\|") {
        $parts = $result -split "\|"
        $torchVer = $parts[0].Trim()
        $gpuAvail = $parts[1].Trim()
        $gpuName  = $parts[2].Trim()
        Write-OK  "torch version : $torchVer"
        if ($gpuAvail -eq "True") {
            Write-OK  "GPU available : True"
            Write-OK  "GPU name      : $gpuName"
        } else {
            Write-FAIL "GPU available : False (got: $torchVer)"
        }
    } else {
        Write-FAIL "torch import failed: $result"
    }
} else {
    Write-FAIL "kokoro venv not found"
}

# ------------------------------------------------------------------------------
Write-Header "6. Live GPU Tensor Operation Test"
# ------------------------------------------------------------------------------

Write-Host "  Running live tensor op on GPU via speech-runtime..." -ForegroundColor Gray
if (Test-Path $speechPython) {
    $liveTest = & $speechPython -c "import torch; t=torch.tensor([1.0,2.0,3.0]); t=t.cuda() if torch.cuda.is_available() else t; r=t.sum().item(); print('DEVICE:'+str(t.device)+'|RESULT:'+str(r))" 2>&1
    if ($liveTest -match "DEVICE:") {
        $dev = ($liveTest -split "DEVICE:")[1].Split("|")[0].Trim()
        $res = ($liveTest -split "RESULT:")[1].Trim()
        if ($dev -match "cuda") {
            Write-OK "Tensor ran on : $dev (ROCm GPU)"
            Write-OK "Result        : $res (expected 6.0)"
        } else {
            Write-WARN "Tensor ran on : $dev (CPU fallback - ROCm not active)"
        }
    } else {
        Write-FAIL "Live test failed: $liveTest"
    }
} else {
    Write-FAIL "speech-runtime venv not found, skipping live test"
}

# ------------------------------------------------------------------------------
Write-Header "Summary"
# ------------------------------------------------------------------------------
Write-Host ""
Write-Host "  All [OK] green  = fully working ROCm setup" -ForegroundColor White
Write-Host "  Any [FAIL] red  = needs attention" -ForegroundColor White
Write-Host "  Any [WARN] yellow = informational only" -ForegroundColor White
Write-Host ""
