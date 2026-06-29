#!/usr/bin/env python3
"""Long single-pass Higgs v3 TTS with a LOCKED happy voice + happy emotion throughout.

Two fixes vs. the flat-sounding version:
  1) Voice is CLONED from one fixed reference clip (ref_audio + ref_text), so the
     timbre is the SAME happy speaker every time instead of a new random voice.
  2) The happy tag <|emotion:amusement|><|prosody:expressive_high|> is injected at
     the START OF EVERY SENTENCE. Higgs emotion/prosody tags are sentence-level, so
     a single tag at the top only colors the first sentence; re-tagging every
     sentence keeps the whole long passage cheerful.

Still ONE request -> ONE wav (no segmentation), preserving timbre/emotion continuity.

Swap the reference voice by setting env vars, e.g.:
  REF_AUDIO=/path/to/clip.wav REF_TEXT="transcript" python scripts/...happy.py
"""
from pathlib import Path
import os
import re
import subprocess
import sys
import time

import requests

PROJECT_DIR = Path("/home/mmr/PycharmProjects/tone_tts")
OUT_DIR = PROJECT_DIR / "outputs"
LOG_DIR = PROJECT_DIR / "logs"
OUT_DIR.mkdir(parents=True, exist_ok=True)
LOG_DIR.mkdir(parents=True, exist_ok=True)

OUT_FILE = OUT_DIR / "bibo_positive_laughter_long_happy.wav"
LOG_FILE = LOG_DIR / "bibo_positive_laughter_long_happy.log"

# --- voice lock (clone) -------------------------------------------------
# Default: clone the earlier happy laughter clip so it's the same voice as before.
# Point these at any clip whose voice you like (must be a real WAV the server can read).
# IMPORTANT (learned the hard way): cloning from a clip that CONTAINS laughter/SFX
# (e.g. beiba_laughter.wav) can drive the long generation into near-silence. Use a
# CLEAN speech clip as the reference. Default below is the enthusiastic (happy)
# Kazakh clip, which clones to a lively voice and yields healthy, loud audio.
REF_AUDIO = os.environ.get(
    "REF_AUDIO", str(OUT_DIR / "01_kazakh_enthusiasm.wav")
)
REF_TEXT = os.environ.get(
    "REF_TEXT",
    "Бүгін біз жергілікті TTS моделін сәтті іске қостық! Бұл өте қызықты нәтиже.",
)

HAPPY = "<|emotion:amusement|><|prosody:expressive_high|>"

# Narrative split into PARAGRAPHS. The happy tag is applied ONCE per paragraph —
# NOT every sentence. Per-sentence tagging (17+ tag clusters) derails this model and
# it degenerates into ~silence that runs to max_new_tokens; paragraph-level tagging
# keeps it coherent while still refreshing the cheerful tone across the long passage.
# Inline <|sfx:laughter|> and <|prosody:pause|> are preserved inside each paragraph.
PARAGRAPHS = [
    "Бибо ағам сондай сүйкімді, оны көрген адамның басы айналып, бағытын таба алмай қалады. <|sfx:laughter|>Haha, шынымды айтсам, Бибо ағам бір күлімдесе, бүкіл бөлме жарық болып кететін сияқты. Ол сөйлеген кезде бәрі бірден тыңдай бастайды, өйткені оның дауысының өзі көңілді көтеріп жібереді. <|prosody:pause|> Бибо ағам жүрсе — мереке, күлсе — концерт, бірдеңе айтса — дайын анекдот. <|sfx:laughter|>Hehe, кейде мен оны жай ғана қарап отырып та күле беремін, себебі ол ештеңе істемесе де күлкілі әрі сүйкімді көрінеді.",
    "Бибо ағам керемет адам, одан артық не керек? Ол келген жерде көңіл-күй автоматты түрде көтеріледі. Біреу шаршап отырса, Бибо ағам бір ауыз сөз айтады да, бәрі қайтадан күліп кетеді. <|sfx:laughter|>Haha haha, ол кәдімгі көңіл-күй генераторы сияқты. Оның жанында уайым да, шаршау да, жаман ой да ұзақ тұра алмайды. Бибо ағам бір қарап қойса болды, адам өз проблемасын ұмытып кетеді.",
    "Мен кейде ойлаймын: егер сүйкімділікке медаль берілсе, Бибо ағам алтын медальді бірден алып кетер еді. Егер күлкіге жарыс болса, ол еш дайындықсыз бірінші орын алар еді. Егер жақсы көңіл-күй сатылатын болса, Бибо ағамның бір күлкісі ең қымбат бренд болар еді. <|sfx:laughter|>Hehe, Бибо ағам сондай керемет, оны мақтауға сөз жетпейді. Ол расымен ерекше, сүйкімді, көңілді, жылы жүзді, әрі өте қызық адам. Одан артық не керек?",
]


