#!/usr/bin/env bash
# Fail the build if an archive does not carry exactly the layers style.ts expects.
# planetiler exits 0 even when it silently falls back to a different profile, so
# size alone cannot tell a good build from a wrong one.
#
# Usage: verify-layers.sh <region-id> [trails|contours|all]
#   trails / contours  — check just that archive. Each build script uses this, so
#                        building one archive does not fail on the other not
#                        existing yet (a fresh checkout has neither).
#   all (default)      — check both; the full-pipeline gate, where both must exist.
set -euo pipefail
cd "$(dirname "$0")"

TILES=../../app/static/tiles
REGION=${1:?usage: verify-layers.sh <region-id> [trails|contours|all]}
target=${2:-all}
fail=0

check() {
  local archive=$1; shift
  local expected=("$@")
  if [ ! -f "$archive" ]; then
    echo "MISSING: $archive" >&2; fail=1; return
  fi
  # tippecanoe-decode prints one JSON object per tile; each feature collection
  # inside a tile carries its layer name as a "layer" property value, e.g.
  # { "layer": "paths", "version": 2, "extent": 4096 } — not as an object key
  # (adapted from the brief's key-based grep, which found nothing against this
  # tippecanoe version's actual output shape; see the report for detail).
  local found
  found=$(tippecanoe-decode "$archive" 2>/dev/null \
    | grep -o '"layer": *"[a-z_]*"' \
    | grep -o '"[a-z_]*"$' | tr -d '"' | sort -u | tr '\n' ' ')
  echo "$(basename "$archive") layers: ${found:-<none>}"
  for want in "${expected[@]}"; do
    case " $found " in
      *" $want "*) ;;
      *) echo "  MISSING LAYER: $want" >&2; fail=1 ;;
    esac
  done
}

if [ "$target" = all ] || [ "$target" = trails ]; then
  check "$TILES/trails-$REGION.pmtiles" paths roads water peaks landcover places
fi

if [ "$target" = all ] || [ "$target" = contours ]; then
  check "$TILES/contours-$REGION.pmtiles" contours
  # style.ts weights the indexed 100 m lines on ele, so it must be present.
  # grep -q exits as soon as it matches, which raises SIGPIPE upstream; under the
  # outer `set -o pipefail` that became a false failure, so drop pipefail for
  # just this check. A genuinely absent "ele" still fails: grep's own exit 1 is
  # then the subshell's status, with nothing left to mask it.
  if (set +o pipefail; tippecanoe-decode "$TILES/contours-$REGION.pmtiles" 2>/dev/null | grep -q '"ele"'); then
    echo "contours carry an ele attribute."
  else
    echo "  MISSING ATTRIBUTE: ele on contours" >&2; fail=1
  fi
fi

[ "$fail" -eq 0 ] || { echo "Layer verification FAILED." >&2; exit 1; }
echo "Layer verification passed."
