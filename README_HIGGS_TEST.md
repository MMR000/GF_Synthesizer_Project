# Higgs Audio v3 TTS — local expressive-speech test

Minimal, reproducible test to check whether **Higgs Audio v3 TTS (4B)** changes
emotion / prosody / style from inline control tags, producing `.wav` files you can
compare by ear.

- **Model (local, never copied):** `/home/mmr/models/higgs-audio-v3-tts-4b`
- **Conda env:** `higgs_tts`
- **GPU:** NVIDIA RTX 4090 (24 GB)
- Control-tag reference: see `PROMPTING.md` / `AGENTS.md` inside the model directory.

> Tag format is always `<|category:tag|>`. Emotion/style/prosody-speed/pitch are
> **sentence-level** (put at the start); `sfx` and `pause`/`long_pause` are **inline**.
> `sfx` gotcha: `<|sfx:laughter|>Haha,...` — tag first, onomatopoeia attached, no space.

## Project layout

```
tone_tts/
├── scripts/
│   ├── 00_check_env.sh        # environment diagnostics -> logs/env_check.log
│   ├── 01_try_vllm_omni.sh    # start server via vLLM-Omni -> logs/vllm_omni_server.log
│   ├── 02_try_sglang_docker.sh# fallback: SGLang-Omni in Docker -> logs/sglang_docker.log
│   ├── 03_test_emotion_curl.sh# generate the WAV test matrix -> logs/curl_tests.log
│   └── 04_play_outputs.sh     # play every outputs/*.wav
├── outputs/                   # generated .wav files
├── logs/                      # all logs
└── README_HIGGS_TEST.md
```

## 0) Check the environment

```bash
bash scripts/00_check_env.sh
```

Confirms: python/pip, installed packages, whether `vllm` is importable, CUDA/VRAM,
the model directory, `config.json`, and `.safetensors`.

## Known root cause of `ModuleNotFoundError: No module named 'vllm'`

`vllm-omni` is installed in `higgs_tts`, but at import time it does
`from vllm.model_executor... import ...`. The **`vllm` package itself was not installed**
in that env (it isn't even listed as a dependency of `vllm-omni`). Fix:

```bash
conda activate higgs_tts
pip install vllm==0.22.1     # matches vllm-omni 0.22.0
```

`scripts/01_try_vllm_omni.sh` does this automatically (set `AUTO_INSTALL_VLLM=0` to skip).
Also note there is **no plain `vllm` binary** in this env — only `vllm-omni`.

## 1) Start the server with vLLM-Omni (primary path)

```bash
bash scripts/01_try_vllm_omni.sh
```

Serves on port **8095**. VRAM is tight on a 24 GB card that is also driving the
desktop, so the script defaults to `GPU_MEM_UTIL=0.55` and `MAX_MODEL_LEN=4096`.
Override if needed:

```bash
GPU_MEM_UTIL=0.5 MAX_MODEL_LEN=2048 bash scripts/01_try_vllm_omni.sh
```

If it OOMs at load, close GPU-heavy apps (browser, IDE) to free VRAM and retry.

### Test vLLM-Omni

```bash
bash scripts/03_test_emotion_curl.sh http://localhost:8095
```

## 2) Fallback: SGLang-Omni in Docker (model-card recommended)

Requires Docker + the NVIDIA Container Toolkit (not installed yet on this host —
the script prints install guidance if `docker` is missing).

```bash
bash scripts/02_try_sglang_docker.sh
```

This mounts `/home/mmr/models` read-only at `/models` in the container and drops you
into a shell. Inside the container:

```bash
cd /workspace/tone_tts
git clone https://github.com/sgl-project/sglang-omni.git /workspace/sglang-omni || true
cd /workspace/sglang-omni
uv venv .venv -p 3.12
source .venv/bin/activate
uv pip install -v -e .
sgl-omni serve --model-path /models/higgs-audio-v3-tts-4b --port 9000
```

SGLang serves at **port 9000**, so the curl test targets
`http://localhost:9000/v1/audio/speech`.

### Test SGLang-Omni

```bash
bash scripts/03_test_emotion_curl.sh http://localhost:9000
```

## 3) Listen and compare

```bash
bash scripts/04_play_outputs.sh
```

Generated files (compare these by ear):

| File | Language | What it tests |
|------|----------|----------------|
| `00_kazakh_neutral.wav`     | Kazakh  | neutral baseline |
| `01_kazakh_enthusiasm.wav`  | Kazakh  | enthusiasm + expressive_high + pause |
| `02_kazakh_sadness.wav`     | Kazakh  | sadness + speed_slow + pitch_low + long_pause |
| `03_kazakh_anger.wav`       | Kazakh  | anger + expressive_high + pitch_high |
| `04_kazakh_laughter.wav`    | Kazakh  | amusement + inline laughter sfx |
| `05_kazakh_whispering.wav`  | Kazakh  | whispering style + contemplation |
| `06_russian_enthusiasm.wav` | Russian | enthusiasm (cross-language check) |
| `07_english_laughter.wav`   | English | amusement + inline laughter sfx |

Compare: neutral vs enthusiasm, sadness vs anger, laughter, whispering, and
Kazakh vs Russian vs English.

## Notes

- The model license is **research / non-commercial** only (see `LICENSE` in the model dir).
- Your Hugging Face token is never printed or required (the model is already local).
- Every step writes a log under `logs/` for debugging.