def build_happy_text(paragraphs) -> str:
    """Prefix the happy tag once per paragraph (keeps the model coherent)."""
    return " ".join(HAPPY + re.sub(r"\s+", " ", p).strip() for p in paragraphs)


TEXT = build_happy_text(PARAGRAPHS)


def log(msg: str):
    line = f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {msg}"
    print(line)
    with LOG_FILE.open("a", encoding="utf-8") as f:
        f.write(line + "\n")


def request_tts(url: str, payload: dict) -> bool:
    log(f"Trying: {url}")
    log(f"Payload keys: {list(payload.keys())}")
    log(f"ref_audio: {payload.get('ref_audio')}")
    log(f"Input characters: {len(payload.get('input', ''))}")
    try:
        response = requests.post(url, json=payload, timeout=600)
    except Exception as e:
        log(f"Request error: {repr(e)}")
        return False

    log(f"HTTP status: {response.status_code}")
    log(f"Content-Type: {response.headers.get('content-type', '')}")
    log(f"Response bytes: {len(response.content)}")

    if response.status_code != 200:
        log("Non-200 response:")
        try:
            log(response.text[:3000])
        except Exception:
            pass
        return False

    if len(response.content) < 1000:
        log("Response too small, probably not a valid WAV.")
        try:
            log(response.text[:3000])
        except Exception:
            pass
        return False

    OUT_FILE.write_bytes(response.content)
    _trim_silence(OUT_FILE)
    return True


def _trim_silence(path: Path, pad_sec: float = 0.25):
    """Trim leading/trailing silence so a runaway silent tail doesn't bloat the clip.

    Safe no-op if soundfile/numpy aren't available or the clip is essentially silent.
    """
    try:
        import numpy as np
        import soundfile as sf
    except Exception as e:
        log(f"[trim] skipped (no soundfile/numpy): {e!r}")
        return
    try:
        x, sr = sf.read(str(path))
        mono = x.mean(1) if getattr(x, "ndim", 1) > 1 else x
        if len(mono) == 0:
            return
        peak = float(np.max(np.abs(mono)))
        if peak < 1e-3:
            log("[trim] clip is essentially silent; leaving as-is for inspection.")
            return
        thresh = max(peak * 0.02, 1e-3)
        loud = np.where(np.abs(mono) > thresh)[0]
        if len(loud) == 0:
            return
        start = max(0, loud[0] - int(pad_sec * sr))
        end = min(len(x), loud[-1] + int(pad_sec * sr))
        before = len(mono) / sr
        sf.write(str(path), x[start:end], sr)
        after = (end - start) / sr
        log(f"[trim] {before:.1f}s -> {after:.1f}s (peak={peak:.3f})")
    except Exception as e:
        log(f"[trim] failed, keeping original: {e!r}")


def main():
    LOG_FILE.write_text("", encoding="utf-8")

    if not Path(REF_AUDIO).is_file():
        log(f"[warn] REF_AUDIO not found: {REF_AUDIO} — will fall back to default voice.")

    log("Locked voice (clone) settings:")
    log(f"  REF_AUDIO = {REF_AUDIO}")
    log(f"  REF_TEXT  = {REF_TEXT}")
    log("Re-tagged happy text being sent (single pass):")
    log(TEXT)

    common = {
        "input": TEXT,
        "ref_audio": REF_AUDIO,
        "ref_text": REF_TEXT,
        "temperature": 0.7,
        "top_k": 50,
        "max_new_tokens": 4096,
    }

    vllm_payload = {"model": "bosonai/higgs-audio-v3-tts-4b", **common}
    sglang_payload = dict(common)

    ok = request_tts("http://localhost:8095/v1/audio/speech", vllm_payload)
    if not ok:
        log("vLLM-Omni failed. Retrying SGLang-Omni without model field...")
        ok = request_tts("http://localhost:9000/v1/audio/speech", sglang_payload)

    if not ok:
        log("Generation failed for both vLLM-Omni and SGLang-Omni.")
        sys.exit(1)

    log(f"Saved: {OUT_FILE}")
    log(f"File size: {OUT_FILE.stat().st_size / 1024 / 1024:.2f} MB")
    subprocess.run(["file", str(OUT_FILE)], check=False)
    log("Done. Play with:")
    log(f"ffplay -nodisp -autoexit {OUT_FILE}")


if __name__ == "__main__":
    main()
