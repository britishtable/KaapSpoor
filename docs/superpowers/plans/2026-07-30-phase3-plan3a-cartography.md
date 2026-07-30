# Phase 3 · Plan 3a — The Cartography Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the map legible at the zoom it opens at, so the route pins are the most prominent thing on it rather than the least.

**Architecture:** Every change is in `app/src/lib/map/style.ts` and `app/src/lib/components/MapView.svelte`. No new data, no tile rebuild, no new dependencies. Layers gain `minzoom` and zoom-interpolated widths and sizes so each one appears only where it carries information; two layers split in three so their coarse and fine halves can appear at different zooms.

**Tech Stack:** MapLibre GL style expressions · SvelteKit 2 / Svelte 5 · Vitest (style shape) · Playwright (rendered-feature invariants).

## Why this exists

A browser look at the deployed map on 2026-07-30 measured what the opening view (`fitBounds` over all located routes, z7.97) actually renders:

| layer | features |
|---|---|
| `paths` | 10,555 |
| `roads` | 5,180 |
| `peaks` | 188 labels |
| `contours` | 0 (correct — the archive is built z10–14) |
| `pins` + `pins-cluster` | 13 |

The pins — the entire point of the map — are 13 objects against ~15,700 lines and 188 labels. The cause is structural: **no layer in `style.ts` carries a `minzoom`, and no width, size or opacity is zoom-interpolated**, so every layer draws full strength at every zoom. Contours were wrongly blamed for the "brown mush" in an earlier reading; they render nothing at z8. It is `paths`.

Separately, cluster circles and done-pins are both `#4a6741`, so a green blob means either "several routes" or "done" with no way to tell.

## Scope

This is the **cartography half** of the spec's Plan 3, carved out because it depends on neither Plan 1 nor Plan 2 and delivers the visible win on its own.

**Out of scope, deliberately:**

- **`places-town` / `places-suburb` layers.** The spec wants them, but the shipped `trails.pmtiles` has no `places` source-layer — that arrives with Plan 2's `tiles-v2`. Adding the style layers now would reference a source-layer that does not exist.
- **Provenance rendering** — hollow pins for `area-approx`, uncertainty circles, route-page wording, and lifting the gate in `transform.ts`. That is Plan 3b, and it depends on Plan 1's fields (already shipped) rather than on anything here.
- Any change to the tile archives or the tile build.

## Global Constraints

- **Base path:** every asset and link URL goes through `base` from `$app/paths` — never a hard-coded `/`.
- **TypeScript strict; no `any`** — including no untyped `$props()`.
- **Attribution is a licence obligation.** `AttributionControl` and the `attribution` fields on both sources stay exactly as they are.
- **Contours only, no hillshade.** 20 m intervals, indexed 100 m lines.
- **Grades stay raw.** Nothing here touches grade.
- **MapLibre needs WebGL, which jsdom lacks.** Style *shape* is tested in Vitest; rendered *behaviour* only in Playwright.
- **Archive zoom ranges are fixed and must be respected:** `contours.pmtiles` is built z10–14 (`tools/tiles/build-contours.sh`), and the planetiler layers carry planetiler's defaults up to z14. A `minzoom` below an archive's own minimum renders nothing; a style that assumes data above z14 gets overzoomed tiles.
- **`ele` on peaks comes from the OSM tag and is a string** (`tools/tiles/profile/trails-profile.yml` passes `ele` through untouched). Any numeric comparison must use `['to-number', ['get', 'ele'], 0]` — the two-argument form, whose second argument is the fallback for values that will not convert. `ele` on *contours* is different: it is generated numerically by `gdal_contour` and the existing `['%', ['get', 'ele'], 100]` works on it directly.

## File structure

```
app/src/lib/map/style.ts              # MODIFY — all layer changes
app/src/lib/map/style.test.ts         # MODIFY — layer ids and minzoom contract
app/src/lib/components/MapView.svelte # MODIFY — cluster colour only
app/e2e/map.spec.ts                   # MODIFY — rendered-feature invariants
```

---

