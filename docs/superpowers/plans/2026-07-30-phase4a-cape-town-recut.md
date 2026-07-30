# Phase 4a — The Cape Town Re-cut Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the basemap as a single tight Cape Town region — from a pipeline that treats a region as a parameter — and add the landcover and place data the styling pass will need.

**Architecture:** `tools/tiles/bbox.json` becomes `regions.json`, a list of named regions. Every build script takes a region id and emits `<archive>-<region>.pmtiles`. The app gains one `region.ts` naming the shipped region, which `style.ts` and `geojson.ts` both read, so the tile URLs and the map's framing bounds stop being two independent constants. Hillshade is built and measured but not styled — 4b does that.

**Tech Stack:** planetiler (custom YAML schema) · GDAL · tippecanoe · the `pmtiles` CLI (new) · SvelteKit 2 · Vitest.

## Global Constraints

- **All tile builds run inside WSL Ubuntu.** GDAL, tippecanoe and planetiler live there, not on Windows. Heavy I/O stays on WSL's native filesystem under `$WORK` (default `$HOME/kaapspoor-tiles`); only finished archives are copied into the repo. Building through `/mnt/c` is slow enough to dominate the run.
- **The region is `18.27, -34.33, 18.51, -33.89`** — the extent of the 133 Table Mountain and peninsula routes plus a 0.05° (~6 km) margin. Do not round or "tidy" these numbers; they are derived.
- **Archives are gitignored** and published as a GitHub Release; CI downloads them. `app/static/tiles/` stays out of git.
- **Attribution is a licence obligation.** `© OpenStreetMap contributors` and the Copernicus DEM credit stay in the style and in every archive's metadata.
- **Grades stay raw.** Nothing here touches route data.
- TypeScript strict, no `any`. Shell scripts keep `set -euo pipefail`.
- **planetiler's schema argument must be the first bare argument** — `planetiler.jar` dispatches on `argv[0]` and silently ignores `--schema=`, falling back to the bundled OpenMapTiles profile. `verify-layers.sh` exists because that failure is otherwise invisible.
- **Hillshade is gated at 30 MB.** If the built archive exceeds it, restrict its zoom range or drop it — do not absorb it silently.

## File structure

```
tools/tiles/
  regions.json                    # REPLACES bbox.json — named regions
  build-trails.sh                 # MODIFY — takes a region id
  build-contours.sh               # MODIFY — takes a region id
  build-hillshade.sh              # NEW — gdaldem -> MBTiles -> pmtiles
  verify-layers.sh                # MODIFY — region-aware, knows the new layers
  report-size.mjs                 # MODIFY — reports per region, enforces the gate
  profile/trails-profile.yml      # MODIFY — landcover, places, paths min_zoom
  README.md                       # MODIFY — region workflow + new prerequisite

app/src/lib/map/
  region.ts                       # NEW — the shipped region: id and bounds
  region.test.ts                  # NEW
  style.ts                        # MODIFY — per-region archive URLs
  style.test.ts                   # MODIFY
  geojson.ts                      # MODIFY — BASEMAP_BOUNDS derives from region.ts
  geojson.test.ts                 # MODIFY

.github/workflows/deploy.yml      # MODIFY — new tag, per-region assets, new floors
```

---

### Task 1: regions.json and a region-aware trails build

**Files:**
- Create: `tools/tiles/regions.json`
- Delete: `tools/tiles/bbox.json`
- Modify: `tools/tiles/build-trails.sh`

**Interfaces:**
- Produces: `regions.json` with a `regions` array; each entry has `id`, `label`, `bbox` and `areas`. Every later task and both other build scripts resolve a region from this file.
- Produces: `app/static/tiles/trails-<id>.pmtiles`.

- [ ] **Step 1: Write regions.json**

```json
{
  "comment": "Each region is a standalone map, not a tile of a continuous surface. Its bbox is the extent of the routes whose area path starts with one of `areas`, plus a ~6 km margin, so a route near the edge still has terrain around it at close zoom. Adding a region is an entry here plus a build run; the app ships one region and has no picker.",
  "regions": [
    {
      "id": "cape-town",
      "label": "Cape Town",
      "bbox": { "west": 18.27, "south": -34.33, "east": 18.51, "north": -33.89 },
      "areas": ["Table-Mountain", "peninsula"]
    }
  ]
}
```

- [ ] **Step 2: Make build-trails.sh take a region id**

Replace the bbox-reading block (currently lines 16-17) and the output paths. The script keeps everything else — the planetiler argv[0] handling, `$WORK` discipline, the jar download.

