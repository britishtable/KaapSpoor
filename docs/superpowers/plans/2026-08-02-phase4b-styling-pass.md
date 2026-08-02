# Phase 4b — The Styling Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Cape Town map look like a map — colour from landcover, shape from hillshade, orientation from town names, and peak labels that actually appear.

**Architecture:** Almost everything is `app/src/lib/map/style.ts`. Phase 4a put `landcover`, `places` and a `hillshade` archive into the tiles; nothing draws them. This plan adds those layers and re-tiers the ones whose thresholds were chosen for a province-wide map and are wrong for a peninsula.

**Tech Stack:** MapLibre GL style expressions · SvelteKit 2 · Vitest (style shape) · Playwright (rendered-feature invariants).

## The measurements this plan is built on

Taken from the deployed map at its real opening view (z10.32) by querying the shipped tiles directly. **These are counts of what is actually in the archive**, not estimates:

| source layer | in view at z10.32 | rendered today |
|---|---|---|
| `landcover` | 669 | **0** — nothing styles it |
| `places` | 245 | **0** — nothing styles it |
| `peaks` | 84 (77 named) | **0** — see below |
| `roads` | 17,939 | 647 (major only) |
| `paths` | 0 | 0 (archive `min_zoom: 11`) |

**Peak elevations, named peaks in view:**

| band | count | examples |
|---|---|---|
| ≥1500 m | **0** | — |
| 1000–1499 | 4 | Table Mountain 1086, Fountain Peak 1051, Fernwood 1003, Devil's Peak 1000.5 |
| 700–999 | 13 | Waaikoppie 933, Constantiaberg 928, Junction Peak 919 |
| 400–699 | 31 | Lion's Head 669, Karbonkelberg 653 |
| <400 | 29 | The Sentinel 331 |

**Places by type:** city 1, town 7, village 6, **suburb 231**.

**Landcover by type:** vineyard 296, scrub 184, wood 50, heath 44, beach 32, grassland 20, forest 17, orchard 17, sand 7, bare_rock 2.

## What the data changes about the plan

- **`peaks-headline` (`ele >= 1500`) renders nothing in this region and never will.** Its threshold was set when the map spanned the Cederberg. The peninsula's highest point is Maclear's Beacon at 1086 m. Re-tier or the overview stays label-free.
- **`suburb` is 231 of 245 places.** City, town and village together are 14 — exactly the right density for overview orientation. Suburbs must be held back hard or they bury everything.
- **`orchard` is not dead weight** — 17 features. An earlier review guessed it would be zero here and suggested pruning it; the measurement says keep it.
- **`vineyard` is the largest landcover class at 296.** A palette that treats it as an afterthought will look wrong for the Cape.

**The other Phase 3a thresholds were checked against the same measurements and stand.** The spec asks for a general re-tune; the data says only the peaks need it:

| layer | minzoom | at the z10.3 opening view | verdict |
|---|---|---|---|
| `roads-major` | none | 647 render | right — the orienting layer |
| `roads-minor` | 11 | 0 | right — 17,939 available, would swamp |
| `contours-index` | 10 | 139 | right — gives the peninsula its shape |
| `contours-intermediate` | 13 | 0 | right |
| `paths` | 12 | 0 (archive `min_zoom: 11`) | right |

Only the peak tiers were wrong, and wrong by construction rather than by degree. Task 6 revisits `contours-index`'s *weight* — not its zoom — because it will now sit on coloured fills rather than cream.

## Global Constraints

- **Base path:** every asset and link URL goes through `base` from `$app/paths`.
- **TypeScript strict; no `any`.** The style object is typed `StyleSpecification`; a malformed expression is a compile error, not a runtime surprise. Fix the expression, never cast.
- **Attribution is a licence obligation.** `AttributionControl` and the `attribution` fields on every source stay. The hillshade source needs its own — it is Copernicus DEM derived.
- **Contours only, no hillshade *replacing* them.** Hillshade goes underneath; the 20 m contours remain the primary relief cue.
- **`ele` on peaks is a raw OSM string**, sometimes unconvertible — always `['to-number', ['get','ele'], 0]`. Contour `ele` is numeric from `gdal_contour` and uses `%` directly. Do not unify them.
- **Archive zoom ranges are fixed:** contours z10–14, hillshade **z9–13**, planetiler layers to z14. A style `minzoom` below an archive's floor renders nothing; above its ceiling the tiles overzoom.
- **`app/src/lib/map/region.ts` is the single source of the shipped region** and a test enforces it against `tools/tiles/regions.json`. Nothing here may hard-code a second copy of the region id or bbox.
- MapLibre behaviour is tested in Playwright only — jsdom has no WebGL.

