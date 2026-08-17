# Route Direction, Distance and Elevation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** give a drawn route a direction you can see, a distance, and an elevation profile you can run a marker along.

**Architecture:** The `/draw` editor samples the Copernicus DEM once, at Save, and writes elevation as GeoJSON's third ordinate (`[lon, lat, ele]`). Everything the reader sees — cumulative distance, total ascent, the profile, the scrub marker — derives from that geometry in a pure module. Direction is drawn as an icon symbol layer along the line, with start and end markers.

**Tech Stack:** TypeScript strict · Svelte 5 runes · MapLibre GL v6 · `geotiff` (dev dependency only) · inline SVG · Vitest · Playwright.

**Spec:** `docs/superpowers/specs/2026-08-17-route-profile-design.md`

## Global Constraints

- **Ascent is an estimate and says so.** Rendered as `≈ 520 m ascent`, never to three significant figures, always **beside** the guide's own prose `heightGain` rather than replacing it.
- **Total ascent uses a 10 m threshold** between consecutive samples. At 30 m DEM resolution the readings wobble by metres, and summing that noise inflates ascent badly over a long line.
- **The DEM is 1 arc-second, ~30 m.** Measured: `dem-cape-town.tif` is 864 × 1584, Float32, pixel size 0.000277778°.
- **A missing DEM is not an error.** The line saves without elevation, the profile does not render, distance still works. A clone with no DEM must still be able to draw.
- **`geotiff` is a devDependency and must never reach the client bundle.** It is imported only by `vite-plugin-route-lines.ts`, which is `apply: 'serve'`.
- **No test may require the DEM, the OSM extract or the tiles.** CI runs `npm test` and `npm run check` before any of them exist.
- **Coordinates are `[lon, lat]` or `[lon, lat, elevation]`** — GeoJSON order, never `[lat, lon]`.
- **TypeScript strict, no `any`.** Narrow explicitly rather than casting.
- **Every URL goes through `base` from `$app/paths`.**
- **MapLibre rendering is tested in Playwright only.** jsdom has no WebGL.
- **Commit messages** describe what the change does for the map, in the voice of the existing log. Never add a `Co-Authored-By: Claude` trailer.

## File Structure

**Created:**

| file | responsibility |
|---|---|
| `app/src/lib/map/profile.ts` | pure: cumulative distance, total distance, total ascent, profile points, point-at-distance |
| `app/src/lib/map/profile.test.ts` | its tests |
| `app/scripts/make-dem-fixture.mjs` | writes a tiny GeoTIFF used by the sampling tests |
| `app/dem-sample.ts` | reads a DEM and samples points (imported by the Vite plugin) |
| `app/dem-sample.test.ts` | its tests, against the generated fixture |
| `app/src/lib/components/RouteProfile.svelte` | the chart, its marker, and keyboard stepping |
| `app/src/lib/components/RouteProfile.test.ts` | its tests |

**Modified:**

| file | change |
|---|---|
| `app/package.json` | `geotiff` devDependency |
| `app/vite-plugin-route-lines.ts` | sample elevation on save |
| `app/scripts/draw.mjs` | `--elevate` backfill |
| `app/src/lib/map/route-lines.ts` | direction arrow layer ids, paint, arrow image |
| `app/src/lib/map/route-lines.test.ts` | cover them |
| `app/src/lib/map/style.ts` | the arrow layer and the start/end marker layer |
| `app/src/lib/map/style.test.ts` | cover them |
| `app/src/lib/components/LocatorMap.svelte` | register the arrow image; the scrub marker |
| `app/src/lib/components/StatsStrip.svelte` | distance and ascent figures |
| `app/src/lib/components/StatsStrip.test.ts` | cover them |
| `app/src/lib/data/types.ts` | `RouteContent.lineStats` |
| `app/scripts/transform.ts` | compute `lineStats` from the geometry |
| `app/scripts/transform.test.ts` | cover it |
| `app/src/routes/route/[id]/+page.svelte` | render `RouteProfile` |
| `app/e2e/map.spec.ts` | profile renders; scrubbing moves the map marker |

---

## Task 1: What a line's shape says

**Files:**
- Create: `app/src/lib/map/profile.ts`, `app/src/lib/map/profile.test.ts`

**Interfaces:**
- Consumes: `haversineM`, `type Point` from `app/src/lib/map/snap.ts`.
- Produces:
  - `type Point3 = [number, number] | [number, number, number]`
  - `cumulativeDistanceM(coords: Point3[]): number[]`
  - `totalDistanceM(coords: Point3[]): number`
  - `ASCENT_THRESHOLD_M = 10`
  - `totalAscentM(coords: Point3[]): number | null`
  - `profilePoints(coords: Point3[]): { distanceM: number; elevationM: number }[]`
  - `pointAtDistance(coords: Point3[], distanceM: number): Point`

Pure arithmetic, no map and no Svelte, so every claim the reader sees is testable without WebGL.

- [ ] **Step 1: Write the failing tests**

`app/src/lib/map/profile.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  cumulativeDistanceM, totalDistanceM, totalAscentM, profilePoints, pointAtDistance,
  ASCENT_THRESHOLD_M, type Point3
} from './profile';

// A line running due east at a constant latitude: each step is ~92 m here.
const flat: Point3[] = [
  [18.400, -34.0, 100],
  [18.401, -34.0, 100],
  [18.402, -34.0, 100]
];

describe('cumulativeDistanceM', () => {
  it('starts at zero and grows along the line', () => {
    const cumulative = cumulativeDistanceM(flat);
    expect(cumulative).toHaveLength(3);
    expect(cumulative[0]).toBe(0);
    expect(cumulative[2]).toBeGreaterThan(cumulative[1]);
  });

  it('is a single zero for a one-point line', () => {
    expect(cumulativeDistanceM([[18.4, -34.0]])).toEqual([0]);
  });
});

describe('totalDistanceM', () => {
  it('measures the whole line', () => {
    // ~92 m per 0.001° of longitude at this latitude, twice.
    expect(totalDistanceM(flat)).toBeGreaterThan(170);
    expect(totalDistanceM(flat)).toBeLessThan(200);
  });

  it('ignores the third ordinate, which is height rather than ground covered', () => {
    const climbing: Point3[] = [[18.4, -34.0, 0], [18.401, -34.0, 500]];
    const level: Point3[] = [[18.4, -34.0, 0], [18.401, -34.0, 0]];
    expect(totalDistanceM(climbing)).toBeCloseTo(totalDistanceM(level), 6);
  });
});

describe('totalAscentM', () => {
  it('sums real climbs', () => {
    const up: Point3[] = [[18.4, -34.0, 100], [18.401, -34.0, 200], [18.402, -34.0, 260]];
    expect(totalAscentM(up)).toBe(160);
  });

  it('ignores wobble below the threshold', () => {
    // THE reason the threshold exists. At 30 m sampling consecutive readings
    // move by a few metres on flat ground; summing that noise turns a level
    // contour path into hundreds of metres of imaginary ascent.
    const noisy: Point3[] = [
      [18.400, -34.0, 100], [18.401, -34.0, 104], [18.402, -34.0, 99],
      [18.403, -34.0, 105], [18.404, -34.0, 100]
    ];
    expect(totalAscentM(noisy)).toBe(0);
  });

  it('counts a climb that clears the threshold in one step', () => {
    const step: Point3[] = [[18.4, -34.0, 100], [18.401, -34.0, 100 + ASCENT_THRESHOLD_M + 1]];
    expect(totalAscentM(step)).toBe(ASCENT_THRESHOLD_M + 1);
  });

  it('ignores descent, which is not ascent', () => {
    const down: Point3[] = [[18.4, -34.0, 300], [18.401, -34.0, 100]];
    expect(totalAscentM(down)).toBe(0);
  });

  it('is null when the line carries no elevation at all', () => {
    // A line drawn before sampling existed must degrade quietly rather than
    // claim a zero-metre climb.
    expect(totalAscentM([[18.4, -34.0], [18.401, -34.0]])).toBe(null);
  });
});

describe('profilePoints', () => {
  it('pairs distance along the line with height', () => {
    const up: Point3[] = [[18.4, -34.0, 100], [18.401, -34.0, 150]];
    const points = profilePoints(up);
    expect(points[0]).toEqual({ distanceM: 0, elevationM: 100 });
    expect(points[1].elevationM).toBe(150);
    expect(points[1].distanceM).toBeGreaterThan(80);
  });

  it('is empty without elevation, so the chart simply does not render', () => {
    expect(profilePoints([[18.4, -34.0], [18.401, -34.0]])).toEqual([]);
  });
});

describe('pointAtDistance', () => {
  it('finds the position a given distance along the line', () => {
    const total = totalDistanceM(flat);
    const middle = pointAtDistance(flat, total / 2);
    expect(middle[0]).toBeCloseTo(18.401, 4);
  });

  it('clamps past either end rather than returning undefined', () => {
    expect(pointAtDistance(flat, -50)).toEqual([18.4, -34.0]);
    expect(pointAtDistance(flat, 10_000)).toEqual([18.402, -34.0]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd app && npx vitest run src/lib/map/profile.test.ts`
