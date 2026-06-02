#!/usr/bin/env bash
# Convert PNG/JPEG under public/ to WebP (in place beside source or explicit output).
# Usage: ./tools/docs/optimize-image.sh public/media/docs/shot.png
#        ./tools/docs/optimize-image.sh public/media/docs/shot.png public/media/docs/shot.webp

set -euo pipefail

SRC="${1:?Usage: optimize-image.sh <input.png> [output.webp]}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
IN="$ROOT/$SRC"
OUT="${2:-${SRC%.*}.webp}"
OUT_PATH="$ROOT/$OUT"

if [[ ! -f "$IN" ]]; then
  echo "Not found: $IN" >&2
  exit 1
fi

mkdir -p "$(dirname "$OUT_PATH")"

if command -v cwebp >/dev/null 2>&1; then
  cwebp -q 85 "$IN" -o "$OUT_PATH"
elif [[ "$(uname -s)" == "Darwin" ]]; then
  sips -s format webp "$IN" --out "$OUT_PATH"
else
  echo "Install cwebp or use sips on macOS" >&2
  exit 1
fi

echo "Wrote $OUT"
