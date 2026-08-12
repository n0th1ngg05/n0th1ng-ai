@echo off
setlocal enabledelayedexpansion
REM ============================================================
REM  Stage 4: Grade + Encode
REM  Takes Stage 3's interpolated frame sequence and applies:
REM  LUT color grade, subtle film grain, sharpening, then
REM  encodes with three presets.
REM
REM  EDIT THESE FOR YOUR SETUP:
REM ============================================================
set FRAME_DIR=D:\AI\ComfyUI\output\Gen3\Stage3
set FRAME_PREFIX=ltx_stage3_interpolated_
set START_NUMBER=691
set FRAME_RATE=48
set LUT_FILE=C:/ComfyUI/luts/your_look.cube
set OUTPUT_DIR=D:\AI\ComfyUI\output\Gen3\Stage3
REM ============================================================

REM Build the ffmpeg sequence pattern with delayed expansion (!...!)
REM so the %%05d survives intact - a plain "set" line silently
REM breaks this because %% only collapses to % in directly-executed
REM lines, not when stored in a variable and expanded later.
set "INPUT_PATTERN=!FRAME_DIR!\!FRAME_PREFIX!%%05d_.png"

if not exist "%LUT_FILE%" (
    echo [WARNING] LUT file not found at %LUT_FILE%
    echo Grab a free .cube LUT and update LUT_FILE above.
    echo Skipping LUT this run - continuing with grain/sharpen/encode only.
    set SKIP_LUT=1
)

echo.
echo === Building filter chain ===

set "BASE_GRADE=eq=contrast=1.03:saturation=1.05:brightness=0.0"

if not defined SKIP_LUT (
    set "LUT_ESCAPED=!LUT_FILE:\=/!"
    set "LUT_ESCAPED=!LUT_ESCAPED:C:=C\:!"
    set "LUT_FILTER=,lut3d='!LUT_ESCAPED!'"
) else (
    set "LUT_FILTER="
)

set "SHARPEN=unsharp=5:5:0.5:5:5:0.0"
set "GRAIN=noise=alls=6:allf=t+u"
set "FILTERS=!BASE_GRADE!!LUT_FILTER!,!SHARPEN!,!GRAIN!"

echo Input pattern: !INPUT_PATTERN!
echo Start number:  !START_NUMBER!
echo Filter chain:  !FILTERS!
echo Output dir:    !OUTPUT_DIR!
echo.

if not exist "!OUTPUT_DIR!" mkdir "!OUTPUT_DIR!"

REM ============================================================
REM  ENCODE PRESETS
REM ============================================================

echo === Encoding: Web/Sharing preset (H.264) ===
ffmpeg -y -start_number !START_NUMBER! -framerate !FRAME_RATE! -i "!INPUT_PATTERN!" ^
  -vf "!FILTERS!" ^
  -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p ^
  -movflags +faststart ^
  "!OUTPUT_DIR!\output_web_h264.mp4"

echo.
echo === Encoding: High-quality archival preset (H.265) ===
ffmpeg -y -start_number !START_NUMBER! -framerate !FRAME_RATE! -i "!INPUT_PATTERN!" ^
  -vf "!FILTERS!" ^
  -c:v libx265 -preset medium -crf 20 -pix_fmt yuv420p10le ^
  -tag:v hvc1 ^
  "!OUTPUT_DIR!\output_archival_h265.mp4"

echo.
echo === Encoding: Lossless/mezzanine preset (for further editing) ===
ffmpeg -y -start_number !START_NUMBER! -framerate !FRAME_RATE! -i "!INPUT_PATTERN!" ^
  -vf "!FILTERS!" ^
  -c:v libx264 -preset veryslow -crf 0 -pix_fmt yuv444p ^
  "!OUTPUT_DIR!\output_mezzanine_lossless.mp4"

echo.
echo === Done. Outputs written to: !OUTPUT_DIR! ===
echo   output_web_h264.mp4
echo   output_archival_h265.mp4
echo   output_mezzanine_lossless.mp4
echo.
pause