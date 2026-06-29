# Emotion TTS Studio — Operations & Deployment Guide

This document is for **running and deploying the whole system on a server**. It covers
prerequisites, one-time setup, configuration, day-to-day operation, running as
background services (systemd), production hosting behind nginx, health checks, logs,
security hardening, and troubleshooting.

> This is a **local / self-hosted research tool**. It does not upload anything to
> external services. It also ships with **no authentication and permissive CORS**, so
> do **not** expose it directly to the public internet without the hardening in
> [§9 Security](#9-security-read-before-exposing).

---

## 1. What runs (architecture)

Three long-running processes:

```
┌─────────────────────┐     /api (relative)      ┌──────────────────────┐     POST /v1/audio/speech     ┌─────────────────────────┐
│  Frontend (web UI)  │ ───────────────────────► │  Backend proxy       │ ────────────────────────────► │  SGLang-Omni TTS engine │
│  Vite/React :5173   │   proxied to :7860       │  FastAPI :7860       │   localhost:9000 (or :8095)   │  GPU server  :9000      │
└─────────────────────┘                          └──────────────────────┘                               └─────────────────────────┘
                                                   saves WAV + history                                     loads higgs-audio-v3-tts-4b
```

| Process | Port | Purpose | Environment |
| --- | --- | --- | --- |
| SGLang-Omni engine | `9000` | Generates speech (the GPU/model) | `uv` venv at `/home/mmr/sglang-omni/.venv` |
| Backend proxy | `7860` | Forwards requests, saves WAVs, history, validation, segmented generation | `uv` venv at `backend/.venv` |
| Frontend | `5173` (dev) / `80` (prod via nginx) | The web studio UI | Node 20+ / built static files |

The browser only ever talks to the backend proxy via **relative `/api/...`** paths, so the
same build works behind any reverse proxy.

---

## 2. Prerequisites

**Hardware**
- NVIDIA GPU with ~24 GB VRAM (developed on an RTX 4090). The model + KV cache use most
  of 24 GB; smaller cards may not fit.
- A working NVIDIA driver (`nvidia-smi` must succeed).

**Software**
- Linux (developed on Ubuntu 24.04 / kernel 6.x).
- Python **3.12**.
- [`uv`](https://github.com/astral-sh/uv) (used to create venvs without needing
  `python3-venv`). The scripts auto-install it via pip if missing.
- Node.js **20+** and npm (developed on Node 22 / npm 10).
- `git`.
- A CUDA 13 toolkit is **not** required system-wide — the SGLang serve script borrows a
  self-consistent CUDA 13.0 toolkit bundled inside the SGLang venv for JIT kernel
  compilation (see `scripts/02b_sglang_native.sh`).

**Model files**
- `bosonai/higgs-audio-v3-tts-4b` downloaded to `/home/mmr/models/higgs-audio-v3-tts-4b`
  (must contain `config.json` and the `.safetensors` weights).

---

## 3. Directory layout

```
/home/mmr/PycharmProjects/tone_tts/
├── backend/                     FastAPI proxy
│   ├── app.py                   all backend logic + segmented generation
│   ├── requirements.txt         fastapi, uvicorn, requests, pydantic, numpy, soundfile, numba, librosa
│   ├── .venv/                   backend venv (created on first run)
│   └── storage/
│       ├── outputs/             generated WAVs (primary copy)
│       ├── history.json         generation history
│       ├── server.log           backend log
│       ├── backend.pid          written by run_emotion_web.sh
│       └── frontend.pid
├── webui/                       React + Vite + Tailwind frontend
│   ├── src/ …                   components, data, api client
│   ├── dist/                    production build output (after `npm run build`)
│   └── package.json
├── outputs/                     project-level mirror of generated WAVs (+ older clips)
├── logs/                        SGLang install/serve logs, older script logs
├── scripts/
│   ├── 02b_sglang_native.sh     install / serve the SGLang-Omni engine
│   ├── run_emotion_web.sh       start backend + frontend (dev)
│   └── stop_emotion_web.sh      stop backend + frontend
├── README_EMOTION_WEBUI.md      feature-level README
└── README_OPERATIONS.md         this file
```

---

## 4. One-time setup

### 4.1 Build the SGLang-Omni engine (slow, once)

```bash
cd /home/mmr/PycharmProjects/tone_tts
bash scripts/02b_sglang_native.sh install
```

This clones `sglang-omni` into `/home/mmr/sglang-omni` (if missing), creates its `uv`
venv, and installs it editable. Progress is logged to `logs/sglang_native_install.log`.

### 4.2 Backend + frontend dependencies

These are installed automatically the first time you run `scripts/run_emotion_web.sh`.
To pre-install manually:

```bash
# backend
cd /home/mmr/PycharmProjects/tone_tts/backend
uv venv .venv --python 3.12
source .venv/bin/activate
uv pip install -r requirements.txt
deactivate

# frontend
cd /home/mmr/PycharmProjects/tone_tts/webui
npm install
```

> `librosa` (used for the per-segment speaker pitch-lock) pulls `numba`; the
> requirements pin `numba>=0.60` so it resolves correctly on Python 3.12. The backend
> still works without librosa (clone-only fallback), but install it for best results.

---

## 5. Configuration reference

| Setting | Default | Where to change |
| --- | --- | --- |
| SGLang port | `9000` | `PORT` env for `02b_sglang_native.sh`, e.g. `PORT=9001 bash scripts/02b_sglang_native.sh serve` |
| SGLang repo dir | `/home/mmr/sglang-omni` | `REPO_DIR` env for `02b_sglang_native.sh` |
| Model path | `/home/mmr/models/higgs-audio-v3-tts-4b` | `MODEL_DIR` in `scripts/02b_sglang_native.sh` (line ~28) |
| Backend → SGLang URL | `http://localhost:9000/v1/audio/speech` | `SGLANG_URL` in `backend/app.py` |
| Backend → vLLM URL | `http://localhost:8095/v1/audio/speech` | `VLLM_URL` in `backend/app.py` |
| Backend port | `7860` | `uvicorn … --port` in `run_emotion_web.sh` / systemd unit |
| Frontend port | `5173` | `npm run dev -- --port` in `run_emotion_web.sh` |
| Request timeout | `600s` | `REQUEST_TIMEOUT` in `backend/app.py` |
| CORS origins | `*` | `allow_origins` in `backend/app.py` |
| Segmented tuning | gap/retries/F0 band | `SEG_*`, `F0_*`, `MAX_SHIFT_ST` constants in `backend/app.py` |

The frontend always calls the backend through the relative path `/api`, so you never set
a backend URL in the frontend — you only need a reverse proxy (or the Vite dev proxy) to
route `/api` to `:7860`.

### Relocating to a different directory or user

If the project will not live at `/home/mmr/PycharmProjects/tone_tts`, update these
**hardcoded paths**:

- `scripts/run_emotion_web.sh` → `PROJECT_DIR`
- `scripts/stop_emotion_web.sh` → `PID_DIR`
- `scripts/02b_sglang_native.sh` → `MODEL_DIR` (and `REPO_DIR` default if desired)
- `webui/src/components/AudioResultPanel.tsx` → `PROJECT_OUTPUTS` (only the "Copy path"
  button text; cosmetic — rebuild the frontend after changing)

The backend itself derives its own paths from `__file__`, so it is location-independent.

---

## 6. Running (quick / interactive)

Two terminals.

**Terminal 1 — engine:**
```bash
cd /home/mmr/PycharmProjects/tone_tts
bash scripts/02b_sglang_native.sh serve
# wait for: "Uvicorn running on http://0.0.0.0:9000"
```

**Terminal 2 — web UI:**
```bash
cd /home/mmr/PycharmProjects/tone_tts
bash scripts/run_emotion_web.sh
# wait for: "Open: http://localhost:5173"
```

Open `http://<server-ip>:5173`. Both services bind `0.0.0.0`, so they are reachable from
the LAN. Stop the web UI with `Ctrl+C` or `bash scripts/stop_emotion_web.sh`; stop the
engine with `Ctrl+C`.

---

## 7. Running as background services (systemd) — recommended for a server

This keeps everything alive across logouts and reboots. Adjust `User`, paths, and the
`/home/mmr` locations to your server. Create the units as root in `/etc/systemd/system/`.

### 7.1 Engine — `tts-sglang.service`

```ini
[Unit]
Description=SGLang-Omni TTS engine (Higgs v3) on :9000
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=mmr
WorkingDirectory=/home/mmr/PycharmProjects/tone_tts
# PORT/REPO_DIR can be overridden here if needed:
Environment=PORT=9000
ExecStart=/bin/bash /home/mmr/PycharmProjects/tone_tts/scripts/02b_sglang_native.sh serve
Restart=on-failure
RestartSec=10
# Model load can be slow; give it time before considering it failed:
TimeoutStartSec=600

[Install]
WantedBy=multi-user.target
```

### 7.2 Backend — `tts-backend.service`

```ini
[Unit]
Description=Emotion TTS Studio backend (FastAPI) on :7860
After=tts-sglang.service
Wants=tts-sglang.service

[Service]
Type=simple
User=mmr
WorkingDirectory=/home/mmr/PycharmProjects/tone_tts/backend
ExecStart=/home/mmr/PycharmProjects/tone_tts/backend/.venv/bin/uvicorn app:app --host 0.0.0.0 --port 7860
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

> Run §4.2 once so `backend/.venv` exists before starting this unit.

### 7.3 Enable & manage

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now tts-sglang.service tts-backend.service

# status / logs
systemctl status tts-sglang tts-backend
journalctl -u tts-sglang -f
journalctl -u tts-backend -f

# restart after a code change
sudo systemctl restart tts-backend
```

The frontend is best served as static files (next section) rather than a systemd-managed
dev server.

---

## 8. Production frontend hosting

### 8.1 Build the static site

```bash
cd /home/mmr/PycharmProjects/tone_tts/webui
npm run build      # outputs to webui/dist/
```

### 8.2 Serve with nginx (recommended)

`/etc/nginx/sites-available/emotion-tts`:

```nginx
server {
    listen 80;
    server_name _;   # or your hostname

    # Built React app
    root /home/mmr/PycharmProjects/tone_tts/webui/dist;
    index index.html;

    # SPA fallback
    location / {
        try_files $uri $uri/ /index.html;
    }

    # API + audio -> FastAPI backend
    location /api/ {
        proxy_pass http://127.0.0.1:7860;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 600s;     # long/segmented generations
        proxy_send_timeout 600s;
        client_max_body_size 50m;    # reference-audio uploads, if used
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/emotion-tts /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

Now the app is at `http://<server>/` and you no longer need port 5173. Rebuild
(`npm run build`) whenever the frontend changes.

### 8.3 Simpler alternative (no nginx)

You can keep running the Vite dev server (`scripts/run_emotion_web.sh`) — it binds
`0.0.0.0:5173` and already proxies `/api` to the backend. It works fine for internal use;
it is just not optimized like a static build behind nginx.

---

## 9. Security (read before exposing)

The defaults assume a trusted LAN. Before putting this anywhere reachable by others:

1. **No auth is built in.** Put it behind nginx with HTTP Basic auth, an SSO/oauth proxy,
   or a VPN. Example Basic auth: add to the nginx `server` (or `location /`) block:
   ```nginx
   auth_basic "Emotion TTS Studio";
   auth_basic_user_file /etc/nginx/.htpasswd;   # created with `htpasswd`
   ```
2. **CORS is `*`.** Fine when same-origin behind nginx; tighten `allow_origins` in
   `backend/app.py` if the API is called cross-origin.
3. **Bind internally.** With nginx in front, bind the backend to localhost
   (`--host 127.0.0.1`) and don't expose 7860 / 9000 to the network. Firewall those ports.
4. **TLS.** Terminate HTTPS at nginx (e.g. Let's Encrypt / certbot).
5. **Filesystem.** The backend writes WAVs under `backend/storage/outputs/` and mirrors to
   `outputs/`; ensure the service user owns those and nothing sensitive is world-readable.

---

## 10. Health checks & verification

```bash
# backend alive + whether engines are reachable
curl -s http://localhost:7860/api/health | python3 -m json.tool

# end-to-end smoke test (short clip)
curl -s -X POST http://localhost:7860/api/generate \
  -H 'Content-Type: application/json' \
  -d '{"text":"<|emotion:amusement|>Сәлем! <|sfx:laughter|>Haha","endpointMode":"sglang","includeModel":false,"filename":"healthcheck.wav"}'

# long-text segmented path
curl -s -X POST http://localhost:7860/api/generate \
  -H 'Content-Type: application/json' \
  -d '{"text":"<|emotion:enthusiasm|>Бірінші сөйлем. Екінші сөйлем! Үшінші ме?","endpointMode":"sglang","includeModel":false,"segmented":true,"cloneVoice":true,"filename":"seg_health.wav"}'
```

A healthy `/api/health` shows `"backend":"alive"` and `sglang.reachable: true` once the
engine has finished loading. In the web UI, the header pill **SGLang 9000** turns green;
click **Health check** to re-poll.

---

## 11. Logs

| Log | Path |
| --- | --- |
| Backend | `backend/storage/server.log` (and `journalctl -u tts-backend` under systemd) |
| SGLang engine | `logs/sglang_native_server.log` (and `journalctl -u tts-sglang`) |
| SGLang install | `logs/sglang_native_install.log` |
| Generation history | `backend/storage/history.json` |

Per-segment progress for segmented generations is written to `server.log`.

---

## 12. Stopping / restarting

```bash
# scripts (interactive mode)
bash scripts/stop_emotion_web.sh            # backend + frontend
pkill -f sgl-omni                           # engine

# systemd
sudo systemctl restart tts-backend
sudo systemctl restart tts-sglang
sudo systemctl stop tts-backend tts-sglang
```

The engine takes 1–3 minutes to reload the model on restart (weights + KV cache + CUDA
graph capture).

---

## 13. Updating

```bash
cd /home/mmr/PycharmProjects/tone_tts
git pull                       # if version-controlled

# backend deps changed?
backend/.venv/bin/python -m pip --version   # sanity
( cd backend && source .venv/bin/activate && uv pip install -r requirements.txt )
sudo systemctl restart tts-backend

# frontend changed?
( cd webui && npm install && npm run build )   # nginx serves the new dist automatically

# engine (sglang-omni) update
( cd /home/mmr/sglang-omni && git pull && source .venv/bin/activate && uv pip install -e . )
sudo systemctl restart tts-sglang
```

---

## 14. Performance & capacity notes

- **One GPU = effectively one generation at a time.** The engine serializes work; many
  concurrent users will queue. For a shared server, expect short clips in ~1–8 s and long
  **segmented** passages to take tens of seconds (it issues one request per sentence, with
  retries).
- **Segmented mode** is the reliable path for long text (single-pass long generations tend
  to drift into silence). It clones the voice from the first segment and pitch-locks the
  rest to keep one consistent speaker.
- Keep the 600 s timeouts (backend `REQUEST_TIMEOUT` and the nginx `proxy_*_timeout`) so
  long jobs don't get cut off.
- Generated files accumulate in `backend/storage/outputs/` and `outputs/`. Prune
  periodically; deleting a history item via the UI/API also removes its file.

---

## 15. Troubleshooting

| Symptom | Likely cause / fix |
| --- | --- |
| Web UI loads but generation fails with "connection error" | Engine not up. Check `systemctl status tts-sglang` / `logs/sglang_native_server.log`; wait for model load; `/api/health` should show `sglang.reachable: true`. |
| `port 9000 -> 000` for a while after starting | Normal — model loading + CUDA graph capture take 1–3 min. |
| SGLang fails with `nvcc` / template / CUDA errors | The serve script must switch JIT to the bundled CUDA 13 toolkit; ensure you start it via `scripts/02b_sglang_native.sh serve` (not by calling `sgl-omni` directly). |
| Backend won't start: `ModuleNotFoundError: soundfile/librosa` | Run §4.2; ensure `backend/.venv` has `requirements.txt` installed (incl. `numba>=0.60`). |
| `python3 -m venv` fails (ensurepip missing) | Use `uv` (the scripts already do). `uv venv .venv --python 3.12`. |
| Long text "failed" in single-pass | Enable **Segmented generation** in the Generation panel (or `"segmented": true` via API). |
| Voice changes gender between segments | Keep "Keep one consistent voice" on (clone + pitch-lock); ensure `librosa` is installed for the F0 lock. |
| Frontend can't reach `/api` behind nginx | Confirm the `location /api/ { proxy_pass http://127.0.0.1:7860; }` block and that the backend is listening on 7860. |
| Port already in use (9000/7860/5173) | Change the relevant port (see §5) or free it: `fuser -k 9000/tcp`. |

---

## 16. API quick reference

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Backend + engine reachability |
| POST | `/api/generate` | Generate (set `"segmented": true` for long text) + save WAV |
| GET | `/api/audio/{filename}` | Serve a generated WAV |
| GET | `/api/history` | List generation history |
| DELETE | `/api/history/{id}` | Delete a history item (and its file) |
| POST | `/api/validate` | Validation warnings for tagged text |
| GET | `/api/tags` | Tag library |
| GET | `/api/templates` | Built-in templates |

`/api/generate` body fields: `text`, `endpointMode` (`auto`|`vllm`|`sglang`|`custom`),
`customUrl`, `includeModel`, `autoRetry`, `temperature`, `top_k`, `max_new_tokens`,
`filename`, `segmented`, `cloneVoice`.