```bash
REGION=${1:?usage: build-trails.sh <region-id>   (see regions.json)}
SEL=".regions[] | select(.id == \"$REGION\")"
jq -e "$SEL" regions.json >/dev/null || { echo "unknown region: $REGION" >&2; exit 1; }
W=$(jq -r "$SEL.bbox.west" regions.json);  S=$(jq -r "$SEL.bbox.south" regions.json)
E=$(jq -r "$SEL.bbox.east" regions.json);  N=$(jq -r "$SEL.bbox.north" regions.json)
echo "Region $REGION: $W,$S,$E,$N"
```

Change the output and copy lines to carry the region id:

```bash
  --output="$WORK/work/trails-$REGION.pmtiles" \
```

```bash
cp "$WORK/work/trails-$REGION.pmtiles" "$REPO_TILES_DIR/../../app/static/tiles/trails-$REGION.pmtiles"
echo "trails-$REGION.pmtiles built."

"$REPO_TILES_DIR/verify-layers.sh" "$REGION" trails
```

- [ ] **Step 3: Verify the script parses and resolves the region**

Run in WSL:

```bash
cd /mnt/c/Users/keega/Documents/KaapSpoor/tools/tiles
bash -n build-trails.sh && echo "syntax OK"
jq -e '.regions[] | select(.id == "cape-town")' regions.json >/dev/null && echo "region resolves"
jq -r '.regions[] | select(.id=="cape-town") | "\(.bbox.west),\(.bbox.south),\(.bbox.east),\(.bbox.north)"' regions.json
```

Expected: `syntax OK`, `region resolves`, then `18.27,-34.33,18.51,-33.89`.

Do **not** run the full build yet — Task 3 changes the profile it would use, and the run takes minutes.

- [ ] **Step 4: Commit**

```bash
git add tools/tiles/regions.json tools/tiles/build-trails.sh
git rm tools/tiles/bbox.json
git commit -m "build(tiles): make a region a parameter rather than a single bbox"
```

---

### Task 2: Region-aware contour build

**Files:**
- Modify: `tools/tiles/build-contours.sh`

**Interfaces:**
- Consumes: `regions.json` (Task 1).
- Produces: `app/static/tiles/contours-<id>.pmtiles`.

The DEM-cell arithmetic, the 2/3 ocean-cell tolerance, the gdalwarp clip and the tippecanoe invocation all stay. Only the bbox source and the output names change.

- [ ] **Step 1: Apply the same region resolution**

Use the identical `REGION`/`SEL` block from Task 1 Step 2 in place of the current `bbox.json` reads, and update the echo that names the file:

```bash
echo "DEM cell range for region $REGION: lat ${LAT_LO}..${LAT_HI}, lon ${LON_LO}..${LON_HI} (${TOTAL_CELLS} cells)"
```

- [ ] **Step 2: Region-scope the outputs**

The DEM `.tif` downloads are **shared across regions** — they are named by degree cell, so leave `$WORK/downloads/` alone; a second region reuses whatever it already fetched. Only the derived artefacts get region names:

```bash
gdalwarp -te "$W" "$S" "$E" "$N" -r bilinear -overwrite \
  "$WORK/work/dem.vrt" "$WORK/work/dem-$REGION.tif"

rm -f "$WORK/work/contours-$REGION.gpkg"
gdal_contour -a ele -i 20 "$WORK/work/dem-$REGION.tif" "$WORK/work/contours-$REGION.gpkg"
ogr2ogr -f GeoJSON "$WORK/work/contours-$REGION.geojson" "$WORK/work/contours-$REGION.gpkg"

tippecanoe -o "$WORK/work/contours-$REGION.pmtiles" \
  --layer=contours \
  --minimum-zoom=10 --maximum-zoom=14 \
  --drop-densest-as-needed \
  --force \
  "$WORK/work/contours-$REGION.geojson"

cp "$WORK/work/contours-$REGION.pmtiles" "$REPO_TILES_DIR/../../app/static/tiles/contours-$REGION.pmtiles"
echo "contours-$REGION.pmtiles built."

"$REPO_TILES_DIR/verify-layers.sh" "$REGION" contours
```

**Keep the dem.vrt build unregioned** (`gdalbuildvrt "$WORK/work/dem.vrt" "$WORK"/downloads/Copernicus_DSM_COG_10_*.tif`) — it mosaics every downloaded cell and the warp does the clipping.

- [ ] **Step 3: Syntax check**

