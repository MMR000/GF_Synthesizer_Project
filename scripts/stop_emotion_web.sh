#!/usr/bin/env bash
# Stop the Emotion TTS Studio backend + frontend started by run_emotion_web.sh.

PID_DIR="/home/mmr/PycharmProjects/tone_tts/backend/storage"

stop_pidfile() {
  local name="$1" file="$2"
  if [ -f "$file" ]; then
    local pid
    pid="$(cat "$file")"
    if kill "$pid" 2>/dev/null; then
      echo "Stopped $name (PID $pid)"
    else
      echo "$name (PID $pid) was not running"
    fi
    rm -f "$file"
  else
    echo "No $name pid file found"
  fi
}

stop_pidfile "backend" "$PID_DIR/backend.pid"
stop_pidfile "frontend" "$PID_DIR/frontend.pid"

# Best-effort cleanup of stragglers (npm spawns a vite child that may outlive its parent).
pkill -f "uvicorn app:app --host 0.0.0.0 --port 7860" 2>/dev/null && echo "Stopped stray uvicorn" || true
pkill -f "vite --host 0.0.0.0 --port 5173" 2>/dev/null && echo "Stopped stray vite" || true

# Free the known ports via whichever tool is available.
for port in 7860 5173; do
  if command -v fuser >/dev/null 2>&1; then
    fuser -k "${port}/tcp" 2>/dev/null && echo "Freed port $port" || true
  elif command -v lsof >/dev/null 2>&1; then
    pid="$(lsof -ti tcp:"$port" 2>/dev/null || true)"
    [ -n "$pid" ] && kill "$pid" 2>/dev/null && echo "Freed port $port (PID $pid)" || true
  fi
done
