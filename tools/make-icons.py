#!/usr/bin/env python3
"""Cut the extension icons out of icons/source.png.

  python3 tools/make-icons.py

icons/source.png is the artwork: a 2048x2048 rounded square (corner radius ~17%
of the width, transparent outside it), terracotta face, two caption bars — the
bright one is the original track, the dimmed one below is the translation. Same
colours as an active button in the overlay.

Writes:
  icons/icon{16,32,48,128}.png   toolbar and extensions page, artwork fills the square
  icons/store-icon-128.png       Chrome Web Store listing: artwork inset to 96x96,
                                 transparent padding around it, as the store asks
  docs/img/icon.png              the page's logo and favicon, so the site cannot
                                 drift away from the icon that actually ships
"""

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "icons" / "source.png"
ICONS = ROOT / "icons"
DOCS_IMG = ROOT / "docs" / "img"


def load_artwork() -> Image.Image:
    im = Image.open(SOURCE)
    if im.mode != "RGBA":
        raise SystemExit(
            f"{SOURCE.name} is {im.mode}, not RGBA. An image generator that bakes a "
            "transparency checkerboard into the pixels will show a light halo around "
            "the icon on Chrome's dark theme — export it with a real alpha channel."
        )
    lo, _ = im.getchannel("A").getextrema()
    if lo > 10:
        raise SystemExit(
            f"{SOURCE.name} has no transparent pixels: the rounded corners are filled "
            "in. Export with transparency outside the rounded square."
        )
    return im


def main() -> None:
    art = load_artwork()

    for size in (16, 32, 48, 128):
        out = ICONS / f"icon{size}.png"
        art.resize((size, size), Image.LANCZOS).save(out)
        print(f"{out.name:22} {size}x{size}")

    store = Image.new("RGBA", (128, 128), (0, 0, 0, 0))
    store.paste(art.resize((96, 96), Image.LANCZOS), (16, 16))
    store.save(ICONS / "store-icon-128.png")
    print(f"{'store-icon-128.png':22} 128x128 (artwork 96x96)")

    if DOCS_IMG.is_dir():
        art.resize((256, 256), Image.LANCZOS).save(DOCS_IMG / "icon.png")
        print(f"{'docs/img/icon.png':22} 256x256")


if __name__ == "__main__":
    main()