### Task 1: Split the contour layers so intermediates stop crowding mid zooms

**Files:**
- Modify: `app/src/lib/map/style.ts:62-73`
- Test: `app/src/lib/map/style.test.ts:58-66`

**Interfaces:**
- Consumes: nothing.
- Produces: layer ids `contours-index` and `contours-intermediate`, replacing `contours`. Task 5's e2e and the existing source-layer contract test both reference these ids.

Today one layer draws both the 100 m index lines and the 20 m intermediates at every zoom from 10 up, distinguished only by width. At z10–12 the intermediates are sub-pixel noise. Splitting them lets the index lines carry the mid zooms alone.

- [ ] **Step 1: Update the failing contract test**

In `app/src/lib/map/style.test.ts`, replace the `it.each` table at lines 58-66 with:

```typescript
  it.each([
    ['water', 'water'],
    ['contours-index', 'contours'],
    ['contours-intermediate', 'contours'],
    ['roads', 'roads'],
    ['paths', 'paths'],
    ['peaks', 'peaks']
  ])('layer %s reads source-layer %s', (id, sourceLayer) => {
    expect(layerFor(id)?.['source-layer']).toBe(sourceLayer);
  });
```

And add a new describe block at the end of the file:

```typescript
describe('zoom scoping', () => {
  const style = buildStyle('selfhosted', '');
  const layer = (id: string) => style.layers.find((l) => l.id === id);

  it('draws index contours from the archive’s own minimum zoom', () => {
    // contours.pmtiles is built z10-14; a lower minzoom would render nothing.
    expect(layer('contours-index')?.minzoom).toBe(10);
  });

  it('holds the 20 m intermediates back until they are legible', () => {
    expect(layer('contours-intermediate')?.minzoom).toBe(13);
  });

  it('keeps the 100 m index lines heavier than the intermediates', () => {
    const index = layer('contours-index') as { paint?: Record<string, unknown> };
    const intermediate = layer('contours-intermediate') as { paint?: Record<string, unknown> };
    expect(JSON.stringify(index.paint?.['line-width'])).not.toBe(
      JSON.stringify(intermediate.paint?.['line-width'])
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /c/Users/keega/Documents/KaapSpoor/app && npx vitest run src/lib/map/style.test.ts`
Expected: FAIL — no layer with id `contours-index`; `layerFor('contours-index')` is undefined.

- [ ] **Step 3: Replace the contours layer**

In `app/src/lib/map/style.ts`, replace the single `contours` layer object (lines 62-73) with two:

```typescript
      {
        // The 100 m index lines carry the mid zooms on their own. The archive
        // starts at z10, so that is the floor — below it there is nothing to draw.
        id: 'contours-index',
        type: 'line',
        source: 'contours',
        'source-layer': 'contours',
        minzoom: 10,
        filter: ['==', ['%', ['get', 'ele'], 100], 0],
        paint: {
          'line-color': '#b08968',
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.6, 13, 1.1, 16, 1.8],
          'line-opacity': ['interpolate', ['linear'], ['zoom'], 10, 0.45, 13, 0.7]
        }
      },
      {
        // 20 m intermediates are sub-pixel noise until you are close in, which
        // is the whole reason this is a separate layer rather than a width case.
        id: 'contours-intermediate',
        type: 'line',
        source: 'contours',
        'source-layer': 'contours',
        minzoom: 13,
        filter: ['!=', ['%', ['get', 'ele'], 100], 0],
        paint: {
          'line-color': '#b08968',
          'line-width': ['interpolate', ['linear'], ['zoom'], 13, 0.4, 16, 0.8],
          'line-opacity': 0.55
        }
      },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /c/Users/keega/Documents/KaapSpoor/app && npx vitest run src/lib/map/style.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/map/style.ts app/src/lib/map/style.test.ts
git commit -m "feat(app): split contours into index and intermediate layers by zoom"
```

---

### Task 2: Hold paths and roads back until they carry information

