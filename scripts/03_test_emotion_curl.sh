#!/usr/bin/env bash
# 03_test_emotion_curl.sh — generate WAV files exercising Higgs Audio v3 control tags.
#
# Usage:
#   bash scripts/03_test_emotion_curl.sh [BASE_URL]
#     BASE_URL defaults to http://localhost:8095 (vLLM-Omni).
#     For SGLang-Omni use:  bash scripts/03_test_emotion_curl.sh http://localhost:9000
#
# For each prompt it POSTs to $BASE_URL/v1/audio/speech and writes a .wav into outputs/.
# If the first request (with "model") fails or returns non-audio, it retries WITHOUT
# the "model" field (SGLang-Omni often doesn't require it).
#
# Request/response logs -> logs/curl_tests.log

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
OUT_DIR="$PROJECT_DIR/outputs"
LOG_DIR="$PROJECT_DIR/logs"
mkdir -p "$OUT_DIR" "$LOG_DIR"
LOG_FILE="$LOG_DIR/curl_tests.log"

BASE_URL="${1:-http://localhost:8095}"
MODEL_NAME="bosonai/higgs-audio-v3-tts-4b"
ENDPOINT="$BASE_URL/v1/audio/speech"

# Fresh log each run.
: > "$LOG_FILE"
log() { echo "$@" | tee -a "$LOG_FILE"; }

log "=================================================================="
log " Higgs Audio v3 TTS — control-tag curl test"
log " date: $(date)"
log " endpoint: $ENDPOINT"
log "=================================================================="

# Build a JSON body safely (handles UTF-8 + tag characters) into $1=outfile.
# $2 = input text ; $3 = include_model (1/0)
build_payload() {
  local out_json="$1" text="$2" include_model="$3"
  if command -v python3 >/dev/null 2>&1; then
    INPUT_TEXT="$text" MODEL_NAME="$MODEL_NAME" INCLUDE_MODEL="$include_model" \
      python3 - "$out_json" <<'PY'
import json, os, sys
body = {"input": os.environ["INPUT_TEXT"], "response_format": "wav"}
if os.environ.get("INCLUDE_MODEL") == "1":
    body = {"model": os.environ["MODEL_NAME"], **body}
with open(sys.argv[1], "w", encoding="utf-8") as f:
    json.dump(body, f, ensure_ascii=False)
PY
  else
    # Fallback (texts here contain no double quotes/backslashes).
    if [ "$include_model" = "1" ]; then
      printf '{"model":"%s","input":"%s","response_format":"wav"}' "$MODEL_NAME" "$text" > "$out_json"
    else
      printf '{"input":"%s","response_format":"wav"}' "$text" > "$out_json"
    fi
  fi
}

# Returns 0 if the file looks like real audio (RIFF/WAV or reasonably large binary).
looks_like_audio() {
  local f="$1"
  [ -s "$f" ] || return 1
  local desc; desc="$(file -b "$f" 2>/dev/null)"
  case "$desc" in
    *WAVE*|*RIFF*|*Audio*|*audio*) return 0 ;;
  esac
  # Some servers stream raw PCM/other; accept if it's clearly not a tiny JSON error.
  local sz; sz=$(stat -c%s "$f" 2>/dev/null || echo 0)
  if [ "$sz" -gt 20000 ] && ! head -c1 "$f" | grep -q '{'; then return 0; fi
  return 1
}

do_request() {
  # $1 outfile, $2 include_model(1/0), $3 text
  local outfile="$1" include_model="$2" text="$3"
  local payload; payload="$(mktemp)"
  build_payload "$payload" "$text" "$include_model"
  local code
  code=$(curl -sS -X POST "$ENDPOINT" \
      -H "Content-Type: application/json" \
      --data-binary @"$payload" \
      -o "$outfile" \
      -w "%{http_code}" 2>>"$LOG_FILE")
  log "    HTTP $code  (model field: $([ "$include_model" = 1 ] && echo yes || echo no))"
  rm -f "$payload"
  [ "$code" = "200" ] && looks_like_audio "$outfile"
}

gen() {
  # $1 = output basename ; $2 = input text
  local name="$1" text="$2"
  local outfile="$OUT_DIR/$name"
  log
  log "------------------------------------------------------------------"
  log ">>> $name"
  log "    input: $text"

  if do_request "$outfile" 1 "$text"; then
    log "    [ok] generated with model field"
  else
    log "    [retry] first attempt failed/non-audio; retrying WITHOUT model field ..."
    if do_request "$outfile" 0 "$text"; then
      log "    [ok] generated without model field"
    else
      log "    [fail] both attempts failed. Server response saved at: $outfile"
      log "    ---- server said (first 500 bytes) ----"
      head -c 500 "$outfile" 2>/dev/null | tee -a "$LOG_FILE"
      log ""
      return 1
    fi
  fi

  # Report what we got.
  file "$outfile"        | tee -a "$LOG_FILE"
  ls -lh "$outfile"      | tee -a "$LOG_FILE"
}

# --- the test matrix ----------------------------------------------------

# A. Neutral baseline (Kazakh)
gen "00_kazakh_neutral.wav" \
"Бүгін біз жергілікті TTS моделін тексеріп жатырмыз. Бұл қарапайым бейтарап сөйлем."

# B. Enthusiasm (Kazakh)
gen "01_kazakh_enthusiasm.wav" \
"<|emotion:enthusiasm|><|prosody:expressive_high|>Бүгін біз жергілікті TTS моделін сәтті іске қостық! <|prosody:pause|> Бұл өте қызықты нәтиже."

# C. Sadness (Kazakh)
gen "02_kazakh_sadness.wav" \
"<|emotion:sadness|><|prosody:speed_slow|><|prosody:pitch_low|>Мен бұл нәтиже басқаша болады деп ойлаған едім. <|prosody:long_pause|> Бірақ біз әлі де жалғастырамыз."

# D. Anger / determination (Kazakh)
gen "03_kazakh_anger.wav" \
"<|emotion:anger|><|prosody:expressive_high|><|prosody:pitch_high|>Бұл қате қайта-қайта қайталанбауы керек! <|prosody:pause|> Біз оны бүгін түзетуіміз қажет."

# E. Amusement + laughter (Kazakh) — sfx tag first, onomatopoeia attached, no space.
gen "04_kazakh_laughter.wav" \
"<|emotion:amusement|><|prosody:expressive_high|>Күте тұрыңыз, бұл шынымен күлкілі жағдай болды. <|sfx:laughter|>Haha, мен бұны мүлде күтпедім."

# F. Whispering (Kazakh)
gen "05_kazakh_whispering.wav" \
"<|style:whispering|><|emotion:contemplation|>Бұл тек ішкі тест. <|prosody:pause|> Дауыстың шынымен сыбырлап шыққанын тексерейік."

# G. Russian enthusiasm
gen "06_russian_enthusiasm.wav" \
"<|emotion:enthusiasm|><|prosody:expressive_high|>Сегодня мы наконец запустили локальную модель синтеза речи! <|prosody:pause|> Это очень интересный результат."

# H. English amusement + laughter
gen "07_english_laughter.wav" \
"<|emotion:amusement|><|prosody:expressive_high|>Wait, that was actually hilarious. <|sfx:laughter|>Hehe, I really did not expect that."

log
log "=================================================================="
log " done. WAV files are in: $OUT_DIR"
log " listen with: bash scripts/04_play_outputs.sh"
log " full request log: $LOG_FILE"
log "=================================================================="

ls -lh "$OUT_DIR" | tee -a "$LOG_FILE"
