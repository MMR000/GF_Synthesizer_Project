#!/usr/bin/env bash
set -e

PROJECT_DIR="/home/mmr/PycharmProjects/tone_tts"
cd "$PROJECT_DIR"

PID_DIR="$PROJECT_DIR/backend/storage"
mkdir -p "$PID_DIR"

echo "==> Starting backend (FastAPI on :7860)"
cd "$PROJECT_DIR/backend"
# Prefer uv (works even when python3-venv / ensurepip is missing); fall back to venv.
if [ ! -x ".venv/bin/python" ]; then
  if command -v uv >/dev/null 2>&1; then
    uv venv .venv --python 3.12
  else
    python3 -m venv .venv
  fi
fi
# shellcheck disable=SC1091
source .venv/bin/activate
if command -v uv >/dev/null 2>&1; then
  uv pip install -q -r requirements.txt
else
  pip install -q -r requirements.txt
fi
uvicorn app:app --host 0.0.0.0 --port 7860 &
BACKEND_PID=$!
echo "$BACKEND_PID" > "$PID_DIR/backend.pid"

echo "==> Starting frontend (Vite on :5173)"
cd "$PROJECT_DIR/webui"
npm install
npm run dev -- --host 0.0.0.0 --port 5173 &
FRONTEND_PID=$!
echo "$FRONTEND_PID" > "$PID_DIR/frontend.pid"

echo ""
echo "Backend PID:  $BACKEND_PID  (http://localhost:7860/api/health)"
echo "Frontend PID: $FRONTEND_PID"
echo "Open: http://localhost:5173"
echo ""
echo "Press Ctrl+C to stop both (or run scripts/stop_emotion_web.sh)."

cleanup() {
  echo ""
  echo "==> Stopping services…"
  kill "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null || true
}
trap cleanup INT TERM

wait
