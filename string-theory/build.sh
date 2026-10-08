#!/usr/bin/env bash
# Full build: score -> parallel frame render -> H.264 master with audio.
#   ./build.sh            (env: JOBS=4 SAMPLES=4)
set -euo pipefail
cd "$(dirname "$0")"
JOBS=${JOBS:-$(nproc)}
SAMPLES=${SAMPLES:-4}
FRAMES=900
mkdir -p out/seg

python3 audio/synth.py out/score.wav

step=$(( (FRAMES + JOBS - 1) / JOBS ))
pids=()
: > out/seg/list.txt
for ((j = 0; j < JOBS; j++)); do
  from=$(( j * step )); to=$(( from + step )); (( to > FRAMES )) && to=$FRAMES
  node render.mjs --from $from --to $to --samples "$SAMPLES" --out "out/seg/part$j.mkv" > "out/seg/part$j.log" 2>&1 &
  pids+=($!)
  echo "file 'part$j.mkv'" >> out/seg/list.txt
done
for p in "${pids[@]}"; do wait "$p"; done

ffmpeg -y -loglevel error -f concat -safe 0 -i out/seg/list.txt -i out/score.wav \
  -map 0:v -map 1:a -c:v libx264 -preset slow -crf 18 -profile:v high -pix_fmt yuv420p \
  -colorspace bt709 -color_primaries bt709 -color_trc bt709 \
  -c:a aac -b:a 256k -movflags +faststart -shortest string-theory.mp4
ffmpeg -y -loglevel error -i out/score.wav -c:a aac -b:a 160k audio/score.m4a
ffmpeg -y -loglevel error -i string-theory.mp4 -ss 14.3 -frames:v 1 poster.jpg
echo "built string-theory.mp4"
