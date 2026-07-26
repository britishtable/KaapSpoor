#!/usr/bin/env bash
# Fail the build if an archive does not carry exactly the layers style.ts expects.
# planetiler exits 0 even when it silently falls back to a different profile, so
# size alone cannot tell a good build from a wrong one.
set -euo pipefail
cd "$(dirname "$0")"

TILES=../../app/static/tiles
fail=0

check() {
  local archive=$1; shift
  local expected=("$@")
  if [ ! -f "$archive" ]; then
    echo "MISSING: $archive" >&2; fail=1; return
  fi
  # tippecanoe-decode prints one JSON object per tile; each feature collection
  # inside a tile carries its layer name as a "layer" property, e.g.
  # { "layer": "paths", "version": 2, "extent": 4096 }.
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

check "$TILES/trails.pmtiles" paths roads water peaks
check "$TILES/contours.pmtiles" contours

# The contour lines must carry ele — style.ts weights the indexed 100 m lines on it.
# NOTE: run in a subshell with pipefail off. grep -q exits as soon as it finds a
# match, which sends tippecanoe-decode a SIGPIPE on a still-huge remaining stream;
# under `set -o pipefail` that non-zero producer exit outranks grep's 0, so the
# `if` sees the pipeline as failed even though the attribute was found. This
# produced a false "MISSING ATTRIBUTE" against a contours.pmtiles that actually
# carries ele on all 536k+ features — caught by checking against the known-good
# archive before trusting this script.
if (set +o pipefail; tippecanoe-decode "$TILES/contours.pmtiles" 2>/dev/null | grep -q '"ele"'); then
  echo "contours carry an ele attribute."
else
  echo "  MISSING ATTRIBUTE: ele on contours" >&2; fail=1
fi

[ "$fail" -eq 0 ] || { echo "Layer verification FAILED." >&2; exit 1; }
echo "Layer verification passed."
