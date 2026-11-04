#!/usr/bin/env python3
"""Build the subtitle fonts in fonts/ from the Google Fonts repository.

  python3 -m venv /tmp/fontenv && /tmp/fontenv/bin/pip install fonttools brotli
  /tmp/fontenv/bin/python tools/make-fonts.py

Run by hand when a font is added or updated; the extension ships the result and
never runs this. The fonts are bundled rather than fetched: a request to Google
on every opening would break the privacy policy (nothing leaves the computer),
and system fonts look different on every OS.

Each font is cut down to the regular weight and to Latin, Latin Extended and
Cyrillic — every language the translation menu offers — and written as WOFF2.
Its OFL licence goes next to it, as the licence requires.

Writes:
  fonts/<code>.woff2     one file per font, listed in manifest.json
  fonts/OFL-<code>.txt   the font's licence
"""

import io
import shutil
import urllib.request
from pathlib import Path

from fontTools.subset import Options, Subsetter
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "fonts"
BASE = "https://raw.githubusercontent.com/google/fonts/main/ofl/"

# code -> (directory in google/fonts, file). The code is what content.js and
# manifest.json call the font; keep the three in step.
FONTS = {
    "literata": ("literata", "Literata[opsz,wght].ttf"),
    "inter": ("inter", "Inter[opsz,wght].ttf"),
    "andika": ("andika", "Andika-Regular.ttf"),
    "jetbrains-mono": ("jetbrainsmono", "JetBrainsMono[wght].ttf"),
}

# Basic Latin and Latin-1, Latin Extended-A/B (pl, de, es, fr, it), combining
# accents, Cyrillic (uk, ru), general punctuation (quotes, dashes, …), currency
# (€, ₴), letterlike (№), and the replacement character.
UNICODES = [
    *range(0x0020, 0x007F), *range(0x00A0, 0x0250), *range(0x02B0, 0x0370),
    *range(0x0400, 0x0530), *range(0x1E00, 0x1F00), *range(0x2000, 0x2070),
    *range(0x20A0, 0x20C1), *range(0x2100, 0x2150), 0x2212, 0xFFFD,
]


def fetch(url: str) -> bytes:
    with urllib.request.urlopen(url, timeout=60) as r:
        return r.read()


def build(code: str, folder: str, name: str) -> None:
    font = TTFont(io.BytesIO(fetch(BASE + folder + "/" + urllib.request.quote(name))))
    if "fvar" in font:
        # Pin the weight at regular; any other axis (opsz) at its default.
        axes = {a.axisTag: a.defaultValue for a in font["fvar"].axes}
        axes["wght"] = 400
        font = instantiateVariableFont(font, axes)
    opts = Options()
    opts.flavor = "woff2"
    opts.layout_features = ["*"]
    opts.name_IDs = ["*"]
    opts.notdef_outline = True
    sub = Subsetter(opts)
    sub.populate(unicodes=UNICODES)
    sub.subset(font)
    font.flavor = "woff2"
    out = OUT / f"{code}.woff2"
    font.save(out)
    (OUT / f"OFL-{code}.txt").write_bytes(fetch(BASE + folder + "/OFL.txt"))
    print(f"{out.relative_to(ROOT)}  {out.stat().st_size // 1024} KB")


def main() -> None:
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir()
    for code, (folder, name) in FONTS.items():
        build(code, folder, name)


if __name__ == "__main__":
    main()
