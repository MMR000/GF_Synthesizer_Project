#!/usr/bin/env python3
"""Segment-by-segment Higgs v3 TTS, then concatenate into ONE wav.

Why segmented: long single-pass generations for this model degenerate into a long
silent tail (only the first ~8s render, then ~silence). Short per-sentence requests
render reliably. We clone ONE fixed voice for every segment (so timbre stays
identical across the whole clip) and stitch the segments together.

- Voice reference: the laughter clip (as requested) — beiba_laughter.wav.
- Each sentence keeps a leading happy tag <|emotion:amusement|><|prosody:expressive_high|>.
- <|prosody:pause|> between sentences becomes a longer silence gap in the stitch.
- Each segment is silence-trimmed; silent segments are retried a few times.

Output: outputs/bibo_positive_laughter_long_happy.wav
Per-segment wavs (debug): outputs/_segments_bibo/seg_XX.wav
Log: logs/bibo_segmented.log
"""
from pathlib import Path
import os
import re
import subprocess
import sys
import time

import numpy as np
import requests
import soundfile as sf

PROJECT_DIR = Path("/home/mmr/PycharmProjects/tone_tts")
OUT_DIR = PROJECT_DIR / "outputs"
SEG_DIR = OUT_DIR / "_segments_bibo"
LOG_DIR = PROJECT_DIR / "logs"
for d in (OUT_DIR, SEG_DIR, LOG_DIR):
    d.mkdir(parents=True, exist_ok=True)

OUT_FILE = OUT_DIR / "bibo_positive_laughter_long_happy.wav"
LOG_FILE = LOG_DIR / "bibo_segmented.log"

SR = 24000

# Voice reference = the laughter clip, as requested.
REF_AUDIO = os.environ.get("REF_AUDIO", str(OUT_DIR / "beiba_laughter.wav"))
REF_TEXT = os.environ.get("REF_TEXT", "Бейба ағам керемет Haha, одан артық не керек?")

HAPPY = "<|emotion:amusement|><|prosody:expressive_high|>"

VLLM_URL = "http://localhost:8095/v1/audio/speech"
SGLANG_URL = "http://localhost:9000/v1/audio/speech"

GAP_SHORT = 0.18   # silence between normal sentences
GAP_PAUSE = 0.45   # silence where a <|prosody:pause|> was
MAX_TRIES = 4      # retries for a segment that comes back silent / runaway
MIN_SEG_SEC = 0.2  # shorter than this = failed
MAX_SEG_SEC = 14.0 # longer than this for one sentence = model rambled -> retry

# The exact requested text.
TEXT = """<|emotion:amusement|><|prosody:expressive_high|>Бибо ағам сондай сүйкімді, оны көрген адамның басы айналып, бағытын таба алмай қалады. <|sfx:laughter|>Haha, шынымды айтсам, Бибо ағам бір күлімдесе, бүкіл бөлме жарық болып кететін сияқты. Ол сөйлеген кезде бәрі бірден тыңдай бастайды, өйткені оның дауысының өзі көңілді көтеріп жібереді. <|prosody:pause|> Бибо ағам жүрсе — мереке, күлсе — концерт, бірдеңе айтса — дайын анекдот. <|sfx:laughter|>Hehe, кейде мен оны жай ғана қарап отырып та күле беремін, себебі ол ештеңе істемесе де күлкілі әрі сүйкімді көрінеді.

<|prosody:pause|>Бибо ағам керемет адам, одан артық не керек? Ол келген жерде көңіл-күй автоматты түрде көтеріледі. Біреу шаршап отырса, Бибо ағам бір ауыз сөз айтады да, бәрі қайтадан күліп кетеді. <|sfx:laughter|>Haha haha, ол кәдімгі көңіл-күй генераторы сияқты. Оның жанында уайым да, шаршау да, жаман ой да ұзақ тұра алмайды. Бибо ағам бір қарап қойса болды, адам өз проблемасын ұмытып кетеді.

<|prosody:pause|>Мен кейде ойлаймын: егер сүйкімділікке медаль берілсе, Бибо ағам алтын медальді бірден алып кетер еді. Егер күлкіге жарыс болса, ол еш дайындықсыз бірінші орын алар еді. Егер жақсы көңіл-күй сатылатын болса, Бибо ағамның бір күлкісі ең қымбат бренд болар еді. <|sfx:laughter|>Hehe, Бибо ағам сондай керемет, оны мақтауға сөз жетпейді. Ол расымен ерекше, сүйкімді, көңілді, жылы жүзді, әрі өте қызық адам. Одан артық не керек?"""


def log(msg: str):
    line = f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {msg}"
    print(line)
    with LOG_FILE.open("a", encoding="utf-8") as f:
        f.write(line + "\n")


def split_segments(text: str):
    """Return list of (segment_text, pause_before: bool).

    Splits into sentences, strips a leading <|prosody:pause|> into a gap flag, and
    guarantees each segment starts with the happy emotion tag.
    """
    flat = re.sub(r"\s+", " ", text).strip()
    # Remove the sentence-level tags so we can re-apply them uniformly per segment;
    # keep inline <|sfx:...|> and <|prosody:pause|>.
    flat = flat.replace(HAPPY, "")
    flat = flat.replace("<|emotion:amusement|>", "").replace("<|prosody:expressive_high|>", "")
    sentences = re.split(r"(?<=[.!?])\s+", flat)
    segs = []
    for s in sentences:
        s = s.strip()
        if not s:
            continue
        pause_before = False
        m = re.match(r"^(?:<\|prosody:(?:pause|long_pause)\|>\s*)+", s)
        if m:
            pause_before = True
            s = s[m.end():].strip()
        # Drop any stray inline pause tags inside (we handle pauses as gaps).
        s = re.sub(r"<\|prosody:(?:pause|long_pause)\|>", "", s).strip()
        if not s:
            continue
        seg_text = HAPPY + s
        segs.append((seg_text, pause_before))
    return segs


