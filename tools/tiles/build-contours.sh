#!/usr/bin/env bash
# Build contours.pmtiles from a DEM: 20 m intervals, source layer "contours",
# with an "ele" attribute so style.ts can weight the indexed 100 m lines.
# Prerequisites: gdal (gdal_contour, gdalwarp, gdalbuildvrt, ogr2ogr), tippecanoe, curl, jq.
#
# Heavy I/O (DEM tiles, gdal/tippecanoe intermediates) happens under $WORK on
# WSL's native filesystem, not under /mnt/c — cross-filesystem I/O through
# /mnt/c is slow enough to dominate the build. Only the finished .pmtiles is
# written back into the repo.
set -euo pipefail
cd "$(dirname "$0")"
REPO_TILES_DIR="$(pwd)"

WORK=${WORK:-$HOME/kaapspoor-tiles}
mkdir -p "$WORK/downloads" "$WORK/work" "$REPO_TILES_DIR/../../app/static/tiles"

W=$(jq -r .west bbox.json); S=$(jq -r .south bbox.json)
E=$(jq -r .east bbox.json); N=$(jq -r .north bbox.json)

# Fetch the Copernicus GLO-30 tiles covering the bbox straight from AWS's public
# bucket: no login, no API key, no usage cap. Tiles are named by their south-west
# corner, one per 1x1 degree, ~1-40 MB each.
BUCKET=https://copernicus-dem-30m.s3.eu-central-1.amazonaws.com
for lat in 35 34 33; do
  for lon in 017 018 019 020; do
    name="Copernicus_DSM_COG_10_S${lat}_00_E${lon}_00_DEM"
    if [ ! -f "$WORK/downloads/${name}.tif" ]; then
      echo "DEM tile ${name}..."
      # Not every 1-degree cell exists (ocean-only cells are absent), so a 404
      # is expected and must not abort the run.
      curl -sfL -o "$WORK/downloads/${name}.tif" "${BUCKET}/${name}/${name}.tif" \
        || echo "  (absent — ocean cell, skipping)"
    fi
  done
done

# Distinguish "some cells are ocean" from "the URL scheme changed". Ocean-only cells
# in this bbox are a small minority; if most tiles are missing, the naming convention
# has moved and a silent partial mosaic would leave a hole in the contours.
GOT=$(ls "$WORK"/downloads/Copernicus_DSM_COG_10_*.tif 2>/dev/null | wc -l)
EXPECTED_MIN=8
if [ "$GOT" -lt "$EXPECTED_MIN" ]; then
  echo "Only ${GOT} DEM tiles present, expected at least ${EXPECTED_MIN}." >&2
  echo "The bucket layout or tile naming has probably changed: ${BUCKET}" >&2
  exit 1
fi
echo "DEM: ${GOT} tiles covering the bbox."

# Merge the tiles into one virtual raster, then clip to the bbox.
gdalbuildvrt "$WORK/work/dem.vrt" "$WORK"/downloads/Copernicus_DSM_COG_10_*.tif
gdalwarp -te "$W" "$S" "$E" "$N" -r bilinear -overwrite \
  "$WORK/work/dem.vrt" "$WORK/work/dem-clipped.tif"

rm -f "$WORK/work/contours.gpkg"
gdal_contour -a ele -i 20 "$WORK/work/dem-clipped.tif" "$WORK/work/contours.gpkg"

# tippecanoe cannot read GeoPackage directly (it errors with "Found unexpected
# character" — it only reads (Geo)JSON/CSV natively), so convert first. This
# is a deviation from the brief, which fed the .gpkg straight to tippecanoe.
ogr2ogr -f GeoJSON "$WORK/work/contours.geojson" "$WORK/work/contours.gpkg"

tippecanoe -o "$WORK/work/contours.pmtiles" \
  --layer=contours \
  --minimum-zoom=10 --maximum-zoom=14 \
  --drop-densest-as-needed \
  --force \
  "$WORK/work/contours.geojson"

cp "$WORK/work/contours.pmtiles" "$REPO_TILES_DIR/../../app/static/tiles/contours.pmtiles"
echo "contours.pmtiles built."

"$REPO_TILES_DIR/verify-layers.sh"
