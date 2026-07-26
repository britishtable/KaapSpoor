#!/usr/bin/env bash
# Build trails.pmtiles from an OSM extract clipped to bbox.json.
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

W=$(jq -r .west bbox.json); S=$(jq -r .south bbox.json)
E=$(jq -r .east bbox.json); N=$(jq -r .north bbox.json)

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
  --output="$WORK/work/trails.pmtiles" \
  --force

cp "$WORK/work/trails.pmtiles" "$REPO_TILES_DIR/../../app/static/tiles/trails.pmtiles"
echo "trails.pmtiles built."
