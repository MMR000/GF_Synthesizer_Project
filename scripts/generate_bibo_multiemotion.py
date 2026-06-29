#!/usr/bin/env python3
"""Multi-emotion exaggerated Higgs v3 TTS demo, segmented then concatenated.

Goal: clearly HEAR emotion/tone change across the passage. A single long pass
degenerates into silence, so we generate sentence-by-sentence and stitch.

Design:
  * Emotion / style / prosody (speed/pitch/expressive) are SENTENCE-LEVEL and made
    "sticky": each segment is re-tagged with the section's current emotion until a
    new <|emotion:*|> appears (a new emotion resets prosody/style for that section).
  * Inline <|sfx:*|> stays in the text; <|prosody:pause|>/<|prosody:long_pause|>
    become silence gaps in the stitch.
  * One fixed CLONED voice for every segment, so you hear the SAME speaker shift
    emotion (default reference = the clean neutral clip, so emotions aren't masked).
    Override with env REF_AUDIO / REF_TEXT, or REF_AUDIO=none for random per-segment.
  * Per-segment quality gate: reject silent / runaway takes and retry.

Output: outputs/bibo_multiemotion.wav
Segments: outputs/_segments_multiemo/seg_XX.wav
Log: logs/bibo_multiemotion.log
"""
from pathlib import Path
import os
import re
import subprocess
import sys
import time

import librosa
import numpy as np
import requests
import soundfile as sf

PROJECT_DIR = Path("/home/mmr/PycharmProjects/tone_tts")
OUT_DIR = PROJECT_DIR / "outputs"
SEG_DIR = OUT_DIR / "_segments_multiemo"
LOG_DIR = PROJECT_DIR / "logs"
for d in (OUT_DIR, SEG_DIR, LOG_DIR):
    d.mkdir(parents=True, exist_ok=True)

OUT_FILE = OUT_DIR / "bibo_multiemotion.wav"
LOG_FILE = LOG_DIR / "bibo_multiemotion.log"
SR = 24000

# Consistent voice. Default: clean neutral clip so emotions read clearly.
REF_AUDIO = os.environ.get("REF_AUDIO", str(OUT_DIR / "00_kazakh_neutral.wav"))
REF_TEXT = os.environ.get(
    "REF_TEXT", "Бүгін біз жергілікті TTS моделін тексеріп жатырмыз. Бұл қарапайым бейтарап сөйлем."
)
USE_REF = REF_AUDIO.lower() not in ("none", "", "off")

VLLM_URL = "http://localhost:8095/v1/audio/speech"
SGLANG_URL = "http://localhost:9000/v1/audio/speech"

GAP_SHORT = 0.22
GAP_LONG = 0.6
MAX_TRIES = int(os.environ.get("MAX_TRIES", "6"))
MIN_SEG_SEC = 0.2
MAX_SEG_SEC = 16.0

# Lower temperature => the clone stays closer to the reference speaker (less drift).
TEMP = float(os.environ.get("TEMP", "0.5"))
TOP_K = int(os.environ.get("TOP_K", "40"))

# Speaker lock: every segment's median pitch must stay within this band around the
# reference's median F0. Emotions move pitch a bit, but a gender flip ~doubles it,
# so this rejects the "other person" takes while allowing expressive variation.
F0_REL_LO = float(os.environ.get("F0_REL_LO", "0.70"))  # down to 70% of ref pitch
F0_REL_HI = float(os.environ.get("F0_REL_HI", "1.55"))  # up to 155% of ref pitch
F0_FMIN, F0_FMAX = 65.0, 450.0
# Only a gentle pitch nudge is ever applied. Big (octave-ish) shifts wreck the
# formants and sound like a slowed-down "elephant", so we cap it hard and instead
# ease the exaggeration tags to coax a naturally in-voice take.
MAX_SHIFT_ST = float(os.environ.get("MAX_SHIFT_ST", "4.0"))

