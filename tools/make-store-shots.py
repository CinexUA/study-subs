#!/usr/bin/env python3
"""Bring raw screen captures to the Chrome Web Store's 1280x800.

    ./tools/make-store-shots.py 01-video-study=~/Pictures/shot1.jpg ...

A capture off a 1920x1080 screen is 16:9; the store wants 16:10. Cropping the
sides is not an option — the overlay's top bar runs edge to edge, so a crop
takes the language chips off the left and the close button off the right. So
the image is scaled to 1280 wide and the missing height is ADDED by replicating
an edge row. The panel's background is a vertical gradient, which is why the
seam does not show.

Which edge gets the padding is MEASURED, not assumed. A row that carries text
smears into vertical stripes when it is stretched, and that is not theoretical:
the transcript column reaches the bottom of the screen mid-sentence, and
splitting the padding evenly turned "something happen." into a barcode. Each
edge row is scored by how much it changes from pixel to pixel; a clean
background row scores under 0.6, the row through that text scored 4.13. Padding
goes on the clean edge, split evenly when both are clean.

Output is PNG without alpha, which is what the store takes and what the
existing set is.
"""

import statistics
import sys
from pathlib import Path

from PIL import Image

W, H = 1280, 800
# Above this a row has something drawn on it and must not be stretched. The
# quietest text row measured is ~7x the noisiest background row, so anything
# between them separates the two; this sits nearer the background end.
BUSY_MAX = 1.0
OUT_DIR = Path(__file__).resolve().parent.parent / "store-assets"


def busyness(im: Image.Image, y: int) -> float:
    """Mean absolute change between neighbouring pixels along one row."""
    row = list(im.crop((0, y, im.width, y + 1)).convert("L").getdata())
    return statistics.fmean(abs(row[i + 1] - row[i]) for i in range(len(row) - 1))


def split_padding(im: Image.Image, pad: int) -> tuple[int, str]:
    """How much of `pad` goes on top, and what to say about the choice."""
    top, bottom = busyness(im, 0), busyness(im, im.height - 1)
    if top > BUSY_MAX and bottom > BUSY_MAX:
        return pad // 2, (f"WARNING both edges carry content "
                          f"(top {top:.2f}, bottom {bottom:.2f}) — check for smearing")
    if bottom > BUSY_MAX:
        return pad, f"all at the top, bottom row has content ({bottom:.2f})"
    if top > BUSY_MAX:
        return 0, f"all at the bottom, top row has content ({top:.2f})"
    return pad // 2, "split evenly, both edges clean"


def convert(src: Path, dest: Path) -> str:
    im = Image.open(src).convert("RGB")
    h = round(im.height * W / im.width)
    im = im.resize((W, h), Image.LANCZOS)

    if h > H:
        # Taller than 16:10 once scaled: take the middle, since the overlay is
        # centred vertically and both edges are background.
        top = (h - H) // 2
        out = im.crop((0, top, W, top + H))
        note = f"cropped {h - H}px vertically"
    else:
        pad = H - h
        top, why = split_padding(im, pad)
        out = Image.new("RGB", (W, H))
        out.paste(im, (0, top))
        # Replicate the edge rows into the new bands.
        if top:
            out.paste(im.crop((0, 0, W, 1)).resize((W, top)), (0, 0))
        if pad - top:
            out.paste(im.crop((0, h - 1, W, h)).resize((W, pad - top)), (0, top + h))
        note = f"padded {top}px top, {pad - top}px bottom — {why}"

    dest.parent.mkdir(parents=True, exist_ok=True)
    out.save(dest, "PNG")
    return note


def main() -> int:
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        return 1
    for arg in args:
        if "=" not in arg:
            print(f"expected <name>=<path>, got: {arg}", file=sys.stderr)
            return 1
        name, _, path = arg.partition("=")
        src = Path(path).expanduser()
        if not src.is_file():
            print(f"no such file: {src}", file=sys.stderr)
            return 1
        dest = OUT_DIR / f"{name}.png"
        note = convert(src, dest)
        print(f"{dest.name}  <- {src.name}  ({note})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