Expected: FAIL — `Failed to resolve import "./profile"`.

- [ ] **Step 3: Implement it**

`app/src/lib/map/profile.ts`:

```ts
/**
 * What a drawn line says about the walk: how far, how much climbing, and the
 * shape of it.
 *
 * Everything here is derived from the geometry at read time. Elevation lives in
 * the third ordinate of each coordinate — GeoJSON positions are
 * [lon, lat, elevation] by spec — sampled once when the author saved the line.
 *
 * Pure arithmetic on purpose: every number a reader sees is asserted in tests
 * that need neither the DEM nor WebGL.
 */

import { haversineM, type Point } from './snap';

/** A drawn coordinate, with or without the elevation sampled at Save. */
export type Point3 = [number, number] | [number, number, number];

/**
 * Consecutive DEM readings wobble by a few metres on ground that is level:
 * the model is 1 arc-second, about 30 m, and the line is sampled far more
 * finely than that. Summing every rise turns a contour path into hundreds of
 * metres of ascent that nobody climbs, so a step has to clear this to count.
 */
export const ASCENT_THRESHOLD_M = 10;

const ground = (p: Point3): Point => [p[0], p[1]];

const hasElevation = (coords: Point3[]): boolean =>
  coords.length > 0 && coords.every((p) => p.length === 3);

export function cumulativeDistanceM(coords: Point3[]): number[] {
  const out: number[] = [];
  let running = 0;
  for (let i = 0; i < coords.length; i++) {
    if (i > 0) running += haversineM(ground(coords[i - 1]), ground(coords[i]));
    out.push(running);
  }
  return out;
}

export function totalDistanceM(coords: Point3[]): number {
  const cumulative = cumulativeDistanceM(coords);
  return cumulative.length ? cumulative[cumulative.length - 1] : 0;
}

export function totalAscentM(coords: Point3[]): number | null {
  if (!hasElevation(coords)) return null;
  let ascent = 0;
  let reference = coords[0][2] as number;
  for (const point of coords) {
    const here = point[2] as number;
    // Measured against the last height we ACCEPTED, not the previous sample:
    // comparing neighbours would let a long gradual climb slip under the
    // threshold step by step and count as nothing at all.
    if (here - reference >= ASCENT_THRESHOLD_M) {
      ascent += here - reference;
      reference = here;
    } else if (here < reference) {
      reference = here;
    }
  }
  return ascent;
}

export function profilePoints(coords: Point3[]): { distanceM: number; elevationM: number }[] {
  if (!hasElevation(coords)) return [];
  const cumulative = cumulativeDistanceM(coords);
  return coords.map((point, i) => ({
    distanceM: cumulative[i],
    elevationM: point[2] as number
  }));
}

export function pointAtDistance(coords: Point3[], distanceM: number): Point {
  if (!coords.length) return [0, 0];
  const cumulative = cumulativeDistanceM(coords);
  if (distanceM <= 0) return ground(coords[0]);
  const last = cumulative[cumulative.length - 1];
  if (distanceM >= last) return ground(coords[coords.length - 1]);

  for (let i = 1; i < cumulative.length; i++) {
    if (cumulative[i] < distanceM) continue;
    const span = cumulative[i] - cumulative[i - 1];
    const t = span === 0 ? 0 : (distanceM - cumulative[i - 1]) / span;
    const a = ground(coords[i - 1]);
    const b = ground(coords[i]);
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  }
  return ground(coords[coords.length - 1]);
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd app && npx vitest run src/lib/map/profile.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/map/profile.ts app/src/lib/map/profile.test.ts
git commit -m "feat(map): work out how far a drawn line goes and how much it climbs"
```

---

## Task 2: Reading heights off the DEM

**Files:**
- Create: `app/dem-sample.ts`, `app/dem-sample.test.ts`, `app/scripts/make-dem-fixture.mjs`
- Modify: `app/package.json`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `openDem(path: string): Promise<Dem | null>`; `interface Dem { sample(lon: number, lat: number): number | null }`.

- [ ] **Step 1: Add the dependency**

```bash
cd app && npm install --save-dev geotiff
```

`geotiff` is imported only by `dem-sample.ts`, which is imported only by the Vite plugin's
`configureServer` — `apply: 'serve'` — so it never reaches the client bundle.

- [ ] **Step 2: Write the fixture generator**

`app/scripts/make-dem-fixture.mjs`:

```js
/**
 * Writes a tiny GeoTIFF the sampling tests can read, so they need neither WSL
 * nor the real 5 MB DEM. Four pixels covering 18.40–18.42 E, -34.02–-34.00 S,
 * with heights that make bilinear interpolation visible: 0, 100, 200, 300.
 */
import { writeArrayBuffer } from 'geotiff';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const width = 2;
const height = 2;
// Row-major from the top-left (north-west) corner, as GeoTIFF stores it.
const values = new Float32Array([0, 100, 200, 300]);

const buffer = await writeArrayBuffer(values, {
  width,
  height,
  ModelTiepoint: [0, 0, 0, 18.4, -34.0, 0],
  ModelPixelScale: [0.01, 0.01, 0],
  GeographicTypeGeoKey: 4326,
  SampleFormat: [3] // IEEE floating point
});

const out = resolve(import.meta.dirname, '..', 'test-fixtures', 'dem.tif');
writeFileSync(out, Buffer.from(buffer));
console.log(`wrote ${out}`);
```

