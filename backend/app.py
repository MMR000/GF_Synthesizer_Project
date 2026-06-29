"""Emotion TTS Studio - local FastAPI proxy for SGLang-Omni / vLLM-Omni expressive TTS.

This backend never uploads anything externally. It proxies generation requests to a
locally running expressive-speech server, saves the resulting WAV locally, mirrors it
into the project ``outputs/`` folder, and keeps a small JSON history.
"""
from __future__ import annotations

import io
import json
import logging
import re
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import requests
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field

# Audio libs are required for segmented generation (numpy + soundfile). librosa is
# optional and only enables the per-segment speaker pitch-lock.
try:
    import numpy as np
    import soundfile as sf

    HAVE_AUDIO = True
except Exception:  # noqa: BLE001
    HAVE_AUDIO = False

try:
    import librosa

    HAVE_LIBROSA = True
except Exception:  # noqa: BLE001
    HAVE_LIBROSA = False

# --------------------------------------------------------------------------------------
# Paths & logging
# --------------------------------------------------------------------------------------
BACKEND_DIR = Path(__file__).resolve().parent
PROJECT_DIR = BACKEND_DIR.parent
STORAGE_DIR = BACKEND_DIR / "storage"
OUTPUTS_DIR = STORAGE_DIR / "outputs"
ROOT_OUTPUTS_DIR = PROJECT_DIR / "outputs"
HISTORY_FILE = STORAGE_DIR / "history.json"
LOG_FILE = STORAGE_DIR / "server.log"

for d in (STORAGE_DIR, OUTPUTS_DIR):
    d.mkdir(parents=True, exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.FileHandler(LOG_FILE, encoding="utf-8"), logging.StreamHandler()],
)
log = logging.getLogger("emotion-tts")

# --------------------------------------------------------------------------------------
# Endpoint config
# --------------------------------------------------------------------------------------
VLLM_URL = "http://localhost:8095/v1/audio/speech"
SGLANG_URL = "http://localhost:9000/v1/audio/speech"
MODEL_NAME = "bosonai/higgs-audio-v3-tts-4b"
REQUEST_TIMEOUT = 600

TAG_RE = re.compile(r"<\|[a-z]+:[a-z_]+\|>")
ANY_TAG_RE = re.compile(r"<\|[^>]*\|>")

# --- Segmented (one-by-one) generation config ----------------------------------------
SEG_SR_FALLBACK = 24000
SEG_GAP_SHORT = 0.22
SEG_GAP_LONG = 0.6
SEG_MIN_SEC = 0.2
SEG_MAX_SEC = 16.0
SEG_MAX_TRIES = 5
SEG_MAX_NEW_TOKENS = 1500
# Speaker pitch-lock band (relative to the first segment's median F0).
F0_REL_LO = 0.70
F0_REL_HI = 1.55
F0_FMIN, F0_FMAX = 65.0, 450.0
MAX_SHIFT_ST = 4.0

SEG_PAUSE_RE = re.compile(r"<\|prosody:(pause|long_pause)\|>")
SEG_EMO_RE = re.compile(r"<\|emotion:([a-z_]+)\|>")
SEG_STYLE_RE = re.compile(r"<\|style:([a-z_]+)\|>")
SEG_PROSMOD_RE = re.compile(r"<\|prosody:(speed_[a-z_]+|pitch_[a-z]+|expressive_[a-z]+)\|>")
SEG_STRIP_BODY_RE = re.compile(
    r"<\|emotion:[a-z_]+\|>|<\|style:[a-z_]+\|>|"
    r"<\|prosody:(?:speed_[a-z_]+|pitch_[a-z]+|expressive_[a-z]+|pause|long_pause)\|>"
)
SEG_PROSMOD_TAG_RE = re.compile(r"<\|prosody:(?:speed_[a-z_]+|pitch_[a-z]+|expressive_[a-z]+)\|>")
SEG_EMO_STYLE_TAG_RE = re.compile(r"<\|emotion:[a-z_]+\|>|<\|style:[a-z_]+\|>")

