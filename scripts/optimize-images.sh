#!/usr/bin/env bash
# Regenerates public/assets/players/{series01,flipped}/<Slug>.webp (200px tall)
# and <Slug>@2x.webp (400px tall) from the source art folders, and the trading
# cards shown on the outcome card, public/assets/players/cards/<Slug>.webp
# (480px tall) and @2x (960px tall), from PLAYERS_CARDS/ ("First Last.jpg").
# Requires ImageMagick (magick) and cwebp.
set -euo pipefail
cd "$(dirname "$0")/.."

OUT=public/assets/players
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

slug() {
  local s="$1"
  s="${s%.png}"; s="${s%_Series_01}"; s="${s%_Flipped}"
  case "$s" in
    Luc_Robataille) s=Luc_Robitaille ;;
    Jean_Sebastian_Giguerre) s=Jean-Sebastien_Giguere ;;
  esac
  echo "$s"
}

process() {
  local src_dir="$1" set="$2"
  mkdir -p "$OUT/$set"
  for f in "$src_dir"/*.png; do
    local name; name=$(slug "$(basename "$f")")
    # Trim transparent padding once at 800px tall, then derive both sizes
    magick "$f" -resize x1200 -trim +repage -resize x800 "$TMP/$name.png"
    for spec in "200:" "400:@2x"; do
      local h="${spec%%:*}" suffix="${spec#*:}"
      magick "$TMP/$name.png" -filter Lanczos -resize "x$h" -strip "$TMP/$name-$h.png"
      cwebp -quiet -q 82 -alpha_q 90 -m 6 -sharp_yuv "$TMP/$name-$h.png" -o "$OUT/$set/$name$suffix.webp"
    done
    echo "$set/$name"
  done
}

# Trading cards: opaque JPEG sources, the file name is the player's name
cards() {
  mkdir -p "$OUT/cards"
  for f in PLAYERS_CARDS/*.jpg; do
    local name; name=$(basename "$f" .jpg)
    [ "$name" = CARDS ] && continue   # the contact sheet of all cards
    name=${name// /_}
    for spec in "480:" "960:@2x"; do
      local h="${spec%%:*}" suffix="${spec#*:}"
      magick "$f" -filter Lanczos -resize "x$h" -strip "$TMP/$name-card-$h.png"
      cwebp -quiet -q 80 -m 6 -sharp_yuv "$TMP/$name-card-$h.png" -o "$OUT/cards/$name$suffix.webp"
    done
    echo "cards/$name"
  done
}

# `optimize-images.sh cards` rebuilds the cards only
[ "${1:-}" = cards ] || { process Players_Series_01 series01; process Players_Series_01_Flipped flipped; }
cards
