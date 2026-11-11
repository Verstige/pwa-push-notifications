#!/usr/bin/env bash
# Generate PWA + apple-touch icons from a single source SVG using macOS `sips`.
# Usage: bash scripts/gen-pwa-icons.sh public/icons/icon-source.svg
# Output: public/icons/icon-192.png, icon-512.png, apple-touch.png

set -euo pipefail

SRC="${1:-public/icons/icon-source.svg}"
OUT_DIR="$(dirname "$SRC")"

if [[ ! -f "$SRC" ]]; then
  echo "Source SVG not found: $SRC"
  exit 1
fi

mkdir -p "$OUT_DIR"

# Standard PWA + manifest icons
sips -s format png -z 192 192 "$SRC" --out "$OUT_DIR/icon-192.png"
sips -s format png -z 512 512 "$SRC" --out "$OUT_DIR/icon-512.png"

# iOS home-screen icon
sips -s format png -z 180 180 "$SRC" --out "$OUT_DIR/apple-touch.png"

# Verify
echo "Generated icons:"
file "$OUT_DIR/icon-192.png" "$OUT_DIR/icon-512.png" "$OUT_DIR/apple-touch.png"