# --------------------------------------------------------------------------------------
# Tag library & templates (served via /api/tags and /api/templates)
# --------------------------------------------------------------------------------------
TAGS: list[dict[str, Any]] = [
    # Emotion
    *[
        {"category": "emotion", "tag": f"<|emotion:{k}|>", "label": v}
        for k, v in [
            ("elation", "Joy / elation"),
            ("amusement", "Funny / playful / laughter mood"),
            ("enthusiasm", "Excited / energetic"),
            ("determination", "Firm / determined"),
            ("pride", "Proud / confident"),
            ("contentment", "Calm satisfaction"),
            ("affection", "Warm / affectionate"),
            ("relief", "Relieved"),
            ("contemplation", "Thoughtful"),
            ("confusion", "Confused"),
            ("surprise", "Surprised"),
            ("awe", "Wonder / awe"),
            ("longing", "Longing"),
            ("arousal", "Heightened desire"),
            ("anger", "Angry"),
            ("fear", "Fearful"),
            ("disgust", "Disgusted"),
            ("bitterness", "Bitter"),
            ("sadness", "Sad"),
            ("shame", "Shame"),
            ("helplessness", "Helpless"),
        ]
    ],
    # Style
    *[
        {"category": "style", "tag": f"<|style:{k}|>", "label": v}
        for k, v in [("singing", "Singing"), ("shouting", "Shouting"), ("whispering", "Whispering")]
    ],
    # Prosody
    *[
        {"category": "prosody", "tag": f"<|prosody:{k}|>", "label": v}
        for k, v in [
            ("speed_very_slow", "Very slow"),
            ("speed_slow", "Slow"),
            ("speed_fast", "Fast"),
            ("speed_very_fast", "Very fast"),
            ("pitch_low", "Low pitch"),
            ("pitch_high", "High pitch"),
            ("pause", "Short pause"),
            ("long_pause", "Long pause"),
            ("expressive_high", "More expressive"),
            ("expressive_low", "Flatter / less expressive"),
        ]
    ],
    # SFX (insert tag + suggested onomatopoeia)
    *[
        {"category": "sfx", "tag": f"<|sfx:{k}|>", "label": lbl, "insert": f"<|sfx:{k}|>{ono}", "onomatopoeia": ono}
        for k, lbl, ono in [
            ("cough", "Cough", "Ahem"),
            ("laughter", "Laughter", "Haha"),
            ("crying", "Crying", "Boohoo"),
            ("screaming", "Screaming", "Ahh"),
            ("burping", "Burping", "Burp"),
            ("humming", "Humming", "Hmm"),
            ("sigh", "Sigh", "Ahh"),
            ("sniff", "Sniff", "Sff"),
            ("sneeze", "Sneeze", "Achoo"),
        ]
    ],
]

