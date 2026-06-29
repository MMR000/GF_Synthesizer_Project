#!/usr/bin/env bash
# 01_try_vllm_omni.sh — start the Higgs Audio v3 TTS server via vLLM-Omni.
#
# Diagnosis baked in:
#   vllm-omni imports the `vllm` package at startup. If `vllm` is not installed
#   in the env you get: ModuleNotFoundError: No module named 'vllm'.
#   This script checks for it and (optionally) installs a matching vllm first.
#
# All output (and the server log) goes to logs/vllm_omni_server.log.
#
# Env knobs (override on the command line, e.g. `PORT=8095 bash 01_try_vllm_omni.sh`):
#   PORT                 server port            (default 8095)
#   HOST                 bind host              (default 0.0.0.0)
#   GPU_MEM_UTIL         vLLM gpu mem fraction  (default 0.55  -> ~13.5GB of 24GB)
#   MAX_MODEL_LEN        max context length     (default 4096)
#   AUTO_INSTALL_VLLM    1 to auto-install vllm if missing (default 0; the 'vllm' env already has it)
#   VLLM_VERSION         pinned vllm version    (default 0.22.1, matches vllm-omni 0.22.0)
#   CONDA_ENV            env to serve from      (default 'vllm' — has torch 2.11 + vllm 0.22.1 + vllm-omni)
#
# IMPORTANT (verified on this machine):
#   * There is NO `--omni` flag in this vllm-omni build; the script tries it for
#     completeness but the working invocation is plain `vllm-omni serve ...`.
#   * vllm-omni 0.22.0 only registers Higgs Audio *v2* architectures. This model is
#     Higgs Audio *v3* (HiggsMultimodalQwen3ForConditionalGeneration), which is NOT in
#     the registry, so loading is expected to FAIL with an unsupported-architecture
#     error. For v3, use the SGLang-Omni path: scripts/02_try_sglang_docker.sh

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_DIR="$PROJECT_DIR/logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/vllm_omni_server.log"

MODEL_DIR="/home/mmr/models/higgs-audio-v3-tts-4b"
CONDA_ENV="${CONDA_ENV:-vllm}"

PORT="${PORT:-8095}"
HOST="${HOST:-0.0.0.0}"
GPU_MEM_UTIL="${GPU_MEM_UTIL:-0.85}"
MAX_MODEL_LEN="${MAX_MODEL_LEN:-4096}"
AUTO_INSTALL_VLLM="${AUTO_INSTALL_VLLM:-0}"
VLLM_VERSION="${VLLM_VERSION:-0.22.1}"

# Tee everything to the log file.
exec > >(tee "$LOG_FILE") 2>&1

echo "=================================================================="
echo " vLLM-Omni server attempt"
echo " date: $(date)"
echo " model: $MODEL_DIR"
echo " host:port = $HOST:$PORT"
echo "=================================================================="

# --- activate env -------------------------------------------------------
if [ -f /home/mmr/miniconda3/etc/profile.d/conda.sh ]; then
  # shellcheck disable=SC1091
  source /home/mmr/miniconda3/etc/profile.d/conda.sh
  conda activate "$CONDA_ENV" || { echo "[fatal] cannot activate conda env $CONDA_ENV"; exit 1; }
  echo "[ok] activated conda env: $CONDA_ENV ($(which python))"
else
  echo "[fatal] /home/mmr/miniconda3/etc/profile.d/conda.sh not found"; exit 1
fi

# --- sanity: model dir --------------------------------------------------
if [ ! -f "$MODEL_DIR/config.json" ]; then
  echo "[fatal] $MODEL_DIR/config.json not found — bad model path"; exit 1
fi

# --- ensure `vllm` python module is importable --------------------------
echo
echo "----- checking that the 'vllm' module is importable -----"
if python -c "import vllm" 2>/dev/null; then
  echo "[ok] vllm importable: $(python -c 'import vllm; print(vllm.__version__)')"
else
  echo "[fail] 'vllm' not importable — this is the cause of 'ModuleNotFoundError: No module named vllm'."
  if [ "$AUTO_INSTALL_VLLM" = "1" ]; then
    echo "[info] AUTO_INSTALL_VLLM=1 -> installing vllm==$VLLM_VERSION (matching vllm-omni)."
    echo "[info] NOTE: this may take several minutes and pull large wheels."
    pip install "vllm==$VLLM_VERSION"
    if python -c "import vllm" 2>/dev/null; then
      echo "[ok] vllm now importable: $(python -c 'import vllm; print(vllm.__version__)')"
    else
      echo "[fatal] vllm still not importable after install. See errors above."
      echo "        Try a different VLLM_VERSION, or run inside the existing 'vllm' conda env."
      exit 1
    fi
  else
    echo "[fatal] AUTO_INSTALL_VLLM=0 and vllm missing. Install it with:"
    echo "          conda activate $CONDA_ENV && pip install vllm==$VLLM_VERSION"
    exit 1
  fi
fi

# --- pick the right CLI binary -----------------------------------------
# The model card / your prior attempt used `vllm serve --omni` and
# `vllm-omni serve --omni`. We try, in order, whatever exists.
HAS_VLLM=0; HAS_VLLM_OMNI=0
command -v vllm        >/dev/null 2>&1 && HAS_VLLM=1
command -v vllm-omni   >/dev/null 2>&1 && HAS_VLLM_OMNI=1
echo
echo "----- available CLIs: vllm=$HAS_VLLM  vllm-omni=$HAS_VLLM_OMNI -----"

COMMON_ARGS=(
  "$MODEL_DIR"
  --host "$HOST"
  --port "$PORT"
  --trust-remote-code
  --gpu-memory-utilization "$GPU_MEM_UTIL"
  --max-model-len "$MAX_MODEL_LEN"
)

run_and_report() {
  # $@ is the full command. Returns the command's exit code.
  echo
  echo ">>> RUNNING: $*"
  echo ">>> (Ctrl-C to stop the server. Logs -> $LOG_FILE)"
  echo "------------------------------------------------------------------"
  "$@"
}

# Attempt 1: `vllm serve ... --omni` (only if a plain `vllm` binary exists).
if [ "$HAS_VLLM" = "1" ]; then
  echo "[try] vllm serve ... --omni"
  if run_and_report vllm serve "${COMMON_ARGS[@]}" --omni; then
    exit 0
  fi
  echo "[warn] 'vllm serve --omni' exited non-zero; trying without --omni ..."
  if run_and_report vllm serve "${COMMON_ARGS[@]}"; then
    exit 0
  fi
  echo "[warn] 'vllm serve' failed; falling back to vllm-omni ..."
fi

# Attempt 2: `vllm-omni serve ...` (the binary that is actually installed here).
if [ "$HAS_VLLM_OMNI" = "1" ]; then
  echo "[try] vllm-omni serve ... --omni"
  if run_and_report vllm-omni serve "${COMMON_ARGS[@]}" --omni; then
    exit 0
  fi
  echo "[warn] 'vllm-omni serve --omni' exited non-zero; retrying without --omni ..."
  if run_and_report vllm-omni serve "${COMMON_ARGS[@]}"; then
    exit 0
  fi
fi

echo
echo "[fatal] All vLLM-Omni start attempts failed."
echo "        Inspect the last 80 lines of: $LOG_FILE"
echo "        If this is an OOM at load time, lower GPU_MEM_UTIL / MAX_MODEL_LEN,"
echo "        or close GPU-using apps (browser, IDE) to free VRAM, then retry."
echo "        If vLLM-Omni cannot serve this model, switch to SGLang-Omni:"
echo "          bash scripts/02_try_sglang_docker.sh"
exit 1