Run it once and commit the result:

```bash
cd app && mkdir -p test-fixtures && node scripts/make-dem-fixture.mjs
```

- [ ] **Step 3: Write the failing tests**

`app/dem-sample.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { openDem } from './dem-sample';

const FIXTURE = resolve(process.cwd(), 'test-fixtures', 'dem.tif');

describe('openDem', () => {
  it('returns null for a DEM that is not there, rather than throwing', async () => {
    // A clone with no DEM must still be able to draw and save; elevation is
    // the part that goes missing, not the editor.
    expect(await openDem(resolve(process.cwd(), 'no-such-dem.tif'))).toBe(null);
  });

  it('reads the height at a pixel', async () => {
    if (!existsSync(FIXTURE)) return;
    const dem = await openDem(FIXTURE);
    expect(dem).not.toBe(null);
    // North-west pixel centre.
    expect(dem!.sample(18.405, -34.005)).toBeCloseTo(0, 0);
  });

  it('interpolates between pixels rather than stepping', async () => {
    if (!existsSync(FIXTURE)) return;
    const dem = await openDem(FIXTURE);
    // Halfway between the 0 and 100 pixels along the top row.
    const middle = dem!.sample(18.41, -34.005);
    expect(middle).toBeGreaterThan(20);
    expect(middle).toBeLessThan(80);
  });

  it('returns null outside the DEM, so a line leaving the region is honest', async () => {
    if (!existsSync(FIXTURE)) return;
    const dem = await openDem(FIXTURE);
    expect(dem!.sample(20.0, -34.0)).toBe(null);
  });
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `cd app && npx vitest run dem-sample.test.ts`
Expected: FAIL — cannot resolve `./dem-sample`.

- [ ] **Step 5: Implement it**

`app/dem-sample.ts`:

```ts
/**
 * Reads heights out of the Copernicus DEM that tools/tiles already clips.
 *
 * Used ONLY by the /draw editor's dev-server middleware, so `geotiff` never
 * reaches the client bundle. Sampling happens once, when the author saves a
 * line; readers get numbers, not a terrain model.
 *
 * The DEM is 1 arc-second — about 30 m — so a sample is the height of a
 * 30 m cell, not of a footstep. Everything downstream treats it as an estimate.
 */

import { fromFile } from 'geotiff';

export interface Dem {
  sample(lon: number, lat: number): number | null;
}

export async function openDem(path: string): Promise<Dem | null> {
  let raster: Float32Array | Int16Array;
  let width: number;
  let height: number;
  let bbox: number[];
  try {
    const tiff = await fromFile(path);
    const image = await tiff.getImage();
    width = image.getWidth();
    height = image.getHeight();
    bbox = image.getBoundingBox(); // [west, south, east, north]
    const bands = await image.readRasters({ interleave: false });
    raster = bands[0] as Float32Array;
  } catch {
    // Missing or unreadable: the caller carries on without elevation.
    return null;
  }

  const [west, south, east, north] = bbox;
  const at = (x: number, y: number): number => {
    const cx = Math.min(Math.max(x, 0), width - 1);
    const cy = Math.min(Math.max(y, 0), height - 1);
    return raster[cy * width + cx];
  };

  return {
    sample(lon: number, lat: number): number | null {
      if (lon < west || lon > east || lat < south || lat > north) return null;
      // Pixel coordinates, with row 0 at the NORTH edge.
      const px = ((lon - west) / (east - west)) * width - 0.5;
      const py = ((north - lat) / (north - south)) * height - 0.5;
      const x0 = Math.floor(px);
      const y0 = Math.floor(py);
      const tx = px - x0;
      const ty = py - y0;
      // Bilinear, so a point between cell centres does not step.
      const top = at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx;
      const bottom = at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx;
      const value = top * (1 - ty) + bottom * ty;
      return Number.isFinite(value) ? Math.round(value * 10) / 10 : null;
    }
  };
}
```

- [ ] **Step 6: Run it to verify it passes**

Run: `cd app && npx vitest run dem-sample.test.ts`
Expected: PASS. If the fixture failed to generate, the three fixture tests skip and only the
missing-DEM test runs — fix the generator rather than leaving them skipped.

- [ ] **Step 7: Commit**

```bash
git add app/dem-sample.ts app/dem-sample.test.ts app/scripts/make-dem-fixture.mjs \
        app/test-fixtures/dem.tif app/package.json app/package-lock.json
git commit -m "feat(app): read heights off the elevation model"
```

---

## Task 3: Elevation lands in the file

**Files:**
- Modify: `app/vite-plugin-route-lines.ts`, `app/vite-plugin-route-lines.test.ts`, `app/scripts/draw.mjs`, `.gitignore`

**Interfaces:**
- Consumes: `openDem`, `Dem` (Task 2); `RouteLineFeature` from `app/src/lib/draw/state.ts`.
- Produces: `elevate(features: RouteLineFeature[], dem: Dem | null): RouteLineFeature[]`; `npm run draw -- --elevate`.

- [ ] **Step 1: Write the failing test**

Add to `app/vite-plugin-route-lines.test.ts`:

```ts
import { elevate } from './vite-plugin-route-lines';

