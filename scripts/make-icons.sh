#!/usr/bin/env bash
# Generates extension icons: dark square, teal border, letter "A" (Geist Bold).
# Requires ffmpeg. Font path is machine-specific; override via FONT env var.
set -e
cd "$(dirname "$0")/.."
FONT="${FONT:-C\:/MONTAGE/fonts/Geist-Bold.ttf}"
mkdir -p icons
ffmpeg -y -loglevel error -f lavfi -i "color=c=0x0B0F0E:s=128x128" \
  -vf "drawbox=x=6:y=6:w=116:h=116:color=0x3CE5B0:t=7,drawtext=fontfile='$FONT':text=A:fontcolor=0x3CE5B0:fontsize=76:x=(w-text_w)/2:y=(h-text_h)/2-4" \
  -frames:v 1 icons/icon128.png
for s in 48 32 16; do
  ffmpeg -y -loglevel error -i icons/icon128.png -vf "scale=$s:$s" icons/icon$s.png
done
echo "icons written"