**Files:**
- Modify: `app/src/lib/map/style.ts` (the `roads` and `paths` layers)
- Test: `app/src/lib/map/style.test.ts` (the `zoom scoping` describe added in Task 1)

**Interfaces:**
- Consumes: the `zoom scoping` describe block from Task 1.
- Produces: `minzoom` on `roads` and `paths`. Task 5's e2e asserts `paths` renders nothing at z8.

This is the single change that removes the mush: 10,555 dashed footpaths at z7.97 become zero.

- [ ] **Step 1: Add the failing tests**

Append to the `zoom scoping` describe block in `app/src/lib/map/style.test.ts`:

```typescript
  it('holds footpaths back until a zoom where a single path is distinguishable', () => {
    // 10,555 paths rendered at the opening view (z7.97) and buried the route
    // pins; this is the change that removes that.
    expect(layer('paths')?.minzoom).toBe(12);
  });

  it('shows roads earlier than paths, since they orient you at region scale', () => {
    expect(layer('roads')?.minzoom).toBe(9);
  });

  it('interpolates road and path widths by zoom rather than fixing them', () => {
    for (const id of ['roads', 'paths']) {
      const paint = (layer(id) as { paint?: Record<string, unknown> }).paint ?? {};
      expect(Array.isArray(paint['line-width'])).toBe(true);
      expect((paint['line-width'] as unknown[])[0]).toBe('interpolate');
    }
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /c/Users/keega/Documents/KaapSpoor/app && npx vitest run src/lib/map/style.test.ts`
Expected: FAIL — `minzoom` is `undefined` on both layers.

- [ ] **Step 3: Add minzoom and zoom-ramped widths**

In `app/src/lib/map/style.ts`, replace the `roads` layer with:

```typescript
      {
        // Roads earn their place at region scale — they are how you find a
        // trailhead — but hairline-thin until you are close.
        id: 'roads',
        type: 'line',
        source: 'trails',
        'source-layer': 'roads',
        minzoom: 9,
        paint: {
          'line-color': '#cfc7bb',
          'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0.5, 12, 1.2, 16, 3]
        }
      },
```

and the `paths` layer with:

```typescript
      {
        // Below z12 individual footpaths are indistinguishable from each other:
        // 10,555 of them rendered at the opening view as brown speckle that
        // buried the 13 route pins. They appear once they can be followed.
        id: 'paths',
        type: 'line',
        source: 'trails',
        'source-layer': 'paths',
        minzoom: 12,
        paint: {
          'line-color': '#8a5a3b',
          'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.8, 16, 1.8],
          'line-dasharray': [3, 2]
        }
      },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /c/Users/keega/Documents/KaapSpoor/app && npx vitest run src/lib/map/style.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/map/style.ts app/src/lib/map/style.test.ts
git commit -m "feat(app): scope paths and roads by zoom so the overview stops drowning"
```

---

### Task 3: Rank peak labels by elevation and split them by zoom

**Files:**
- Modify: `app/src/lib/map/style.ts` (the `peaks` layer)
- Test: `app/src/lib/map/style.test.ts`

**Interfaces:**
- Consumes: the `zoom scoping` describe block.
- Produces: layer ids `peaks-major` and `peaks-minor`, replacing `peaks`. Task 5's e2e references both; Task 1's source-layer contract table must be updated to match.

188 peak labels at the opening view name every obscure bump in the Western Cape while giving no orientation at all. Splitting by elevation lets the big, recognisable summits appear at region scale and everything else wait.

- [ ] **Step 1: Update the contract table and add the failing tests**

In `app/src/lib/map/style.test.ts`, change the `it.each` table's `['peaks', 'peaks']` row to two rows:

```typescript
    ['peaks-major', 'peaks'],
    ['peaks-minor', 'peaks'],
```

and append to the `zoom scoping` describe block:

