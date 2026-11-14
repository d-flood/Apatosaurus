#!/usr/bin/env bash
set -euo pipefail
DEMO="$(cd "$(dirname "$0")" && pwd)"
OUT="$(realpath -m "$1")"
cd "$DEMO/video"
FRAMES=$(../node_modules/.bin/remotion compositions src/index.ts --public-dir "$PWD/public" 2>/dev/null | awk '$1 == "Demo" { print $4 }')
T=$(awk -v f="$FRAMES" 'BEGIN { printf "%.3f", f / 30 }')
TC=$(awk -v t="$T" 'BEGIN { printf "%.3f", t - 5.5 }')
"$DEMO/make-music.sh" "$T" "$TC"
../node_modules/.bin/remotion render src/index.ts Demo "$OUT" --public-dir "$PWD/public" --codec h264 --crf 18
