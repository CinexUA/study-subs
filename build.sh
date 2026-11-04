#!/usr/bin/env bash
# Pack the extension for the Chrome Web Store.
#
#   ./build.sh          -> dist/study-subs-<version>.zip
#
# The file list is derived from manifest.json, not hand-written: a script added
# to the manifest can't be forgotten here, and nothing that isn't referenced
# (icons/source.png is 3.9 MB, tools/, dist/, .git/) can sneak in.

set -euo pipefail
cd "$(dirname "$0")"

command -v zip >/dev/null || { echo "zip is not installed" >&2; exit 1; }

# Syntax gate — the same check that runs before every commit.
node --check content.js
node --check injected.js
node --check channels.js
node --check popup.js
echo "node --check ok"

VERSION=$(python3 -c "import json; print(json.load(open('manifest.json'))['version'])")

# Everything the manifest actually references, plus the manifest itself.
mapfile -t FILES < <(python3 - <<'PY'
import json
m = json.load(open("manifest.json"))
out = ["manifest.json"]
out += m.get("icons", {}).values()
for cs in m.get("content_scripts", []):
    out += cs.get("js", []) + cs.get("css", [])
for p in m.get("web_accessible_resources", []):
    out += p.get("resources", [])
popup = m.get("action", {}).get("default_popup")
if popup:
    out.append(popup)
# A page the manifest names loads its own scripts and styles, and the manifest
# never lists those. Read them off the page itself, local paths only, so a
# script added to popup.html can't be left out of the package either.
import os, re
for page in [f for f in out if f.endswith(".html")]:
    if not os.path.isfile(page):
        continue
    html = open(page, encoding="utf-8").read()
    for ref in re.findall(r'<(?:script\b[^>]*\ssrc|link\b[^>]*\shref)="([^"]+)"', html):
        if not re.match(r"^(?:[a-z]+:|//)", ref):
            out.append(ref)
seen = set()
for f in out:
    if f not in seen:
        seen.add(f)
        print(f)
PY
)

missing=0
for f in "${FILES[@]}"; do
  [[ -f "$f" ]] || { echo "missing file referenced by manifest: $f" >&2; missing=1; }
done
[[ $missing -eq 0 ]] || exit 1

OUT="dist/study-subs-$VERSION.zip"
mkdir -p dist
rm -f "$OUT"
zip -q -X "$OUT" "${FILES[@]}"

echo
echo "$OUT  ($(du -h "$OUT" | cut -f1))"
unzip -l "$OUT" | tail -n +4 | head -n -2
