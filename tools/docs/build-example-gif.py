#!/usr/bin/env python3
"""Build a tiny example UI-loop GIF for documentation (no AI — programmatic frames)."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "public/media/docs/example-ui-loop.gif"
W, H = 480, 270
FRAMES = 8
DURATION_MS = 120


def load_font(size: int):
    for name in ("Helvetica.ttc", "Arial.ttf", "DejaVuSans.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def draw_frame(index: int) -> Image.Image:
    img = Image.new("RGB", (W, H), "#edf8fb")
    draw = ImageDraw.Draw(img)
    title = load_font(22)
    small = load_font(13)
    mono = load_font(12)

    draw.rounded_rectangle((24, 24, W - 24, H - 24), radius=18, fill="#ffffff", outline="#94cfd9", width=2)
    draw.text((40, 40), "Docs hub · example loop", fill="#075b78", font=title)
    draw.text((40, 72), "Programmatic GIF — safe for LLM-authored docs", fill="#5a8a96", font=small)

    pulse = abs((index % FRAMES) - FRAMES / 2) / (FRAMES / 2)
    bar_w = int(120 + 180 * (1 - pulse))
    draw.rounded_rectangle((40, 110, 40 + bar_w, 138), radius=8, fill="#37a7db")
    draw.text((40, 152), "Frame {0}/{1} · highlight animates".format(index + 1, FRAMES), fill="#075b78", font=mono)

    cx = 40 + bar_w - 8
    draw.ellipse((cx - 10, 118, cx + 10, 138), fill="#075b78")
    draw.text((40, H - 52), "public/media/docs/example-ui-loop.gif", fill="#5a8a96", font=mono)
    return img


def main() -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    frames = [draw_frame(i) for i in range(FRAMES)]
    frames[0].save(
        OUT,
        save_all=True,
        append_images=frames[1:],
        duration=DURATION_MS,
        loop=0,
        optimize=True,
    )
    print(f"Wrote {OUT} ({len(frames)} frames)")


if __name__ == "__main__":
    main()