def trim(mono: np.ndarray, pad_sec: float = 0.08) -> np.ndarray:
    if len(mono) == 0:
        return mono
    peak = float(np.max(np.abs(mono)))
    if peak < 1e-3:
        return mono[:0]
    thresh = max(peak * 0.03, 1e-3)
    loud = np.where(np.abs(mono) > thresh)[0]
    if len(loud) == 0:
        return mono[:0]
    start = max(0, loud[0] - int(pad_sec * SR))
    end = min(len(mono), loud[-1] + int(pad_sec * SR))
    return mono[start:end]


def synth_segment(seg_text: str):
    """Return trimmed mono float array for one segment, or empty array on failure."""
    common = {
        "input": seg_text,
        "ref_audio": REF_AUDIO,
        "ref_text": REF_TEXT,
        "temperature": 0.7,
        "top_k": 50,
        "max_new_tokens": 1200,
    }
    for url, payload in (
        (VLLM_URL, {"model": "bosonai/higgs-audio-v3-tts-4b", **common}),
        (SGLANG_URL, dict(common)),
    ):
        try:
            r = requests.post(url, json=payload, timeout=300)
        except Exception as e:
            log(f"    {url} error: {e!r}")
            continue
        if r.status_code != 200 or len(r.content) < 1000:
            log(f"    {url} HTTP {r.status_code} bytes {len(r.content)}")
            continue
        tmp = SEG_DIR / "_raw.wav"
        tmp.write_bytes(r.content)
        x, sr = sf.read(str(tmp))
        if getattr(x, "ndim", 1) > 1:
            x = x.mean(1)
        if sr != SR:  # resample-lite via numpy interp if ever needed
            n = int(len(x) * SR / sr)
            x = np.interp(np.linspace(0, len(x), n, endpoint=False), np.arange(len(x)), x)
        return trim(np.asarray(x, dtype=np.float32))
    return np.zeros(0, dtype=np.float32)


def main():
    LOG_FILE.write_text("", encoding="utf-8")
    if not Path(REF_AUDIO).is_file():
        log(f"[fatal] REF_AUDIO not found: {REF_AUDIO}")
        sys.exit(1)

    segs = split_segments(TEXT)
    log(f"Reference voice (clone): {REF_AUDIO}")
    log(f"Segments to generate: {len(segs)}")

    pieces = []
    for i, (seg_text, pause_before) in enumerate(segs):
        log("-" * 60)
        log(f"[{i:02d}] pause_before={pause_before}  text={seg_text}")
        audio = np.zeros(0, dtype=np.float32)
        best = np.zeros(0, dtype=np.float32)
        best_peak = 0.0
        for attempt in range(1, MAX_TRIES + 1):
            cand = synth_segment(seg_text)
            dur = len(cand) / SR
            peak = float(np.max(np.abs(cand))) if len(cand) else 0.0
            log(f"     try {attempt}: dur={dur:.2f}s peak={peak:.3f}")
            # Track the best loud candidate in case all are too long.
            if peak >= best_peak and len(cand) >= int(MIN_SEG_SEC * SR):
                best, best_peak = cand, peak
            # Accept only a sane-length, loud-enough take.
            if int(MIN_SEG_SEC * SR) <= len(cand) <= int(MAX_SEG_SEC * SR) and peak >= 0.03:
                audio = cand
                break
        else:
            # No clean take: fall back to the best one, capped at MAX_SEG_SEC.
            audio = best[: int(MAX_SEG_SEC * SR)]
            log(f"     [warn] no clean take for seg {i}; using capped best ({len(audio)/SR:.2f}s).")
        if len(audio) == 0:
            log(f"     [warn] segment {i} produced no audio; skipping.")
            continue

        # Save per-segment for debugging.
        sf.write(str(SEG_DIR / f"seg_{i:02d}.wav"), audio, SR)

        gap = GAP_PAUSE if pause_before else GAP_SHORT
        if pieces:  # don't lead with silence
            pieces.append(np.zeros(int(gap * SR), dtype=np.float32))
        pieces.append(audio)

    if not pieces:
        log("[fatal] no audio generated for any segment.")
        sys.exit(1)

    full = np.concatenate(pieces)
    # Gentle peak-normalize to avoid clipping while keeping it loud.
    peak = float(np.max(np.abs(full)))
    if peak > 0:
        full = (full / peak) * 0.97

    sf.write(str(OUT_FILE), full, SR)
    log("=" * 60)
    log(f"Saved: {OUT_FILE}")
    log(f"Total duration: {len(full) / SR:.2f}s  size: {OUT_FILE.stat().st_size/1024/1024:.2f} MB")
    subprocess.run(["file", str(OUT_FILE)], check=False)
    log(f"Play with: ffplay -nodisp -autoexit {OUT_FILE}")


if __name__ == "__main__":
    main()
