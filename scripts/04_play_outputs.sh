#!/usr/bin/env bash
# 04_play_outputs.sh — play every generated WAV one by one.
# Requires ffplay (from ffmpeg). Falls back to aplay if ffplay is missing.

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
OUT_DIR="$PROJECT_DIR/outputs"

shopt -s nullglob
files=("$OUT_DIR"/*.wav)
shopt -u nullglob

if [ ${#files[@]} -eq 0 ]; then
  echo "[warn] no .wav files in $OUT_DIR — run scripts/03_test_emotion_curl.sh first."
  exit 0
fi

PLAYER=""
if command -v ffplay >/dev/null 2>&1; then
  PLAYER="ffplay"
elif command -v aplay >/dev/null 2>&1; then
  PLAYER="aplay"
else
  echo "[fail] neither ffplay (ffmpeg) nor aplay found. Install one:"
  echo "       sudo apt-get install -y ffmpeg    # provides ffplay"
  exit 1
fi

echo "Using player: $PLAYER"
for f in "${files[@]}"; do
  echo "=================================================="
  echo "Playing: $f"
  file "$f"
  if [ "$PLAYER" = "ffplay" ]; then
    ffplay -nodisp -autoexit "$f"
  else
    aplay "$f"
  fi
done

echo "=================================================="
echo "done."