TEMPLATES: list[dict[str, str]] = [
    {
        "title": "Kazakh neutral baseline",
        "language": "Kazakh",
        "mood": "Neutral",
        "description": "Plain neutral sentence for a baseline timbre reference.",
        "text": "Бүгін біз жергілікті TTS моделін тексеріп жатырмыз. Бұл қарапайым бейтарап сөйлем.",
    },
    {
        "title": "Kazakh enthusiasm",
        "language": "Kazakh",
        "mood": "Enthusiasm",
        "description": "Energetic, expressive launch announcement.",
        "text": "<|emotion:enthusiasm|><|prosody:expressive_high|>Бүгін біз жергілікті TTS моделін сәтті іске қостық! <|prosody:pause|> Бұл өте қызықты нәтиже.",
    },
    {
        "title": "Kazakh laughter",
        "language": "Kazakh",
        "mood": "Amusement",
        "description": "Playful line with inline laughter SFX.",
        "text": "<|emotion:amusement|><|prosody:expressive_high|>Бейба ағам керемет <|sfx:laughter|>Haha, одан артық не керек?",
    },
    {
        "title": "Kazakh whisper",
        "language": "Kazakh",
        "mood": "Whispering",
        "description": "Soft whispered internal test line.",
        "text": "<|style:whispering|><|emotion:contemplation|>Бұл тек ішкі тест. <|prosody:pause|> Дауыстың шынымен сыбырлап шыққанын тексерейік.",
    },
    {
        "title": "Kazakh sadness",
        "language": "Kazakh",
        "mood": "Sadness",
        "description": "Slow, low, melancholic delivery.",
        "text": "<|emotion:sadness|><|prosody:speed_slow|><|prosody:pitch_low|>Мен бұл нәтиже басқаша болады деп ойлаған едім. <|prosody:long_pause|> Бірақ біз әлі де жалғастырамыз.",
    },
    {
        "title": "Kazakh anger",
        "language": "Kazakh",
        "mood": "Anger",
        "description": "Firm, high-energy demand.",
        "text": "<|emotion:anger|><|prosody:expressive_high|><|prosody:pitch_high|>Бұл қате қайта-қайта қайталанбауы керек! <|prosody:pause|> Біз оны бүгін түзетуіміз қажет.",
    },
    {
        "title": "Russian enthusiasm",
        "language": "Russian",
        "mood": "Enthusiasm",
        "description": "Excited Russian launch line.",
        "text": "<|emotion:enthusiasm|><|prosody:expressive_high|>Сегодня мы наконец запустили локальную модель синтеза речи! <|prosody:pause|> Это очень интересный результат.",
    },
    {
        "title": "English laughter",
        "language": "English",
        "mood": "Amusement",
        "description": "Casual English line with laughter.",
        "text": "<|emotion:amusement|><|prosody:expressive_high|>Wait, that was actually hilarious. <|sfx:laughter|>Hehe, I really did not expect that.",
    },
    {
        "title": "Long Kazakh positive laughter",
        "language": "Kazakh",
        "mood": "Amusement",
        "description": "Long single-pass upbeat passage with repeated delivery tags.",
        "text": "<|emotion:amusement|><|prosody:expressive_high|><|prosody:pitch_high|>Бибо ағам сондай сүйкімді! Оны көрген адамның басы айналып, бағытын таба алмай қалады! <|sfx:laughter|>Haha, шынымен айтамын, Бибо ағам бір күлімдесе болды, бүкіл бөлме жарқ етіп кетеді! <|prosody:pause|><|emotion:amusement|><|prosody:expressive_high|>Ол кірсе — бәрі күледі, ол сөйлесе — бәрі тыңдайды, ол күлсе — бітті, ешкім өзін ұстай алмайды! <|sfx:laughter|>Hehe, Бибо ағам жүрсе мереке, отырса концерт, үндемей тұрса да дайын комедия сияқты!\n\n<|prosody:pause|><|emotion:enthusiasm|><|prosody:expressive_high|>Бибо ағам керемет адам! Одан артық не керек өзі? Біреу шаршап отырса, Бибо ағам бір ауыз сөз айтады да, бәрі қайта тіріліп кеткендей болады! <|sfx:laughter|>Haha haha, ол кәдімгі көңіл-күй генераторы ғой! Оның жанында уайым да ұзақ тұрмайды, шаршау да қашып кетеді, жаман ой болса өзі есіктен шығып кетеді! <|prosody:pause|><|emotion:amusement|>Бибо ағам бір қарап қойса болды, адам өзінің проблемасын ұмытып, “мен неге мұңайып отырмын?” деп өзі күліп жібереді!\n\n<|prosody:pause|><|emotion:amusement|><|prosody:expressive_high|>Мен кейде шын ойлаймын: егер сүйкімділікке медаль берілсе, Бибо ағам алтын медальді ғана емес, бүкіл жарысты алып кетер еді! Егер күлкіге конкурс болса, ол дайындалмай-ақ бірінші орын алар еді! Егер жақсы көңіл-күй сатылатын болса, Бибо ағамның бір күлкісі ең қымбат бренд болар еді! <|sfx:laughter|>Hehe, Бибо ағам сондай керемет, оны мақтауға сөз жетпейді! Ерекше, сүйкімді, көңілді, жылы жүзді, қызық, күлкілі — бәрі бір адамның ішінде! <|sfx:laughter|>Haha, Бибо ағам бар жерде көңілсіз отыру мүмкін емес! Одан артық не керек?",
    },
    {
        "title": "Multi-emotion Kazakh drama",
        "language": "Kazakh",
        "mood": "Multi-emotion",
        "description": "Emotional arc: contentment, surprise, sadness, anger, relief, amusement.",
        "text": "<|emotion:contentment|><|prosody:expressive_high|>Бибо ағам мені мақтағанда, менің жүрегім бірден жылып кетеді. Ол “жарайсың” десе болды, мен өзімді әлемдегі ең ақылды, ең мықты, ең бақытты адам сияқты сезінемін. <|emotion:elation|>Сол сәтте қуанышым ішіме сыймай, аспанға ұшып кеткім келеді. <|sfx:laughter|>Haha, Бибо ағамның бір мақтауы маған бір аптаға жететін энергия береді.\n\n<|prosody:pause|><|emotion:surprise|>Бірақ кейде Бибо ағам күтпеген жерден қатты сөйлеп қояды. Мен бірден абдырап қаламын. <|emotion:confusion|>Басымда мың сұрақ пайда болады, ал жауап біреу де жоқ сияқты. <|prosody:pause|> Ол маған ұрысқанда, көңілім қатты жарақаттанады. <|emotion:sadness|><|prosody:speed_slow|><|prosody:pitch_low|>Сол кезде ішімнен бір нәрсе үзіліп кеткендей болады.\n\n<|prosody:long_pause|><|emotion:anger|><|prosody:expressive_high|>Ал егер біреу Бибо ағам туралы жаман сөз айтса, мен бірден ашуланамын! Жоқ, оған болмайды! Бибо ағамды ешкім ренжітпеуі керек! <|prosody:pause|><|emotion:relief|>Бірақ Бибо ағам қайтадан күлімдеп, “ештеңе етпейді” десе, менің жаным бірден тынышталады. <|emotion:amusement|><|prosody:expressive_high|>Сосын ол бір күлкілі нәрсе айтып қояды да, мен бәрін ұмытып кетемін. <|sfx:laughter|>Haha, міне, Бибо ағамның күші осында.",
    },
]

