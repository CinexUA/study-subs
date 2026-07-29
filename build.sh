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