## File structure

```
app/src/lib/map/style.ts        # MODIFY — all layer work
app/src/lib/map/style.test.ts   # MODIFY — shape and threshold assertions
app/e2e/map.spec.ts             # MODIFY — rendered-feature invariants
```

---

### Task 1: Hillshade beneath everything

**Files:** Modify `app/src/lib/map/style.ts`, `app/src/lib/map/style.test.ts`

**Interfaces:** Produces a `hillshade` **raster** source and a `hillshade` layer, first in the layer list after `background`.

The archive is `hillshade-<region>.pmtiles`, PNG tiles, **z9–13**. It is a plain pre-rendered raster, not a `raster-dem` — MapLibre does no shading computation, so there is no `hillshade-*` paint property to set. It is styled with `raster-opacity`.

- [ ] **Step 1: Write the failing tests**

Append to the `zoom scoping` describe in `app/src/lib/map/style.test.ts`:

```typescript
  it('declares hillshade as a raster source at the archive zoom range', () => {
    const src = style.sources.hillshade as {
      type: string; url?: string; minzoom?: number; maxzoom?: number; attribution?: string;
    };
    expect(src.type).toBe('raster');
    expect(src.url).toContain('hillshade-cape-town.pmtiles');
    // The archive is built z9-13. Declaring the range lets MapLibre overzoom
    // rather than request tiles that do not exist.
    expect(src.minzoom).toBe(9);
    expect(src.maxzoom).toBe(13);
    expect(src.attribution).toContain('Copernicus');
  });

  it('draws hillshade underneath the terrain it shades', () => {
    const ids = style.layers.map((l) => l.id);
    expect(ids).toContain('hillshade');
    // Under contours and water, above only the background: shading is a
    // backdrop, not a layer competing with the lines that carry the detail.
    expect(ids.indexOf('hillshade')).toBe(1);
    expect(ids.indexOf('hillshade')).toBeLessThan(ids.indexOf('contours-index'));
    expect(ids.indexOf('hillshade')).toBeLessThan(ids.indexOf('water'));
  });

  it('keeps hillshade subtle enough that contours stay primary', () => {
    const layer = style.layers.find((l) => l.id === 'hillshade') as {
      paint?: Record<string, unknown>;
    };
    const opacity = layer.paint?.['raster-opacity'] as number;
    expect(opacity).toBeGreaterThan(0);
    expect(opacity).toBeLessThanOrEqual(0.35);
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd /c/Users/keega/Documents/KaapSpoor/app && npx vitest run src/lib/map/style.test.ts`
Expected: FAIL — `style.sources.hillshade` is undefined.

- [ ] **Step 3: Add the source and layer**

In `selfHosted()`, add to `sources` alongside `trails` and `contours`:

```typescript
      hillshade: {
        type: 'raster',
        url: `pmtiles://${base}/tiles/hillshade-${SHIPPED_REGION.id}.pmtiles`,
        tileSize: 256,
        // Built z9-13 by tools/tiles/build-hillshade.sh. Declaring the range
        // makes MapLibre overzoom past 13 instead of requesting absent tiles.
        minzoom: 9,
        maxzoom: 13,
        attribution: ATTRIBUTION_SELF
      }
