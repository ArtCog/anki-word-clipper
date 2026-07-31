#!/usr/bin/env bash
# Builds dist/anki-word-clipper.zip for the release.
# manifest.json is Chrome-only (no Firefox keys = no warnings in chrome://extensions).
# The Firefox variant is generated here from it, so the two can never drift apart.
set -e
cd "$(dirname "$0")/.."

# staging lives inside the project: mktemp gives Git Bash paths that node
# on Windows resolves to C:\tmp\... and cannot find
STAGE="dist/.stage"
DEST="$STAGE/anki-word-clipper"
rm -r "$STAGE" 2>/dev/null || true
mkdir -p "$DEST"

cp manifest.json background.js content.js context-extract.js anki-client.js translator.js \
   popup.html popup.js welcome.html README.md README.ru.md LICENSE "$DEST/"
cp -r icons bridge "$DEST/"
rm -f "$DEST/bridge/"*.log

# Firefox MV3 uses event pages, not service workers, and needs an add-on id
node -e "
const fs=require('fs');
const m=JSON.parse(fs.readFileSync('$DEST/manifest.json','utf8'));
m.background={scripts:['anki-client.js','translator.js','background.js']};
m.browser_specific_settings={gecko:{id:'anki-word-clipper@arturx.art',strict_min_version:'115.0'}};
fs.writeFileSync('$DEST/manifest.firefox.json', JSON.stringify(m,null,2)+'\n');
"

rm -f dist/anki-word-clipper.zip
"/c/Windows/System32/tar.exe" -a -cf "$(pwd)/dist/anki-word-clipper.zip" -C "$STAGE" anki-word-clipper
rm -r "$STAGE"
echo "dist/anki-word-clipper.zip собран (версия $(node -p "require('./manifest.json').version"))"