```typescript
  it('shows only major summits at region scale', () => {
    expect(layer('peaks-major')?.minzoom).toBe(10);
  });

  it('holds minor peaks back until close in', () => {
    expect(layer('peaks-minor')?.minzoom).toBe(13);
  });

  it('reads ele through to-number with a fallback, since OSM stores it as a string', () => {
    // trails-profile.yml passes the raw OSM `ele` tag through, so it arrives as
    // "1085" — and sometimes as something that will not convert at all.
    const both = [layer('peaks-major'), layer('peaks-minor')];
    for (const l of both) {
      const json = JSON.stringify(l);
      expect(json).toContain('to-number');
      expect(json).toContain('ele');
    }
  });

  it('sorts peak labels so the highest summit wins a collision', () => {
    const major = layer('peaks-major') as { layout?: Record<string, unknown> };
    expect(major.layout?.['symbol-sort-key']).toBeDefined();
  });

  it('interpolates peak label size by zoom', () => {
    const major = layer('peaks-major') as { layout?: Record<string, unknown> };
    expect(Array.isArray(major.layout?.['text-size'])).toBe(true);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /c/Users/keega/Documents/KaapSpoor/app && npx vitest run src/lib/map/style.test.ts`
Expected: FAIL — no `peaks-major` layer.

- [ ] **Step 3: Replace the peaks layer with two**

In `app/src/lib/map/style.ts`, replace the single `peaks` layer with:

```typescript
      {
        // The summits a person actually navigates by. `ele` is the raw OSM tag,
        // so it is a string and may be unconvertible — to-number's second
        // argument is the fallback, and 0 sorts such peaks into the minor layer.
        id: 'peaks-major',
        type: 'symbol',
        source: 'trails',
        'source-layer': 'peaks',
        minzoom: 10,
        filter: ['>=', ['to-number', ['get', 'ele'], 0], 1000],
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Open Sans Regular'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 10, 10, 15, 13],
          'text-offset': [0, 0.8],
          // Lower sort key wins a collision, so negate elevation: the highest
          // summit in a crowded cluster is the one that keeps its label.
          'symbol-sort-key': ['-', 0, ['to-number', ['get', 'ele'], 0]]
        },
        paint: { 'text-color': '#5b4636', 'text-halo-color': '#fff', 'text-halo-width': 1.2 }
      },
      {
        // Everything else, including peaks with no usable `ele`. 188 of these
        // carpeted the opening view; they belong at a zoom where you are looking
        // at one mountain rather than a province.
        id: 'peaks-minor',
        type: 'symbol',
        source: 'trails',
        'source-layer': 'peaks',
        minzoom: 13,
        filter: ['<', ['to-number', ['get', 'ele'], 0], 1000],
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Open Sans Regular'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 13, 10, 16, 12],
          'text-offset': [0, 0.8],
          'symbol-sort-key': ['-', 0, ['to-number', ['get', 'ele'], 0]]
        },
        paint: { 'text-color': '#5b4636', 'text-halo-color': '#fff', 'text-halo-width': 1.2 }
      }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /c/Users/keega/Documents/KaapSpoor/app && npx vitest run src/lib/map/style.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the whole app suite and the type check**

Run: `cd /c/Users/keega/Documents/KaapSpoor/app && npm test && npm run check`
Expected: PASS, 0 type errors. Report the observed test count.

- [ ] **Step 6: Commit**

```bash
git add app/src/lib/map/style.ts app/src/lib/map/style.test.ts
git commit -m "feat(app): rank peak labels by elevation and split them by zoom"
```

---

### Task 4: Make green mean done, and nothing else

**Files:**
- Modify: `app/src/lib/components/MapView.svelte:84` (the `pins-cluster` paint)
- Test: `app/e2e/map.spec.ts` — covered by Task 5's spec; no unit test, because the value lives in a Svelte component's `addLayer` call rather than in `style.ts`.

**Interfaces:**
- Consumes: nothing.
- Produces: a cluster colour distinct from the done-pin colour.

`MapView.svelte:84` paints clusters `#4a6741` and `MapView.svelte:101` paints done-pins the same `#4a6741`. A green circle therefore means either "several routes here" or "you have done this one".

- [ ] **Step 1: Change the cluster colour**

In `app/src/lib/components/MapView.svelte`, in the `pins-cluster` layer's `paint`, replace `'circle-color': '#4a6741'` with:

