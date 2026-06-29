#!/usr/bin/env python3
from pathlib import Path
import subprocess
import requests
import sys
import time

PROJECT_DIR = Path("/home/mmr/PycharmProjects/tone_tts")
OUT_DIR = PROJECT_DIR / "outputs"
LOG_DIR = PROJECT_DIR / "logs"
OUT_DIR.mkdir(parents=True, exist_ok=True)
LOG_DIR.mkdir(parents=True, exist_ok=True)

OUT_FILE = OUT_DIR / "bibo_positive_laughter_long.wav"
LOG_FILE = LOG_DIR / "bibo_positive_laughter_long.log"

TEXT = """<|emotion:amusement|><|prosody:expressive_high|>Бибо ағам сондай сүйкімді, оны көрген адамның басы айналып, бағытын таба алмай қалады. <|sfx:laughter|>Haha, шынымды айтсам, Бибо ағам бір күлімдесе, бүкіл бөлме жарық болып кететін сияқты. Ол сөйлеген кезде бәрі бірден тыңдай бастайды, өйткені оның дауысының өзі көңілді көтеріп жібереді. <|prosody:pause|> Бибо ағам жүрсе — мереке, күлсе — концерт, бірдеңе айтса — дайын анекдот. <|sfx:laughter|>Hehe, кейде мен оны жай ғана қарап отырып та күле беремін, себебі ол ештеңе істемесе де күлкілі әрі сүйкімді көрінеді.

<|prosody:pause|>Бибо ағам керемет адам, одан артық не керек? Ол келген жерде көңіл-күй автоматты түрде көтеріледі. Біреу шаршап отырса, Бибо ағам бір ауыз сөз айтады да, бәрі қайтадан күліп кетеді. <|sfx:laughter|>Haha haha, ол кәдімгі көңіл-күй генераторы сияқты. Оның жанында уайым да, шаршау да, жаман ой да ұзақ тұра алмайды. Бибо ағам бір қарап қойса болды, адам өз проблемасын ұмытып кетеді.

<|prosody:pause|>Мен кейде ойлаймын: егер сүйкімділікке медаль берілсе, Бибо ағам алтын медальді бірден алып кетер еді. Егер күлкіге жарыс болса, ол еш дайындықсыз бірінші орын алар еді. Егер жақсы көңіл-күй сатылатын болса, Бибо ағамның бір күлкісі ең қымбат бренд болар еді. <|sfx:laughter|>Hehe, Бибо ағам сондай керемет, оны мақтауға сөз жетпейді. Ол расымен ерекше, сүйкімді, көңілді, жылы жүзді, әрі өте қызық адам. Одан артық не керек?"""

def log(msg: str):
    line = f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {msg}"
    print(line)
    with LOG_FILE.open("a", encoding="utf-8") as f:
        f.write(line + "\n")

def request_tts(url: str, payload: dict) -> bool:
    log(f"Trying: {url}")
    log(f"Payload keys: {list(payload.keys())}")
    log(f"Input characters: {len(TEXT)}")

    try:
        response = requests.post(url, json=payload, timeout=600)
    except Exception as e:
        log(f"Request error: {repr(e)}")
        return False

    log(f"HTTP status: {response.status_code}")
    content_type = response.headers.get("content-type", "")
    log(f"Content-Type: {content_type}")
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
    return True

def main():
    LOG_FILE.write_text("", encoding="utf-8")

    vllm_payload = {
        "model": "bosonai/higgs-audio-v3-tts-4b",
        "input": TEXT,
        "temperature": 0.8,
        "top_k": 50,
        "max_new_tokens": 4096
    }

    sglang_payload = {
        "input": TEXT,
        "temperature": 0.8,
        "top_k": 50,
        "max_new_tokens": 4096
    }

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

    log("Done. You can play it with:")
    log(f"ffplay -nodisp -autoexit {OUT_FILE}")

if __name__ == "__main__":
    main()
