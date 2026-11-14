#!/usr/bin/env bash
set -euo pipefail
DEMO="$(cd "$(dirname "$0")" && pwd)"
cd "$DEMO"
T="$1"; TC="$2"
uv run --no-project --quiet --with numpy==2.5.4 python -I music.py "$T" "$TC" music-raw.wav
STATS=$(bin/ffmpeg -hide_banner -nostats -i music-raw.wav -af ebur128=peak=true -f null - 2>&1 | tail -14)
I=$(echo "$STATS" | awk '/^ +I:/{print $2}')
TP=$(echo "$STATS" | awk '/Peak:/{print $2}')
GAIN=$(awk -v i="$I" -v tp="$TP" 'BEGIN{g=-17-i; if (tp+g > -1.5) g=-1.5-tp; printf "%.2f", g}')
echo "raw I=$I LUFS TP=$TP dBFS -> gain ${GAIN} dB"
FADE_OUT=$(awk -v t="$T" 'BEGIN{printf "%.3f", t-2}')
bin/ffmpeg -hide_banner -loglevel error -y -i music-raw.wav -af "volume=${GAIN}dB,afade=t=in:d=1.5,afade=t=out:st=${FADE_OUT}:d=2" -c:a pcm_s16le video/public/music.wav
bin/ffmpeg -hide_banner -nostats -i video/public/music.wav -af ebur128=peak=true -f null - 2>&1 | awk '/^ +I:|Peak:/'
