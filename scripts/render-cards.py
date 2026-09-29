#!/usr/bin/env python3
"""Render PNG title/outro cards for the README demo.

Brew's ffmpeg ships without libfreetype/drawtext, so we generate the
intro and outro cards as static PNGs (1280x720, plugin-themed dark
background) via PIL, then ffmpeg wraps them as silent video clips
during assembly.

Output:
    test-results/demo/build/intro.png
    test-results/demo/build/outro.png
"""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
# Output dir overridable via $CARDS_OUT_DIR so build-demo.sh can drop
# the PNGs into its per-language work directory.
OUT_DIR = Path(
    sys.argv[1]
    if len(sys.argv) > 1
    else (ROOT / "test-results" / "demo" / "build")
)
OUT_DIR.mkdir(parents=True, exist_ok=True)

W, H = 1280, 720
BG = (14, 14, 18)
WHITE = (255, 255, 255)
MUTED = (180, 180, 198)
DIM = (108, 108, 117)

FONT_CANDIDATES = [
    "/System/Library/Fonts/HelveticaNeue.ttc",
    "/System/Library/Fonts/Helvetica.ttc",
    "/Library/Fonts/Arial.ttf",
]


def load_font(size: int, weight: str = "regular") -> ImageFont.FreeTypeFont:
    for path in FONT_CANDIDATES:
        if not Path(path).exists():
            continue
        try:
            if path.endswith(".ttc"):
                idx = 2 if weight == "bold" else 0
                return ImageFont.truetype(path, size, index=idx)
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default()


def draw_centered(
    draw: ImageDraw.ImageDraw,
    text: str,
    font: ImageFont.FreeTypeFont,
    y: int,
    color: tuple[int, int, int],
) -> None:
    bbox = draw.textbbox((0, 0), text, font=font)
    text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]
    x = (W - text_w) // 2
    draw.text((x, y - text_h // 2), text, font=font, fill=color)


def render_intro() -> Path:
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)

    title = load_font(112, weight="bold")
    subtitle = load_font(34)

    draw_centered(d, "Snipsy", title, H // 2 - 50, WHITE)
    draw_centered(d, "Hotstring expansion for Obsidian", subtitle, H // 2 + 60, MUTED)

    path = OUT_DIR / "intro.png"
    img.save(path, "PNG")
    return path


def render_outro() -> Path:
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)

    title = load_font(86, weight="bold")
    line = load_font(32)
    url = load_font(22)

    draw_centered(d, "Snipsy", title, H // 2 - 100, WHITE)
    draw_centered(d, "Find it in Community plugins", line, H // 2 + 10, MUTED)
    draw_centered(d, "github.com/Dimagious/snipsidian", url, H // 2 + 80, DIM)

    path = OUT_DIR / "outro.png"
    img.save(path, "PNG")
    return path


def main() -> int:
    intro = render_intro()
    outro = render_outro()
    print(f"OK intro: {intro}")
    print(f"OK outro: {outro}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