TEXT = """<|emotion:contentment|><|prosody:expressive_high|>Бибо ағам мені мақтағанда, менің жүрегім бірден жылып кетеді. Ол “жарайсың” десе болды, мен өзімді әлемдегі ең ақылды, ең мықты, ең бақытты адам сияқты сезінемін. <|emotion:elation|>Сол сәтте қуанышым ішіме сыймай, аспанға ұшып кеткім келеді. <|sfx:laughter|>Haha, Бибо ағамның бір мақтауы маған бір аптаға жететін энергия береді.

<|prosody:pause|><|emotion:pride|>Ол мені елдің алдында мақтаса, мен тіпті кеудемді көтеріп, “міне, бұл — менің ағам!” деп мақтанғым келеді. Бибо ағам мені қолдаса, мен кез келген қиын жұмысты істей алатындай боламын. <|emotion:determination|>Сол кезде мен өзіме: “Болды, енді тоқтамаймын, бәрін дәлелдеймін!” деп айтамын.

<|prosody:pause|><|emotion:surprise|>Бірақ кейде Бибо ағам күтпеген жерден қатты сөйлеп қояды. Мен бірден абдырап қаламын. “Не болды? Мен не істеп қойдым?” деп ойланып қаламын. <|emotion:confusion|>Басымда мың сұрақ пайда болады, ал жауап біреу де жоқ сияқты. <|prosody:pause|> Ол маған ұрысқанда, көңілім қатты жарақаттанады. <|emotion:sadness|><|prosody:speed_slow|><|prosody:pitch_low|>Сол кезде ішімнен бір нәрсе үзіліп кеткендей болады. Мен үндемей қаламын, көзім төмен қарап, жүрегім ауырлап кетеді.

<|prosody:long_pause|><|emotion:helplessness|>Егер Бибо ағам маған ренжісе, мен не істерімді білмей қаламын. Бір жағынан түсіндіргім келеді, бір жағынан сөз таппаймын. <|emotion:shame|>Кейде өзімді кішкентай бала сияқты сезінемін, қателесіп қойғанымды біліп, ұялып қаламын. Бірақ бәрібір ішімнен: “Бибо аға, маған қатты ұрыспаңызшы” дегім келеді.

<|prosody:pause|><|emotion:anger|><|prosody:expressive_high|>Ал егер біреу Бибо ағам туралы жаман сөз айтса, мен бірден ашуланамын! Жоқ, оған болмайды! Бибо ағамды ешкім ренжітпеуі керек! <|prosody:pause|><|emotion:determination|>Мен оны қорғауға дайынмын, өйткені ол мен үшін жай ғана аға емес, ол — ерекше адам.

<|prosody:pause|><|emotion:fear|>Кейде Бибо ағам үндемей қалса, мен қорқып кетемін. “Ол маған ренжіп қалды ма? Енді сөйлеспей қоя ма?” деп уайымдаймын. <|emotion:longing|><|prosody:speed_slow|>Сол кезде оның бұрынғы күлкісі, жылы сөзі, жақсы көңілі есіме түседі. Мен қайтадан бәрі жақсы болғанын қалаймын.

<|prosody:pause|><|emotion:relief|>Бірақ Бибо ағам қайтадан күлімдеп, “ештеңе етпейді” десе, менің жаным бірден тынышталады. Сол кезде бүкіл ауырлық кетіп қалғандай болады. <|emotion:affection|>Мен Бибо ағамды қатты жақсы көремін, өйткені ол кейде ұрысса да, бәрібір жүрегі жылы адам. <|sfx:sigh|>Ahh, Бибо ағам сондай ерекше.

<|prosody:pause|><|emotion:amusement|><|prosody:expressive_high|>Сосын ол қайтадан бір күлкілі нәрсе айтып қояды да, мен бәрін ұмытып кетемін. <|sfx:laughter|>Haha, міне, Бибо ағамның күші осында. Бір минут бұрын мен қайғырып отырсам, келесі минутта күліп отырамын. <|emotion:awe|>Шынымен, Бибо ағам — эмоцияның толық пакеті: қуаныш, мақтаныш, қорқыныш, өкпе, күлкі, мейірім, бәрі бір адамның ішінде. Одан артық не керек?"""

PAUSE_RE = re.compile(r"<\|prosody:(pause|long_pause)\|>")
EMO_RE = re.compile(r"<\|emotion:([a-z_]+)\|>")
STYLE_RE = re.compile(r"<\|style:([a-z_]+)\|>")
PROSMOD_RE = re.compile(r"<\|prosody:(speed_[a-z_]+|pitch_[a-z]+|expressive_[a-z]+)\|>")
STRIP_BODY_RE = re.compile(
    r"<\|emotion:[a-z_]+\|>|<\|style:[a-z_]+\|>|<\|prosody:(?:speed_[a-z_]+|pitch_[a-z]+|expressive_[a-z]+|pause|long_pause)\|>"
)


def log(msg: str):
    line = f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {msg}"
    print(line)
    with LOG_FILE.open("a", encoding="utf-8") as f:
        f.write(line + "\n")


def render_tags(st) -> str:
    parts = []
    if st["emotion"]:
        parts.append(f"<|emotion:{st['emotion']}|>")
    if st["style"]:
        parts.append(f"<|style:{st['style']}|>")
    for key in ("speed", "pitch", "expressive"):
        if st[key]:
            parts.append(f"<|prosody:{st[key]}|>")
    return "".join(parts)


