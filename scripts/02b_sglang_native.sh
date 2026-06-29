#!/usr/bin/env bash
# 02b_sglang_native.sh — NO-DOCKER path: build & serve SGLang-Omni natively.
#
# Why this exists: vLLM-Omni 0.22.0 cannot serve Higgs Audio *v3*
# (model type `higgs_multimodal_qwen3` is unknown to it / to transformers).
# SGLang-Omni ships the custom v3 modeling code and officially supports
# bosonai/higgs-audio-v3-tts-4b. Docker isn't installed here (and needs sudo),
# so we build SGLang-Omni in an isolated uv venv instead.
#
# Usage:
#   bash scripts/02b_sglang_native.sh install   # build the env (slow, one-time)
#   bash scripts/02b_sglang_native.sh serve     # start the server on :9000
#   bash scripts/02b_sglang_native.sh           # install (if needed) then serve
#
# Logs:
#   logs/sglang_native_install.log
#   logs/sglang_native_server.log

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_DIR="$PROJECT_DIR/logs"
mkdir -p "$LOG_DIR"

REPO_DIR="${REPO_DIR:-/home/mmr/sglang-omni}"
VENV_DIR="$REPO_DIR/.venv"
MODEL_DIR="/home/mmr/models/higgs-audio-v3-tts-4b"
PORT="${PORT:-9000}"
PYVER="${PYVER:-3.12}"

ensure_uv() {
  if ! command -v uv >/dev/null 2>&1; then
    echo "[info] installing uv (no sudo needed) ..."
    python -m pip install -q uv || pip install -q uv
  fi
  echo "[ok] uv: $(uv --version 2>&1 | head -1)"
}

ensure_repo() {
  if [ ! -f "$REPO_DIR/pyproject.toml" ]; then
    echo "[info] cloning sglang-omni into $REPO_DIR ..."
    git clone https://github.com/sgl-project/sglang-omni.git "$REPO_DIR"
  fi
  echo "[ok] repo: $REPO_DIR"
}

do_install() {
  local log="$LOG_DIR/sglang_native_install.log"
  ensure_uv
  ensure_repo
  cd "$REPO_DIR"
  echo "[info] creating uv venv ($PYVER) and installing -e . (this is slow). Log -> $log"
  {
    echo "==== sglang-omni native install $(date) ===="
    uv venv "$VENV_DIR" -p "$PYVER"
    # shellcheck disable=SC1091
    source "$VENV_DIR/bin/activate"
    uv pip install -v -e .
    echo "==== install exit=$? ===="
    python -c "import sglang, sglang_omni; print('sglang', sglang.__version__)" 2>&1 || true
    which sgl-omni
  } > "$log" 2>&1
  echo "[done] install finished. Tail of log:"
  tail -15 "$log"
}

do_serve() {
  local log="$LOG_DIR/sglang_native_server.log"
  if [ ! -d "$VENV_DIR" ]; then
    echo "[fatal] venv missing at $VENV_DIR — run: bash $0 install"; exit 1
  fi
  # shellcheck disable=SC1091
  source "$VENV_DIR/bin/activate"

  # SGLang JIT-compiles CUDA kernels at runtime with `nvcc`. The system nvcc here
  # is CUDA 12.0, which is too old for these CUDA-13 (c++20) kernels and fails with
  # template errors. Point the JIT at a CUDA 13 toolkit if the system one is < 13.
  # Self-consistent CUDA 13.0 toolkit installed INSIDE this venv (nvcc + crt + nvvm
  # + headers all 13.0, matching torch cu130 and flashinfer's bundled CCCL). Using
  # 13.3 here breaks flashinfer ("CUDA compiler and toolkit headers incompatible").
  CUDA_HOME_OVERRIDE="${CUDA_HOME_OVERRIDE:-$VENV_DIR/lib/python3.12/site-packages/nvidia/cu13}"
  local sys_nvcc_major
  sys_nvcc_major="$(nvcc --version 2>/dev/null | sed -n 's/.*release \([0-9]*\).*/\1/p' | head -1)"
  if [ "${sys_nvcc_major:-0}" -lt 13 ] 2>/dev/null && [ -x "$CUDA_HOME_OVERRIDE/bin/nvcc" ]; then
    export CUDA_HOME="$CUDA_HOME_OVERRIDE"
    export CUDACXX="$CUDA_HOME/bin/nvcc"
    export PATH="$CUDA_HOME/bin:$PATH"
    echo "[info] system nvcc is v${sys_nvcc_major}; switching JIT to CUDA 13 at $CUDA_HOME"
    echo "[info] nvcc now: $(nvcc --version 2>/dev/null | sed -n 's/.*release /release /p')"
  else
    echo "[info] using system nvcc (v${sys_nvcc_major:-unknown})"
  fi
  if [ ! -f "$MODEL_DIR/config.json" ]; then
    echo "[fatal] model not found at $MODEL_DIR"; exit 1
  fi
  echo "[info] starting sgl-omni on :$PORT (model: $MODEL_DIR)"
  echo "[info] endpoint will be http://localhost:$PORT/v1/audio/speech"
  echo "[info] server log -> $log"
  echo ">>> sgl-omni serve --model-path $MODEL_DIR --port $PORT"
  sgl-omni serve --model-path "$MODEL_DIR" --port "$PORT" 2>&1 | tee "$log"
}

case "${1:-all}" in
  install) do_install ;;
  serve)   do_serve ;;
  all)     do_install && do_serve ;;
  *) echo "usage: $0 [install|serve]"; exit 2 ;;
esac
