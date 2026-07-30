#!/usr/bin/env bash
# Build trails-<region>.pmtiles from an OSM extract clipped to the region's
# bbox in regions.json. Each region is a standalone map, not a tile of a
# continuous surface — see regions.json's comment.
# Prerequisites: java 21+, curl, jq. planetiler.jar is downloaded automatically.
#
# Heavy I/O (the OSM extract download, planetiler's temp files) happens under
# $WORK on WSL's native filesystem, not under /mnt/c — cross-filesystem I/O
# through /mnt/c is slow enough to dominate the build. Only the finished
# .pmtiles is written back into the repo.
set -euo pipefail
cd "$(dirname "$0")"
REPO_TILES_DIR="$(pwd)"

WORK=${WORK:-$HOME/kaapspoor-tiles}
mkdir -p "$WORK/downloads" "$WORK/work" "$REPO_TILES_DIR/../../app/static/tiles"

REGION=${1:?usage: build-trails.sh <region-id>   (see regions.json)}

jq -e . regions.json >/dev/null 2>&1 \
  || { echo "regions.json is not valid JSON" >&2; exit 1; }

# --arg passes the id as data, not as jq program text: a quote or paren in it
# is then a failed match rather than a jq compile error.
REGION_JSON=$(jq -e --arg id "$REGION" '.regions[] | select(.id == $id)' regions.json) \
  || { echo "unknown region: $REGION (known: $(jq -r '.regions[].id' regions.json | tr '\n' ' '))" >&2; exit 1; }

W=$(jq -r '.bbox.west'  <<<"$REGION_JSON"); S=$(jq -r '.bbox.south' <<<"$REGION_JSON")
E=$(jq -r '.bbox.east'  <<<"$REGION_JSON"); N=$(jq -r '.bbox.north' <<<"$REGION_JSON")
echo "Region $REGION: $W,$S,$E,$N"

PLANETILER_JAR="$WORK/planetiler.jar"
if [ ! -f "$PLANETILER_JAR" ]; then
  echo "Downloading planetiler.jar (once)..."
  curl -L --fail -o "$PLANETILER_JAR" \
    https://github.com/onthegomap/planetiler/releases/latest/download/planetiler.jar
fi

if [ ! -f "$WORK/downloads/region.osm.pbf" ]; then
  echo "Downloading the South Africa extract (~200 MB, once)..."
  curl -L --fail -o "$WORK/downloads/region.osm.pbf" \
    https://download.geofabrik.de/africa/south-africa-latest.osm.pbf
fi

# NOTE: planetiler.jar's Main class dispatches on argv[0]: if it matches
# *.yml/*.yaml it loads that file directly as a custom schema (no "--schema"
# flag at all); anything else falls through to the bundled OpenMapTiles
# profile, silently ignoring an explicit "--schema=..." flag. So the schema
# path must be the first, bare argument.
java -Xmx4g -jar "$PLANETILER_JAR" \
  "$REPO_TILES_DIR/profile/trails-profile.yml" \
  --bounds="$W,$S,$E,$N" \
  --osm_path="$WORK/downloads/region.osm.pbf" \
  --download=false \
  --tmpdir="$WORK/work/tmp" \
  --output="$WORK/work/trails-$REGION.pmtiles" \
  --force

cp "$WORK/work/trails-$REGION.pmtiles" "$REPO_TILES_DIR/../../app/static/tiles/trails-$REGION.pmtiles"
echo "trails-$REGION.pmtiles built."

"$REPO_TILES_DIR/verify-layers.sh" "$REGION" trails