def split_segments(text: str):
    """Return list of dicts: {text, gap_before, emotion} with sticky tag tracking."""
    flat = re.sub(r"\s+", " ", text).strip()
    sentences = re.split(r"(?<=[.!?])\s+", flat)
    st = {"emotion": None, "style": None, "speed": None, "pitch": None, "expressive": None}
    out = []
    for raw in sentences:
        s = raw.strip()
        if not s:
            continue
        gap = 0.0
        # Consume leading tags, updating sticky state, until sfx/plain text begins.
        while True:
            s = s.lstrip()
            m = PAUSE_RE.match(s)
            if m:
                gap = max(gap, GAP_LONG if m.group(1) == "long_pause" else GAP_SHORT)
                s = s[m.end():]
                continue
            m = EMO_RE.match(s)
            if m:
                # New emotion resets section prosody/style.
                st.update(emotion=m.group(1), style=None, speed=None, pitch=None, expressive=None)
                s = s[m.end():]
                continue
            m = STYLE_RE.match(s)
            if m:
                st["style"] = m.group(1)
                s = s[m.end():]
                continue
            m = PROSMOD_RE.match(s)
            if m:
                v = m.group(1)
                st["speed" if v.startswith("speed") else "pitch" if v.startswith("pitch") else "expressive"] = v
                s = s[m.end():]
                continue
            break
        # Drop any stray sticky/pause tags left mid-body; keep <|sfx:*|>.
        body = STRIP_BODY_RE.sub("", s).strip()
        if not body:
            continue
        out.append({"text": render_tags(st) + body, "gap_before": gap, "emotion": st["emotion"]})
    return out


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


PROSMOD_TAG_RE = re.compile(r"<\|prosody:(?:speed_[a-z_]+|pitch_[a-z]+|expressive_[a-z]+)\|>")
EMO_STYLE_TAG_RE = re.compile(r"<\|emotion:[a-z_]+\|>|<\|style:[a-z_]+\|>")


def ease_tags(seg_text: str, level: int) -> str:
    """Progressively drop the tags that push the model out of voice.

    level 0: full tags (as authored).
    level 1: drop prosody modifiers (expressive/speed/pitch) -> these inflate pitch.
    level 2+: also drop emotion/style, keeping only <|sfx:*|> + text (pure clone,
             which reliably stays in the reference speaker's voice).
    """
    if level <= 0:
        return seg_text
    out = PROSMOD_TAG_RE.sub("", seg_text)
    if level >= 2:
        out = EMO_STYLE_TAG_RE.sub("", out)
    return out.strip()


def median_f0(mono: np.ndarray) -> float:
    """Median voiced fundamental frequency (Hz), or nan if no voiced frames."""
    if len(mono) < int(0.15 * SR):
        return float("nan")
    try:
        f0, _, _ = librosa.pyin(
            mono.astype(np.float32), fmin=F0_FMIN, fmax=F0_FMAX, sr=SR, frame_length=2048
        )
        f0 = f0[~np.isnan(f0)]
        return float(np.median(f0)) if len(f0) else float("nan")
    except Exception:
        return float("nan")


def synth_segment(seg_text: str) -> np.ndarray:
    common = {"input": seg_text, "temperature": TEMP, "top_k": TOP_K, "max_new_tokens": 1500}
    if USE_REF:
        common["ref_audio"] = REF_AUDIO
        common["ref_text"] = REF_TEXT
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
        return trim(np.asarray(x, dtype=np.float32))
    return np.zeros(0, dtype=np.float32)


