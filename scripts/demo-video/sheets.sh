#!/usr/bin/env bash
set -euo pipefail
DEMO="$(cd "$(dirname "$0")" && pwd)"
V="$1"; P="$2"; shift 2
mkdir -p "$DEMO/stills"
i=0
for t in "$@"; do
	"$DEMO/bin/ffmpeg" -hide_banner -loglevel error -y -ss "$t" -i "$V" -frames:v 1 -vf "scale=960:-1,drawtext=text='$t s':x=12:y=12:fontsize=28:fontcolor=white:box=1:boxcolor=black@0.6" "$DEMO/stills/$P-$(printf %02d $i).png" 2>/dev/null || \
	"$DEMO/bin/ffmpeg" -hide_banner -loglevel error -y -ss "$t" -i "$V" -frames:v 1 -vf "scale=960:-1" "$DEMO/stills/$P-$(printf %02d $i).png"
	i=$((i+1))
done
n=0
for start in $(seq 0 6 $((i-1))); do
	inputs=(); for j in $(seq $start $((start+5))); do f="$DEMO/stills/$P-$(printf %02d $j).png"; [ -f "$f" ] && inputs+=(-i "$f"); done
	k=$(( ${#inputs[@]} / 2 ))
	while [ $k -lt 6 ]; do inputs+=(-f lavfi -i "color=c=black:s=960x540:d=1"); k=$((k+1)); done
	"$DEMO/bin/ffmpeg" -hide_banner -loglevel error -y "${inputs[@]}" -filter_complex "[0][1][2]hstack=3[a];[3][4][5]hstack=3[b];[a][b]vstack" -frames:v 1 "$DEMO/stills/$P-sheet$n.png"
	n=$((n+1))
done
ls "$DEMO"/stills/$P-sheet*.png