```bash
cd /mnt/c/Users/keega/Documents/KaapSpoor/tools/tiles && bash -n build-contours.sh && echo "syntax OK"
```

- [ ] **Step 4: Commit**

```bash
git add tools/tiles/build-contours.sh
git commit -m "build(tiles): scope the contour build to a region"
```

---

### Task 3: Landcover and places in the schema

**Files:**
- Modify: `tools/tiles/profile/trails-profile.yml`

**Interfaces:**
- Produces: two new source-layers, `landcover` and `places`, which 4b styles and `verify-layers.sh` (Task 5) requires.

Landcover is the largest colour-per-byte gain available; `places` is what finally orients the overview, since Phase 3a proved peak labels cannot.

- [ ] **Step 1: Add the layers**

Append to the `layers:` list in `tools/tiles/profile/trails-profile.yml`:

```yaml
  - id: landcover
    features:
      - source: osm
        geometry: polygon
        min_zoom: 8
        include_when:
          natural: [wood, scrub, heath, grassland, bare_rock, sand, beach]
          landuse: [forest, vineyard, orchard]
        attributes:
          - key: natural
          - key: landuse
  - id: places
    features:
      - source: osm
        geometry: point
        include_when:
          place: [city, town, village, suburb]
        attributes:
          - key: place
          - key: name
          - key: population
```

- [ ] **Step 2: Hold footpaths back in the tiles as well as the style**

Add `min_zoom: 11` to the existing `paths` layer's feature block — deliberately **one below** the style's `minzoom: 12`, so the style always has data at the zoom it starts drawing, with a level of slack. Below z11 the footpath geometry is not in the archive at all, so those bytes are never shipped.

```yaml
  - id: paths
    features:
      - source: osm
        geometry: line
        min_zoom: 11
        include_when:
          highway: [path, footway, track, steps, bridleway]
```

Leave its `attributes` untouched.

- [ ] **Step 3: Validate the YAML parses**

```bash
cd /mnt/c/Users/keega/Documents/KaapSpoor/tools/tiles
python3 -c "import yaml,sys; d=yaml.safe_load(open('profile/trails-profile.yml')); print('layers:', [l['id'] for l in d['layers']])"
```

Expected: `layers: ['paths', 'roads', 'water', 'peaks', 'landcover', 'places']`

- [ ] **Step 4: Commit**

```bash
git add tools/tiles/profile/trails-profile.yml
git commit -m "build(tiles): add landcover and place layers, and hold paths back in the archive"
```

---

### Task 4: The hillshade build

**Files:**
- Create: `tools/tiles/build-hillshade.sh`

**Interfaces:**
- Consumes: `regions.json`, and the clipped DEM that `build-contours.sh` produces at `$WORK/work/dem-<region>.tif`.
- Produces: `app/static/tiles/hillshade-<id>.pmtiles` — a **raster** archive, unlike the two vector ones.

Pre-rendered raster rather than a Terrain-RGB `raster-dem` source: it needs no client-side computation, and 4b can style it as a plain raster layer with an opacity. The cost is that the illumination angle is baked in.

- [ ] **Step 1: Write the script**

`tools/tiles/build-hillshade.sh`:

```bash
#!/usr/bin/env bash
# Build hillshade-<region>.pmtiles from the DEM that build-contours.sh already
# clipped. Run build-contours.sh for the region first — this reuses its
# dem-<region>.tif rather than re-fetching or re-clipping.
#
# Prerequisites: gdal, and the pmtiles CLI:
#   https://github.com/protomaps/PMTiles/releases  (put `pmtiles` on PATH)
#
# This is the one raster archive in the pipeline, and the only one that could
# threaten the size budget — report-size.mjs gates it at 30 MB.
set -euo pipefail
cd "$(dirname "$0")"
REPO_TILES_DIR="$(pwd)"

REGION=${1:?usage: build-hillshade.sh <region-id>   (see regions.json)}
SEL=".regions[] | select(.id == \"$REGION\")"
jq -e "$SEL" regions.json >/dev/null || { echo "unknown region: $REGION" >&2; exit 1; }

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
```

- [ ] **Step 2: Make it executable and syntax-check**

```bash
cd /mnt/c/Users/keega/Documents/KaapSpoor/tools/tiles
chmod +x build-hillshade.sh && bash -n build-hillshade.sh && echo "syntax OK"
```

- [ ] **Step 3: Commit**

```bash
git add tools/tiles/build-hillshade.sh
git commit -m "build(tiles): add a hillshade archive, gated on measured size"
```

