#!/usr/bin/env bash
# Build hillshade-<region>.pmtiles from the DEM that build-contours.sh already
# clipped. Run build-contours.sh for the region first — this reuses its
# dem-<region>.tif rather than re-fetching or re-clipping.
#
# Prerequisites: gdal, and the pmtiles CLI (the Go implementation, not the
# PMTiles spec/JS repo):
#   https://github.com/protomaps/go-pmtiles/releases  (currently v1.31.2;
#   grab go-pmtiles_<version>_Linux_x86_64.tar.gz, which extracts a `pmtiles`
#   binary — put it on PATH)
#
# This is the one raster archive in the pipeline, and the only one that could
# threaten the size budget — report-size.mjs gates it at 30 MB.
set -euo pipefail
cd "$(dirname "$0")"
REPO_TILES_DIR="$(pwd)"

REGION=${1:?usage: build-hillshade.sh <region-id>   (see regions.json)}

jq -e . regions.json >/dev/null 2>&1 \
  || { echo "regions.json is not valid JSON" >&2; exit 1; }

# --arg passes the id as data, not as jq program text: a quote or paren in it
# is then a failed match rather than a jq compile error.
REGION_JSON=$(jq -e --arg id "$REGION" '.regions[] | select(.id == $id)' regions.json) \
  || { echo "unknown region: $REGION (known: $(jq -r '.regions[].id' regions.json | tr '\n' ' '))" >&2; exit 1; }

WORK=${WORK:-$HOME/kaapspoor-tiles}
DEM="$WORK/work/dem-$REGION.tif"
[ -f "$DEM" ] || { echo "missing $DEM — run ./build-contours.sh $REGION first" >&2; exit 1; }
command -v pmtiles >/dev/null || { echo "pmtiles CLI not found; see the header" >&2; exit 1; }

# -z exaggerates relief; the Peninsula is steep enough that 1 reads flat at the
# zooms this map opens on. -compute_edges avoids a black 1px border per tile.
echo "==> shading"
gdaldem hillshade -z 1.5 -compute_edges -alg Horn \
  "$DEM" "$WORK/work/hillshade-$REGION.tif"

# Single-band greyscale. There is no alpha channel here — 4b lays it under the
# contours using raster-opacity in the style rather than baked transparency.
echo "==> tiling"
gdal_translate -of MBTiles -co TILE_FORMAT=PNG -co ZOOM_LEVEL_STRATEGY=UPPER \
  "$WORK/work/hillshade-$REGION.tif" "$WORK/work/hillshade-$REGION.mbtiles"
gdaladdo -r average "$WORK/work/hillshade-$REGION.mbtiles" 2 4 8 16

echo "==> converting to pmtiles"
pmtiles convert "$WORK/work/hillshade-$REGION.mbtiles" \
  "$WORK/work/hillshade-$REGION.pmtiles"

cp "$WORK/work/hillshade-$REGION.pmtiles" \
   "$REPO_TILES_DIR/../../app/static/tiles/hillshade-$REGION.pmtiles"
echo "hillshade-$REGION.pmtiles built."
ls -lh "$REPO_TILES_DIR/../../app/static/tiles/hillshade-$REGION.pmtiles"
