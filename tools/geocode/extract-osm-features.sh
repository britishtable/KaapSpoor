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

# Phase 4d needs two more exports from the same clip, and they are separate
# files because they answer different questions. `walkable-ways` is every way a
# person can walk — INCLUDING the unnamed connectors the name filter above
# drops, which are exactly what makes a fragmented trail continuous. Sharing
# one clipped PBF keeps every tier reading the same OSM snapshot; two Overpass
# fetches on different dates would diverge silently.
echo "==> filtering to walkable ways"
osmium tags-filter --overwrite "$OUT_DIR/clipped.osm.pbf" \
  w/highway=path,footway,track,steps \
  -o "$OUT_DIR/walkable.osm.pbf"
osmium export --overwrite "$OUT_DIR/walkable.osm.pbf" \
  -f geojsonseq --add-unique-id=type_id \
  -o "$OUT_DIR/walkable-ways.geojsonl"

# Hiking route relations: an ordered, mapper-authored member list, which is the
# highest-confidence route geometry available anywhere in this pipeline.
#
# NOT `osmium export`. That writes a relation as a MultiLineString and drops
# both the member WAY IDS and their ROLES on the way through — which would cost
# us the provenance every drawn line has to carry, and the forward/backward
# distinction that keeps an alternative section from being concatenated into a
# line that doubles back. OSM XML keeps both, as <member type ref role/>; the
# geometry is joined back on by way id from walkable-ways.geojsonl above.
#
# XML rather than OSM JSON because osmium's JSON writer is a COMPILE-TIME
# option that Ubuntu's osmium-tool package does not enable — 1.16.0 here fails
# with "No support for writing this format in this program", and a newer
# release does not fix it. The reader accepts either.
#
# -R omits referenced objects: we want the relations themselves, not a second
# copy of every member way.
echo "==> filtering to hiking route relations"
osmium tags-filter --overwrite -R "$OUT_DIR/clipped.osm.pbf" \
  r/type=route \
  -o "$OUT_DIR/routes.osm.pbf"
osmium cat --overwrite "$OUT_DIR/routes.osm.pbf" \
  -f xml \
  -o "$OUT_DIR/route-relations.osm"

# --add-unique-id=type_id puts "n123"/"w456" in each feature's "@id", which is
# what provenance records so an osm-match claim can be re-checked later.
echo "==> exporting to GeoJSON-seq"
osmium export --overwrite "$OUT_DIR/filtered.osm.pbf" \
  -f geojsonseq \
  --add-unique-id=type_id \
  -o "$OUT"

echo "==> wrote $OUT ($(wc -l < "$OUT") features before the name filter)"
echo "==> wrote $OUT_DIR/walkable-ways.geojsonl ($(wc -l < "$OUT_DIR/walkable-ways.geojsonl") ways)"
echo "==> wrote $OUT_DIR/route-relations.osm ($(grep -c '<relation' "$OUT_DIR/route-relations.osm") relations)"
