#!/usr/bin/env bash
# Extract named OSM features that a route title could plausibly name.
#
# Must run inside WSL Ubuntu, same as tools/tiles/*.sh: osmium-tool is a Linux
# package and the cached OSM extract already lives on WSL's own filesystem.
#   sudo apt install osmium-tool
#
# Reuses the extract tools/tiles/build-trails.sh already downloaded
# ($HOME/kaapspoor-tiles/downloads/region.osm.pbf) — no second 400 MB download.
#
# Output is a GeoJSON-seq file (one Feature per line) under work/, which is
# gitignored: it is an intermediate, not a deliverable. The committed artifact
# of this phase is data/route-locations.json.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK="${WORK:-$HOME/kaapspoor-tiles}"
PBF="$WORK/downloads/region.osm.pbf"
OUT_DIR="$HERE/work"
OUT="$OUT_DIR/named-features.geojsonl"

if [ ! -f "$PBF" ]; then
  echo "error: $PBF not found. Run tools/tiles/build-trails.sh first — it downloads it." >&2
  exit 1
fi

command -v osmium >/dev/null || { echo "error: osmium not found (sudo apt install osmium-tool)" >&2; exit 1; }

mkdir -p "$OUT_DIR"

# Clip generously: wide enough for every route including Mt Zebra Park (~25.5E),
# which sits outside the tile bbox but still needs a coordinate.
echo "==> clipping to the routes' region"
osmium extract --overwrite --bbox 17.5,-35.0,26.0,-31.5 "$PBF" -o "$OUT_DIR/clipped.osm.pbf"

# Only tags a route title could name. Peaks and saddles come from the same
# tags the tile profile already uses; the rest are the landform and reserve
# tags that ravines, buttresses, gorges and nature reserves carry.
echo "==> filtering to nameable features"
osmium tags-filter --overwrite "$OUT_DIR/clipped.osm.pbf" \
  n/natural=peak,saddle \
  nw/natural=ridge,arete,cliff,valley,gorge,water,bay,beach,cape \
  w/waterway=stream,river \
  w/highway=path \
  nwr/leisure=nature_reserve \
  nwr/boundary=protected_area \
  nwr/protect_class \
  -o "$OUT_DIR/filtered.osm.pbf"

# --add-unique-id=type_id puts "n123"/"w456" in each feature's "@id", which is
# what provenance records so an osm-match claim can be re-checked later.
echo "==> exporting to GeoJSON-seq"
osmium export --overwrite "$OUT_DIR/filtered.osm.pbf" \
  -f geojsonseq \
  --add-unique-id=type_id \
  -o "$OUT"

echo "==> wrote $OUT ($(wc -l < "$OUT") features before the name filter)"
