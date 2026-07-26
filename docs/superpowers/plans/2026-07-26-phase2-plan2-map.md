# Phase 2 · Plan 2 — The Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the 125 located routes on a keyless, self-hosted hiking map with contours, synchronized with the existing route library panel.

**Architecture:** MapLibre GL renders a GeoJSON pin layer over a basemap. The basemap starts as OpenTopoMap (keyless, zero setup) so all the UI work can proceed, then swaps to self-hosted PMTiles — a minimal OSM trails extract plus DEM-derived vector contours — through one `style.ts` function. Map and panel never reference each other; both read and write a small `selection` store.

**Tech Stack:** `maplibre-gl` · `pmtiles` (protocol) · SvelteKit 2 / Svelte 5 · existing Vitest + Playwright · planetiler, GDAL and tippecanoe for the offline tile build.

## Global Constraints

- **Keyless and capless.** No API keys, no signup, no usage-limited tile service in the shipped app. OpenTopoMap is a staging basemap only.
- **App lives in `app/`**; all `npm`/`node` commands run from `app/`. Node ≥ 20.
- **Base path:** production builds serve under `/KaapSpoor` via `BASE_PATH`. Every internal link and asset URL uses `base` from `$app/paths` — never a hard-coded `/`. This includes the `.pmtiles` URLs.
- **TypeScript strict; no `any`** — including no untyped `$props()`. Annotate SvelteKit loads with generated `./$types`.
- **Attribution is a licence obligation.** The map must show `© OpenStreetMap contributors` (plus OpenTopoMap and the DEM source while in use). Never suppress `AttributionControl`.
- **Contours only, no hillshade.** 20 m intervals, indexed 100 m lines.
- **Thin roads:** trunk, primary, secondary, tertiary and named residential streets only. No service roads, driveways, parking aisles, buildings or address points.
- **Grades stay raw.** Never normalise or parse grade strings.
- **Published output stays under 1 GB** (CI enforces). 4.5 MB used today; photos have a deferred ~230 MB claim.
- **MapLibre needs WebGL, which jsdom lacks.** Never unit-test the rendered canvas — pure logic in Vitest, map behaviour in Playwright only.

---

## File structure

```
tools/tiles/                      # NEW — the offline tile build (not shipped code)
  README.md                       # prerequisites + exact build commands
  bbox.json                       # single source of truth for the extract window
  build-trails.sh                 # OSM extract -> planetiler -> trails.pmtiles
  build-contours.sh               # DEM -> gdal_contour -> tippecanoe -> contours.pmtiles
  profile/trails-profile.yml       # planetiler layer/filter definition
  report-size.mjs                 # measured size report (echoes Phase 0 discipline)

app/src/lib/map/                  # NEW — all map logic, one job per file
  geojson.ts                      # routesToGeoJSON()
  geojson.test.ts
  style.ts                        # buildStyle() — the basemap swap point
  style.test.ts
  selection.ts                    # hoveredId / selectedId store
  selection.test.ts

app/src/lib/components/
  MapView.svelte                  # NEW — MapLibre init, pins, popup, controls
  LocatorMap.svelte               # NEW — route-page mini-map
  RouteRow.svelte                 # MODIFY — hover/select wiring
  BottomSheet.svelte              # NEW — mobile panel container (CSS only)

app/src/routes/
  +page.svelte                    # MODIFY — split layout: map + panel
  route/[id]/+page.svelte         # MODIFY — swap coords text for LocatorMap

app/src/lib/journal/store.ts      # MODIFY — optimistic-then-persist toggle fix
app/static/tiles/                 # generated .pmtiles land here (git-ignored)
```

`tools/tiles/` is a build tool, not shipped code — it follows `tools/scraper/`'s pattern of a documented, repeatable command whose output is measured rather than estimated.

---

### Task 1: Journal toggle fix (optimistic write)

Done first because it is independent of the map and closes a known data-loss window: the
checkbox flips the instant you click it, but `setEntry` currently waits for IndexedDB
before updating the store, so a reload inside that gap loses the toggle.

**Files:**
- Modify: `app/src/lib/journal/store.ts`
- Test: `app/src/lib/journal/store.test.ts`

**Interfaces:**
- Consumes: `putEntry`, `getAllEntries`, `clearEntries` from `./db`; `JournalEntry` from `../data/types`.
- Produces: unchanged public API — `journal`, `hydrate()`, `setEntry(e)`, `toggleDone(routeId)`, `replaceAll(entries)`. Only the ordering inside `setEntry` changes, plus a rollback on write failure.

- [ ] **Step 1: Add the module mock and the failing tests**

At the very top of `app/src/lib/journal/store.test.ts`, change the vitest import to include `vi` and add a passthrough mock of the db module. The mock must be a passthrough so every existing test keeps hitting real fake-indexeddb; only the rollback test overrides it.

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Passthrough mock: real behaviour by default, so existing tests are unaffected.
// One test below overrides putEntry to force a write failure.
vi.mock('./db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./db')>();
  return { ...actual, putEntry: vi.fn(actual.putEntry) };
});
```

Then append these two tests:
```ts
it('reflects the entry in the store before the write resolves', async () => {
  const pending = setEntry({ routeId: 'r9', done: true, date: null, notes: '' });
  // Deliberately not awaited yet: the store must already show the change, so a
  // reload in this window cannot lose the toggle.
  expect(get(journal).get('r9')?.done).toBe(true);
  await pending;
  expect(await getAllEntries()).toHaveLength(1);
});

it('rolls the store back when the write fails', async () => {
  const db = await import('./db');
  vi.mocked(db.putEntry).mockRejectedValueOnce(new Error('disk full'));

  await expect(
    setEntry({ routeId: 'r10', done: true, date: null, notes: '' })
  ).rejects.toThrow('disk full');

  // The optimistic update must not survive a failed write.
  expect(get(journal).get('r10')).toBeUndefined();
});
```

- [ ] **Step 2: Run it and watch both fail**

Run: `cd app && npx vitest run src/lib/journal/store.test.ts`
Expected: FAIL — the first test reports `expected undefined to be true` (the store is not updated until after the await); the second fails because `setEntry` has no rollback.

- [ ] **Step 3: Make the write optimistic, with rollback**

Replace `setEntry` in `app/src/lib/journal/store.ts` with:
```ts
export async function setEntry(entry: JournalEntry): Promise<void> {
  let previous: JournalEntry | undefined;
  journal.subscribe((m) => (previous = m.get(entry.routeId)))();

  // Update the store first: the checkbox flips optimistically on click, so the
  // store must match it immediately or a reload in between loses the toggle.
  update((m) => m.set(entry.routeId, entry));

  try {
    await putEntry(entry);
  } catch (err) {
    // Roll back so the UI stops claiming a save that did not happen.
    update((m) => {
      if (previous) m.set(entry.routeId, previous);
      else m.delete(entry.routeId);
    });
    throw err;
  }
}
```

- [ ] **Step 4: Run the file and watch it pass**

Run: `cd app && npx vitest run src/lib/journal/store.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 5: Run the whole suite to confirm nothing regressed**

Run: `cd app && npx vitest run`
Expected: PASS — 45 tests (43 before, plus these 2), output pristine.

- [ ] **Step 6: Commit**

```bash
git add app/src/lib/journal/store.ts app/src/lib/journal/store.test.ts
git commit -m "fix(app): update the journal store before persisting, roll back on failure"
```