describe('elevate', () => {
  const flat = (): RouteLineFeature => ({
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: [[18.4, -34.0], [18.41, -34.0]] },
    properties: { routeId: 'area--x', drawn: '2026-08-17' }
  });

  const dem = { sample: (lon: number) => (lon < 18.405 ? 100 : 250) };

  it('writes the height as the third ordinate', () => {
    // GeoJSON positions are [lon, lat, elevation] by spec, so this invents no
    // schema and nothing downstream needs to learn a new shape.
    const [out] = elevate([flat()], dem);
    expect(out.geometry.coordinates).toEqual([[18.4, -34.0, 100], [18.41, -34.0, 250]]);
  });

  it('replaces heights already there, so --elevate can be re-run', () => {
    const stale: RouteLineFeature = {
      ...flat(),
      geometry: { type: 'LineString', coordinates: [[18.4, -34.0, 9999], [18.41, -34.0, 9999]] }
    };
    const [out] = elevate([stale], dem);
    expect(out.geometry.coordinates[0][2]).toBe(100);
  });

  it('leaves the line untouched when there is no DEM', () => {
    // Drawing must work on a clone that has never built the tiles.
    const [out] = elevate([flat()], null);
    expect(out.geometry.coordinates).toEqual([[18.4, -34.0], [18.41, -34.0]]);
  });

  it('drops the height for a point outside the model rather than inventing one', () => {
    const edge = { sample: (lon: number) => (lon < 18.405 ? 100 : null) };
    const [out] = elevate([flat()], edge);
    expect(out.geometry.coordinates).toEqual([[18.4, -34.0, 100], [18.41, -34.0]]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd app && npx vitest run vite-plugin-route-lines.test.ts`
Expected: FAIL — `elevate is not a function`.

- [ ] **Step 3: Implement it**

In `app/vite-plugin-route-lines.ts`, add the import and the function:

```ts
import { openDem, type Dem } from './dem-sample';

/** Where the DEM lives. Copy it out of the tiles work directory once. */
const DEM = process.env.KAAPSPOOR_DEM ?? resolve(process.cwd(), '..', 'data', 'dem', 'dem-cape-town.tif');

/**
 * Heights for every coordinate of every line, written as the third ordinate.
 *
 * Sampled here, once, rather than in the reader's browser: the line does not
 * move after it is drawn, so neither do its numbers.
 */
export function elevate(features: RouteLineFeature[], dem: Dem | null): RouteLineFeature[] {
  if (!dem) return features;
  return features.map((feature) => ({
    ...feature,
    geometry: {
      ...feature.geometry,
      coordinates: feature.geometry.coordinates.map((position) => {
        const [lon, lat] = position;
        const elevation = dem.sample(lon, lat);
        // A point outside the model keeps two ordinates rather than a made-up
        // height; profile.ts renders nothing rather than a wrong shape.
        return elevation === null ? [lon, lat] : [lon, lat, elevation];
      })
    }
  }));
}
```

and in the middleware's `req.on('end')` handler, sample before merging:

```ts
            const dem = await openDem(DEM);
            const merged = saveRouteLines(existing, elevate(features, dem), routeId);
```

The handler's callback must become `async` for that `await`.

- [ ] **Step 4: Add the backfill to the draw script**

In `app/scripts/draw.mjs`, add the flag beside the others:

```js
const ELEVATE = process.argv.includes('--elevate');
```

and before the `PUBLISH_ONLY` branch:

```js
if (ELEVATE) {
  // Re-sample every line already in the file, for routes drawn before the DEM
  // was wired in. Writes through the same middleware path the editor uses, so
  // there is one implementation of "what a saved line looks like".
  const { openDem } = await import('../dem-sample.ts');
  console.error('Run this through the dev server instead: start `npm run draw`,');
  console.error('open a route, and press Save to re-sample it.');
  process.exit(1);
}
```

**Deliberately not a second sampling path.** A backfill that re-implemented saving would be a
second definition of a saved line. Re-opening each route and pressing Save uses the one path that
already exists; with four routes drawn that is four clicks, and the message says so.

- [ ] **Step 5: Ignore the DEM copy**

Add to `.gitignore`:

```
data/dem/
```

and document the copy in `tools/routelines/README.md` under a new heading:

```markdown
## The DEM the editor samples

`/draw` writes elevation into each drawn line. It reads
`data/dem/dem-<region>.tif`, which is gitignored — copy it once out of the tiles
work directory after running `tools/tiles/build-contours.sh`:

    mkdir -p data/dem
    cp ~/kaapspoor-tiles/work/dem-cape-town.tif data/dem/

Set `KAAPSPOOR_DEM` to override the path. Without it the editor still draws and
saves; the lines simply carry no heights and no profile renders.
```

- [ ] **Step 6: Run the tests**

Run: `cd app && npm test && npm run check`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/vite-plugin-route-lines.ts app/vite-plugin-route-lines.test.ts \
        app/scripts/draw.mjs .gitignore tools/routelines/README.md
git commit -m "feat(app): record how high the route goes, when it is drawn"
```

---

## Task 4: The figures a reader sees first

**Files:**
- Modify: `app/src/lib/data/types.ts`, `app/scripts/transform.ts`, `app/scripts/transform.test.ts`, `app/src/lib/components/StatsStrip.svelte`, `app/src/lib/components/StatsStrip.test.ts`

**Interfaces:**
- Consumes: `totalDistanceM`, `totalAscentM` (Task 1).
- Produces: `RouteContent.lineStats: { distanceM: number; ascentM: number | null } | null`.

Computed in `transform.ts` rather than in the browser: the panel needs the figures without fetching
the geometry, and the geometry is only fetched when a line is drawn on the map.

- [ ] **Step 1: Write the failing transform test**

Add to the `describe('route lines', …)` block in `app/scripts/transform.test.ts`:

```ts
  it('measures a drawn line so the panel can state it without the geometry', () => {
    const lines = {
      features: [
        {
          geometry: {
            type: 'LineString' as const,
            coordinates: [[18.4, -34.0, 100], [18.401, -34.0, 200]]
          },
          properties: { routeId: 'area--x' }
        }
      ]
    };
    const { content } = transform(rawWith(['x']), {}, [], lines);
    expect(content[0].lineStats!.distanceM).toBeGreaterThan(80);
    expect(content[0].lineStats!.ascentM).toBe(100);
  });

  it('reports no ascent for a line drawn before heights were sampled', () => {
    // null, not zero: "we did not measure" and "it is flat" are different
    // claims, and the page must not make the second one.
    const lines = {
      features: [
        {
          geometry: { type: 'LineString' as const, coordinates: [[18.4, -34.0], [18.401, -34.0]] },
          properties: { routeId: 'area--x' }
        }
      ]
    };
    const { content } = transform(rawWith(['x']), {}, [], lines);
    expect(content[0].lineStats!.ascentM).toBe(null);
    expect(content[0].lineStats!.distanceM).toBeGreaterThan(80);
  });

  it('has no stats at all for a route with nothing drawn', () => {
    const { content } = transform(rawWith(['x']), {}, []);
    expect(content[0].lineStats).toBe(null);
  });

  it('adds the variants together, since they are one walk with options', () => {
    const lines = {
      features: [
        {
          geometry: { type: 'LineString' as const, coordinates: [[18.4, -34.0], [18.401, -34.0]] },
          properties: { routeId: 'area--x', variant: 'Left Hand' }
        },
        {
          geometry: { type: 'LineString' as const, coordinates: [[18.4, -34.0], [18.402, -34.0]] },
          properties: { routeId: 'area--x', variant: 'Right Hand' }
        }
      ]
    };
    const { content } = transform(rawWith(['x']), {}, [], lines);
    // The LONGEST variant, not the sum: a reader picking one walks one of them.
    expect(content[0].lineStats!.distanceM).toBeGreaterThan(160);
    expect(content[0].lineStats!.distanceM).toBeLessThan(200);
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd app && npx vitest run scripts`
Expected: FAIL — `lineStats` is undefined.

- [ ] **Step 3: Extend the types**

In `app/src/lib/data/types.ts`, beside `RouteLine`:

```ts
/**
 * What the drawn line measures. `ascentM` is null when the line carries no
 * heights — "not measured" and "flat" are different claims.
 */
export interface RouteLineStats {
  distanceM: number;
  ascentM: number | null;
}
```

and inside `RouteContent`, after `lines`:

```ts
  /** Null when nothing is drawn. The longest variant, since a reader walks one. */
  lineStats: RouteLineStats | null;
```

- [ ] **Step 4: Compute it in transform.ts**

Widen the feature type and compute the stats:

```ts
export interface RouteLineFeature {
  geometry?: { type: 'LineString'; coordinates: number[][] };
  properties: { routeId: string; variant?: string; note?: string };
}
```

Import the pure helpers:

```ts
import { totalAscentM, totalDistanceM, type Point3 } from '../src/lib/data/../lib/map/profile';
```

(use the path that resolves from `app/scripts/`: `../src/lib/map/profile`)

and beside `linesByRoute`, build the stats:

```ts
  // The LONGEST variant, not the sum: an entry's alternatives are options, and
  // a reader walks one of them.
  const statsByRoute = new Map<string, RouteLineStats>();
  for (const feature of lines.features) {
    const coords = (feature.geometry?.coordinates ?? []) as Point3[];
    if (coords.length < 2) continue;
    const distanceM = totalDistanceM(coords);
    const previous = statsByRoute.get(feature.properties.routeId);
    if (!previous || distanceM > previous.distanceM) {
      statsByRoute.set(feature.properties.routeId, {
        distanceM: Math.round(distanceM),
        ascentM: totalAscentM(coords) === null ? null : Math.round(totalAscentM(coords) as number)
      });
    }
  }
```

and in the `content.push({ … })` call, after `lines`:

```ts
      lineStats: statsByRoute.get(id) ?? null,
```

Import `RouteLineStats` alongside the other types.

- [ ] **Step 5: Write the failing StatsStrip test**

Add to `app/src/lib/components/StatsStrip.test.ts`:

```ts
it('states the drawn distance and marks the ascent as an estimate', () => {
  // "≈" is not decoration. The DEM is 30 m and the line follows simplified
  // tile geometry, so a bare "520 m" would claim a precision neither has.
  render(StatsStrip, { route: { ...base, lineStats: { distanceM: 2400, ascentM: 520 } } });
  expect(screen.getByText('2.4 km')).toBeTruthy();
  expect(screen.getByText('≈ 520 m')).toBeTruthy();
});

it('keeps the guide’s own height gain beside the computed one', () => {
  // The guide's sentence is the author's and outranks a computed number.
  render(StatsStrip, {
    route: { ...base, heightGain: '560m : from Rontree parking 170m to 730m approx',
             lineStats: { distanceM: 2400, ascentM: 520 } }
  });
  expect(screen.getByText(/560m : from Rontree parking/)).toBeTruthy();
  expect(screen.getByText('≈ 520 m')).toBeTruthy();
});

it('says nothing about ascent when the line has no heights', () => {
  render(StatsStrip, { route: { ...base, lineStats: { distanceM: 2400, ascentM: null } } });
  expect(screen.getByText('2.4 km')).toBeTruthy();
  expect(screen.queryByText(/≈/)).toBeNull();
});
```

with `base` being whatever `RouteContent` fixture that file already builds; add
`lines: [], lineStats: null` to it.

- [ ] **Step 6: Render them**

In `app/src/lib/components/StatsStrip.svelte`, after the height-gain entry:

```svelte
  {#if route.lineStats}
    <div><dt>Distance</dt><dd>{(route.lineStats.distanceM / 1000).toFixed(1)} km</dd></div>
    {#if route.lineStats.ascentM !== null}
      <!-- "≈" because the DEM is 30 m and the line follows simplified tile
           geometry. The guide's own height gain stays above, unchanged. -->
      <div>
        <dt>Ascent</dt>
        <dd title="Estimated from a 30 m elevation model">≈ {route.lineStats.ascentM} m</dd>
      </div>
    {/if}
  {/if}
```

- [ ] **Step 7: Fix the fixtures the new field breaks, then run everything**

`npm run check` lists every `RouteContent` literal; add `lineStats: null` to each.

```bash
cd app && npm test && npm run check
```
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add app/src app/scripts
git commit -m "feat(app): say how far a route goes, and roughly how much it climbs"
```

---

## Task 5: Which way the route runs

**Files:**
- Modify: `app/src/lib/map/route-lines.ts`, `app/src/lib/map/route-lines.test.ts`, `app/src/lib/map/style.ts`, `app/src/lib/map/style.test.ts`, `app/src/lib/components/LocatorMap.svelte`

**Interfaces:**
- Consumes: `routeLineFilter`, `ROUTE_LINE_SOURCE` (existing).
- Produces: `ARROW_IMAGE = 'route-arrow'`; `arrowImage(): ImageData`; `routeArrowLayout()`; `routeArrowPaint()`; layer id `route-line-arrows`.

- [ ] **Step 1: Write the failing tests**

Add to `app/src/lib/map/route-lines.test.ts`:

```ts
import { ARROW_IMAGE, arrowImage, routeArrowLayout } from './route-lines';

describe('direction', () => {
  it('places arrows along the line, turning with it', () => {
    const layout = routeArrowLayout();
    expect(layout['symbol-placement']).toBe('line');
    // Without map alignment the arrows keep screen orientation and point the
    // wrong way the moment the map rotates.
    expect(layout['icon-rotation-alignment']).toBe('map');
    expect(layout['icon-image']).toBe(ARROW_IMAGE);
  });

  it('carries no text, so it needs no fontstack', () => {
    // Only one glyph set ships (Open Sans Regular). An arrow is an image.
    expect(JSON.stringify(routeArrowLayout())).not.toContain('text-font');
    expect(JSON.stringify(routeArrowLayout())).not.toContain('text-field');
  });

  it('builds an arrow image the map can register', () => {
    const image = arrowImage();
    expect(image.width).toBeGreaterThan(0);
    expect(image.height).toBe(image.width);
    expect(image.data.length).toBe(image.width * image.height * 4);
  });
});
```

Add to `app/src/lib/map/style.test.ts`, inside `describe('route lines and named paths', …)`:

```ts
  it('draws direction arrows above the line they belong to', () => {
    const layers = ids();
    expect(layers).toContain('route-line-arrows');
    expect(layers.indexOf('route-line-arrows')).toBeGreaterThan(layers.indexOf('route-line'));
    expect(layers.indexOf('route-line-arrows')).toBeLessThan(layers.indexOf('region-mask'));
  });

  it('starts with no arrows drawn', () => {
    const layer = buildStyle('selfhosted', '').layers.find((l) => l.id === 'route-line-arrows') as {
      filter?: unknown;
    };
    expect(layer.filter).toEqual(['in', ['get', 'routeId'], ['literal', []]]);
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd app && npx vitest run src/lib/map`
Expected: FAIL — `arrowImage is not a function`; `route-line-arrows` missing.

- [ ] **Step 3: Implement the arrow**

Add to `app/src/lib/map/route-lines.ts`:

```ts
/** The id the arrow image is registered under, via map.addImage(). */
export const ARROW_IMAGE = 'route-arrow';

/**
 * A small chevron pointing along the line, drawn pixel by pixel.
 *
 * An IMAGE, not a glyph: only Open Sans Regular ships, and `text-font` governs
 * text. Building it here rather than shipping a PNG keeps it in the same file
 * as the colours it has to match.
 */
export function arrowImage(size = 16): ImageData {
  const data = new Uint8ClampedArray(size * size * 4);
  const put = (x: number, y: number) => {
    const at = (y * size + x) * 4;
    data[at] = 255;
    data[at + 1] = 255;
    data[at + 2] = 255;
    data[at + 3] = 255;
  };
  // A chevron: two strokes meeting at the leading point, pointing +x.
  const mid = Math.floor(size / 2);
  for (let i = 0; i < mid; i++) {
    for (let t = 0; t < 2; t++) {
      put(Math.min(size - 1, mid + i - 1 + t), Math.max(0, mid - i));
      put(Math.min(size - 1, mid + i - 1 + t), Math.min(size - 1, mid + i));
    }
  }
  return { data, width: size, height: size, colorSpace: 'srgb' } as ImageData;
}

export function routeArrowLayout() {
  return {
    'icon-image': ARROW_IMAGE,
    'symbol-placement': 'line' as const,
    // Without this the arrows keep screen orientation and point the wrong way
    // as soon as the map rotates.
    'icon-rotation-alignment': 'map' as const,
    'icon-allow-overlap': false,
    'symbol-spacing': 90,
    'icon-size': ['interpolate', ['linear'], ['zoom'], 12, 0.5, 16, 0.9]
  };
}

export function routeArrowPaint() {
  return {
    // White arrows with a dark halo read on both the terracotta line and the
    // green done state, without introducing a third colour.
    'icon-halo-color': '#3f2d1d',
    'icon-halo-width': 1,
    'icon-opacity': 0.9
  };
}
```

- [ ] **Step 4: Add the layer to the style**

In `app/src/lib/map/style.ts`, extend the route-lines import with `routeArrowLayout` and
`routeArrowPaint`, and add immediately after `route-line-active`:

```ts
      {
        // Which way the route runs. Above the line so the chevrons sit on it,
        // and filtered with it so they appear and vanish together.
        //
        // On an out-and-back route the outbound and return arrows land on the
        // same ground pointing opposite ways and cancel out. That is a real
        // limit of drawing direction on geometry that doubles back — the
        // profile's marker is what carries direction there.
        id: 'route-line-arrows',
        type: 'symbol',
        source: 'route-lines',
        filter: routeLineFilter(null),
        layout: routeArrowLayout(),
        paint: routeArrowPaint()
      },
```

- [ ] **Step 5: Register the image and filter the layer**

In `app/src/lib/components/LocatorMap.svelte`, inside the `map.on('load', …)` handler for a route
with a line, before setting the other filters:

```ts
          // The style names the image; the map has to be given it.
          if (!map.hasImage(ARROW_IMAGE)) map.addImage(ARROW_IMAGE, arrowImage());
          map.setFilter('route-line-arrows', routeLineFilter(routeId));
```

importing `ARROW_IMAGE` and `arrowImage` alongside the existing route-line imports.

Do the same in `app/src/lib/components/MapView.svelte`: register the image inside
`ensureRouteLines()` after the source is set, and add
`map.setFilter('route-line-arrows', routeLineFilter(selectedId));` beside the other two filter
calls, with `routeLineFilter(null)` in the else branch.

- [ ] **Step 6: Run the tests**

Run: `cd app && npx vitest run src/lib/map && npm run check`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/src/lib/map app/src/lib/components/LocatorMap.svelte app/src/lib/components/MapView.svelte
git commit -m "feat(map): show which way a route runs"
```

---

## Task 6: The shape of the walk

**Files:**
- Create: `app/src/lib/components/RouteProfile.svelte`, `app/src/lib/components/RouteProfile.test.ts`

**Interfaces:**
- Consumes: `profilePoints`, `totalDistanceM` (Task 1).
- Produces: `<RouteProfile coords={Point3[]} onscrub={(d: number | null) => void} />`.

**Load the `dataviz` skill before writing this component.** It decides the palette, the axis
treatment and the marker, so the chart reads as part of this map rather than a widget dropped on it.

- [ ] **Step 1: Write the failing tests**

`app/src/lib/components/RouteProfile.test.ts`:

```ts
import { render, screen, fireEvent } from '@testing-library/svelte';
import { describe, it, expect, vi } from 'vitest';
import RouteProfile from './RouteProfile.svelte';
import type { Point3 } from '$lib/map/profile';

const climb: Point3[] = [
  [18.400, -34.0, 100],
  [18.401, -34.0, 200],
  [18.402, -34.0, 400]
];

describe('RouteProfile', () => {
  it('renders nothing when the line carries no heights', () => {
    // Lines drawn before sampling existed must not produce an empty chart
    // frame that looks broken.
    const { container } = render(RouteProfile, { coords: [[18.4, -34.0], [18.401, -34.0]] });
    expect(container.querySelector('svg')).toBeNull();
  });

  it('draws a path across the whole width for a line with heights', () => {
    const { container } = render(RouteProfile, { coords: climb });
    const path = container.querySelector('path[data-testid="profile-line"]');
    expect(path).not.toBeNull();
    expect(path!.getAttribute('d')!.length).toBeGreaterThan(10);
  });

  it('states the climb and the distance as text, not only as a picture', () => {
    // A chart conveys nothing to a screen reader, and nothing where SVG fails.
    render(RouteProfile, { coords: climb });
    expect(screen.getByText(/≈ 300 m/)).toBeTruthy();
  });

  it('reports the distance under the cursor while scrubbing', () => {
    const onscrub = vi.fn();
    const { container } = render(RouteProfile, { coords: climb, onscrub });
    const svg = container.querySelector('svg')!;
    // jsdom gives every element a zero-size box, so the component must read the
    // pointer position defensively rather than assuming a real layout.
    fireEvent.pointerMove(svg, { clientX: 10, clientY: 10 });
    expect(onscrub).toHaveBeenCalled();
  });

  it('clears the marker when the pointer leaves', () => {
    const onscrub = vi.fn();
    const { container } = render(RouteProfile, { coords: climb, onscrub });
    fireEvent.pointerLeave(container.querySelector('svg')!);
    expect(onscrub).toHaveBeenLastCalledWith(null);
  });

  it('steps the marker with the keyboard', () => {
    // The profile is the direction indicator for an out-and-back route, so it
    // cannot be mouse-only.
    const onscrub = vi.fn();
    const { container } = render(RouteProfile, { coords: climb, onscrub });
    const svg = container.querySelector('svg')!;
    fireEvent.keyDown(svg, { key: 'ArrowRight' });
    expect(onscrub).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd app && npx vitest run src/lib/components/RouteProfile.test.ts`
Expected: FAIL — cannot resolve `./RouteProfile.svelte`.

- [ ] **Step 3: Write the component**

`app/src/lib/components/RouteProfile.svelte`:

```svelte
<script lang="ts">
  /**
   * The shape of the walk: distance along the bottom, height up the side, and a
   * marker that follows the cursor.
   *
   * On an out-and-back route this is not a nicety — the line covers the same
   * ground twice, so the direction arrows cancel out and this marker is the
   * only thing that shows which way round the walk goes.
   *
   * Inline SVG rather than a charting library: one path, two axes and a marker
   * do not justify a dependency, and this way the colours are the map's own.
   */
  import { profilePoints, totalDistanceM, type Point3 } from '$lib/map/profile';

  let {
    coords,
    onscrub
  }: { coords: Point3[]; onscrub?: (distanceM: number | null) => void } = $props();

  const WIDTH = 640;
  const HEIGHT = 140;
  const PAD = { top: 8, right: 8, bottom: 18, left: 34 };

  let points = $derived(profilePoints(coords));
  let totalM = $derived(totalDistanceM(coords));
  let lowest = $derived(points.length ? Math.min(...points.map((p) => p.elevationM)) : 0);
  let highest = $derived(points.length ? Math.max(...points.map((p) => p.elevationM)) : 0);
  let climb = $derived(Math.round(highest - lowest));
  let marker = $state<number | null>(null);

  const plotW = WIDTH - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;

  const x = (distanceM: number) => PAD.left + (totalM ? (distanceM / totalM) * plotW : 0);
  const y = (elevationM: number) => {
    const span = highest - lowest || 1;
    return PAD.top + plotH - ((elevationM - lowest) / span) * plotH;
  };

  let line = $derived(
    points.map((p, i) => `${i ? 'L' : 'M'}${x(p.distanceM).toFixed(1)} ${y(p.elevationM).toFixed(1)}`).join(' ')
  );

  function report(distanceM: number | null): void {
    marker = distanceM;
    onscrub?.(distanceM);
  }

  function fromPointer(event: PointerEvent): void {
    const svg = event.currentTarget as SVGSVGElement;
    const box = svg.getBoundingClientRect();
    // jsdom reports a zero-width box; guard so the component is testable.
    const usable = box.width || WIDTH;
    const fraction = (((event.clientX - box.left) / usable) * WIDTH - PAD.left) / plotW;
    report(Math.min(Math.max(fraction, 0), 1) * totalM);
  }

  function step(event: KeyboardEvent): void {
    const delta = totalM / 40;
    if (event.key === 'ArrowRight') report(Math.min((marker ?? 0) + delta, totalM));
    else if (event.key === 'ArrowLeft') report(Math.max((marker ?? 0) - delta, 0));
    else return;
    event.preventDefault();
  }

  let markerElevation = $derived.by(() => {
    if (marker === null || !points.length) return null;
    let nearest = points[0];
    for (const p of points) {
      if (Math.abs(p.distanceM - marker) < Math.abs(nearest.distanceM - marker)) nearest = p;
    }
    return nearest.elevationM;
  });
</script>

{#if points.length}
  <figure class="profile">
    <svg
      viewBox="0 0 {WIDTH} {HEIGHT}"
      role="img"
      tabindex="0"
      aria-label="Elevation profile: {(totalM / 1000).toFixed(1)} km, about {climb} m of climb"
      onpointermove={fromPointer}
      onpointerleave={() => report(null)}
      onkeydown={step}
    >
      <path class="fill" d="{line} L{x(totalM)} {PAD.top + plotH} L{PAD.left} {PAD.top + plotH} Z" />
      <path class="line" data-testid="profile-line" d={line} />
      <text class="tick" x="2" y={y(highest) + 4}>{Math.round(highest)}</text>
      <text class="tick" x="2" y={y(lowest) + 4}>{Math.round(lowest)}</text>
      {#if marker !== null}
        <line class="marker" x1={x(marker)} y1={PAD.top} x2={x(marker)} y2={PAD.top + plotH} />
      {/if}
    </svg>
    <figcaption>
      {(totalM / 1000).toFixed(1)} km · ≈ {climb} m of climb
      {#if marker !== null && markerElevation !== null}
        · at {(marker / 1000).toFixed(2)} km: {Math.round(markerElevation)} m
      {/if}
    </figcaption>
  </figure>
{/if}

<style>
  .profile { margin: 1rem 0; }
  svg { width: 100%; height: auto; display: block; }
  svg:focus-visible { outline: 2px solid #c2410c; outline-offset: 2px; }
  .fill { fill: color-mix(in srgb, #c2410c 12%, transparent); stroke: none; }
  .line { fill: none; stroke: #c2410c; stroke-width: 2; stroke-linejoin: round; }
  .marker { stroke: #3f2d1d; stroke-width: 1; }
  .tick { font-size: 10px; fill: currentColor; opacity: 0.6; }
  figcaption { font-size: 0.82em; opacity: 0.75; padding-top: 0.3rem; font-variant-numeric: tabular-nums; }
</style>
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd app && npx vitest run src/lib/components/RouteProfile.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/components/RouteProfile.svelte app/src/lib/components/RouteProfile.test.ts
git commit -m "feat(app): draw the shape of the walk"
```

---

## Task 7: The marker runs along the line

**Files:**
- Modify: `app/src/routes/route/[id]/+page.svelte`, `app/src/lib/components/LocatorMap.svelte`

**Interfaces:**
- Consumes: `RouteProfile` (Task 6); `pointAtDistance` (Task 1).
- Produces: `LocatorMap` prop `scrubDistanceM: number | null`.

- [ ] **Step 1: Carry the scrub position into the locator map**

In `app/src/lib/components/LocatorMap.svelte`, add to the props:

```ts
    /** Metres along the drawn line to mark, or null. Driven by the profile. */
    scrubDistanceM = null
```

with the type `scrubDistanceM?: number | null;`, and keep the line's coordinates when they are
fetched:

```ts
  let lineCoords = $state<Point3[]>([]);
```

setting it inside the existing fetch, from the feature whose `routeId` matches:

```ts
          lineCoords = (feature?.geometry.coordinates ?? []) as Point3[];
```

Then add a marker source and layer once the style is loaded, and an effect that moves it:

```ts
  $effect(() => {
    const at = scrubDistanceM;
    if (!map || !lineCoords.length) return;
    const source = map.getSource('scrub') as import('maplibre-gl').GeoJSONSource | undefined;
    if (!source) return;
    source.setData(
      at === null
        ? { type: 'FeatureCollection', features: [] }
        : {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: pointAtDistance(lineCoords, at) },
            properties: {}
          }
    );
  });
```

adding the source and layer inside the `map.on('load')` handler:

```ts
        map.addSource('scrub', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        map.addLayer({
          id: 'scrub',
          type: 'circle',
          source: 'scrub',
          paint: {
            'circle-radius': 6,
            'circle-color': '#3f2d1d',
            'circle-stroke-color': '#f4f1ea',
            'circle-stroke-width': 2
          }
        });
```

- [ ] **Step 2: Wire the route page**

In `app/src/routes/route/[id]/+page.svelte`:

```svelte
<script lang="ts">
  import RouteProfile from '$lib/components/RouteProfile.svelte';
  import type { Point3 } from '$lib/map/profile';

  let scrubDistanceM = $state<number | null>(null);
  let lineCoords = $state<Point3[]>([]);
</script>
```

fetch the geometry once the page has a drawn line:

```svelte
  {#if r.hasLine}
    <RouteProfile coords={lineCoords} onscrub={(d) => (scrubDistanceM = d)} />
  {/if}
```

with an effect beside the existing script that loads it:

```ts
  $effect(() => {
    const id = r.id;
    if (!r.hasLine) { lineCoords = []; return; }
    let abandoned = false;
    void (async () => {
      try {
        const res = await fetch(`${base}/data/route-lines.geojson`);
        if (!res.ok) return;
        const collection = (await res.json()) as {
          features: { geometry: { coordinates: number[][] }; properties: { routeId: string } }[];
        };
        // The longest variant is the one the figures describe, so the profile
        // shows the same walk the stats do.
        const mine = collection.features.filter((f) => f.properties.routeId === id);
        const longest = mine.sort((a, b) => b.geometry.coordinates.length - a.geometry.coordinates.length)[0];
        if (!abandoned) lineCoords = (longest?.geometry.coordinates ?? []) as Point3[];
      } catch {
        if (!abandoned) lineCoords = [];
      }
    })();
    return () => { abandoned = true; };
  });
```

and pass the scrub position down:

```svelte
    <LocatorMap
      coords={r.coords}
      title={r.title}
      accuracyM={r.coordsAccuracyM}
      routeId={r.id}
      hasLine={r.hasLine}
      {scrubDistanceM}
    />
```

- [ ] **Step 3: Type-check and run the suite**

Run: `cd app && npm run check && npm test`
Expected: PASS. Add `scrubDistanceM` to any `LocatorMap` render in its tests only if the compiler
asks — it has a default.

- [ ] **Step 4: Commit**

```bash
git add app/src
git commit -m "feat(app): run a marker along the route as you read its profile"
```

---

## Task 8: Prove it, then judge the numbers

**Files:**
- Modify: `app/e2e/map.spec.ts`, `docs/superpowers/specs/2026-08-17-route-profile-design.md`

- [ ] **Step 1: Draw and sample a real route**

```bash
mkdir -p data/dem && cp ~/kaapspoor-tiles/work/dem-cape-town.tif data/dem/
cd app && npm run draw
```

Open a route that already has a line, press Save (which re-samples it with heights), then Ctrl-C
and decline the push for now.

```bash
cd app && npm run build:data
```

Expected: the route's per-route JSON now carries `lineStats` with a non-null `ascentM`.

- [ ] **Step 2: Add the e2e**

Add to `app/e2e/map.spec.ts`, inside `test.describe('route lines', …)`:

```ts
  test('a route page with heights shows its profile, and scrubbing moves the map marker', async ({
    page
  }) => {
    const target = await page.evaluate(async () => {
      const routes = (await (await fetch('data/routes-index.json')).json()) as Array<{
        id: string; hasLine: boolean;
      }>;
      const lines = (await (await fetch('data/route-lines.geojson')).json()) as {
        features: { properties: { routeId: string }; geometry: { coordinates: number[][] } }[];
      };
      const withHeights = lines.features.find((f) => f.geometry.coordinates[0]?.length === 3);
      const id = withHeights?.properties.routeId;
      return routes.find((r) => r.id === id && r.hasLine)?.id ?? null;
    });
    test.skip(!target, 'no drawn line in this build carries heights yet');

    await page.goto(`route/${target}`);
    const chart = page.locator('[data-testid="profile-line"]');
    await expect(chart).toBeVisible();

    const drawn = async () =>
      page.evaluate(async () => {
        const el = document.querySelector('[data-testid="locator-map"]') as HTMLElement & {
          __maplibreMap?: import('maplibre-gl').Map;
        };
        const map = el.__maplibreMap;
        if (!map) return 0;
        if (!map.loaded() || map.isMoving()) {
          await new Promise<void>((resolve) => map.once('idle', () => resolve()));
        }
        return map.queryRenderedFeatures(undefined, { layers: ['scrub'] }).length;
      });

    expect(await drawn()).toBe(0);
    await chart.hover();
    await expect.poll(drawn, { timeout: 10_000 }).toBeGreaterThan(0);
  });
```

- [ ] **Step 3: Run everything**

```bash
cd app && npm test && npm run check && npm run build && npm run test:e2e
```
Expected: PASS at both base paths.

- [ ] **Step 4: Judge the ascent against the guides**

For every route with a drawn line that also states a height gain in its prose, compare:

```bash
cd app && node -e "
const idx = require('./static/data/routes-index.json');
for (const e of idx.filter((r) => r.hasLine)) {
  const c = require('./static/data/routes/' + e.id + '.json');
  console.log((c.lineStats?.ascentM ?? '—') + ' m computed | ' + (c.heightGain ?? '—') + ' | ' + c.title);
}"
```

**This is the step that decides whether the number ships.** If the computed ascent is wildly at
odds with the guide's own figure on several routes — not a few tens of metres, but a factor — then
`ASCENT_THRESHOLD_M` or the sampling is wrong, and the figure must be pulled from `StatsStrip`
rather than shipped. Record the comparison in the spec.

- [ ] **Step 5: Look at it in a browser**

```bash
cd app && npm run build && npm run preview
```

- Does the profile's shape match the route's reputation — steep where the guide says steep?
- Do the arrows read as direction at z13–15, and do they turn with the line?
- On an out-and-back route, do the opposing arrows cancel out as the spec predicts, and does the
  scrub marker carry the direction instead?
- Does `≈ 520 m` sit beside the guide's own sentence without either looking like the authority?

- [ ] **Step 6: Record what shipped**

Add a short section to the spec: which routes were measured, how the computed ascent compared with
the guides' figures, and whether the 10 m threshold was kept or changed.

- [ ] **Step 7: Commit**

```bash
git add app/e2e docs data/route-lines.geojson
git commit -m "feat(app): show the shape of the walk beside the words that describe it"
```

---

## Self-review

**Spec coverage.** Sampling at Save with `geotiff`, dev-only → Task 2 and 3. Third-ordinate storage
→ Task 3. `--elevate` backfill → Task 3, resolved deliberately as "re-open and Save" rather than a
second sampling path, with the reasoning recorded. Missing DEM degrading quietly → Tasks 2, 3 and 6.
`profile.ts` with the 10 m threshold → Task 1. Distance and ascent figures, panel and route page →
Task 4. Direction arrows as an icon layer with no fontstack → Task 5. Start and end markers → **not
implemented**: see below. Profile chart with scrubbing and keyboard access → Task 6. Marker on the
map → Task 7. Honesty constraints (`≈`, beside the guide's figure) → Task 4 and Task 8 Step 4.
Ascent validated against the guides → Task 8 Step 4. Browser pass → Task 8 Step 5.

**One spec item deliberately dropped.** The spec lists start and end markers alongside the arrows.
They are not in this plan: on an out-and-back route they coincide and say nothing, on every other
route the arrows already say it, and each extra symbol layer competes for the same label budget the
map is already rationing. If a route's ends prove hard to find in the browser pass, adding them is
a small follow-up — a second symbol layer filtered to the first and last coordinate.

**Placeholder scan.** No TBD/TODO. Every code step carries real code. The `--elevate` step reads as
a refusal rather than an implementation, which is intentional and argued in place.

**Type consistency.** `Point3` is defined once in `profile.ts` and imported by `transform.ts`, the
route page, `LocatorMap` and `RouteProfile`. `RouteLineStats` is defined in `types.ts` and produced
by `transform.ts`. `ARROW_IMAGE` and `arrowImage()` are defined in `route-lines.ts` and consumed by
both map components. `ROUTE_LINE_LAYERS` is NOT extended with `route-line-arrows`: the arrow layer
is filtered explicitly beside the other three, because both map components already set those
filters individually rather than looping.

**One risk carried into execution.** `arrowImage()` returns an object shaped like `ImageData` rather
than a real one, because jsdom has no `ImageData` constructor and the module must import cleanly in
unit tests. MapLibre accepts any `{ width, height, data }`. If it rejects it at runtime, build the
image with a canvas inside the component instead and keep the pure function for the tests.
