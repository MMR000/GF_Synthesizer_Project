#!/usr/bin/env bash
set -e

cd /home/mmr/PycharmProjects/tone_tts

python scripts/generate_bibo_positive_laughter_long.py

ffplay -nodisp -autoexit outputs/bibo_positive_laughter_long.wav