### Task 2: Route GeoJSON conversion

**Files:**
- Create: `app/src/lib/map/geojson.ts`
- Test: `app/src/lib/map/geojson.test.ts`

**Interfaces:**
- Consumes: `RouteIndexEntry` from `$lib/data/types`.
- Produces:
  - `RoutePinProps { id: string; title: string; grade: string | null }`
  - `routesToGeoJSON(entries: RouteIndexEntry[]): GeoJSON.FeatureCollection<GeoJSON.Point, RoutePinProps>` — includes only entries with coords; each feature's `id` is the route id (MapLibre needs a feature id for `feature-state`).
  - `boundsOf(entries: RouteIndexEntry[]): [[number, number], [number, number]] | null` — `[[west, south], [east, north]]`, or `null` when nothing is located.

- [ ] **Step 1: Write the failing test**

`app/src/lib/map/geojson.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { routesToGeoJSON, boundsOf } from './geojson';
import type { RouteIndexEntry } from '$lib/data/types';

function entry(id: string, coords: { lat: number; lon: number } | null): RouteIndexEntry {
  return {
    id, title: id.toUpperCase(), area: ['x'],
    coords: coords ? { ...coords, zoom: 16 } : null,
    grade: '3 ***', gradeSource: 'label', time: null, heightGain: null, isFullEntry: true
  };
}

const entries = [
  entry('a', { lat: -33.97, lon: 18.39 }),
  entry('b', null),
  entry('c', { lat: -32.6, lon: 19.2 })
];

describe('routesToGeoJSON', () => {
  it('includes only located routes', () => {
    const fc = routesToGeoJSON(entries);
    expect(fc.features.map((f) => f.properties.id)).toEqual(['a', 'c']);
  });
  it('writes coordinates as [lon, lat] per the GeoJSON spec', () => {
    const [first] = routesToGeoJSON(entries).features;
    expect(first.geometry.coordinates).toEqual([18.39, -33.97]);
  });
  it('sets a feature id so MapLibre feature-state can target it', () => {
    expect(routesToGeoJSON(entries).features[0].id).toBe('a');
  });
  it('carries the raw grade string unchanged', () => {
    expect(routesToGeoJSON(entries).features[0].properties.grade).toBe('3 ***');
  });
  it('returns an empty collection when nothing is located', () => {
    expect(routesToGeoJSON([entry('b', null)]).features).toEqual([]);
  });
});

describe('boundsOf', () => {
  it('returns south-west and north-east corners', () => {
    expect(boundsOf(entries)).toEqual([[18.39, -33.97], [19.2, -32.6]]);
  });
  it('returns null when nothing is located', () => {
    expect(boundsOf([entry('b', null)])).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd app && npx vitest run src/lib/map/geojson.test.ts`
Expected: FAIL — cannot resolve `./geojson`.

- [ ] **Step 3: Implement**

`app/src/lib/map/geojson.ts`:
```ts
import type { RouteIndexEntry } from '$lib/data/types';

export interface RoutePinProps {
  id: string;
  title: string;
  grade: string | null;
}

export function routesToGeoJSON(
  entries: RouteIndexEntry[]
): GeoJSON.FeatureCollection<GeoJSON.Point, RoutePinProps> {
  return {
    type: 'FeatureCollection',
    features: entries
      .filter((e) => e.coords !== null)
      .map((e) => ({
        type: 'Feature',
        // MapLibre requires a feature id to drive feature-state (done styling).
        id: e.id,
        geometry: { type: 'Point', coordinates: [e.coords!.lon, e.coords!.lat] },
        properties: { id: e.id, title: e.title, grade: e.grade }
      }))
  };
}

export function boundsOf(
  entries: RouteIndexEntry[]
): [[number, number], [number, number]] | null {
  const located = entries.filter((e) => e.coords !== null);
  if (located.length === 0) return null;
  const lons = located.map((e) => e.coords!.lon);
  const lats = located.map((e) => e.coords!.lat);
  return [
    [Math.min(...lons), Math.min(...lats)],
    [Math.max(...lons), Math.max(...lats)]
  ];
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `cd app && npx vitest run src/lib/map/geojson.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/map/geojson.ts app/src/lib/map/geojson.test.ts
git commit -m "feat(app): convert located routes to a GeoJSON pin source"
```

### Task 3: Selection store

**Files:**
- Create: `app/src/lib/map/selection.ts`
- Test: `app/src/lib/map/selection.test.ts`

**Interfaces:**
- Produces:
  - `selection` — a readable store of `{ hoveredId: string | null; selectedId: string | null }`.
  - `setHovered(id: string | null): void`
  - `setSelected(id: string | null): void` — selecting also clears hover, so a click does not leave a stale highlight behind.
  - `clearSelection(): void`

- [ ] **Step 1: Write the failing test**

`app/src/lib/map/selection.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { selection, setHovered, setSelected, clearSelection } from './selection';

beforeEach(() => clearSelection());

