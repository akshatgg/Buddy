#!/usr/bin/env bash
# The website's images, made from the app's own art: the buddies' previews and the app icon.
# Run from the repository root after the buddies or the icon change. Needs sips (macOS) and cwebp (brew install webp).
# With --og it also renders the link preview, web/public/og.png, from tools/og-card.html with Google Chrome.
set -euo pipefail

out=web/public
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$out/img"

webp() { # webp <source png> <long edge> <destination>
  sips -Z "$2" "$1" --out "$tmp/x.png" >/dev/null
  cwebp -quiet -q 82 -alpha_q 90 "$tmp/x.png" -o "$3"
}

webp assets/buddies/previews/boy-1.png 720 "$out/img/aarav.webp"
webp assets/buddies/previews/girl-1.png 720 "$out/img/anaya.webp"
webp build/icon.png 256 "$out/img/icon.webp"

sips -Z 32 build/icon.png --out "$out/favicon-32.png" >/dev/null
sips -Z 180 build/icon.png --out "$out/apple-touch-icon.png" >/dev/null
sips -Z 192 build/icon.png --out "$out/icon-192.png" >/dev/null
sips -Z 512 build/icon.png --out "$out/icon-512.png" >/dev/null

if [ "${1:-}" = "--og" ]; then
  chrome="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  "$chrome" --headless=new --disable-gpu --hide-scrollbars --allow-file-access-from-files \
    --user-data-dir="$tmp/chrome" --window-size=1200,630 --virtual-time-budget=4000 \
    --screenshot="$out/og.png" "file://$PWD/tools/og-card.html" 2>/dev/null
fi

ls -l "$out/img" "$out"/*.png
