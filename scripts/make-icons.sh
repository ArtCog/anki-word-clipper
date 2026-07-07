#!/usr/bin/env bash
# Generates extension icons: teal rounded square with a dark "A" (Geist Bold).
# Requires ffmpeg. Font path is machine-specific; override via FONT env var.
set -e
cd "$(dirname "$0")/.."
FONT="${FONT:-C\:/MONTAGE/fonts/Geist-Bold.ttf}"
mkdir -p icons
# rounded-rect alpha mask via signed-distance expression (corner radius 26/128)
ROUND="geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(gt(hypot(max(abs(X-63.5)-37.5,0),max(abs(Y-63.5)-37.5,0)),26),0,255)'"
ffmpeg -y -loglevel error -f lavfi -i "color=c=0x3CE5B0:s=128x128" \
  -vf "drawtext=fontfile='$FONT':text=A:fontcolor=0x0B0F0E:fontsize=86:x=(w-text_w)/2:y=(h-text_h)/2-6,format=rgba,$ROUND" \
  -frames:v 1 icons/icon128.png
for s in 48 32 16; do
  ffmpeg -y -loglevel error -i icons/icon128.png -vf "scale=$s:$s" icons/icon$s.png
done
echo "icons written"
