# Emotion TTS Studio

A local web studio for **expressive / emotional TTS** built on a local **SGLang-Omni**
(or vLLM-Omni) speech server. Write Kazakh / Russian / English text, drag emotion /
prosody / style / SFX tags into the editor, generate WAV audio, and listen back —
right in the browser.

> Local research tool. Nothing is uploaded to external servers. No credentials are stored
> or exposed.

---

## Architecture

```
webui/     React + Vite + TypeScript + Tailwind + Framer Motion frontend (port 5173)
backend/   FastAPI proxy that calls your local TTS server and saves WAVs (port 7860)
```

The browser only ever talks to the local FastAPI proxy (`/api/*`, proxied by Vite). The
proxy forwards generation to your local speech server and writes audio to
`backend/storage/outputs/` and mirrors it into the project `outputs/` folder.

Supported speech endpoints:

- vLLM-Omni: `http://localhost:8095/v1/audio/speech`
- SGLang-Omni: `http://localhost:9000/v1/audio/speech`

In **Auto** mode the proxy tries vLLM (with the `model` field) and falls back to SGLang
(without the `model` field).

---

## 1. Start your TTS server (separately)

Make sure your local expressive speech server is already running, e.g. via the existing
scripts in this repo:

```bash
# SGLang-Omni (native), for example:
bash scripts/02b_sglang_native.sh
```

It should answer on `http://localhost:9000/v1/audio/speech` (SGLang) or
`http://localhost:8095/v1/audio/speech` (vLLM).

## 2. Start this web UI

```bash
cd /home/mmr/PycharmProjects/tone_tts
bash scripts/run_emotion_web.sh
```

This creates a Python venv for the backend, installs deps, starts FastAPI on `:7860`,
then installs npm deps and starts Vite on `:5173`.

> The runner uses [`uv`](https://github.com/astral-sh/uv) to create the backend venv
> when available (it works even if the system `python3-venv` / `ensurepip` package is not
> installed), and falls back to `python3 -m venv` otherwise.

To stop:

```bash
bash scripts/stop_emotion_web.sh
# or just Ctrl+C in the run terminal
```

## 3. Open the app

```
http://localhost:5173
```

## 4. Generate a test

Load a template or paste:

```
<|emotion:amusement|><|prosody:expressive_high|>Бейба ағам керемет <|sfx:laughter|>Haha, одан артық не керек?
```

Click **Generate WAV** (or **Generate + play**) and listen in the Audio Result panel.

---

## Features

- **Tag Library** — full emotion / prosody / style / SFX catalog. Search, filter,
  favorite, copy, click-to-insert, and drag-into-editor. SFX tags insert the suggested
  onomatopoeia (e.g. `<|sfx:laughter|>Haha`).
- **Tagged Text Composer** — large editor, insert tags at the cursor (or before selected
  text), Undo, Clear, Copy, Remove all tags, Normalize spaces, Repeat delivery tags per
  paragraph, Make more emotional, char/token counts, raw + clean previews.
- **Templates** — ready Kazakh / Russian / English examples (neutral, enthusiasm,
  laughter, whisper, sadness, anger, long passages, multi-emotion drama).
- **Validation & Tips** — flags malformed/unknown tags, SFX without sound text,
  long text with a single emotion, missing punctuation, `[laughter]` markers (with a
  one-click fix), wrong bracket syntax, etc.
- **Generation panel** — endpoint mode (auto / vLLM / SGLang / custom), model-field
  toggle (include / exclude / auto-retry), temperature / top_k / max_new_tokens /
  filename, health check, generate, generate + autoplay, stop, live payload + curl
  preview.
- **Audio Result** — waveform (Wavesurfer.js) + native fallback, file info, download,
  copy path / tagged / clean, regenerate, and A/B comparison of any two saved clips.
- **History** — every generation is recorded; search, load text back, play, delete,
  export JSON.
- **Copy / Export** — equivalent curl and Python `requests` snippets, raw tagged text,
  clean text.
- **Reference Voice** (optional, UI-only for now) — pick a reference clip + transcript;
  wiring is left as a clear TODO and does not block normal generation.

---

## API (FastAPI proxy)

| Method | Path                     | Purpose                              |
| ------ | ------------------------ | ------------------------------------ |
| GET    | `/api/health`            | Backend + endpoint reachability      |
| POST   | `/api/generate`          | Generate + save WAV, record history  |
| GET    | `/api/audio/{filename}`  | Serve a generated WAV                 |
| GET    | `/api/history`           | List generation history              |
| DELETE | `/api/history/{id}`      | Delete a history item (and its file) |
| POST   | `/api/validate`          | Validation warnings for text         |
| GET    | `/api/tags`              | Tag library                          |
| GET    | `/api/templates`         | Built-in templates                   |

Backend log: `backend/storage/server.log`.

---

## Notes

- **Long text is not auto-split** so the speaker timbre stays consistent. The composer
  shows a reminder that long single-pass audio may reduce emotion strength; use
  **Repeat delivery tags ¶** to re-assert emotion/prosody before each paragraph.
- Request timeout is 600s to allow long generations.
- Generated files are written to both `backend/storage/outputs/` and the project
  `outputs/` folder.

## Manual dev (without the runner)

```bash
# backend (uv recommended; falls back to python venv)
cd backend && uv venv .venv --python 3.12 && source .venv/bin/activate
uv pip install -r requirements.txt
uvicorn app:app --host 0.0.0.0 --port 7860

# frontend (new terminal)
cd webui && npm install && npm run dev -- --port 5173
```