---

### Task 5: Region-aware verification and size reporting

**Files:**
- Modify: `tools/tiles/verify-layers.sh`, `tools/tiles/report-size.mjs`

**Interfaces:**
- Consumes: `regions.json`, the built archives.
- Produces: the gate that fails a build whose archive is missing a layer, and the measurement that decides whether hillshade ships.

- [ ] **Step 1: Take a region id in verify-layers.sh**

Change the usage to `verify-layers.sh <region> [trails|contours|all]` and the archive paths to carry the region. Update the expected trails layers to include the two new ones:

```bash
REGION=${1:?usage: verify-layers.sh <region-id> [trails|contours|all]}
target=${2:-all}
```

```bash
if [ "$target" = all ] || [ "$target" = trails ]; then
  check "$TILES/trails-$REGION.pmtiles" paths roads water peaks landcover places
fi

if [ "$target" = all ] || [ "$target" = contours ]; then
  check "$TILES/contours-$REGION.pmtiles" contours
```

and the `ele` check's path likewise. Keep the `set +o pipefail` subshell exactly as it is — the comment there records a real SIGPIPE failure that cost a debugging round.

- [ ] **Step 2: Make report-size.mjs region-aware and enforce the hillshade gate**

Replace the fixed archive list with one derived from `regions.json`, and add the gate:

```javascript
import { readFileSync } from 'node:fs';

const HILLSHADE_GATE_MB = 30;

const { regions } = JSON.parse(
  readFileSync(resolve(here, 'regions.json'), 'utf-8')
);

let total = 0;
let failed = false;
for (const { id } of regions) {
  console.log(`region ${id}:`);
  for (const kind of ['trails', 'contours', 'hillshade']) {
    const path = resolve(dir, `${kind}-${id}.pmtiles`);
    if (!existsSync(path)) {
      // hillshade is optional by design; the other two are not.
      console.log(`  ${kind}: MISSING${kind === 'hillshade' ? ' (optional)' : ''}`);
      if (kind !== 'hillshade') failed = true;
      continue;
    }
    const mb = statSync(path).size / 1024 / 1024;
    total += mb;
    console.log(`  ${kind}: ${mb.toFixed(1)} MB`);
    if (kind === 'hillshade' && mb > HILLSHADE_GATE_MB) {
      console.log(
        `  => hillshade is ${mb.toFixed(1)} MB, over the ${HILLSHADE_GATE_MB} MB gate.` +
          ' Restrict its zoom range or drop it — do not absorb it silently.'
      );
      failed = true;
    }
  }
}
console.log(`total: ${total.toFixed(1)} MB`);
process.exit(failed ? 1 : 0);
```

Drop the `COMMIT_THRESHOLD_MB` advice block — that decision was made in Phase 2 and the archives are release assets now.

- [ ] **Step 3: Syntax-check both**

```bash
cd /mnt/c/Users/keega/Documents/KaapSpoor/tools/tiles && bash -n verify-layers.sh && echo "sh OK"
cd /c/Users/keega/Documents/KaapSpoor && node --check tools/tiles/report-size.mjs && echo "mjs OK"
```

- [ ] **Step 4: Commit**

```bash
git add tools/tiles/verify-layers.sh tools/tiles/report-size.mjs
git commit -m "build(tiles): verify and measure per region, and gate hillshade at 30 MB"
```

---

### Task 6: One shipped region in the app

**Files:**
- Create: `app/src/lib/map/region.ts`, `app/src/lib/map/region.test.ts`
- Modify: `app/src/lib/map/style.ts`, `app/src/lib/map/style.test.ts`, `app/src/lib/map/geojson.ts`, `app/src/lib/map/geojson.test.ts`

**Interfaces:**
- Produces: `SHIPPED_REGION` (`{ id, bbox }`), the single source of truth for both the archive URLs and the map's framing bounds.

Phase 3a added `BASEMAP_BOUNDS` to `geojson.ts` as a hand-written constant. It and the tile URLs describe the same region, so they become one thing — a divergence between them would frame the map on terrain that is not there.

- [ ] **Step 1: Write the failing tests**