```

and as the **second** layer, immediately after `background`:

```typescript
      {
        // A backdrop, not a feature layer: it gives the mountain its shape at a
        // glance while the 20 m contours stay the thing you actually read
        // elevation from. Kept low-opacity for that reason — at full strength it
        // muddies both the contours and the landcover fills above it.
        id: 'hillshade',
        type: 'raster',
        source: 'hillshade',
        paint: { 'raster-opacity': 0.25 }
      },
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd /c/Users/keega/Documents/KaapSpoor/app && npx vitest run src/lib/map/style.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/map/style.ts app/src/lib/map/style.test.ts
git commit -m "feat(app): draw the hillshade archive beneath the contours"
```

---

### Task 2: Landcover colour

**Files:** Modify `app/src/lib/map/style.ts`, `app/src/lib/map/style.test.ts`

**Interfaces:** Produces a `landcover` fill layer above `hillshade` and below `water`.

This is where the map stops being cream and brown. The palette is grouped by what the classes *mean* on the ground rather than by OSM tag, so fynbos reads as one thing whether OSM called it `scrub` or `heath`.

- [ ] **Step 1: Write the failing tests**

```typescript
  it('fills landcover between the hillshade and the water', () => {
    const ids = style.layers.map((l) => l.id);
    expect(ids).toContain('landcover');
    expect(ids.indexOf('landcover')).toBeGreaterThan(ids.indexOf('hillshade'));
    expect(ids.indexOf('landcover')).toBeLessThan(ids.indexOf('water'));
  });

  it('colours every landcover class present in the region', () => {
    // Measured in the shipped archive at the opening view: vineyard 296,
    // scrub 184, wood 50, heath 44, beach 32, grassland 20, forest 17,
    // orchard 17, sand 7, bare_rock 2. A class with no case falls through to
    // the default and silently reads as bare ground.
    const layer = style.layers.find((l) => l.id === 'landcover') as {
      paint?: Record<string, unknown>;
    };
    const json = JSON.stringify(layer.paint?.['fill-color']);
    for (const cls of [
      'vineyard', 'scrub', 'wood', 'heath', 'beach',
      'grassland', 'forest', 'orchard', 'sand', 'bare_rock'
    ]) {
      expect(json).toContain(cls);
    }
  });

  it('groups fynbos so scrub and heath read as one thing', () => {
    const layer = style.layers.find((l) => l.id === 'landcover') as {
      paint?: Record<string, unknown>;
    };
    const expr = JSON.stringify(layer.paint?.['fill-color']);
    // Both OSM tags describe the same vegetation on this peninsula; a reader
    // should not see two different greens for it.
    const scrubColour = expr.match(/"scrub","heath"[^"]*"(#[0-9a-f]{6})"/i);
    expect(scrubColour).not.toBeNull();
  });
```

- [ ] **Step 2: Run to verify they fail**

Expected: FAIL — no `landcover` layer.

- [ ] **Step 3: Add the layer**

Immediately after `hillshade`:

```typescript
      {
        // Grouped by what it is on the ground, not by which OSM tag was used:
        // scrub and heath are both fynbos here and must read as one cover type.
        // Vineyard is the single largest class in this region (296 polygons),
        // so it gets a colour of its own rather than being lumped with woodland.
        id: 'landcover',
        type: 'fill',
        source: 'trails',
        'source-layer': 'landcover',
        paint: {
          'fill-color': [
            'match',
            ['coalesce', ['get', 'natural'], ['get', 'landuse']],
            ['scrub', 'heath'], '#c8d2b0',
            ['wood', 'forest'], '#b3c49a',
            ['vineyard', 'orchard'], '#d8d9a8',
            ['grassland'], '#d5dcb8',
            ['beach', 'sand'], '#ece2c8',
            ['bare_rock'], '#dcd6cc',
            '#e8e3d6'
          ],
          // Low enough that the hillshade beneath still shapes the terrain.
          'fill-opacity': 0.55
        }
      },
```

- [ ] **Step 4: Run to verify they pass, then the full suite**

Run: `cd /c/Users/keega/Documents/KaapSpoor/app && npx vitest run src/lib/map/style.test.ts && npm test && npm run check`
Report observed counts and the type-error count.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/map/style.ts app/src/lib/map/style.test.ts
git commit -m "feat(app): colour the map from landcover, grouped by ground cover"
```

---

### Task 3: Place labels, and holding suburbs back

**Files:** Modify `app/src/lib/map/style.ts`, `app/src/lib/map/style.test.ts`

**Interfaces:** Produces `places-settlement` and `places-suburb` symbol layers, above every fill and line layer.

This is the layer that finally orients the overview — Phase 3a proved peak labels cannot, because route cluster badges correctly win the symbol collision against them.

**The density split is the whole point.** City, town and village together are **14** features; suburb alone is **231**. They cannot share a layer.

- [ ] **Step 1: Write the failing tests**

```typescript
  it('labels settlements from the overview and suburbs only close in', () => {
    const settlement = style.layers.find((l) => l.id === 'places-settlement') as {
      minzoom?: number; filter?: unknown;
    };
    const suburb = style.layers.find((l) => l.id === 'places-suburb') as {
      minzoom?: number; filter?: unknown;
    };
    // The map opens near z10.3. City/town/village is 14 features in region —
    // the right density to orient by. Suburb is 231 and would bury everything.
    expect(settlement.minzoom).toBeLessThanOrEqual(10);
    expect(suburb.minzoom).toBeGreaterThanOrEqual(13);
  });

  it('splits places so the two tiers cannot both draw the same feature', () => {
    const settlement = style.layers.find((l) => l.id === 'places-settlement') as {
      filter?: unknown;
    };
    const suburb = style.layers.find((l) => l.id === 'places-suburb') as {
      filter?: unknown;
    };
    expect(JSON.stringify(settlement.filter)).toContain('city');
    expect(JSON.stringify(settlement.filter)).toContain('town');
    expect(JSON.stringify(settlement.filter)).toContain('village');
    expect(JSON.stringify(suburb.filter)).toContain('suburb');
    expect(JSON.stringify(settlement.filter)).not.toContain('suburb');
  });

  it('ranks settlements so a city outranks a village in a collision', () => {
    const settlement = style.layers.find((l) => l.id === 'places-settlement') as {
      layout?: Record<string, unknown>;
    };
    expect(settlement.layout?.['symbol-sort-key']).toBeDefined();
  });

  it('draws place labels above the lines they sit on', () => {
    const ids = style.layers.map((l) => l.id);
    expect(ids.indexOf('places-settlement')).toBeGreaterThan(ids.indexOf('roads-major'));
    expect(ids.indexOf('places-settlement')).toBeGreaterThan(ids.indexOf('contours-index'));
  });
```

- [ ] **Step 2: Run to verify they fail**

- [ ] **Step 3: Add both layers**

At the **end** of the layer list, after the peak layers:

```typescript
      {
        // 14 features in this region against suburb's 231 — the density that
        // makes an overview readable. This is what orients the map; peak labels
        // cannot, because route cluster badges outrank them in symbol collision.
        id: 'places-settlement',
        type: 'symbol',
        source: 'trails',
        'source-layer': 'places',
        filter: ['match', ['get', 'place'], ['city', 'town', 'village'], true, false],
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Open Sans Regular'],
          'text-size': [
            'interpolate', ['linear'], ['zoom'],
            9, ['match', ['get', 'place'], 'city', 14, 'town', 11, 9],
            14, ['match', ['get', 'place'], 'city', 20, 'town', 16, 13]
          ],
          // Lower wins a collision, so rank city above town above village.
          'symbol-sort-key': ['match', ['get', 'place'], 'city', 0, 'town', 1, 2],
          'text-padding': 6
        },
        paint: {
          'text-color': '#4a4a4a',
          'text-halo-color': '#f4f1ea',
          'text-halo-width': 1.6
        }
      },
      {
        // 231 features. Useful once you are looking for a trailhead in a
        // particular suburb, overwhelming at any zoom before that.
        id: 'places-suburb',
        type: 'symbol',
        source: 'trails',
        'source-layer': 'places',
        minzoom: 13,
        filter: ['==', ['get', 'place'], 'suburb'],
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Open Sans Regular'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 13, 10, 16, 12],
          'text-padding': 4
        },
        paint: {
          'text-color': '#6b6b6b',
          'text-halo-color': '#f4f1ea',
          'text-halo-width': 1.4
        }
      }
```

Give `places-settlement` no `minzoom` — it should draw wherever the map opens.

- [ ] **Step 4: Run tests, then commit**

```bash
git add app/src/lib/map/style.ts app/src/lib/map/style.test.ts
git commit -m "feat(app): label settlements from the overview, suburbs only close in"
```

---

### Task 4: Re-tier the peaks for a peninsula

**Files:** Modify `app/src/lib/map/style.ts`, `app/src/lib/map/style.test.ts`

**Interfaces:** Keeps the ids `peaks-headline`, `peaks-major`, `peaks-minor`; changes only their thresholds and zooms.

`peaks-headline` currently filters `ele >= 1500` and so renders **nothing** — the region's highest point is 1086 m. The thresholds were set for a map that spanned the Cederberg.

**New tiers, from the measured distribution:**

| tier | filter | minzoom | count in region |
|---|---|---|---|
| `peaks-headline` | `ele >= 1000` | 10 | **4** |
| `peaks-major` | `600 <= ele < 1000` | 12 | ~18 |
| `peaks-minor` | `ele < 600` | 14 | ~55 |

Four labels at the overview is the right density beside 14 settlement labels. Lion's Head at 669 m lands in `major` and appears at z12, which is where you are looking at one mountain rather than the whole peninsula.

- [ ] **Step 1: Update the threshold tests**

Replace the existing peak partition tests with:

```typescript
  it('tiers peaks for a peninsula whose highest point is 1086 m', () => {
    // Measured in region: 0 peaks >= 1500 (the old headline threshold, which
    // rendered nothing), 4 in 1000-1499, 13 in 700-999, 31 in 400-699.
    const ele = ['to-number', ['get', 'ele'], 0];
    expect(layer('peaks-headline')?.filter).toEqual(['>=', ele, 1000]);
    expect(layer('peaks-major')?.filter).toEqual([
      'all', ['>=', ele, 600], ['<', ele, 1000]
    ]);
    expect(layer('peaks-minor')?.filter).toEqual(['<', ele, 600]);
  });

  it('shows the four highest summits where the map opens', () => {
    // The map opens near z10.3; a headline minzoom above that would leave the
    // opening view without a single peak name, which is what it had before.
    expect(layer('peaks-headline')?.minzoom).toBeLessThanOrEqual(10);
    expect(layer('peaks-major')?.minzoom).toBe(12);
    expect(layer('peaks-minor')?.minzoom).toBe(14);
  });

  it('still partitions every peak into exactly one tier', () => {
    const h = layer('peaks-headline')?.filter as unknown[];
    const mj = layer('peaks-major')?.filter as unknown[];
    const mn = layer('peaks-minor')?.filter as unknown[];
    // headline >= 1000; major [600,1000); minor < 600 — exhaustive and
    // non-overlapping, including a peak whose ele is missing (scores 0).
    expect(h[0]).toBe('>=');
    expect(h[2]).toBe(1000);
    expect(mj[0]).toBe('all');
    expect(mn[0]).toBe('<');
    expect(mn[2]).toBe(600);
  });
```

- [ ] **Step 2: Run to verify they fail**

- [ ] **Step 3: Apply the new thresholds**

Change `peaks-headline`'s filter to `['>=', ele, 1000]` and its `minzoom` to `10`; `peaks-major`'s filter to `['all', ['>=', ele, 600], ['<', ele, 1000]]` and `minzoom` to `12`; `peaks-minor`'s filter to `['<', ele, 600]` and `minzoom` to `14`. Update each layer's comment to say why the threshold is what it is — the old comments describe a province.

Leave `symbol-sort-key` and the halo paint alone.

- [ ] **Step 4: Run tests, then commit**

```bash
git add app/src/lib/map/style.ts app/src/lib/map/style.test.ts
git commit -m "feat(app): re-tier peak labels for a peninsula, not a province"
```

---

### Task 5: e2e invariants for the styled map

**Files:** Modify `app/e2e/map.spec.ts`

The existing "not buried" test asserts the opening view is not a carpet. It now needs to assert the opposite too: that the things this plan added actually draw.

- [ ] **Step 1: Extend the opening-view test**

In the `countsAt` helper's returned object, add `landcover`, `placesSettlement`, `placesSuburb`, `peaksHeadline` and `hillshade` using the existing `of()` helper (which returns `-1` for an absent layer).

Then, in the opening-view block, add:

```typescript
    // Phase 4b: the opening view must now show what it was given. These were
    // all in the archive and drawn by nothing before this plan.
    expect(overview.landcover).toBeGreaterThan(0);
    expect(overview.placesSettlement).toBeGreaterThan(0);
    expect(overview.peaksHeadline).toBeGreaterThan(0);
    // Suburbs are 231 features against 14 settlements — they must NOT be here.
    expect(overview.placesSuburb).toBe(0);
    // Absent layers return -1; a rename must fail loudly, not silently pass.
    for (const v of [overview.landcover, overview.placesSettlement, overview.peaksHeadline]) {
      expect(v).not.toBe(-1);
    }
```

Raster layers are not returned by `queryRenderedFeatures`, so **do not** assert a count for `hillshade` — assert its presence in the style instead:

```typescript
    const hasHillshade = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="map"]') as HTMLElement & {
        __maplibreMap?: import('maplibre-gl').Map;
      };
      return !!el.__maplibreMap!.getLayer('hillshade');
    });
    expect(hasHillshade).toBe(true);
```

And in the close-in block at z13, assert suburbs have arrived: `expect(closeIn.placesSuburb).toBeGreaterThan(0);`

- [ ] **Step 2: Run the full e2e**

Run: `cd /c/Users/keega/Documents/KaapSpoor/app && npm run test:e2e`

This needs the archives in `app/static/tiles/`. They should be the three `*-cape-town.pmtiles` files from Phase 4a; if absent, fetch them:
`gh release download tiles-cape-town-v1 --pattern '*.pmtiles' --dir static/tiles`

Expected: all specs pass at both base paths. Report the observed counts and the observed opening zoom the spec logs.

- [ ] **Step 3: Commit**

```bash
git add app/e2e/map.spec.ts
git commit -m "test(app): assert the styled layers actually draw at the opening view"
```

---

### Task 6: Look at it

**Files:** none — verification.

Phase 3a's lesson stands: rendered-feature counts can pass while the map is unreadable, and can be measured at the wrong camera entirely. Colour and shading are the least testable thing in this project.

**Read this first, or lose an hour:** a MapLibre map in a **hidden/backgrounded tab never loads its style**, because `Style.loadJSON` awaits a `requestAnimationFrame` that a hidden tab never fires. Check `document.visibilityState` before diagnosing anything. Ask the human partner to bring the browser window to the front rather than fighting it.

- [ ] **Step 1: Serve the built site**

```bash
cd /c/Users/keega/Documents/KaapSpoor/app && npm run build && npm run preview -- --port 4174
```

- [ ] **Step 2: Capture four views**

The opening view; z12 over Table Mountain; z14 over the Twelve Apostles; and one over Constantia, where the vineyards are.

- [ ] **Step 3: Judge against what this plan claims**

- Does landcover read as terrain rather than as flat blocks of colour, and is fynbos distinguishable from vineyard and from woodland?
- Does the hillshade give shape without muddying the contours? Is 0.25 opacity right?
- At the opening view: are the four headline peaks and the settlement names both legible, or do they collide with each other and with the route clusters?
- At z14, does the hillshade look acceptable overzoomed past its z13 ceiling?
- Do the contours still read against the coloured fills, or does `contours-index` need more weight now that it is no longer on cream?

- [ ] **Step 4: Record the verdict**

If a value is wrong, that is a real finding — the palette, the opacity and the thresholds are reasoned, not measured. Adjust, re-run `npx vitest run src/lib/map/style.test.ts` and `npm run test:e2e`, and commit the adjustment separately so the reasoning stays visible.

---

## Definition of done

- `cd app && npm test && npm run check` pass with 0 type errors.
- `npm run test:e2e` passes at both base paths.
- At the opening view: landcover, settlement labels and headline peaks all render more than 0; suburbs render 0.
- A human has looked at four zooms and said it reads well.
- Attribution still names OpenStreetMap and the Copernicus DEM.

## What this plan deliberately does not do

- **No tile rebuild.** Everything drawn here is already in the archives Phase 4a published.
- **No second region** and no region picker.
- **No provenance rendering** — hollow pins and uncertainty circles for the 41 `area-approx` routes, and lifting the gate in `transform.ts`, remain Phase 4c.
- **No route geometry.** Highlighting a route's shape is Phase 4d.