```javascript
        paint: {
          // Deliberately NOT the done-green (#4a6741, see the pins layer below):
          // a cluster says "several routes here", which is a different claim
          // from "you have done this one". Sharing a colour made green ambiguous.
          'circle-color': '#55606b',
          'circle-radius': 16,
          'circle-opacity': 0.85
        }
```

- [ ] **Step 2: Verify the two colours no longer collide**

Run: `cd /c/Users/keega/Documents/KaapSpoor && grep -n "4a6741\|55606b" app/src/lib/components/MapView.svelte`
Expected: `#55606b` appears once (the cluster), `#4a6741` appears once (the done case in the `pins` layer's `circle-color`). If `#4a6741` still appears twice, the wrong one was changed.

- [ ] **Step 3: Commit**

```bash
git add app/src/lib/components/MapView.svelte
git commit -m "fix(app): stop clusters and done-pins sharing a colour"
```

---

### Task 5: Prove the opening view in a real browser

**Files:**
- Modify: `app/e2e/map.spec.ts`

**Interfaces:**
- Consumes: layer ids `paths`, `peaks-minor`, `peaks-major`, `pins`, `pins-cluster`.
- Produces: the regression test that keeps this fix from silently reverting.

Pixel diffing was judged overkill in `docs/superpowers/specs/2026-07-27-map-followups.md` and still is. Asserting *rendered feature counts* turns the defect into a deterministic test: the numbers that motivated this plan were themselves gathered by `queryRenderedFeatures`.

- [ ] **Step 1: Write the failing test**

Append to the `test.describe('map', ...)` block in `app/e2e/map.spec.ts`:

```typescript
  test('the opening view is not buried under paths and minor peaks', async ({ page }) => {
    // Measured before this fix, at the fitBounds opening view (z7.97): 10,555
    // paths, 5,180 roads and 188 peak labels against 13 route pins. Every layer
    // drew at every zoom because none carried a minzoom. This asserts the
    // scoping that fixed it, at the zoom a visitor actually lands on.
    await page.goto('');
    await expect(page.locator('[data-testid="map"][data-map-ready="true"]')).toBeAttached({
      timeout: 15_000
    });

    const counts = async (zoom: number) =>
      page.evaluate(async (z) => {
        const el = document.querySelector('[data-testid="map"]') as HTMLElement & {
          __maplibreMap?: import('maplibre-gl').Map;
        };
        const map = el.__maplibreMap!;
        map.jumpTo({ center: [18.42, -33.96], zoom: z });
        await new Promise<void>((resolve) => map.once('idle', () => resolve()));
        const of = (id: string) => {
          try {
            return map.queryRenderedFeatures(undefined, { layers: [id] }).length;
          } catch {
            return -1; // layer absent — a real failure, distinct from "zero drawn"
          }
        };
        return {
          paths: of('paths'),
          peaksMinor: of('peaks-minor'),
          peaksMajor: of('peaks-major'),
          pins: of('pins') + of('pins-cluster')
        };
      }, zoom);

    const overview = await counts(8);
    expect(overview.paths).toBe(0);
    expect(overview.peaksMinor).toBe(0);
    // The pins are the point of the map: at the zoom it opens on, they must be
    // the thing that renders.
    expect(overview.pins).toBeGreaterThan(0);

    // z13 over the Atlantic seaboard, not an arbitrary close-in view: a
    // screenshot of exactly this camera showed Blinkwater Needle, Blinkwater
    // Peak, St Michael Peak, Fernwood Peak, Junction Peak, Cleft Peak, Reserve
    // Peak and Fountain Peak — all named, all under 1000 m, so all in the minor
    // layer. Picking a plateau view instead could legitimately render zero
    // minor peaks and fail for being right.
    const closeIn = await counts(13);
    expect(closeIn.paths).toBeGreaterThan(0);
    expect(closeIn.peaksMinor).toBeGreaterThan(0);
  });
```

- [ ] **Step 2: Run it against the current build to verify it fails**

Run: `cd /c/Users/keega/Documents/KaapSpoor/app && npx playwright test map.spec.ts -g "buried"`
Expected: FAIL on `expect(overview.paths).toBe(0)` if run before Tasks 1-3, or PASS after them. If the layer ids are wrong the counts come back `-1`, which fails distinctly from a zero count — that distinction is the point of the `-1`.

Note: this needs `app/static/tiles/*.pmtiles` and `app/static/fonts/` present locally. If they are absent, download them the way CI does:
`gh release download tiles-v1 --pattern '*.pmtiles' --dir static/tiles` and the `fonts.tar.gz` asset.

- [ ] **Step 3: Run the full e2e suite at both base paths**

Run: `cd /c/Users/keega/Documents/KaapSpoor/app && npm run test:e2e`
Expected: PASS. Report the observed test count. The pre-existing specs that jump to Kasteelspoort at z15 must still pass — `paths` at minzoom 12 is below that, so they are unaffected.

- [ ] **Step 4: Commit**

```bash
git add app/e2e/map.spec.ts
git commit -m "test(app): assert the opening view renders pins, not a carpet of paths"
```

---

### Task 6: Look at it

**Files:** none — this is verification, not code.

The follow-ups doc's own lesson is that two defects on the map branch were invisible to unit tests, type-checking and eleven task reviews, and only a real browser found them. A cartography change is exactly the class where the tests can pass and the result still look wrong.

**Read this before starting, or you will lose an hour:** a MapLibre map in a **hidden/backgrounded browser tab never loads its style**, because `Style.loadJSON` awaits a `requestAnimationFrame` that a hidden tab never fires. The symptoms mimic catastrophic breakage — canvas present and correctly sized, WebGL fine, controls rendered, but `getStyle()` throws, `isStyleLoaded()` is false, and **zero tile requests with no error event at all**. Check `document.visibilityState` first. To inspect anyway, shim `window.requestAnimationFrame` to a `setTimeout` and re-apply the style with `setStyle`; that renders faithfully enough to judge cartography, though not performance or first paint.

- [ ] **Step 1: Serve the built site locally**

Run: `cd /c/Users/keega/Documents/KaapSpoor/app && npm run build && npm run preview -- --port 4173`

- [ ] **Step 2: Look at three zooms and capture each**

Open `http://localhost:4173/`, and capture a screenshot at:
- the default opening view (whatever `fitBounds` gives),
- z11 over the Cape Peninsula,
- z14 over Table Mountain.

- [ ] **Step 3: Judge, against the specific things this plan claims to fix**

- At the opening view: are the route pins the most prominent thing? Is the brown speckle gone? Are peak labels sparse enough to read?
- At z11: do the index contours give shape without the intermediates crowding them?
- At z14: do paths, intermediates and minor peaks all appear, and does it still read as a hiking map?
- Anywhere: is a cluster now visually distinct from a done-pin?

- [ ] **Step 4: Record the verdict**

If it looks right, say so and attach the screenshots. If a zoom threshold is wrong, that is a real finding: the values in Tasks 1-3 are reasoned, not measured, and this step is where they get corrected. Adjust, re-run `npx vitest run src/lib/map/style.test.ts` and `npm run test:e2e`, and commit the adjustment separately so the reasoning stays visible in history.

---

## Definition of done

- `cd app && npm test && npm run check` passes with 0 type errors.
- `cd app && npm run test:e2e` passes at both base paths.
- At the opening view, `paths` and `peaks-minor` render exactly 0 features and the pin layers render more than 0.
- A human has looked at the deployed or locally-served map at three zooms and said it reads well.
- A cluster and a done-pin are visually distinguishable.

## What this plan deliberately does not do

- **No place labels.** They need `tiles-v2` (Plan 2); the current archive has no `places` source-layer.
- **No provenance rendering** — hollow pins, uncertainty circles, route-page wording, or lifting the `area-approx` gate in `transform.ts`. That is Plan 3b.
- **No tile rebuild** and no change to `tools/tiles/`.
