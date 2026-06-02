#!/usr/bin/env bash
# Interactive window screenshot → public/media/docs/
# Usage: ./tools/docs/capture-screenshot.sh [output-name.webp]
# macOS: click the browser window when prompted.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUT_DIR="$SCRIPT_DIR/../../public/media/docs"
OUT_NAME="${1:-docs-capture.webp}"
RAW="$(mktemp /tmp/doc-capture-XXXXXX.png)"

mkdir -p "$OUT_DIR"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Interactive capture is documented for macOS (screencapture -w)."
  echo "Save your screenshot manually to: $OUT_DIR/$OUT_NAME"
  exit 1
fi

echo "Click the window to capture (Esc to cancel)…"
screencapture -w "$RAW"

DEST="$OUT_DIR/$OUT_NAME"
if [[ "$OUT_NAME" == *.webp ]] && command -v cwebp >/dev/null 2>&1; then
  cwebp -q 85 "$RAW" -o "$DEST"
elif [[ "$OUT_NAME" == *.webp ]]; then
  if sips -s format webp "$RAW" --out "$DEST" >/dev/null 2>&1; then
    :
  else
    cp "$RAW" "${OUT_DIR}/${OUT_NAME%.webp}.png"
    DEST="${OUT_DIR}/${OUT_NAME%.webp}.png"
  fi
else
  cp "$RAW" "$DEST"
fi

rm -f "$RAW"
REL="media/docs/$(basename "$DEST")"
echo "Saved public/$REL"
echo "Use in JSON: \"path\": \"$REL\""
