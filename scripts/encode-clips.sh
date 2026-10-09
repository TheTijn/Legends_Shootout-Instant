#!/usr/bin/env bash
# Builds public/assets/clips/<Shooter>.mp4 (+ .jpg poster) from the commentary
# sources listed in scripts/clips.txt (LegendShootout_MP4/).
# Each clip runs from 0s, so the call starts on its first word, to its cut
# point: just before the deke/release, in the silent gap before the
# commentator calls the shot. The drawn outcome is stamped over the frozen
# last frame instead. Video stays at the native 640x360; the audio is
# normalised to -18 LUFS and faded out over the last 60ms.
#
# Usage: npm run clips [-- <slug> ...]   (no slugs = every clip). Requires ffmpeg.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=${OUT:-public/assets/clips}
LUFS=-18
FADE=0.06
ONLY=" $* "
mkdir -p "$OUT"
grep -v '^#' scripts/clips.txt | while IFS='|' read -r file slug goalie cut; do
  [ -z "$file" ] && continue
  [ "$ONLY" != "  " ] && [[ "$ONLY" != *" $slug "* ]] && continue
  gain=$(ffmpeg -nostats -t "$cut" -i "$file" -vn -af ebur128 -f null - 2>&1 | awk -v t=$LUFS '/^ +I:/{i=$2} END{printf "%.1f", t-i}')
  fade=$(awk "BEGIN{print $cut-$FADE}")
  ffmpeg -v error -y -i "$file" -t "$cut" \
    -vf "scale=640:360:flags=lanczos,format=yuv420p" \
    -c:v libx264 -profile:v high -preset slow -crf 23 -maxrate 2M -bufsize 4M -g 30 \
    -af "volume=${gain}dB,afade=t=out:st=$fade:d=$FADE" -c:a aac -b:a 96k \
    -movflags +faststart "$OUT/$slug.mp4" < /dev/null
  ffmpeg -v error -y -i "$file" -frames:v 1 -vf "scale=640:360" -q:v 5 "$OUT/$slug.jpg" < /dev/null
  echo "$slug  ${cut}s  ${gain}dB  $(du -k "$OUT/$slug.mp4" | cut -f1)KB"
done
