#!/usr/bin/env bash
# Fetch glyph PBFs so map labels need no third-party font server.
# style.ts's peaks layer asks for "Open Sans Regular"; that fontstack directory
# name must match exactly.
set -euo pipefail
cd "$(dirname "$0")"

DEST=../../app/static/fonts
STACK="Open Sans Regular"
mkdir -p downloads "$DEST"

if [ ! -f downloads/fonts.zip ]; then
  echo "Downloading the openmaptiles font set (once)..."
  # NOTE: the brief's URL (.../v2.0/fonts.zip) 404s — the release asset under
  # v2.0 is actually named "v2.0.zip", not "fonts.zip".
  curl -L --fail -o downloads/fonts.zip \
    https://github.com/openmaptiles/fonts/releases/download/v2.0/v2.0.zip
fi

rm -rf downloads/fonts-extracted
mkdir -p downloads/fonts-extracted
unzip -q downloads/fonts.zip -d downloads/fonts-extracted

if [ ! -d "downloads/fonts-extracted/$STACK" ]; then
  echo "Fontstack '$STACK' not found in the archive. Available:" >&2
  ls downloads/fonts-extracted >&2
  exit 1
fi

rm -rf "$DEST/$STACK"
cp -r "downloads/fonts-extracted/$STACK" "$DEST/$STACK"
echo "fonts installed: $(ls "$DEST/$STACK" | wc -l) range files"
du -sh "$DEST"
