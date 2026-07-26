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

# Copernicus DEM cells are 1x1 degree, named by their south-west corner. Derive
# the cell range from bbox.json — the single source of truth this script must
# not drift from — instead of hard-coding it: widening bbox.json must widen the
# DEM fetch too, or gdalwarp pads the uncovered area with nodata and the build
# produces a silently contour-free band that no existing check catches.
#
# floor(), not int()/truncation: awk's int() truncates toward zero, which for a
# negative south/west bound (all of this bbox) rounds the wrong way.
floor() { awk -v v="$1" 'BEGIN { i = int(v); print (v < i) ? i - 1 : i }'; }

# Lower edge of each axis is simply floor(bound). Upper edge is the cell whose
# south-west corner is just below the bound — floor(bound) too, except when
# the bound itself falls exactly on a degree line, in which case that cell
# only touches the bbox at a single edge and must be excluded (bound - 1).
LAT_LO=$(floor "$S")
LON_LO=$(floor "$W")
if awk -v v="$N" 'BEGIN { exit !(v == int(v)) }'; then LAT_HI=$((${N%.*} - 1)); else LAT_HI=$(floor "$N"); fi
if awk -v v="$E" 'BEGIN { exit !(v == int(v)) }'; then LON_HI=$((${E%.*} - 1)); else LON_HI=$(floor "$E"); fi

LATS=$(seq "$LAT_LO" "$LAT_HI")
LONS=$(seq "$LON_LO" "$LON_HI")
LAT_COUNT=$(echo "$LATS" | wc -l)
LON_COUNT=$(echo "$LONS" | wc -l)
TOTAL_CELLS=$((LAT_COUNT * LON_COUNT))
echo "DEM cell range for bbox.json: lat ${LAT_LO}..${LAT_HI}, lon ${LON_LO}..${LON_HI} (${TOTAL_CELLS} cells)"

# Fetch the Copernicus GLO-30 tiles covering the bbox straight from AWS's public
# bucket: no login, no API key, no usage cap. Tiles are named by their south-west
# corner, one per 1x1 degree, ~1-40 MB each.
BUCKET=https://copernicus-dem-30m.s3.eu-central-1.amazonaws.com
for lat in $LATS; do
  # Southern latitudes (negative, all of this bbox) name as S<abs>; a future
  # bbox crossing the equator would need N<abs> for lat >= 0.
  if [ "$lat" -lt 0 ]; then latname=$(printf "S%02d" $((-lat))); else latname=$(printf "N%02d" "$lat"); fi
  for lon in $LONS; do
    if [ "$lon" -lt 0 ]; then lonname=$(printf "W%03d" $((-lon))); else lonname=$(printf "E%03d" "$lon"); fi
    name="Copernicus_DSM_COG_10_${latname}_00_${lonname}_00_DEM"
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
# Same 2/3 tolerance the previous hard-coded 8-of-12 encoded, now computed from
# the derived cell count so it scales when bbox.json's coverage changes.
EXPECTED_MIN=$((TOTAL_CELLS * 2 / 3))
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

"$REPO_TILES_DIR/verify-layers.sh" contours
