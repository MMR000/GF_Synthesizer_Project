#!/usr/bin/env bash
# 02_try_sglang_docker.sh — fallback path: serve Higgs Audio v3 TTS via SGLang-Omni in Docker.
#
# The Higgs model card recommends SGLang-Omni for self-hosting. This launches the
# official dev image with your LOCAL model directory mounted read-only at /models
# (the model files are NOT copied into the project).
#
# NOTE: Docker must be installed with the NVIDIA Container Toolkit. If `docker` is
# missing this script prints install guidance and the exact in-container commands,
# then exits without changing anything.

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_DIR="$PROJECT_DIR/logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/sglang_docker.log"

MODELS_HOST_DIR="/home/mmr/models"
IMAGE="lmsysorg/sglang-omni:dev"
SGLANG_PORT="${SGLANG_PORT:-9000}"

exec > >(tee "$LOG_FILE") 2>&1

echo "=================================================================="
echo " SGLang-Omni Docker server attempt"
echo " date: $(date)"
echo " image: $IMAGE"
echo " mounting host $MODELS_HOST_DIR -> container /models (read-only)"
echo "=================================================================="

print_incontainer_instructions() {
  cat <<'INSTR'

------------------------------------------------------------------
 INSIDE the container, run these commands (copy/paste):
------------------------------------------------------------------
  cd /workspace/tone_tts
  git clone https://github.com/sgl-project/sglang-omni.git /workspace/sglang-omni || true
  cd /workspace/sglang-omni

  uv venv .venv -p 3.12
  source .venv/bin/activate
  uv pip install -v -e .

  # Serve from the LOCAL model mounted at /models (do NOT re-download):
  sgl-omni serve \
    --model-path /models/higgs-audio-v3-tts-4b \
    --port 9000

------------------------------------------------------------------
 Then, from your HOST machine (a second terminal), test with:
   bash scripts/03_test_emotion_curl.sh http://localhost:9000
 SGLang-Omni serves the OpenAI-compatible endpoint at:
   http://localhost:9000/v1/audio/speech
------------------------------------------------------------------
INSTR
}

# --- check for docker ---------------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
  echo "[fail] 'docker' is NOT installed on this host."
  echo
  echo "Install Docker + the NVIDIA Container Toolkit first, e.g.:"
  echo "  # Docker engine (Ubuntu):"
  echo "  sudo apt-get update && sudo apt-get install -y docker.io"
  echo "  sudo usermod -aG docker \$USER   # then log out/in"
  echo
  echo "  # NVIDIA Container Toolkit (so --gpus all works):"
  echo "  # https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html"
  echo "  sudo nvidia-ctk runtime configure --runtime=docker && sudo systemctl restart docker"
  echo
  echo "Until Docker is available, use the vLLM-Omni path instead:"
  echo "  bash scripts/01_try_vllm_omni.sh"
  print_incontainer_instructions
  exit 1
fi

echo "[ok] docker found: $(docker --version 2>&1)"

# --- pull image ---------------------------------------------------------
echo
echo "----- docker pull $IMAGE -----"
docker pull "$IMAGE" || { echo "[fatal] docker pull failed (network? auth?)"; exit 1; }

# --- show the in-container instructions, then drop into the container ---
print_incontainer_instructions

echo
echo "----- launching container (interactive shell) -----"
echo "[info] this opens an interactive zsh; run the commands above inside it."

docker run -it --rm --gpus all \
  --shm-size 32g \
  --ipc host \
  --network host \
  --privileged \
  -v "$MODELS_HOST_DIR":/models:ro \
  -v "$PROJECT_DIR":/workspace/tone_tts \
  "$IMAGE" /bin/zsh

echo
echo "[info] container exited. SGLang log (host side) -> $LOG_FILE"
echo "[info] note: server stdout lives INSIDE the container session, not this file."