describe('selection store', () => {
  it('starts with nothing hovered or selected', () => {
    expect(get(selection)).toEqual({ hoveredId: null, selectedId: null });
  });
  it('tracks the hovered route', () => {
    setHovered('a');
    expect(get(selection).hoveredId).toBe('a');
  });
  it('tracks the selected route', () => {
    setSelected('b');
    expect(get(selection).selectedId).toBe('b');
  });
  it('clears hover when a selection is made, so no stale highlight remains', () => {
    setHovered('a');
    setSelected('b');
    expect(get(selection)).toEqual({ hoveredId: null, selectedId: 'b' });
  });
  it('accepts null to clear the hover', () => {
    setHovered('a');
    setHovered(null);
    expect(get(selection).hoveredId).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd app && npx vitest run src/lib/map/selection.test.ts`
Expected: FAIL — cannot resolve `./selection`.

- [ ] **Step 3: Implement**

`app/src/lib/map/selection.ts`:
```ts
import { writable } from 'svelte/store';

export interface SelectionState {
  hoveredId: string | null;
  selectedId: string | null;
}

const EMPTY: SelectionState = { hoveredId: null, selectedId: null };

export const selection = writable<SelectionState>({ ...EMPTY });

export function setHovered(id: string | null): void {
  selection.update((s) => ({ ...s, hoveredId: id }));
}

export function setSelected(id: string | null): void {
  // Clearing hover avoids two highlights surviving a click.
  selection.set({ hoveredId: null, selectedId: id });
}

export function clearSelection(): void {
  selection.set({ ...EMPTY });
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `cd app && npx vitest run src/lib/map/selection.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/map/selection.ts app/src/lib/map/selection.test.ts
git commit -m "feat(app): add the map/panel selection store"
```

### Task 4: Style builder (the basemap swap point)

**Files:**
- Create: `app/src/lib/map/style.ts`
- Test: `app/src/lib/map/style.test.ts`
- Modify: `app/package.json` (add `maplibre-gl` and `pmtiles`)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `type Basemap = 'opentopo' | 'selfhosted'`
  - `buildStyle(basemap: Basemap, base: string): StyleSpecification` — returns a MapLibre style. `base` is SvelteKit's base path, prefixed onto every self-hosted `.pmtiles` URL. `'opentopo'` yields a raster source; `'selfhosted'` yields two `vector` sources (`trails`, `contours`) with `pmtiles://` URLs plus contour and path layers.
  - `ATTRIBUTION_OSM = '© OpenStreetMap contributors'` — exported so tests and callers share one string.

Both basemaps must carry attribution: this is an ODbL licence obligation, not styling.

- [ ] **Step 1: Install the map libraries**

```bash
cd app && npm install maplibre-gl pmtiles
```
These are **runtime dependencies**, not devDependencies — they ship in the bundle.

- [ ] **Step 2: Write the failing test**

`app/src/lib/map/style.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { buildStyle, ATTRIBUTION_OSM } from './style';

describe('buildStyle(opentopo)', () => {
  const style = buildStyle('opentopo', '');
  it('uses a raster source', () => {
    expect(style.sources.basemap.type).toBe('raster');
  });
  it('attributes OpenStreetMap, which the ODbL requires', () => {
    expect(JSON.stringify(style.sources)).toContain(ATTRIBUTION_OSM);
  });
  it('renders the raster as the only basemap layer', () => {
    expect(style.layers.map((l) => l.id)).toContain('basemap');
  });
});

describe('buildStyle(selfhosted)', () => {
  const style = buildStyle('selfhosted', '/KaapSpoor');
  it('declares trails and contours as vector sources', () => {
    expect(style.sources.trails.type).toBe('vector');
    expect(style.sources.contours.type).toBe('vector');
  });
  it('prefixes pmtiles URLs with the base path so GitHub Pages resolves them', () => {
    expect(JSON.stringify(style.sources)).toContain('pmtiles:///KaapSpoor/tiles/trails.pmtiles');
    expect(JSON.stringify(style.sources)).toContain('pmtiles:///KaapSpoor/tiles/contours.pmtiles');
  });
  it('draws contour lines and paths', () => {
    const ids = style.layers.map((l) => l.id);
    expect(ids).toContain('contours');
    expect(ids).toContain('paths');
  });
  it('attributes OpenStreetMap', () => {
    expect(JSON.stringify(style.sources)).toContain(ATTRIBUTION_OSM);
  });
});

describe('both basemaps', () => {
  it('agree on the glyphs endpoint so labels render either way', () => {
    expect(buildStyle('opentopo', '').glyphs).toBe(buildStyle('selfhosted', '').glyphs);
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `cd app && npx vitest run src/lib/map/style.test.ts`
Expected: FAIL — cannot resolve `./style`.

- [ ] **Step 4: Implement**

`app/src/lib/map/style.ts`:
```ts
import type { StyleSpecification } from 'maplibre-gl';

export type Basemap = 'opentopo' | 'selfhosted';

export const ATTRIBUTION_OSM = '© OpenStreetMap contributors';
const ATTRIBUTION_OPENTOPO = `${ATTRIBUTION_OSM}, © <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)`;
const ATTRIBUTION_SELF = `${ATTRIBUTION_OSM}, contours from Copernicus DEM`;

// Free, keyless font endpoint. Both basemaps share it so switching cannot
// silently drop every label.
const GLYPHS = 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf';

function openTopo(): StyleSpecification {
  return {
    version: 8,
    glyphs: GLYPHS,
    sources: {
      basemap: {
        type: 'raster',
        tiles: ['https://a.tile.opentopomap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        maxzoom: 17,
        attribution: ATTRIBUTION_OPENTOPO
      }
    },
    layers: [{ id: 'basemap', type: 'raster', source: 'basemap' }]
  };
}

function selfHosted(base: string): StyleSpecification {
  return {
    version: 8,
    glyphs: GLYPHS,
    sources: {
      trails: {
        type: 'vector',
        url: `pmtiles://${base}/tiles/trails.pmtiles`,
        attribution: ATTRIBUTION_SELF
      },
      contours: {
        type: 'vector',
        url: `pmtiles://${base}/tiles/contours.pmtiles`,
        attribution: ATTRIBUTION_SELF
      }
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#f4f1ea' } },
      {
        id: 'water',
        type: 'fill',
        source: 'trails',
        'source-layer': 'water',
        paint: { 'fill-color': '#a8c8e0' }
      },
      {
        id: 'contours',
        type: 'line',
        source: 'contours',
        'source-layer': 'contours',
        paint: {
          'line-color': '#b08968',
          // Indexed 100 m lines read heavier than the 20 m intermediates.
          'line-width': ['case', ['==', ['%', ['get', 'ele'], 100], 0], 1.1, 0.5],
          'line-opacity': 0.7
        }
      },
      {
        id: 'roads',
        type: 'line',
        source: 'trails',
        'source-layer': 'roads',
        paint: { 'line-color': '#cfc7bb', 'line-width': 1.5 }
      },
      {
        id: 'paths',
        type: 'line',
        source: 'trails',
        'source-layer': 'paths',
        paint: { 'line-color': '#8a5a3b', 'line-width': 1.2, 'line-dasharray': [3, 2] }
      },
      {
        id: 'peaks',
        type: 'symbol',
        source: 'trails',
        'source-layer': 'peaks',
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Open Sans Regular'],
          'text-size': 11,
          'text-offset': [0, 0.8]
        },
        paint: { 'text-color': '#5b4636', 'text-halo-color': '#fff', 'text-halo-width': 1.2 }
      }
    ]
  };
}

export function buildStyle(basemap: Basemap, base: string): StyleSpecification {
  return basemap === 'opentopo' ? openTopo() : selfHosted(base);
}
```

- [ ] **Step 5: Run it and watch it pass**

Run: `cd app && npx vitest run src/lib/map/style.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 6: Commit**

```bash
git add app/src/lib/map/style.ts app/src/lib/map/style.test.ts app/package.json app/package-lock.json
git commit -m "feat(app): add the MapLibre style builder with a basemap swap point"
```

### Task 5: MapView component

The map canvas cannot be unit-tested (jsdom has no WebGL), so this task has no Vitest
coverage by design — Task 9's Playwright spec proves it mounts and behaves. Verify it here
by eye in the dev server, and keep the component thin so the untested surface stays small.

**Files:**
- Create: `app/src/lib/components/MapView.svelte`

**Interfaces:**
- Consumes: `buildStyle`, `Basemap` from `$lib/map/style`; `routesToGeoJSON`, `boundsOf` from `$lib/map/geojson`; `selection`, `setHovered`, `setSelected` from `$lib/map/selection`; `journal` from `$lib/journal/store`; `RouteIndexEntry` from `$lib/data/types`; `base` from `$app/paths`.
- Produces: `MapView.svelte` with props `{ entries: RouteIndexEntry[]; basemap?: Basemap }` (default `'opentopo'`). Pin layer ids: `pins`, `pins-cluster`, `pins-cluster-count`. Source id: `routes`.

- [ ] **Step 1: Write the component**

`app/src/lib/components/MapView.svelte`:
```svelte
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { base } from '$app/paths';
  import maplibregl, { Map as MapLibreMap, Popup, GeolocateControl, NavigationControl, AttributionControl } from 'maplibre-gl';
  import { Protocol } from 'pmtiles';
  import 'maplibre-gl/dist/maplibre-gl.css';
  import { buildStyle, type Basemap } from '$lib/map/style';
  import { routesToGeoJSON, boundsOf } from '$lib/map/geojson';
  import { selection, setHovered, setSelected } from '$lib/map/selection';
  import { journal } from '$lib/journal/store';
  import type { RouteIndexEntry } from '$lib/data/types';

  let { entries, basemap = 'opentopo' as Basemap }: { entries: RouteIndexEntry[]; basemap?: Basemap } = $props();

  let container: HTMLDivElement;
  let map: MapLibreMap | undefined;
  let loaded = $state(false);

  onMount(() => {
    // pmtiles:// URLs need their protocol registered before the style loads.
    const protocol = new Protocol();
    maplibregl.addProtocol('pmtiles', protocol.tile);

    map = new MapLibreMap({
      container,
      style: buildStyle(basemap, base),
      attributionControl: false // added explicitly below so it is never dropped
    });
    map.addControl(new AttributionControl({ compact: true }));
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(
      new GeolocateControl({ trackUserLocation: true, showUserLocation: true }),
      'top-right'
    );

    const bounds = boundsOf(entries);
    if (bounds) map.fitBounds(bounds, { padding: 48, animate: false });

    map.on('load', () => {
      if (!map) return;
      map.addSource('routes', {
        type: 'geojson',
        data: routesToGeoJSON(entries),
        cluster: true,
        clusterRadius: 40,
        clusterMaxZoom: 13
      });

      map.addLayer({
        id: 'pins-cluster',
        type: 'circle',
        source: 'routes',
        filter: ['has', 'point_count'],
        paint: { 'circle-color': '#4a6741', 'circle-radius': 16, 'circle-opacity': 0.85 }
      });
      map.addLayer({
        id: 'pins-cluster-count',
        type: 'symbol',
        source: 'routes',
        filter: ['has', 'point_count'],
        layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-font': ['Open Sans Regular'], 'text-size': 12 },
        paint: { 'text-color': '#fff' }
      });
      map.addLayer({
        id: 'pins',
        type: 'circle',
        source: 'routes',
        filter: ['!', ['has', 'point_count']],
        paint: {
          // Done routes read differently from to-do ones; hover/selection grows the pin.
          'circle-color': ['case', ['boolean', ['feature-state', 'done'], false], '#4a6741', '#c1663f'],
          'circle-radius': ['case', ['boolean', ['feature-state', 'active'], false], 9, 6],
          'circle-stroke-color': '#fff',
          'circle-stroke-width': 1.5
        }
      });

      loaded = true;

      map.on('click', 'pins-cluster', (e) => {
        const f = map!.queryRenderedFeatures(e.point, { layers: ['pins-cluster'] })[0];
        const zoom = map!.getZoom();
        map!.easeTo({ center: (f.geometry as GeoJSON.Point).coordinates as [number, number], zoom: zoom + 2 });
      });

      map.on('click', 'pins', (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const id = String(f.properties?.id);
        setSelected(id);
        new Popup({ closeButton: true })
          .setLngLat((f.geometry as GeoJSON.Point).coordinates as [number, number])
          .setHTML(
            `<strong>${f.properties?.title ?? ''}</strong><br>` +
              `${f.properties?.grade ?? ''}<br>` +
              `<a href="${base}/route/${id}">Open route</a>`
          )
          .addTo(map!);
      });

      map.on('mouseenter', 'pins', (e) => {
        map!.getCanvas().style.cursor = 'pointer';
        const id = e.features?.[0]?.properties?.id;
        if (id) setHovered(String(id));
      });
      map.on('mouseleave', 'pins', () => {
        map!.getCanvas().style.cursor = '';
        setHovered(null);
      });
    });
  });

  onDestroy(() => {
    map?.remove();
    maplibregl.removeProtocol('pmtiles');
  });

  // Paint done state from the journal.
  $effect(() => {
    const done = new Set([...$journal.values()].filter((e) => e.done).map((e) => e.routeId));
    if (!map || !loaded) return;
    for (const e of entries) {
      if (!e.coords) continue;
      map.setFeatureState({ source: 'routes', id: e.id }, { done: done.has(e.id) });
    }
  });

  // Highlight and fly when the panel selects or hovers a route.
  $effect(() => {
    const { hoveredId, selectedId } = $selection;
    if (!map || !loaded) return;
    const active = selectedId ?? hoveredId;
    for (const e of entries) {
      if (!e.coords) continue;
      map.setFeatureState({ source: 'routes', id: e.id }, { active: e.id === active });
    }
    if (selectedId) {
      const target = entries.find((e) => e.id === selectedId);
      if (target?.coords) {
        map.flyTo({ center: [target.coords.lon, target.coords.lat], zoom: 14, speed: 1.4 });
      }
    }
  });
</script>

<!-- data-map-ready flips only after the style loaded AND the pins layer was added,
     which is the one honest signal an outside test can assert on: WebGL pixels
     are not queryable from Playwright. -->
<div class="map" bind:this={container} data-testid="map" data-map-ready={loaded}></div>

<style>
  .map { width: 100%; height: 100%; min-height: 20rem; }
</style>
```

- [ ] **Step 2: Type-check**

Run: `cd app && npx svelte-check --tsconfig ./tsconfig.json 2>&1 | tail -5`
Expected: `0 errors, 0 warnings`. If `setFeatureState` complains about the `done`/`active` keys, the fix is typing the state object — never casting to `any`.

- [ ] **Step 3: Confirm the full unit suite still passes**

Run: `cd app && npx vitest run`
Expected: PASS, unchanged count (this task adds no unit tests by design).

- [ ] **Step 4: Commit**

```bash
git add app/src/lib/components/MapView.svelte
git commit -m "feat(app): add the MapView map component with clustered route pins"
```

### Task 6: Wire RouteRow into the selection store

**Files:**
- Modify: `app/src/lib/components/RouteRow.svelte`
- Test: `app/src/lib/components/RouteRow.test.ts`

**Interfaces:**
- Consumes: `selection`, `setHovered`, `setSelected` from `$lib/map/selection`.
- Produces: `RouteRow` keeps its existing props `{ route: RouteIndexEntry; done: boolean }` and its `data-testid="route-link"`. It gains: hover writes `setHovered(route.id)`, mouseleave writes `setHovered(null)`, click writes `setSelected(route.id)`, and it carries `class="active"` plus `aria-current="true"` when it is the hovered or selected row.

Clicking must still navigate to the route page — selection is additive, not a replacement
for the link.

- [ ] **Step 1: Write the failing test**

Append to `app/src/lib/components/RouteRow.test.ts` (and add `fireEvent` to the
`@testing-library/svelte` import, and `beforeEach` to the vitest import):
```ts
import { render, screen, fireEvent } from '@testing-library/svelte';
import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { selection, clearSelection } from '../map/selection';

beforeEach(() => clearSelection());

describe('RouteRow selection wiring', () => {
  it('reports a hover to the selection store', async () => {
    render(RouteRow, { route: located, done: false });
    await fireEvent.mouseEnter(screen.getByTestId('route-link'));
    expect(get(selection).hoveredId).toBe('a');
  });

  it('clears the hover on mouse leave', async () => {
    render(RouteRow, { route: located, done: false });
    const row = screen.getByTestId('route-link');
    await fireEvent.mouseEnter(row);
    await fireEvent.mouseLeave(row);
    expect(get(selection).hoveredId).toBeNull();
  });

  it('reports a click as a selection', async () => {
    render(RouteRow, { route: located, done: false });
    await fireEvent.click(screen.getByTestId('route-link'));
    expect(get(selection).selectedId).toBe('a');
  });

  it('marks itself current when it is the selected row', async () => {
    render(RouteRow, { route: located, done: false });
    await fireEvent.click(screen.getByTestId('route-link'));
    expect(screen.getByTestId('route-link').getAttribute('aria-current')).toBe('true');
  });

  it('still links to the route page', () => {
    render(RouteRow, { route: located, done: false });
    expect(screen.getByTestId('route-link').getAttribute('href')).toContain('/route/a');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd app && npx vitest run src/lib/components/RouteRow.test.ts`
Expected: FAIL — `expected null to be 'a'`; the row has no handlers yet.

- [ ] **Step 3: Add the wiring**

Replace the `<script>` block and the anchor in `app/src/lib/components/RouteRow.svelte`:
```svelte
<script lang="ts">
  import { base } from '$app/paths';
  import type { RouteIndexEntry } from '../data/types';
  import { selection, setHovered, setSelected } from '../map/selection';
  let { route, done }: { route: RouteIndexEntry; done: boolean } = $props();
  // Highlight when this row is either hovered or selected.
  let active = $derived($selection.selectedId === route.id || $selection.hoveredId === route.id);
</script>

<a
  class="row"
  class:active
  aria-current={active ? 'true' : undefined}
  href="{base}/route/{route.id}"
  data-testid="route-link"
  onmouseenter={() => setHovered(route.id)}
  onmouseleave={() => setHovered(null)}
  onclick={() => setSelected(route.id)}
>
  <span class="title">{route.title}</span>
  {#if route.grade}<span class="grade">{route.grade.split(' ')[0]}</span>{/if}
  {#if !route.coords}<span class="glyph" aria-label="no location" title="No location recorded">◌</span>{/if}
  {#if done}<span class="glyph" aria-label="done" title="Done">✓</span>{/if}
</a>
```

Add to the existing `<style>` block:
```css
  .row.active { background: color-mix(in srgb, currentColor 14%, transparent); }
```

- [ ] **Step 4: Run it and watch it pass**

Run: `cd app && npx vitest run src/lib/components/RouteRow.test.ts`
Expected: PASS (8 tests — 3 original plus 5 new).

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/components/RouteRow.svelte app/src/lib/components/RouteRow.test.ts
git commit -m "feat(app): report row hover and selection to the map"
```

### Task 7: Split layout — map beside the panel, bottom sheet on mobile

**Files:**
- Create: `app/src/lib/components/BottomSheet.svelte`
- Modify: `app/src/routes/+page.svelte`
- Test: `app/src/routes/library.test.ts`

**Interfaces:**
- Consumes: `MapView.svelte`; `AreaTree.svelte`; `Filters.svelte`; `buildAreaTree` from `$lib/data/areas`; `filterEntries`, `FilterOptions` from `$lib/data/filter`; `journal` from `$lib/journal/store`; `PageData` from `./$types`.
- Produces: `BottomSheet.svelte` with props `{ children: Snippet }` — a container that is a plain sidebar at desktop widths and a drag-free scrollable sheet pinned to the bottom below 48rem. Layout is CSS only; no JavaScript measures or positions anything.

The panel keeps listing **all 184 routes**, including the 59 unlocated ones, because it is
the only way to reach them. That is why the map does not replace the list.

- [ ] **Step 1: Write the failing test**

Replace the body of `app/src/routes/library.test.ts`'s describe block with:
```ts
describe('library page', () => {
  it('renders the area tree from loaded entries', () => {
    render(Page, { data: { entries } });
    expect(screen.getByRole('heading', { name: /KaapSpoor/i })).toBeTruthy();
    expect(screen.getByText('Table Mountain')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Blind Gully/ })).toBeTruthy();
  });

  it('lists unlocated routes alongside located ones, since the map cannot show them', () => {
    const unlocated = { ...entries[0], id: 'nowhere', title: 'Nowhere', coords: null };
    render(Page, { data: { entries: [...entries, unlocated] } });
    expect(screen.getByRole('link', { name: /Nowhere/ })).toBeTruthy();
    expect(screen.getAllByLabelText('no location').length).toBe(1);
  });
});
```

- [ ] **Step 2: Run it and watch the second test fail**

Run: `cd app && npx vitest run src/routes/library.test.ts`
Expected: FAIL — `Nowhere` is not rendered, because the current page has no second entry.
(If it passes already, the assertion is not exercising the new layout — check that
`entries[0]` really has coords.)

- [ ] **Step 3: Build the sheet container**

`app/src/lib/components/BottomSheet.svelte`:
```svelte
<script lang="ts">
  import type { Snippet } from 'svelte';
  let { children }: { children: Snippet } = $props();
</script>

<aside class="sheet">{@render children()}</aside>

<style>
  /* Desktop: an ordinary sidebar column. */
  .sheet {
    overflow-y: auto;
    border-left: 1px solid color-mix(in srgb, currentColor 15%, transparent);
    padding: 0.75rem;
  }

  /* Narrow screens: a sheet over the map. CSS only — nothing measures anything. */
  @media (max-width: 48rem) {
    .sheet {
      border-left: none;
      border-top: 1px solid color-mix(in srgb, currentColor 20%, transparent);
      border-radius: 12px 12px 0 0;
      background: Canvas;
      max-height: 55vh;
      box-shadow: 0 -4px 16px rgb(0 0 0 / 0.15);
    }
  }
</style>
```

- [ ] **Step 4: Rebuild the home page as a split view**

`app/src/routes/+page.svelte`:
```svelte
<script lang="ts">
  import { buildAreaTree } from '$lib/data/areas';
  import { filterEntries, type FilterOptions } from '$lib/data/filter';
  import { journal } from '$lib/journal/store';
  import AreaTree from '$lib/components/AreaTree.svelte';
  import Filters from '$lib/components/Filters.svelte';
  import MapView from '$lib/components/MapView.svelte';
  import BottomSheet from '$lib/components/BottomSheet.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  let opts = $state<FilterOptions>({ query: '', status: 'all', located: 'all' });
  let doneIds = $derived(new Set([...$journal.values()].filter((e) => e.done).map((e) => e.routeId)));
  let shown = $derived(filterEntries(data.entries, opts, doneIds));
  let tree = $derived(buildAreaTree(shown));
</script>

<h1 class="visually-hidden">KaapSpoor</h1>

<div class="split">
  <div class="map-pane">
    <!-- Pins follow the filters, so filtering the list filters the map too. -->
    <MapView entries={shown} />
  </div>
  <BottomSheet>
    <Filters bind:value={opts} />
    <AreaTree nodes={tree} {doneIds} />
  </BottomSheet>
</div>

<style>
  .split {
    display: grid;
    grid-template-columns: 1fr 22rem;
    height: calc(100vh - 3.25rem);
  }
  .map-pane { min-width: 0; }

  @media (max-width: 48rem) {
    .split { grid-template-columns: 1fr; grid-template-rows: 1fr auto; }
  }

  /* The h1 stays for document structure and the existing test, but the map is
     the page's real content so it should not take vertical space. */
  .visually-hidden {
    position: absolute;
    width: 1px; height: 1px;
    margin: -1px; padding: 0; border: 0;
    clip-path: inset(50%);
    overflow: hidden;
    white-space: nowrap;
  }
</style>
```

- [ ] **Step 5: Widen the layout so the map can fill the pane**

In `app/src/routes/+layout.svelte`, replace the `main` rule in the `<style>` block:
```css
  main { padding: 0; max-width: none; }
```
The library page now owns its own spacing; the route and settings pages keep theirs
through their own styles.

- [ ] **Step 6: Run the page test and watch it pass**

Run: `cd app && npx vitest run src/routes/library.test.ts`
Expected: PASS (2 tests). MapView mounts but paints nothing under jsdom — that is expected
and harmless; the e2e in Task 9 covers real rendering.

- [ ] **Step 7: Run the full suite and type-check**

Run: `cd app && npx vitest run && npx svelte-check --tsconfig ./tsconfig.json 2>&1 | tail -3`
Expected: all unit tests pass; `0 errors, 0 warnings`.

- [ ] **Step 8: Commit**

```bash
git add app/src/lib/components/BottomSheet.svelte app/src/routes/+page.svelte app/src/routes/+layout.svelte app/src/routes/library.test.ts
git commit -m "feat(app): split the home page into map and synchronized panel"
```

### Task 8: Route-page locator mini-map

Replaces the coordinates-as-text placeholder Plan 1 shipped.

**Files:**
- Create: `app/src/lib/components/LocatorMap.svelte`
- Modify: `app/src/routes/route/[id]/+page.svelte:19-23`
- Test: `app/src/routes/route/route-page.test.ts`

**Interfaces:**
- Consumes: `buildStyle` from `$lib/map/style`; `Coords` from `$lib/data/types`; `base` from `$app/paths`.
- Produces: `LocatorMap.svelte` with props `{ coords: Coords; title: string }` — a small non-interactive map with one marker. Scroll zoom, drag and keyboard interaction are disabled so it never traps the page scroll on a phone.

- [ ] **Step 1: Write the failing test**

Append to `app/src/routes/route/route-page.test.ts`:
```ts
it('shows a locator map for a located route', () => {
  const located = { ...route, coords: { lat: -33.97, lon: 18.39, zoom: 16 } };
  render(Page, { data: { route: located } });
  expect(screen.getByTestId('locator-map')).toBeTruthy();
});

it('shows no locator map when the route has no coordinates', () => {
  render(Page, { data: { route } }); // route fixture has coords: null
  expect(screen.queryByTestId('locator-map')).toBeNull();
  expect(screen.getByText('Location not recorded.')).toBeTruthy();
});
```

- [ ] **Step 2: Run it and watch the first fail**

Run: `cd app && npx vitest run src/routes/route/route-page.test.ts`
Expected: FAIL — no element with `data-testid="locator-map"`.

- [ ] **Step 3: Build the locator**

`app/src/lib/components/LocatorMap.svelte`:
```svelte
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { base } from '$app/paths';
  import maplibregl, { Map as MapLibreMap, Marker, AttributionControl } from 'maplibre-gl';
  import { Protocol } from 'pmtiles';
  import 'maplibre-gl/dist/maplibre-gl.css';
  import { buildStyle } from '$lib/map/style';
  import type { Coords } from '$lib/data/types';

  let { coords, title }: { coords: Coords; title: string } = $props();
  let container: HTMLDivElement;
  let map: MapLibreMap | undefined;

  onMount(() => {
    const protocol = new Protocol();
    maplibregl.addProtocol('pmtiles', protocol.tile);
    map = new MapLibreMap({
      container,
      style: buildStyle('opentopo', base),
      center: [coords.lon, coords.lat],
      zoom: coords.zoom,
      // Non-interactive: a scrollable map inside an article hijacks page scroll.
      interactive: false,
      attributionControl: false
    });
    map.addControl(new AttributionControl({ compact: true }));
    new Marker({ color: '#c1663f' }).setLngLat([coords.lon, coords.lat]).addTo(map);
  });

  onDestroy(() => {
    map?.remove();
    maplibregl.removeProtocol('pmtiles');
  });
</script>

<div class="locator" bind:this={container} data-testid="locator-map" aria-label="Location of {title}"></div>

<style>
  .locator {
    height: 14rem;
    margin: 1rem 0;
    border-radius: 8px;
    overflow: hidden;
  }
</style>
```

- [ ] **Step 4: Use it on the route page**

In `app/src/routes/route/[id]/+page.svelte`, add to the imports:
```ts
  import LocatorMap from '$lib/components/LocatorMap.svelte';
```
and replace the coordinates block (currently lines 19–23) with:
```svelte
{#if r.coords}
  <LocatorMap coords={r.coords} title={r.title} />
{:else}
  <p class="loc muted">Location not recorded.</p>
{/if}
```

- [ ] **Step 5: Run the test and watch it pass**

Run: `cd app && npx vitest run src/routes/route/route-page.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Full suite and type-check**

Run: `cd app && npx vitest run && npx svelte-check --tsconfig ./tsconfig.json 2>&1 | tail -3`
Expected: all pass; `0 errors, 0 warnings`.

- [ ] **Step 7: Commit**

```bash
git add app/src/lib/components/LocatorMap.svelte app/src/routes/route
git commit -m "feat(app): show a locator mini-map on located route pages"
```

### Task 9: End-to-end map spec

This is the only place the real map is exercised — real Chromium, real WebGL. Everything
the unit tests cannot reach is proven here.

**Files:**
- Create: `app/e2e/map.spec.ts`

**Interfaces:**
- Consumes: the built site served by `vite preview` (already configured in `app/playwright.config.ts`); `data-testid="map"` from `MapView.svelte`; `data-testid="route-link"` from `RouteRow.svelte`.
- Produces: no exports — a spec file.

- [ ] **Step 1: Write the spec**

`app/e2e/map.spec.ts`:
```ts
import { test, expect } from '@playwright/test';

test.describe('map', () => {
  test('mounts a WebGL canvas', async ({ page }) => {
    await page.goto('/');
    const canvas = page.locator('[data-testid="map"] canvas');
    await expect(canvas).toBeVisible();
  });

  test('adds the pin layer once the style has loaded', async ({ page }) => {
    await page.goto('/');
    // MapView sets data-map-ready only after the style load event fired and the
    // pins layer was added, so this asserts the real thing rather than merely
    // that a canvas element exists.
    await expect(page.locator('[data-testid="map"][data-map-ready="true"]')).toBeAttached({
      timeout: 15_000
    });
  });

  test('shows the OpenStreetMap attribution the licence requires', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.maplibregl-ctrl-attrib')).toContainText('OpenStreetMap');
  });

  test('offers a geolocate control', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.maplibregl-ctrl-geolocate')).toBeVisible();
  });

  test('hovering a panel row marks it current, proving the map/panel sync', async ({ page }) => {
    await page.goto('/');
    const row = page.getByTestId('route-link').first();
    // Hover rather than click: a click navigates away, which would end the test
    // before the shared selection state could be observed.
    await row.hover();
    await expect(row).toHaveAttribute('aria-current', 'true');
  });

  test('a located route page shows its locator map', async ({ page }) => {
    await page.goto('/route/table-mountain--atlantic-west--kasteelspoort');
    await expect(page.getByTestId('locator-map')).toBeVisible();
  });
});
```

- [ ] **Step 2: Run the e2e**

Run: `cd app && npm run test:e2e`
Expected: all specs pass — the existing `journal.spec.ts` plus these six.

If the map-ready assertion times out, the cause is real — the style failed to load — so
investigate the console output rather than raising the timeout. Do not delete a failing
spec or weaken it to a bare visibility check.

- [ ] **Step 3: Commit**

```bash
git add app/e2e/map.spec.ts
git commit -m "test(app): e2e coverage for the map, attribution and locator"
```

### Task 10: Tile pipeline — build and measure

The plan's one genuinely uncertain output. It is deliberately last among the build steps so
the app already works before this runs, and its purpose is as much **measurement** as
production: the hosting decision depends on the number this task produces.

**Files:**
- Create: `tools/tiles/README.md`
- Create: `tools/tiles/bbox.json`
- Create: `tools/tiles/profile/trails-profile.yml`
- Create: `tools/tiles/build-trails.sh`
- Create: `tools/tiles/build-contours.sh`
- Create: `tools/tiles/report-size.mjs`
- Modify: `.gitignore` (ignore downloads and generated tiles)

**Interfaces:**
- Consumes: `bbox.json` as the single source of truth for the window; external tools `planetiler`, `gdal_contour`, `tippecanoe`.
- Produces: `app/static/tiles/trails.pmtiles` and `app/static/tiles/contours.pmtiles`, plus a printed size report. Source-layer names **must** be `paths`, `roads`, `water`, `peaks` (trails) and `contours` (contours), because `style.ts` from Task 4 already references exactly those names.

- [ ] **Step 1: Pin the window**

`tools/tiles/bbox.json`:
```json
{
  "comment": "Bounding box of all located KaapSpoor routes plus ~0.2 deg margin. Single source of truth for both tile builds.",
  "west": 17.8,
  "south": -34.5,
  "east": 20.9,
  "north": -32.4
}
```

- [ ] **Step 2: Ignore the heavy intermediates**

Append to `.gitignore`:
```
tools/tiles/downloads/
tools/tiles/work/
app/static/tiles/
```

- [ ] **Step 3: Define the minimal trails profile**

`tools/tiles/profile/trails-profile.yml`:
```yaml
# Planetiler custom schema. Deliberately minimal: every class omitted here is
# bytes we do not ship. "Thin roads" means trunk..residential only — enough to
# find a trailhead, nothing below that (no service roads, driveways, buildings).
schema_name: KaapSpoor trails
schema_description: Footpaths, tracks, water, peaks and access roads only
attribution: '&copy; OpenStreetMap contributors'
sources:
  osm:
    type: osm
    local_path: downloads/region.osm.pbf
layers:
  - id: paths
    features:
      - source: osm
        geometry: line
        include_when:
          highway: [path, footway, track, steps, bridleway]
        attributes:
          - key: highway
          - key: name
          - key: sac_scale
  - id: roads
    features:
      - source: osm
        geometry: line
        include_when:
          highway: [trunk, primary, secondary, tertiary, residential, unclassified]
        attributes:
          - key: highway
          - key: name
  - id: water
    features:
      - source: osm
        geometry: polygon
        include_when:
          natural: [water]
          landuse: [reservoir]
  - id: peaks
    features:
      - source: osm
        geometry: point
        include_when:
          natural: [peak, saddle]
        attributes:
          - key: name
          - key: ele
```

- [ ] **Step 4: Write the trails build script**

`tools/tiles/build-trails.sh`:
```bash
#!/usr/bin/env bash
# Build trails.pmtiles from an OSM extract clipped to bbox.json.
# Prerequisites: java 21+, planetiler.jar in this directory, curl, jq.
set -euo pipefail
cd "$(dirname "$0")"

mkdir -p downloads work ../../app/static/tiles

W=$(jq -r .west bbox.json); S=$(jq -r .south bbox.json)
E=$(jq -r .east bbox.json); N=$(jq -r .north bbox.json)

if [ ! -f downloads/region.osm.pbf ]; then
  echo "Downloading the South Africa extract (~200 MB, once)..."
  curl -L --fail -o downloads/region.osm.pbf \
    https://download.geofabrik.de/africa/south-africa-latest.osm.pbf
fi

java -Xmx4g -jar planetiler.jar \
  --schema=profile/trails-profile.yml \
  --bounds="$W,$S,$E,$N" \
  --download=false \
  --output=../../app/static/tiles/trails.pmtiles \
  --force

echo "trails.pmtiles built."
```
Make it executable: `chmod +x tools/tiles/build-trails.sh`

- [ ] **Step 5: Write the contours build script**

`tools/tiles/build-contours.sh`:
```bash
#!/usr/bin/env bash
# Build contours.pmtiles from a DEM: 20 m intervals, source layer "contours",
# with an "ele" attribute so style.ts can weight the indexed 100 m lines.
# Prerequisites: gdal (gdal_contour, gdalwarp), tippecanoe, curl, jq.
set -euo pipefail
cd "$(dirname "$0")"

mkdir -p downloads work ../../app/static/tiles

W=$(jq -r .west bbox.json); S=$(jq -r .south bbox.json)
E=$(jq -r .east bbox.json); N=$(jq -r .north bbox.json)

if [ ! -f downloads/dem.tif ]; then
  echo "Place a DEM covering the bbox at downloads/dem.tif before running." >&2
  echo "Copernicus GLO-30 or SRTM 30 m both work; see README.md." >&2
  exit 1
fi

gdalwarp -te "$W" "$S" "$E" "$N" -r bilinear \
  downloads/dem.tif work/dem-clipped.tif

gdal_contour -a ele -i 20 work/dem-clipped.tif work/contours.gpkg

tippecanoe -o ../../app/static/tiles/contours.pmtiles \
  --layer=contours \
  --minimum-zoom=10 --maximum-zoom=14 \
  --drop-densest-as-needed \
  --force \
  work/contours.gpkg

echo "contours.pmtiles built."
```
Make it executable: `chmod +x tools/tiles/build-contours.sh`

- [ ] **Step 6: Write the size report**

`tools/tiles/report-size.mjs`:
```js
// Report measured tile sizes. Phase 0 taught us that projections move a lot
// once real bytes arrive, so the hosting decision waits for this number.
import { statSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dir = resolve(here, '../../app/static/tiles');
const COMMIT_THRESHOLD_MB = 50;

let total = 0;
for (const name of ['trails.pmtiles', 'contours.pmtiles']) {
  const path = resolve(dir, name);
  if (!existsSync(path)) {
    console.log(`${name}: MISSING`);
    continue;
  }
  const mb = statSync(path).size / 1024 / 1024;
  total += mb;
  console.log(`${name}: ${mb.toFixed(1)} MB`);
}
console.log(`total: ${total.toFixed(1)} MB`);
console.log(
  total <= COMMIT_THRESHOLD_MB
    ? `=> under ${COMMIT_THRESHOLD_MB} MB: commit the tiles to the repo.`
    : `=> over ${COMMIT_THRESHOLD_MB} MB: publish as a GitHub Release asset and have CI download them.`
);
```

- [ ] **Step 7: Document it**

`tools/tiles/README.md`:
```markdown
# Tile build

Builds the two PMTiles archives the map needs. Output is git-ignored; see the size
report for whether to commit it or publish it as a release asset.

## Prerequisites

- Java 21+ and `planetiler.jar` in this directory
  (<https://github.com/onthegomap/planetiler/releases>)
- GDAL (`gdal_contour`, `gdalwarp`), `tippecanoe`, `curl`, `jq`
- A DEM covering `bbox.json` at `downloads/dem.tif` — Copernicus GLO-30
  (<https://registry.opendata.aws/copernicus-dem/>) or SRTM 30 m both work

## Build

```bash
./build-trails.sh      # downloads the region extract on first run
./build-contours.sh    # needs downloads/dem.tif in place
node report-size.mjs
```

## Contract with the app

`app/src/lib/map/style.ts` references these source-layer names. Renaming them here
breaks the map:

| Archive | Source layers |
|---|---|
| `trails.pmtiles` | `paths`, `roads`, `water`, `peaks` |
| `contours.pmtiles` | `contours` (with an `ele` attribute) |

Contours are 20 m intervals; `style.ts` weights lines where `ele % 100 == 0`.

## Licensing

OSM data is ODbL — attribution is required and already wired into the style. The DEM's
own attribution belongs in the style's attribution string too.
```

- [ ] **Step 8: Build and measure**

Run:
```bash
cd tools/tiles && ./build-trails.sh && ./build-contours.sh && node report-size.mjs
```
Expected: both archives exist and the report prints a total with a commit-or-release
recommendation. **Record the actual number in your report** — the next task depends on it.

If a prerequisite is missing and cannot be installed, stop and report BLOCKED with the
exact tool and error rather than faking or skipping the measurement.

- [ ] **Step 9: Commit the tooling (not the tiles)**

```bash
git add tools/tiles .gitignore
git commit -m "feat(tiles): build minimal trails and contour PMTiles, and measure them"
```

### Task 11: Swap the basemap to self-hosted, and gate the size in CI

The final step: flip the app off OpenTopoMap and onto the tiles Task 10 produced, then make
CI enforce the outcome. Do not start this task until Task 10 has reported a real size.

**Files:**
- Modify: `app/src/lib/components/MapView.svelte` (default basemap)
- Modify: `app/src/lib/components/LocatorMap.svelte` (basemap)
- Modify: `app/src/lib/map/style.test.ts` (assert the shipped default)
- Modify: `.github/workflows/deploy.yml` (make tiles available to the build)
- Modify: `data/README.md` or `tools/tiles/README.md` (record the measured size + decision)

**Interfaces:**
- Consumes: `buildStyle('selfhosted', base)` from Task 4; the archives from Task 10.
- Produces: an app whose shipped basemap is keyless and self-hosted. No new exports.

- [ ] **Step 1: Write the failing test for the shipped default**

Append to `app/src/lib/map/style.test.ts`:
```ts
import { SHIPPED_BASEMAP } from './style';

describe('shipped basemap', () => {
  it('is self-hosted, so the app depends on no external tile service', () => {
    expect(SHIPPED_BASEMAP).toBe('selfhosted');
  });
  it('produces a style with no third-party tile host', () => {
    const json = JSON.stringify(buildStyle(SHIPPED_BASEMAP, ''));
    expect(json).not.toContain('opentopomap.org');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd app && npx vitest run src/lib/map/style.test.ts`
Expected: FAIL — `SHIPPED_BASEMAP` is not exported.

- [ ] **Step 3: Export the shipped default and use it everywhere**

In `app/src/lib/map/style.ts`, add below the `Basemap` type:
```ts
// The basemap the app actually ships. OpenTopoMap was a staging basemap while the
// map UX was built; shipping it would reintroduce an external dependency.
export const SHIPPED_BASEMAP: Basemap = 'selfhosted';
```

In `app/src/lib/components/MapView.svelte`, change the import and the prop default:
```ts
  import { buildStyle, SHIPPED_BASEMAP, type Basemap } from '$lib/map/style';
```
```ts
  let { entries, basemap = SHIPPED_BASEMAP }: { entries: RouteIndexEntry[]; basemap?: Basemap } = $props();
```

In `app/src/lib/components/LocatorMap.svelte`, change the import and the style call:
```ts
  import { buildStyle, SHIPPED_BASEMAP } from '$lib/map/style';
```
```ts
      style: buildStyle(SHIPPED_BASEMAP, base),
```

- [ ] **Step 4: Run the unit tests and type-check**

Run: `cd app && npx vitest run && npx svelte-check --tsconfig ./tsconfig.json 2>&1 | tail -3`
Expected: all pass; `0 errors, 0 warnings`.

- [ ] **Step 5: Verify against the real tiles locally**

Run:
```bash
cd app && npm run build && npm run preview -- --port 4173
```
Then open <http://localhost:4173/> and confirm by eye: contour lines are visible, paths
render, pins sit on the terrain, and the attribution control shows OpenStreetMap. Stop the
server when done.

If tiles are missing the map will be blank — that means Task 10's output is not in
`app/static/tiles/`.

- [ ] **Step 6: Run the e2e against the self-hosted basemap**

Run: `cd app && npm run test:e2e`
Expected: all specs still pass. The attribution spec now asserts against the self-hosted
attribution string, which still contains "OpenStreetMap".

- [ ] **Step 7: Make CI able to build the map**

The tiles are git-ignored, so CI needs them. Apply whichever branch matches Task 10's
measured size.

**If the report said commit them** (total ≤ 50 MB): stop ignoring them and commit.
Remove `app/static/tiles/` from `.gitignore`, then:
```bash
git add -f app/static/tiles/trails.pmtiles app/static/tiles/contours.pmtiles .gitignore
```
No workflow change is needed — the checkout already has them.

**If the report said release asset** (total > 50 MB): keep them ignored, publish them once
by hand, and teach CI to fetch them. Publish:
```bash
gh release create tiles-v1 \
  app/static/tiles/trails.pmtiles app/static/tiles/contours.pmtiles \
  --title "Map tiles v1" --notes "Trails and contour PMTiles for the KaapSpoor map."
```
Then in `.github/workflows/deploy.yml`, insert this step immediately **before** the
`- run: npm run build` step:
```yaml
      - name: Fetch map tiles
        run: |
          mkdir -p static/tiles
          gh release download tiles-v1 --dir static/tiles --clobber
        env:
          GH_TOKEN: ${{ github.token }}
```

- [ ] **Step 8: Record the measurement and the decision**

Append a "Measured" section to `tools/tiles/README.md` recording the real numbers from
Task 10's `report-size.mjs` run. Use this shape, with today's date and the actual sizes
substituted — the committed file must contain real measurements, not blanks:

```markdown
## Measured (record each rebuild)

| Date | trails.pmtiles | contours.pmtiles | Total | Hosting |
|---|---|---|---|---|
| 2026-07-26 | 38.4 MB | 11.2 MB | 49.6 MB | committed |
```

(The row above is an example of the format. Write your own measured values and the
hosting choice they implied.)

- [ ] **Step 9: Confirm the whole pipeline, including the size gate**

Run:
```bash
cd app && MSYS_NO_PATHCONV=1 BASE_PATH=/KaapSpoor npm run build && node scripts/check-size.mjs build
```
Expected: build succeeds; the size report prints the published total and exits 0. It must
remain under 1 GB with room for the deferred ~230 MB photo pass — if tiles plus app exceed
~700 MB, stop and report it rather than shipping something that will strand the photos.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat(app): ship the self-hosted keyless basemap"
```

---

## Plan complete

At the end of Task 11 the app is a deployed static site whose home page is a hiking map:
the 125 located routes as clustered pins over self-hosted contours and trails, no API keys
and no usage caps, synchronized with a panel that still lists all 184 routes so the 59
unlocated ones stay reachable. Route pages carry a locator mini-map, the journal toggle no
longer loses a click, and CI enforces the 1 GB ceiling.

**Deferred beyond this plan:** hillshade, offline/PWA, the photo pass (tier already chosen:
WebP 640 q70), hand-geocoding the 59 unlocated routes, and a visual design pass — which is
best done now that the layout has reached its final shape.