# Valid tag values for syntax validation.
VALID_TAGS = {t["tag"] for t in TAGS}
SFX_TAGS = {t["tag"] for t in TAGS if t["category"] == "sfx"}

# --------------------------------------------------------------------------------------
# App
# --------------------------------------------------------------------------------------
app = FastAPI(title="Emotion TTS Studio", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


class GenerateRequest(BaseModel):
    text: str
    endpointMode: str = "auto"  # auto | vllm | sglang | custom
    customUrl: Optional[str] = None
    includeModel: bool = True
    autoRetry: bool = True
    temperature: float = 0.8
    top_k: int = 50
    max_new_tokens: int = 4096
    filename: str = "emotion_test.wav"
    # Segmented (one-by-one) generation for long text.
    segmented: bool = False
    cloneVoice: bool = True  # clone subsequent segments from the first one


class ValidateRequest(BaseModel):
    text: str


# --------------------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------------------
def clean_text(text: str) -> str:
    """Strip all <|...|> tags, leaving the spoken words."""
    return re.sub(r"\s+", " ", ANY_TAG_RE.sub("", text)).strip()


def load_history() -> list[dict[str, Any]]:
    if not HISTORY_FILE.exists():
        return []
    try:
        return json.loads(HISTORY_FILE.read_text(encoding="utf-8"))
    except Exception as e:  # noqa: BLE001
        log.error("Failed to read history.json: %s", e)
        return []


def save_history(items: list[dict[str, Any]]) -> None:
    HISTORY_FILE.write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8")


def safe_filename(name: str) -> str:
    name = (name or "emotion_test.wav").strip()
    name = re.sub(r"[^A-Za-z0-9_.\-]", "_", name)
    if not name.lower().endswith(".wav"):
        name += ".wav"
    return name


def looks_like_audio(content: bytes) -> bool:
    if len(content) < 1024:
        return False
    return content[:4] in (b"RIFF", b"OggS", b"fLaC") or content[:3] == b"ID3" or content[:2] == b"\xff\xfb"


def build_targets(req: GenerateRequest) -> list[tuple[str, bool]]:
    """Return ordered list of (url, include_model) attempts based on endpoint mode."""
    mode = (req.endpointMode or "auto").lower()
    if mode == "vllm":
        base = [(VLLM_URL, req.includeModel)]
    elif mode == "sglang":
        base = [(SGLANG_URL, req.includeModel)]
    elif mode == "custom":
        if not req.customUrl:
            raise HTTPException(status_code=400, detail="customUrl required for custom endpoint mode")
        base = [(req.customUrl, req.includeModel)]
    else:  # auto
        base = [(VLLM_URL, True), (SGLANG_URL, False)]
        return base
    # Non-auto: optionally add a retry with the model field flipped.
    if req.autoRetry:
        base.append((base[0][0], not base[0][1]))
    return base


def call_tts(
    url: str,
    include_model: bool,
    req: GenerateRequest,
    *,
    text: Optional[str] = None,
    ref_audio: Optional[str] = None,
    ref_text: Optional[str] = None,
    max_new_tokens: Optional[int] = None,
) -> tuple[bool, bytes, str]:
    payload: dict[str, Any] = {
        "input": req.text if text is None else text,
        "temperature": req.temperature,
        "top_k": req.top_k,
        "max_new_tokens": max_new_tokens or req.max_new_tokens,
    }
    if ref_audio:
        payload["ref_audio"] = ref_audio
        payload["ref_text"] = ref_text or ""
    if include_model:
        payload["model"] = MODEL_NAME
    try:
        log.info("POST %s (model=%s)", url, include_model)
        r = requests.post(url, json=payload, timeout=REQUEST_TIMEOUT)
    except requests.exceptions.RequestException as e:
        msg = f"connection error: {e}"
        log.warning("  %s -> %s", url, msg)
        return False, b"", msg
    if r.status_code != 200:
        snippet = r.text[:500]
        log.warning("  %s -> HTTP %s: %s", url, r.status_code, snippet)
        return False, b"", f"HTTP {r.status_code}: {snippet}"
    if not looks_like_audio(r.content):
        snippet = r.content[:500].decode("utf-8", "replace")
        log.warning("  %s -> non-audio response (%d bytes): %s", url, len(r.content), snippet)
        return False, b"", f"non-audio response ({len(r.content)} bytes): {snippet}"
    return True, r.content, "ok"


# --------------------------------------------------------------------------------------
# Segmented generation: split -> generate each sentence -> clone voice -> stitch
# --------------------------------------------------------------------------------------
def _render_tags(st: dict[str, Optional[str]]) -> str:
    parts = []
    if st["emotion"]:
        parts.append(f"<|emotion:{st['emotion']}|>")
    if st["style"]:
        parts.append(f"<|style:{st['style']}|>")
    for key in ("speed", "pitch", "expressive"):
        if st[key]:
            parts.append(f"<|prosody:{st[key]}|>")
    return "".join(parts)


def split_segments(text: str) -> list[dict[str, Any]]:
    """Split into sentence-level segments with sticky emotion/prosody/style tags.

    <|prosody:pause|> / <|prosody:long_pause|> become silence gaps between segments.
    A new <|emotion:*|> resets that section's prosody/style.
    """
    flat = re.sub(r"\s+", " ", text).strip()
    sentences = re.split(r"(?<=[.!?。！？])\s+", flat)
    st: dict[str, Optional[str]] = {
        "emotion": None,
        "style": None,
        "speed": None,
        "pitch": None,
        "expressive": None,
    }
    out: list[dict[str, Any]] = []
    for raw in sentences:
        s = raw.strip()
        if not s:
            continue
        gap = 0.0
        while True:
            s = s.lstrip()
            m = SEG_PAUSE_RE.match(s)
            if m:
                gap = max(gap, SEG_GAP_LONG if m.group(1) == "long_pause" else SEG_GAP_SHORT)
                s = s[m.end():]
                continue
            m = SEG_EMO_RE.match(s)
            if m:
                st.update(emotion=m.group(1), style=None, speed=None, pitch=None, expressive=None)
                s = s[m.end():]
                continue
            m = SEG_STYLE_RE.match(s)
            if m:
                st["style"] = m.group(1)
                s = s[m.end():]
                continue
            m = SEG_PROSMOD_RE.match(s)
            if m:
                v = m.group(1)
                key = "speed" if v.startswith("speed") else "pitch" if v.startswith("pitch") else "expressive"
                st[key] = v
                s = s[m.end():]
                continue
            break
        body = SEG_STRIP_BODY_RE.sub("", s).strip()
        if not body:
            continue
        out.append({"text": _render_tags(st) + body, "gap_before": gap, "emotion": st["emotion"]})
    return out


def _ease_tags(seg_text: str, level: int) -> str:
    """Progressively drop the tags that push the model out of voice (anti-drift)."""
    if level <= 0:
        return seg_text
    out = SEG_PROSMOD_TAG_RE.sub("", seg_text)
    if level >= 2:
        out = SEG_EMO_STYLE_TAG_RE.sub("", out)
    return out.strip()


def _trim_silence(mono, sr: int, pad_sec: float = 0.08):
    if len(mono) == 0:
        return mono
    peak = float(np.max(np.abs(mono)))
    if peak < 1e-3:
        return mono[:0]
    thresh = max(peak * 0.03, 1e-3)
    loud = np.where(np.abs(mono) > thresh)[0]
    if len(loud) == 0:
        return mono[:0]
    start = max(0, loud[0] - int(pad_sec * sr))
    end = min(len(mono), loud[-1] + int(pad_sec * sr))
    return mono[start:end]


def _median_f0(mono, sr: int) -> float:
    if not HAVE_LIBROSA or len(mono) < int(0.15 * sr):
        return float("nan")
    try:
        f0, _, _ = librosa.pyin(
            mono.astype(np.float32), fmin=F0_FMIN, fmax=F0_FMAX, sr=sr, frame_length=2048
        )
        f0 = f0[~np.isnan(f0)]
        return float(np.median(f0)) if len(f0) else float("nan")
    except Exception:  # noqa: BLE001
        return float("nan")


def _decode_wav(content: bytes):
    x, sr = sf.read(io.BytesIO(content), dtype="float32", always_2d=False)
    if getattr(x, "ndim", 1) > 1:
        x = x.mean(axis=1)
    return np.asarray(x, dtype=np.float32), int(sr)


def do_segmented(req: GenerateRequest, fname: str, targets: list[tuple[str, bool]]):
    """Generate long text segment-by-segment and concatenate. Returns
    (audio_bytes, endpoint_used, seg_count) or raises RuntimeError with details."""
    if not HAVE_AUDIO:
        raise RuntimeError("segmented mode needs numpy + soundfile installed in the backend venv")

    segs = split_segments(req.text)
    if not segs:
        raise RuntimeError("no speakable segments found in text")

    log.info("Segmented generation: %d segments (clone=%s, librosa=%s)", len(segs), req.cloneVoice, HAVE_LIBROSA)
    pieces: list[Any] = []
    sr_master = SEG_SR_FALLBACK
    ref_audio: Optional[str] = None
    ref_text: Optional[str] = None
    target_f0 = float("nan")
    f0_lo = f0_hi = 0.0
    endpoint_used = ""
    seg_tokens = min(req.max_new_tokens, SEG_MAX_NEW_TOKENS)
    last_err = ""

    for i, seg in enumerate(segs):
        audio = None
        best = None
        best_dist = float("inf")
        for attempt in range(1, SEG_MAX_TRIES + 1):
            level = 0 if attempt <= 2 else 1 if attempt <= 4 else 2
            seg_text = _ease_tags(seg["text"], level) if HAVE_LIBROSA else seg["text"]
            content = None
            for url, im in targets:
                ok, body, msg = call_tts(
                    url,
                    im,
                    req,
                    text=seg_text,
                    ref_audio=ref_audio,
                    ref_text=ref_text,
                    max_new_tokens=seg_tokens,
                )
                if ok:
                    content = body
                    endpoint_used = f"{url} (model={'yes' if im else 'no'}) · {len(segs)} segments"
                    break
                last_err = msg
            if content is None:
                continue  # all endpoints failed this attempt; retry
            x, sr = _decode_wav(content)
            x = _trim_silence(x, sr)
            dur_ok = int(SEG_MIN_SEC * sr) <= len(x) <= int(SEG_MAX_SEC * sr)
            peak = float(np.max(np.abs(x))) if len(x) else 0.0
            loud_ok = peak >= 0.03
            f0 = _median_f0(x, sr) if (HAVE_LIBROSA and target_f0 == target_f0) else float("nan")
            f0_ok = True
            if HAVE_LIBROSA and target_f0 == target_f0 and f0 == f0:
                f0_ok = f0_lo <= f0 <= f0_hi
            if dur_ok and loud_ok and (len(x) > 0):
                dist = abs(np.log(f0 / target_f0)) if (f0 == f0 and target_f0 == target_f0) else 0.0
                if dist < best_dist:
                    best, best_dist = (x, sr), dist
            if dur_ok and loud_ok and f0_ok:
                audio = (x, sr)
                break
        if audio is None:
            if best is None:
                log.warning("  segment %d produced no usable audio; skipping", i)
                continue
            audio = (best[0][: int(SEG_MAX_SEC * best[1])], best[1])

        x, sr = audio
        # Optional gentle pitch-lock back toward the speaker (never big octave shifts).
        if HAVE_LIBROSA and target_f0 == target_f0:
            f_final = _median_f0(x, sr)
            if f_final == f_final and not (f0_lo <= f_final <= f0_hi):
                n_steps = 12.0 * float(np.log2(target_f0 / f_final))
                n_steps = max(-MAX_SHIFT_ST, min(MAX_SHIFT_ST, n_steps))
                x = librosa.effects.pitch_shift(
                    np.ascontiguousarray(x, dtype=np.float32), sr=sr, n_steps=n_steps
                ).astype(np.float32)

        # Establish the cloned reference voice from the first good segment.
        if ref_audio is None:
            sr_master = sr
            if req.cloneVoice:
                ref_path = OUTPUTS_DIR / f"_ref_{fname}"
                sf.write(str(ref_path), x, sr)
                ref_audio = str(ref_path.resolve())
                ref_text = clean_text(seg["text"])
            if HAVE_LIBROSA:
                target_f0 = _median_f0(x, sr)
                if target_f0 == target_f0:
                    f0_lo, f0_hi = target_f0 * F0_REL_LO, target_f0 * F0_REL_HI

        if pieces:
            gap = seg["gap_before"] if seg["gap_before"] > 0 else SEG_GAP_SHORT
            pieces.append(np.zeros(int(gap * sr_master), dtype=np.float32))
        pieces.append(x.astype(np.float32))

    if not pieces:
        raise RuntimeError(f"all segments failed. last error: {last_err or 'unknown'}")

    full = np.concatenate(pieces)
    peak = float(np.max(np.abs(full)))
    if peak > 0:
        full = (full / peak) * 0.97
    buf = io.BytesIO()
    sf.write(buf, full, sr_master, format="WAV", subtype="PCM_16")
    # Clean up the temporary reference clip.
    if ref_audio:
        try:
            Path(ref_audio).unlink(missing_ok=True)
        except Exception:  # noqa: BLE001
            pass
    return buf.getvalue(), endpoint_used, len(segs)


# --------------------------------------------------------------------------------------
# Endpoints
# --------------------------------------------------------------------------------------
@app.get("/api/health")
def health() -> dict[str, Any]:
    def reachable(url: str) -> bool:
        root = url.rsplit("/v1/", 1)[0]
        for probe in (f"{root}/health", root):
            try:
                resp = requests.get(probe, timeout=2)
                if resp.status_code < 500:
                    return True
            except requests.exceptions.RequestException:
                continue
        return False

    return {
        "ok": True,
        "backend": "alive",
        "endpoints": {
            "vllm": {"url": VLLM_URL, "reachable": reachable(VLLM_URL)},
            "sglang": {"url": SGLANG_URL, "reachable": reachable(SGLANG_URL)},
        },
    }


@app.get("/api/tags")
def get_tags() -> list[dict[str, Any]]:
    return TAGS


@app.get("/api/templates")
def get_templates() -> list[dict[str, str]]:
    return TEMPLATES


@app.post("/api/validate")
def validate(req: ValidateRequest) -> dict[str, Any]:
    return {"warnings": run_validation(req.text)}


def run_validation(text: str) -> list[dict[str, str]]:
    warnings: list[dict[str, str]] = []

    def add(level: str, code: str, message: str) -> None:
        warnings.append({"level": level, "code": code, "message": message})

    stripped = text.strip()
    if not stripped:
        add("error", "empty", "Text is empty.")
        return warnings

    # Invalid / unknown tag syntax.
    for m in ANY_TAG_RE.finditer(text):
        tag = m.group(0)
        if not TAG_RE.fullmatch(tag):
            add("error", "bad_syntax", f"Malformed tag: {tag}")
        elif tag not in VALID_TAGS:
            add("warn", "unknown_tag", f"Unknown tag value: {tag}")

    # Chinese / full-width brackets or wrong syntax.
    if re.search(r"[【】｜〈〉《》]", text) or "[" in text and "]" in text:
        if re.search(r"\[[a-zA-Z]+\]", text):
            add("warn", "wrong_bracket", "Use <|category:value|> syntax, not [square brackets].")

    # [laughter] style markers.
    if re.search(r"\[laughter\]", text, re.IGNORECASE):
        add("fix", "bracket_laughter", "Found [laughter]; replace with <|sfx:laughter|>Haha.")

    # SFX not followed by onomatopoeia.
    for m in re.finditer(r"<\|sfx:[a-z_]+\|>", text):
        after = text[m.end():m.end() + 8].lstrip()
        if not after or not re.match(r"[A-Za-zА-Яа-яЁё]", after):
            add("warn", "sfx_no_sound", f"SFX {m.group(0)} should be followed by sound text like Haha, Hehe, Achoo.")

    # Emotion usage.
    emotions = re.findall(r"<\|emotion:[a-z_]+\|>", text)
    if not emotions:
        add("warn", "no_emotion", "No emotion tags used. Add one near the beginning for expressive output.")

    # Long text with a single emotion at the start only.
    if len(stripped) > 400 and len(emotions) <= 1:
        add(
            "warn",
            "long_single_emotion",
            "Long text has only one emotion tag. Repeat emotion/prosody tags before each paragraph to reduce drift.",
        )

    # Punctuation.
    if not re.search(r"[.!?。！？]", stripped):
        add("warn", "no_punctuation", "No sentence punctuation found. Punctuation helps pacing and intonation.")

    # Too many line breaks.
    if text.count("\n") > 12:
        add("warn", "many_breaks", "Many line breaks detected. Excess blank lines can cause odd pauses.")

    return warnings


@app.post("/api/generate")
def generate(req: GenerateRequest) -> JSONResponse:
    if not req.text or not req.text.strip():
        raise HTTPException(status_code=400, detail="text must not be empty")

    fname = safe_filename(req.filename)
    targets = build_targets(req)
    started = time.time()

    if req.segmented:
        if not HAVE_AUDIO:
            return _record_failure(
                req, fname, round(time.time() - started, 2),
                "segmented mode requires numpy + soundfile in the backend venv",
            )
        try:
            audio, endpoint_used, seg_count = do_segmented(req, fname, targets)
        except Exception as e:  # noqa: BLE001
            return _record_failure(req, fname, round(time.time() - started, 2), f"segmented: {e}")
        elapsed = round(time.time() - started, 2)
        return _record_success(req, fname, audio, endpoint_used, elapsed, segments=seg_count)

    # Single-pass.
    audio: bytes = b""
    endpoint_used = ""
    errors: list[str] = []
    for url, include_model in targets:
        ok, content, msg = call_tts(url, include_model, req)
        if ok:
            audio = content
            endpoint_used = f"{url} (model={'yes' if include_model else 'no'})"
            break
        errors.append(f"{url} (model={'yes' if include_model else 'no'}): {msg}")

    elapsed = round(time.time() - started, 2)
    if not audio:
        return _record_failure(req, fname, elapsed, " | ".join(errors) or "all endpoints failed")
    return _record_success(req, fname, audio, endpoint_used, elapsed)


def _history_params(req: GenerateRequest) -> dict[str, Any]:
    return {
        "temperature": req.temperature,
        "top_k": req.top_k,
        "max_new_tokens": req.max_new_tokens,
        "endpointMode": req.endpointMode,
        "segmented": req.segmented,
    }


def _record_failure(req: GenerateRequest, fname: str, elapsed: float, detail: str) -> JSONResponse:
    log.error("Generation failed: %s", detail)
    item = {
        "id": uuid.uuid4().hex[:12],
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "filename": fname,
        "endpointUsed": "",
        "text": req.text,
        "cleanText": clean_text(req.text),
        "parameters": _history_params(req),
        "fileSize": 0,
        "status": "failed",
        "elapsed": elapsed,
        "error": detail,
    }
    items = load_history()
    items.insert(0, item)
    save_history(items)
    return JSONResponse(status_code=502, content={"ok": False, "error": detail, "historyItem": item})


def _record_success(
    req: GenerateRequest,
    fname: str,
    audio: bytes,
    endpoint_used: str,
    elapsed: float,
    segments: int = 0,
) -> JSONResponse:
    out_path = OUTPUTS_DIR / fname
    out_path.write_bytes(audio)
    mirror_ok = False
    try:
        ROOT_OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)
        (ROOT_OUTPUTS_DIR / fname).write_bytes(audio)
        mirror_ok = True
    except Exception as e:  # noqa: BLE001
        log.warning("Could not mirror to project outputs/: %s", e)

    item = {
        "id": uuid.uuid4().hex[:12],
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "filename": fname,
        "endpointUsed": endpoint_used,
        "text": req.text,
        "cleanText": clean_text(req.text),
        "parameters": _history_params(req),
        "fileSize": len(audio),
        "status": "saved",
        "elapsed": elapsed,
        "mirrored": mirror_ok,
        "segments": segments,
    }
    items = load_history()
    items.insert(0, item)
    save_history(items)
    log.info("Saved %s (%d bytes) via %s in %ss", fname, len(audio), endpoint_used, elapsed)
    return JSONResponse(
        content={
            "ok": True,
            "filename": fname,
            "url": f"/api/audio/{fname}",
            "endpointUsed": endpoint_used,
            "fileSize": len(audio),
            "elapsed": elapsed,
            "segments": segments,
            "historyItem": item,
        }
    )


