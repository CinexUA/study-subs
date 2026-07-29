#!/usr/bin/env python3
"""Cut the extension icons out of icons/source.png.

  python3 tools/make-icons.py

icons/source.png is the artwork: a 2048x2048 rounded square, terracotta face,
"Eng" over a dimmed second script — the original track above, the translation
below.

The generator hands the file over as RGB with a transparency *checkerboard baked
into the pixels*, which would show up as a light halo around the icon on Chrome's
dark theme. So the alpha channel is rebuilt here from the plate's own geometry:
the artwork bleeds to all four edges with a corner radius measured at 360px of
2048 (17.6%, fitted to the arc with 2px rms). INSET trims the outermost pixels,
where the original antialiasing already mixed terracotta with checkerboard grey.

Writes:
  icons/icon{16,32,48,128}.png   toolbar and extensions page, artwork fills the square
  icons/store-icon-128.png       Chrome Web Store listing: artwork inset to 96x96,
                                 transparent padding around it, as the store asks
"""

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "icons" / "source.png"
ICONS = ROOT / "icons"

RADIUS_PCT = 0.176  # corner radius as a fraction of the width
INSET = 2           # px (at source scale) shaved off the edge to drop the grey fringe
SS = 4              # supersampling for the mask, so the corners stay smooth


def load_artwork() -> Image.Image:
    im = Image.open(SOURCE).convert("RGB")
    w, h = im.size

    mask = Image.new("L", (w * SS, h * SS), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [INSET * SS, INSET * SS, (w - INSET) * SS - 1, (h - INSET) * SS - 1],
        radius=RADIUS_PCT * w * SS,
        fill=255,
    )
    mask = mask.resize((w, h), Image.LANCZOS)

    out = im.convert("RGBA")
    out.putalpha(mask)
    return out


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


if __name__ == "__main__":
    main()
