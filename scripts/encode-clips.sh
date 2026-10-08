#!/usr/bin/env bash
# Builds public/assets/clips/<Shooter>.mp4 (+ .jpg poster) from "Video clips/".
# Each source holds one attempt (repeated); we keep LEAD seconds up to the cut
# point listed in scripts/clips.txt so the footage never shows the puck
# crossing the line — the drawn outcome is revealed by the net cam instead.
# Requires ffmpeg.
set -euo pipefail
cd "$(dirname "$0")/.."
SRC="Video clips"
OUT=public/assets/clips
LEAD=${LEAD:-4.3}
mkdir -p "$OUT"
grep -v '^#' scripts/clips.txt | while IFS='|' read -r file slug goalie cut; do
  [ -z "$file" ] && continue
  start=$(awk "BEGIN{s=$cut-$LEAD; print (s<0?0:s)}")
  dur=$(awk "BEGIN{print $cut-$start}")
  ffmpeg -v error -y -ss "$start" -i "$SRC/$file" -t "$dur" -an \
    -vf "scale=960:540:flags=lanczos,format=yuv420p" \
    -c:v libx264 -profile:v high -preset slow -crf 25 -maxrate 2M -bufsize 4M \
    -g 30 -movflags +faststart "$OUT/$slug.mp4" < /dev/null
  ffmpeg -v error -y -ss "$start" -i "$SRC/$file" -frames:v 1 -vf "scale=960:540" -q:v 5 "$OUT/$slug.jpg" < /dev/null
  echo "$slug  ${dur}s  $(du -k "$OUT/$slug.mp4" | cut -f1)KB"
done