@app.get("/api/audio/{filename}")
def get_audio(filename: str) -> FileResponse:
    fname = safe_filename(filename)
    path = OUTPUTS_DIR / fname
    if not path.exists():
        # Fall back to the project outputs/ folder (so older files are playable too).
        alt = ROOT_OUTPUTS_DIR / fname
        if alt.exists():
            path = alt
        else:
            raise HTTPException(status_code=404, detail="audio not found")
    return FileResponse(str(path), media_type="audio/wav", filename=fname)


@app.get("/api/history")
def get_history() -> list[dict[str, Any]]:
    return load_history()


@app.delete("/api/history/{item_id}")
def delete_history(item_id: str, delete_file: bool = True) -> dict[str, Any]:
    items = load_history()
    kept = []
    removed = None
    for it in items:
        if it.get("id") == item_id:
            removed = it
        else:
            kept.append(it)
    if removed is None:
        raise HTTPException(status_code=404, detail="history item not found")
    save_history(kept)
    if delete_file and removed.get("filename"):
        for base in (OUTPUTS_DIR, ROOT_OUTPUTS_DIR):
            p = base / removed["filename"]
            try:
                if p.exists():
                    p.unlink()
            except Exception as e:  # noqa: BLE001
                log.warning("Could not delete %s: %s", p, e)
    return {"ok": True, "deleted": item_id}


@app.get("/api/")
def root() -> dict[str, str]:
    return {"service": "Emotion TTS Studio backend", "status": "ok"}