`app/src/lib/map/region.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { SHIPPED_REGION } from './region';

describe('SHIPPED_REGION', () => {
  it('is the Cape Town region', () => {
    expect(SHIPPED_REGION.id).toBe('cape-town');
  });

  it('matches the bbox tools/tiles/regions.json builds', () => {
    // Derived from the 133 Table Mountain and peninsula routes plus a ~6 km
    // margin. If these drift apart, the map frames terrain that was never built.
    expect(SHIPPED_REGION.bbox).toEqual({
      west: 18.27,
      south: -34.33,
      east: 18.51,
      north: -33.89
    });
  });

  it('contains Table Mountain and excludes the West Coast', () => {
    const { west, south, east, north } = SHIPPED_REGION.bbox;
    const inside = (lon: number, lat: number) =>
      lon >= west && lon <= east && lat >= south && lat <= north;
    expect(inside(18.4028, -33.9575)).toBe(true); // Maclear's Beacon
    expect(inside(18.4302, -33.4915)).toBe(false); // Koeberg, 26 km north
  });
});
```

Add to `app/src/lib/map/style.test.ts`, inside the `buildStyle(selfhosted)` describe:

```typescript
  it('points at the shipped region archives', () => {
    const json = JSON.stringify(style.sources);
    expect(json).toContain('pmtiles:///KaapSpoor/tiles/trails-cape-town.pmtiles');
    expect(json).toContain('pmtiles:///KaapSpoor/tiles/contours-cape-town.pmtiles');
  });
```

Add to `app/src/lib/map/geojson.test.ts`:

```typescript
import { SHIPPED_REGION } from './region';

it('frames on the shipped region rather than a second hand-written box', () => {
  // One region, one source of truth: a divergence here frames the map on
  // terrain the pipeline never built.
  expect(BASEMAP_BOUNDS).toBe(SHIPPED_REGION.bbox);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd /c/Users/keega/Documents/KaapSpoor/app && npx vitest run src/lib/map/`
Expected: FAIL — `./region` does not exist.

- [ ] **Step 3: Write region.ts**

```typescript
/**
 * The region this build ships.
 *
 * Each region is a standalone map, not a tile of a continuous surface — see
 * tools/tiles/regions.json, which builds the archives named here. The app has
 * no region picker; adding one is a later phase.
 */
export interface Region {
  id: string;
  bbox: { west: number; south: number; east: number; north: number };
}

export const SHIPPED_REGION: Region = {
  id: 'cape-town',
  // Must equal the `cape-town` entry in tools/tiles/regions.json. It is the
  // extent of the 133 Table Mountain and peninsula routes plus a ~6 km margin.
  bbox: { west: 18.27, south: -34.33, east: 18.51, north: -33.89 }
};
```

- [ ] **Step 4: Point style.ts and geojson.ts at it**

In `style.ts`, import `SHIPPED_REGION` and interpolate its id into both source URLs:

```typescript
        url: `pmtiles://${base}/tiles/trails-${SHIPPED_REGION.id}.pmtiles`,
```

```typescript
        url: `pmtiles://${base}/tiles/contours-${SHIPPED_REGION.id}.pmtiles`,
```

In `geojson.ts`, replace the hand-written `BASEMAP_BOUNDS` object with a re-export of the region's bbox, keeping the existing comment about why out-of-region routes must not frame the map:

```typescript
export const BASEMAP_BOUNDS = SHIPPED_REGION.bbox;
```

- [ ] **Step 5: Run the tests and the type check**

Run: `cd /c/Users/keega/Documents/KaapSpoor/app && npm test && npm run check`
Expected: PASS, 0 type errors. Report observed counts.

The Phase 3a e2e asserts the opening zoom is above 7; with a region this tight it will be far higher. **If that assertion now fails, it is the test being stale, not the app** — widen it to a sensible band and say so in your report.

- [ ] **Step 6: Commit**

```bash
git add app/src/lib/map/
git commit -m "feat(app): ship one named region, and derive the map bounds from it"
```

---

### Task 7: Build it, measure it, publish it

**Files:** none — this is the machine-time task. Its outputs are archives and numbers.

**This task runs in WSL and takes a while.** The DEM cells are already cached from earlier builds; planetiler and tippecanoe are the slow parts.

- [ ] **Step 1: Build all three archives**

```bash
cd /mnt/c/Users/keega/Documents/KaapSpoor/tools/tiles
./build-trails.sh cape-town
./build-contours.sh cape-town
./build-hillshade.sh cape-town
```

Each ends by running `verify-layers.sh`, which must pass. `trails-cape-town.pmtiles` must report layers `paths roads water peaks landcover places` — if `landcover` or `places` is missing, planetiler fell back to its bundled profile and the schema argument is in the wrong position.

- [ ] **Step 2: Measure, and apply the gate**

```bash
cd /c/Users/keega/Documents/KaapSpoor && node tools/tiles/report-size.mjs
```

Record all three sizes. **If hillshade exceeds 30 MB**, halve the source resolution before shading and measure again:

```bash
gdal_translate -outsize 50% 50% "$WORK/work/dem-cape-town.tif" "$WORK/work/dem-cape-town-half.tif"
```

then point `build-hillshade.sh` at that file for the rebuild. Downsampling the DEM is the reliable lever — the MBTiles driver derives its top zoom from the raster's resolution, so there is no creation option to cap it directly. If it still exceeds the gate after halving, report that and stop rather than publishing it.

- [ ] **Step 3: Publish the release**

```bash
cd /c/Users/keega/Documents/KaapSpoor
gh release create tiles-cape-town-v1 \
  --title "Cape Town tiles v1" \
  --notes "Table Mountain + peninsula region (18.27,-34.33,18.51,-33.89). Vector: trails (paths, roads, water, peaks, landcover, places) and contours (20 m, z10-14). Raster: hillshade." \
  app/static/tiles/trails-cape-town.pmtiles \
  app/static/tiles/contours-cape-town.pmtiles \
  app/static/tiles/hillshade-cape-town.pmtiles
