#!/usr/bin/env bash
# generate_beiba_laughter.sh — generate Kazakh "Бейба" laughter test clips.
#
# Tries vLLM-Omni first (port 8095, with "model" field). If that fails, falls
# back to SGLang-Omni (port 9000, without "model" field) — the server that
# actually serves Higgs Audio v3 on this machine.
#
# Outputs (in outputs/):
#   beiba_laughter.wav        — "Haha"
#   beiba_laughter_hehe.wav   — "Hehe"
#   beiba_laughter_haha2.wav  — "Haha haha"
#
# Log: logs/beiba_laughter_test.log

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
OUT_DIR="$PROJECT_DIR/outputs"
LOG_DIR="$PROJECT_DIR/logs"
mkdir -p "$OUT_DIR" "$LOG_DIR"
LOG_FILE="$LOG_DIR/beiba_laughter_test.log"

VLLM_URL="${VLLM_URL:-http://localhost:8095}"
SGLANG_URL="${SGLANG_URL:-http://localhost:9000}"
MODEL_NAME="bosonai/higgs-audio-v3-tts-4b"

: > "$LOG_FILE"
log() { echo "$@" | tee -a "$LOG_FILE"; }

log "=================================================================="
log " Higgs Audio v3 — Бейба laughter test"
log " date: $(date)"
log " vLLM-Omni : $VLLM_URL/v1/audio/speech (primary, with model field)"
log " SGLang-Omni: $SGLANG_URL/v1/audio/speech (fallback, no model field)"
log "=================================================================="

# Build a JSON body safely (UTF-8 + tags) to a temp file.
# $1 outfile ; $2 text ; $3 include_model(1/0)
build_payload() {
  local out_json="$1" text="$2" include_model="$3"
  if command -v python3 >/dev/null 2>&1; then
    INPUT_TEXT="$text" MODEL_NAME="$MODEL_NAME" INCLUDE_MODEL="$include_model" \
      python3 - "$out_json" <<'PY'
import json, os, sys
body = {"input": os.environ["INPUT_TEXT"]}
if os.environ.get("INCLUDE_MODEL") == "1":
    body = {"model": os.environ["MODEL_NAME"], **body}
with open(sys.argv[1], "w", encoding="utf-8") as f:
    json.dump(body, f, ensure_ascii=False)
PY
  else
    if [ "$include_model" = "1" ]; then
      printf '{"model":"%s","input":"%s"}' "$MODEL_NAME" "$text" > "$out_json"
    else
      printf '{"input":"%s"}' "$text" > "$out_json"
    fi
  fi
}

# 0 if file looks like real audio.
looks_like_audio() {
  local f="$1"
  [ -s "$f" ] || return 1
  case "$(file -b "$f" 2>/dev/null)" in
    *WAVE*|*RIFF*|*Audio*|*audio*) return 0 ;;
  esac
  local sz; sz=$(stat -c%s "$f" 2>/dev/null || echo 0)
  [ "$sz" -gt 20000 ] && ! head -c1 "$f" | grep -q '{'
}

# $1 url ; $2 include_model ; $3 text ; $4 outfile  -> returns curl/audio status
post_tts() {
  local url="$1" include_model="$2" text="$3" outfile="$4"
  local payload code
  payload="$(mktemp)"
  build_payload "$payload" "$text" "$include_model"
  code=$(curl -sS -X POST "$url/v1/audio/speech" \
      -H "Content-Type: application/json" \
      --data-binary @"$payload" \
      --output "$outfile" \
      -w "%{http_code}" 2>>"$LOG_FILE")
  rm -f "$payload"
  log "    -> $url  HTTP $code  (model field: $([ "$include_model" = 1 ] && echo yes || echo no))"
  [ "$code" = "200" ] && looks_like_audio "$outfile"
}

# $1 outfile basename ; $2 text
gen() {
  local name="$1" text="$2"
  local outfile="$OUT_DIR/$name"
  log
  log "------------------------------------------------------------------"
  log ">>> $name"
  log "    input: $text"

  # 1) vLLM-Omni on 8095 with model field.
  if post_tts "$VLLM_URL" 1 "$text" "$outfile"; then
    log "    [ok] generated via vLLM-Omni ($VLLM_URL)"
  # 2) Fallback: SGLang-Omni on 9000 without model field.
  elif post_tts "$SGLANG_URL" 0 "$text" "$outfile"; then
    log "    [ok] generated via SGLang-Omni ($SGLANG_URL)"
  else
    log "    [fail] both servers failed for $name."
    log "    ---- server response (first 400 bytes) ----"
    head -c 400 "$outfile" 2>/dev/null | tee -a "$LOG_FILE"; log ""
    return 1
  fi

  file "$outfile"   | tee -a "$LOG_FILE"
  ls -lh "$outfile" | tee -a "$LOG_FILE"
}

# --- the three variants ------------------------------------------------
gen "beiba_laughter.wav" \
"<|emotion:amusement|><|prosody:expressive_high|>Бейба ағам керемет <|sfx:laughter|>Haha, одан артық не керек?"

gen "beiba_laughter_hehe.wav" \
"<|emotion:amusement|><|prosody:expressive_high|>Бейба ағам керемет! <|sfx:laughter|>Hehe, одан артық не керек?"

gen "beiba_laughter_haha2.wav" \
"<|emotion:amusement|><|prosody:expressive_high|>Бейба ағам керемет! <|sfx:laughter|>Haha haha, одан артық не керек?"

log
log "=================================================================="
log " done. files in: $OUT_DIR"
log " log: $LOG_FILE"
log "=================================================================="

# --- playback (only if ffplay is available and a display/audio exists) -
if command -v ffplay >/dev/null 2>&1; then
  for f in "$OUT_DIR/beiba_laughter.wav" "$OUT_DIR/beiba_laughter_hehe.wav" "$OUT_DIR/beiba_laughter_haha2.wav"; do
    [ -f "$f" ] || continue
    log "Playing: $f"
    ffplay -nodisp -autoexit "$f" >/dev/null 2>&1 || log "    [warn] ffplay could not play $f (no audio device?)"
  done
else
  log "[info] ffplay not found; skipping playback. Install with: sudo apt-get install -y ffmpeg"
fi