def main():
    LOG_FILE.write_text("", encoding="utf-8")
    if USE_REF and not Path(REF_AUDIO).is_file():
        log(f"[fatal] REF_AUDIO not found: {REF_AUDIO}")
        sys.exit(1)

    segs = split_segments(TEXT)
    log(f"Voice: {'clone ' + REF_AUDIO if USE_REF else 'random per-segment (no clone)'}")
    log(f"Sampling: temp={TEMP} top_k={TOP_K} max_tries={MAX_TRIES}")
    log(f"Segments: {len(segs)}")

    # Target speaker pitch from the reference clip; everything is locked near it.
    target_f0 = float("nan")
    if USE_REF:
        ref_y, _ = librosa.load(REF_AUDIO, sr=SR, mono=True)
        target_f0 = median_f0(np.asarray(ref_y, dtype=np.float32))
    if not (target_f0 == target_f0):  # nan => no usable reference pitch
        target_f0 = 110.0
        log(f"[warn] could not read reference F0; defaulting target to {target_f0:.0f} Hz")
    f0_lo, f0_hi = target_f0 * F0_REL_LO, target_f0 * F0_REL_HI
    log(f"Speaker lock: target F0={target_f0:.1f} Hz  accept band=[{f0_lo:.0f}, {f0_hi:.0f}] Hz")

    pieces = []
    for i, seg in enumerate(segs):
        log("-" * 60)
        log(f"[{i:02d}] emotion={seg['emotion']} gap={seg['gap_before']:.2f}  {seg['text']}")
        audio = np.zeros(0, dtype=np.float32)
        # Fallback: among non-silent, non-runaway takes keep the one whose pitch is
        # closest to the target speaker (in log space), so we never accept a flip.
        best, best_dist = np.zeros(0, dtype=np.float32), float("inf")
        for attempt in range(1, MAX_TRIES + 1):
            # Escalate: if the model keeps flipping voice, ease the exaggeration tags
            # so it stays in the reference speaker rather than relying on pitch fixes.
            level = 0 if attempt <= 2 else 1 if attempt <= 4 else 2
            seg_text = ease_tags(seg["text"], level)
            cand = synth_segment(seg_text)
            dur = len(cand) / SR
            peak = float(np.max(np.abs(cand))) if len(cand) else 0.0
            f0 = median_f0(cand)
            dur_ok = int(MIN_SEG_SEC * SR) <= len(cand) <= int(MAX_SEG_SEC * SR)
            loud_ok = peak >= 0.03
            f0_ok = (f0 == f0) and (f0_lo <= f0 <= f0_hi)
            log(f"     try {attempt} (ease={level}): dur={dur:.2f}s peak={peak:.3f} "
                f"f0={f0:.1f}Hz {'OK' if f0_ok else 'PITCH-OFF'}")
            if dur_ok and loud_ok and (f0 == f0):
                dist = abs(np.log(f0 / target_f0))
                if dist < best_dist:
                    best, best_dist = cand, dist
            if dur_ok and loud_ok and f0_ok:
                audio = cand
                break
        else:
            audio = best[: int(MAX_SEG_SEC * SR)]
            log(f"     [warn] no in-band take for seg {i}; using closest-pitch best "
                f"({len(audio)/SR:.2f}s, dist={best_dist:.3f}).")
        # Gentle speaker lock only: nudge a slightly-off take toward target, but never
        # apply the big octave-ish shifts that mangle formants ("elephant" voice).
        if len(audio) > 0:
            f_final = median_f0(audio)
            if (f_final == f_final) and not (f0_lo <= f_final <= f0_hi):
                n_steps = 12.0 * float(np.log2(target_f0 / f_final))
                if abs(n_steps) <= MAX_SHIFT_ST:
                    log(f"     [fix] pitch-nudge seg {i}: {f_final:.0f}Hz -> {target_f0:.0f}Hz "
                        f"({n_steps:+.1f} semitones)")
                    audio = librosa.effects.pitch_shift(
                        np.ascontiguousarray(audio, dtype=np.float32), sr=SR, n_steps=n_steps
                    ).astype(np.float32)
                else:
                    capped = max(-MAX_SHIFT_ST, min(MAX_SHIFT_ST, n_steps))
                    log(f"     [fix] seg {i} off by {n_steps:+.1f}st (too far for a clean "
                        f"shift); nudging {capped:+.1f}st to avoid 'elephant' artifacts.")
                    audio = librosa.effects.pitch_shift(
                        np.ascontiguousarray(audio, dtype=np.float32), sr=SR, n_steps=capped
                    ).astype(np.float32)
        if len(audio) == 0:
            log(f"     [warn] segment {i} produced no audio; skipping.")
            continue
        sf.write(str(SEG_DIR / f"seg_{i:02d}_{seg['emotion']}.wav"), audio, SR)
        if pieces:
            gap = seg["gap_before"] if seg["gap_before"] > 0 else GAP_SHORT
            pieces.append(np.zeros(int(gap * SR), dtype=np.float32))
        pieces.append(audio)

    if not pieces:
        log("[fatal] no audio generated.")
        sys.exit(1)

    full = np.concatenate(pieces)
    peak = float(np.max(np.abs(full)))
    if peak > 0:
        full = (full / peak) * 0.97
    sf.write(str(OUT_FILE), full, SR)
    log("=" * 60)
    log(f"Saved: {OUT_FILE}")
    log(f"Total duration: {len(full)/SR:.2f}s  size: {OUT_FILE.stat().st_size/1024/1024:.2f} MB")
    log("Emotion order: " + " -> ".join(dict.fromkeys(s["emotion"] for s in segs if s["emotion"])))
    subprocess.run(["file", str(OUT_FILE)], check=False)
    log(f"Play: ffplay -nodisp -autoexit {OUT_FILE}")


if __name__ == "__main__":
    main()
