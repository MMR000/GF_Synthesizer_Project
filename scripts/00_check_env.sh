#!/usr/bin/env bash
# 00_check_env.sh — environment diagnostics for Higgs Audio v3 TTS test.
# Saves everything to logs/env_check.log (and echoes to the terminal).

set -u

# Resolve project root (this script lives in <root>/scripts/).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_DIR="$PROJECT_DIR/logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/env_check.log"

MODEL_DIR="/home/mmr/models/higgs-audio-v3-tts-4b"
CONDA_ENV="higgs_tts"

# Send all stdout/stderr to both the terminal and the log file.
exec > >(tee "$LOG_FILE") 2>&1

echo "=================================================================="
echo " Higgs Audio v3 TTS — environment check"
echo " date: $(date)"
echo " host: $(hostname)"
echo "=================================================================="

# Activate the conda env if available so the report reflects the env we serve from.
if [ -f /home/mmr/miniconda3/etc/profile.d/conda.sh ]; then
  # shellcheck disable=SC1091
  source /home/mmr/miniconda3/etc/profile.d/conda.sh
  conda activate "$CONDA_ENV" 2>/dev/null && echo "[ok] activated conda env: $CONDA_ENV" \
    || echo "[warn] could not activate conda env: $CONDA_ENV"
else
  echo "[warn] conda.sh not found; reporting on the current shell environment"
fi

echo
echo "----- which python -----"
which python || echo "[missing] python"

echo
echo "----- python --version -----"
python --version 2>&1 || echo "[missing] python"

echo
echo "----- which pip -----"
which pip || echo "[missing] pip"

echo
echo "----- pip list (filtered) -----"
pip list 2>/dev/null | grep -iE "vllm|omni|torch|transformers|huggingface|xformers" \
  || echo "[none] no matching packages found"

echo
echo "----- relevant CLI entry points -----"
for bin in vllm vllm-omni sgl-omni sglang; do
  p="$(which "$bin" 2>/dev/null)"
  if [ -n "$p" ]; then echo "[found]   $bin -> $p"; else echo "[missing] $bin"; fi
done

echo
echo "----- can python import vllm / vllm_omni? -----"
python - <<'PY' 2>&1 || true
for mod in ("vllm", "vllm_omni"):
    try:
        m = __import__(mod)
        print(f"[ok] import {mod}  version={getattr(m, '__version__', '?')}")
    except Exception as e:
        print(f"[fail] import {mod}: {type(e).__name__}: {e}")
PY

echo
echo "----- torch CUDA availability -----"
python - <<'PY' 2>&1 || true
try:
    import torch
    print("torch:", torch.__version__)
    print("cuda available:", torch.cuda.is_available())
    print("torch cuda build:", torch.version.cuda)
    if torch.cuda.is_available():
        print("device:", torch.cuda.get_device_name(0))
except Exception as e:
    print("[fail] torch check:", type(e).__name__, e)
PY

echo
echo "----- nvidia-smi -----"
nvidia-smi || echo "[warn] nvidia-smi failed (driver issue or no permission)"

echo
echo "----- free / total VRAM (csv) -----"
nvidia-smi --query-gpu=name,memory.total,memory.used,memory.free,driver_version --format=csv \
  || echo "[warn] could not query VRAM"

echo
echo "----- nvcc --version -----"
nvcc --version || true

echo
echo "----- model dir size: $MODEL_DIR -----"
du -sh "$MODEL_DIR" 2>&1 || echo "[missing] $MODEL_DIR"

echo
echo "----- first-level contents of model dir -----"
ls -lh "$MODEL_DIR" 2>&1 || echo "[missing] $MODEL_DIR"

echo
echo "----- config.json present? -----"
if [ -f "$MODEL_DIR/config.json" ]; then
  echo "[ok] config.json exists"
else
  echo "[fail] config.json NOT found"
fi

echo
echo "----- .safetensors present? -----"
shopt -s nullglob
safetensors=("$MODEL_DIR"/*.safetensors)
if [ ${#safetensors[@]} -gt 0 ]; then
  echo "[ok] found ${#safetensors[@]} safetensors file(s):"
  for f in "${safetensors[@]}"; do echo "      $(basename "$f")"; done
else
  echo "[fail] no .safetensors files found in $MODEL_DIR"
fi
shopt -u nullglob

echo
echo "=================================================================="
echo " env check complete -> $LOG_FILE"
echo "=================================================================="
