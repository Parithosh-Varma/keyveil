#!/usr/bin/env python3
"""Regenerate every KeyVeil brand asset from brand/logo-source.png.

The source is a near-black mark on transparency. Outputs:
  brand/logo-mark-black.png    trimmed mark, as-is (1024px)
  brand/logo-mark-paper.png    mark recolored to paper #F3F3EE
  brand/logo-mark-accent.png   mark recolored to vermilion #F55036
  brand/app-icon.png           1024px ink rounded-square + paper mark
  brand/og-image.png           1200x630 paper card with centered app icon
  <app>/public/favicon.ico     16/32/48 multi-size (from app icon)
  <app>/public/icon-192.png, icon-512.png, apple-touch-icon.png (180)
  <app>/public/site.webmanifest
Usage: python3 brand/build-assets.py   (run from repo root)
Requires: Pillow
"""
from __future__ import annotations

import sys
from pathlib import Path

try:
    from PIL import Image, ImageDraw
except ImportError:
    sys.exit("Pillow required: pip install Pillow")

ROOT = Path(__file__).resolve().parent.parent
BRAND = ROOT / "brand"
INK = (12, 10, 9, 255)
PAPER = (243, 243, 238, 255)
ACCENT = (245, 80, 54, 255)


def load_mark() -> Image.Image:
    im = Image.open(BRAND / "logo-source.png").convert("RGBA")
    bbox = im.getbbox() or (0, 0, *im.size)
    # pad 4% for optical breathing room
    pad = int(max(im.size) * 0.04)
    l, u, r, b = bbox
    l, u = max(0, l - pad), max(0, u - pad)
    r, b = min(im.width, r + pad), min(im.height, b + pad)
    return im.crop((l, u, r, b))


def recolor(mark: Image.Image, rgb: tuple[int, int, int]) -> Image.Image:
    """Keep alpha, flood RGB (source is near-black so a flood is exact)."""
    out = Image.new("RGBA", mark.size, rgb + (0,))
    out.putalpha(mark.getchannel("A"))
    return out


def fit(mark: Image.Image, box: int) -> Image.Image:
    w, h = mark.size
    s = box / max(w, h)
    return mark.resize((round(w * s), round(h * s)), Image.LANCZOS)


def rounded_square(size: int, radius: int, color: tuple[int, int, int, int]) -> Image.Image:
    base = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size, size], radius=radius, fill=255)
    base.putalpha(mask)
    bg = Image.new("RGBA", (size, size), color)
    base.paste(bg, (0, 0), base)
    base.putalpha(mask)
    return base


def app_icon(mark_paper: Image.Image, size: int = 1024) -> Image.Image:
    icon = rounded_square(size, int(size * 0.225), INK)
    m = fit(mark_paper, int(size * 0.68))
    icon.alpha_composite(m, ((size - m.width) // 2, (size - m.height) // 2))
    return icon.convert("RGB")


def main() -> None:
    mark = load_mark()
    black = fit(recolor(mark, INK[:3]), 1024)
    paper = fit(recolor(mark, PAPER[:3]), 1024)
    accent = fit(recolor(mark, ACCENT[:3]), 1024)
    black.save(BRAND / "logo-mark-black.png")
    paper.save(BRAND / "logo-mark-paper.png")
    accent.save(BRAND / "logo-mark-accent.png")

    icon1024 = app_icon(paper)
    icon1024.save(BRAND / "app-icon.png")

    # og card: paper, centered icon + vermilion rule
    og = Image.new("RGB", (1200, 630), PAPER[:3])
    ic = app_icon(paper, 320)
    og.paste(ic, ((1200 - 320) // 2, 110))
    bar = Image.new("RGB", (120, 10), ACCENT[:3])
    og.paste(bar, ((1200 - 120) // 2, 480))
    og.save(BRAND / "og-image.png")

    for app in ("apps/landing", "apps/dashboard"):
        pub = ROOT / app / "public"
        pub.mkdir(parents=True, exist_ok=True)
        icon1024.resize((192, 192), Image.LANCZOS).save(pub / "icon-192.png")
        icon1024.save(pub / "icon-512.png")
        icon1024.resize((180, 180), Image.LANCZOS).save(pub / "apple-touch-icon.png")
        icon1024.resize((32, 32), Image.LANCZOS).save(pub / "icon-32.png")
        icon1024.save(
            pub / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)]
        )
        (pub / "site.webmanifest").write_text(
            """{
  "name": "KeyVeil",
  "short_name": "KeyVeil",
  "display": "standalone",
  "background_color": "#F3F3EE",
  "theme_color": "#F3F3EE",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
"""
        )
    print("brand assets regenerated")


if __name__ == "__main__":
    main()