```

Omit the hillshade asset if it failed the gate.

- [ ] **Step 4: Report**

Record in your report: the three measured sizes, the layers `verify-layers.sh` found, the DEM cell count the contour build reported, and whether hillshade passed the gate. **Do not commit anything in this task** — the archives are gitignored.

---

### Task 8: CI downloads the region's archives

**Files:**
- Modify: `.github/workflows/deploy.yml`
- Modify: `tools/tiles/README.md`

**Interfaces:**
- Consumes: the release published in Task 7 and its measured sizes.

- [ ] **Step 1: Update the fetch step**

In the `Fetch map tiles and fonts` step, change `TILES_TAG` to `tiles-cape-town-v1` and replace the three size-floor assertions with ones derived from **Task 7's measured numbers**, each set to roughly 70% of what was measured — low enough not to be brittle, high enough to catch a truncated download:

```bash
          test "$(stat -c%s static/tiles/trails-cape-town.pmtiles)"   -gt <70% of measured>
          test "$(stat -c%s static/tiles/contours-cape-town.pmtiles)" -gt <70% of measured>
```

Keep the glyph-count assertion unchanged. Add a hillshade floor only if it shipped.

The comment above those assertions explains *why* presence is not validity; keep it and update the numbers it refers to.

- [ ] **Step 2: Update the runbook**

In `tools/tiles/README.md`, replace the bbox description with the region workflow: how to build a region, that `regions.json` is the single source of truth, that the `pmtiles` CLI is a new prerequisite for hillshade, and that adding a region is an entry plus a build run rather than a code change.

- [ ] **Step 3: Verify the workflow parses**

```bash
cd /c/Users/keega/Documents/KaapSpoor && python3 -c "import yaml; d=yaml.safe_load(open('.github/workflows/deploy.yml')); print('jobs:', list(d['jobs'])); print('deploy needs:', d['jobs']['deploy']['needs'])"
```

Expected: `jobs: ['build', 'geocode', 'deploy']`, `deploy needs: ['build', 'geocode']`.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/deploy.yml tools/tiles/README.md
git commit -m "ci: fetch the Cape Town region archives and check their measured floors"
```

---

## Definition of done

- `tools/tiles/regions.json` is the single source of the region's extent, and `app/src/lib/map/region.ts` agrees with it — enforced by a test.
- `./build-trails.sh cape-town` and `./build-contours.sh cape-town` produce archives that `verify-layers.sh cape-town` passes, with `landcover` and `places` present.
- Hillshade is either built and under 30 MB, or explicitly reported as over the gate and not shipped.
- `node tools/tiles/report-size.mjs` reports every region's archives and exits non-zero on a missing required archive or a failed gate.
- `cd app && npm test && npm run check` pass.
- CI fetches the new release and its floors reflect measured sizes.

## What this plan deliberately does not do

- **No styling.** Landcover and places are in the archives and drawn by nothing. 4b styles them, blends the hillshade and re-tunes the Phase 3a zoom thresholds for a map a sixtieth the previous size.
- **No region picker**, and no second region. The pipeline takes a parameter; the app ships one value.
- **No route data changes.** Which routes exist, where they are, and how well their position is known are all untouched.
- **No deploy.** Pushing is a separate decision; the site keeps serving the old archives until the style points at the new ones, which happens in 4b.
