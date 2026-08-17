# Drawn Route Lines Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** let the author draw each route's line by clicking along the rendered hiking trails, with named variants under one entry, and retire the two tiers that inferred lines from prose.

**Architecture:** A pure TypeScript snapping engine (`snap.ts`) builds a walk graph from the vector-tile path features the map has already loaded, so a click follows the trails to the previous click instead of tracing every bend. A dev-only `/draw` page uses it, and saves through a Vite dev-server middleware straight into `data/route-lines.geojson`. The public map draws every variant of the selected route from that committed file, and nothing else.

**Tech Stack:** TypeScript strict · Svelte 5 runes · MapLibre GL v6 · Vite 5 dev middleware · Vitest · Playwright · `@sveltejs/adapter-static` 3.0.10.

**Spec:** `docs/superpowers/specs/2026-08-17-drawn-route-lines-design.md`

## Global Constraints

- **Every line on the map is drawn by the author.** No inferred geometry ships. A route with nothing drawn keeps its pin and draws nothing.
- **Snap tolerance is 15 screen pixels**, converted to metres by the page at the current zoom. A click with no trail node that close is refused with a message — never a free-hand point.
- **Node keys round coordinates to 7 decimal places**, matching `tools/routelines/kaap_routelines/geo.py`. Seven places is ~1 cm.
- **Coordinate order is `[lon, lat]`** everywhere, as GeoJSON and MapLibre write it.
- **`/draw` must never appear in `app/build`.** Asserted by a test, not by care.
- **Unit tests must pass with no OSM extract and no tiles present.** CI runs `npm test` and `npm run check` *before* it downloads the tiles release.
- **TypeScript strict, no `any`.** Narrow explicitly rather than casting.
- **Every URL goes through `base` from `$app/paths`.**
- **MapLibre rendering is tested in Playwright only.** jsdom has no WebGL.
- **No tile rebuild, no new release asset, no change to `TILES_TAG`.**
- **Commit messages** describe what the change does for the map, in the voice of the existing log (`git log --oneline`). Never add a `Co-Authored-By: Claude` trailer.

## File Structure

**Created:**

| file | responsibility |
|---|---|
| `app/src/lib/map/snap.ts` | node keys, junction splitting, graph, nearest node, Dijkstra |
| `app/src/lib/map/snap.test.ts` | its tests, mirroring the Python ones |
| `app/src/lib/draw/state.ts` | the drawing's data: variants, legs, undo, to/from GeoJSON |
| `app/src/lib/draw/state.test.ts` | its tests |
| `app/src/routes/draw/+page.ts` | `prerender = false` — the one line that keeps it out of the build |
| `app/src/routes/draw/+page.svelte` | the editor |
| `app/vite-plugin-route-lines.ts` | dev-only middleware that writes `data/route-lines.geojson` |
| `app/vite-plugin-route-lines.test.ts` | its handler's tests |
| `app/src/lib/components/RouteVariants.svelte` | the panel's variant list with captions |
| `app/src/lib/components/RouteVariants.test.ts` | its tests |
| `app/build-output.test.ts` | `/draw` absent from the built site; expected pages present |

**Modified:**

| file | change |
|---|---|
| `app/svelte.config.js` | `strict: false` on the adapter |
| `app/vite.config.ts` | register the dev-only plugin |
| `app/src/lib/data/types.ts` | drop `lineSource`; add `RouteLine` to `RouteContent` |
| `app/scripts/transform.ts` | read variants onto content; `hasLine` from the file |
| `app/scripts/transform.test.ts` | cover it |
| `app/src/lib/map/route-lines.ts` | filter by route, emphasise by variant |
| `app/src/lib/map/route-lines.test.ts` | cover it |
| `app/src/lib/map/style.ts` | a third layer for the emphasised variant |
| `app/src/lib/map/style.test.ts` | cover it |
| `app/src/lib/map/selection.ts` | carry the hovered variant |
| `app/src/lib/map/selection.test.ts` | cover it |
| `app/src/lib/components/MapView.svelte` | draw every variant; emphasise one |
| `app/src/lib/components/LocatorMap.svelte` | same, on the route page |
| `app/src/lib/components/RoutePreview.svelte` | render `RouteVariants` |
| `app/src/lib/components/ProvenanceNote.svelte` | one sentence about the drawn line |
| `app/src/routes/route/[id]/+page.svelte` | pass variants through |
| `app/e2e/map.spec.ts` | variants draw, emphasis, deselect clears |
| `data/route-lines.geojson` | replaced with an empty collection |
| `tools/routelines/README.md` | rewritten for what remains |

**Deleted:** `tools/routelines/kaap_routelines/{cli,walk,report,mentions,ids}.py` and their tests; `data/route-relations.json`.

---

## Task 1: The snapping engine

**Files:**
- Create: `app/src/lib/map/snap.ts`, `app/src/lib/map/snap.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type Point = [number, number]` (lon, lat); `type NodeKey = string`
  - `nodeKey(point: Point): NodeKey`
  - `haversineM(a: Point, b: Point): number`
  - `splitAtJunctions(lines: Point[][]): Point[][]`
  - `interface SnapGraph { adjacency: Map<NodeKey, Edge[]>; nodes: Map<NodeKey, Point> }`
  - `interface Edge { a: NodeKey; b: NodeKey; coords: Point[]; lengthM: number }`
  - `buildGraph(lines: Point[][]): SnapGraph`
  - `nearestNode(graph: SnapGraph, point: Point, withinM: number): NodeKey | null`
  - `routeBetween(graph: SnapGraph, from: NodeKey, to: NodeKey): Point[] | null`

This is a port of `tools/routelines/kaap_routelines/{geo,graph}.py`, whose behaviour 64 Python tests already pin. Keep the names recognisable against that source.

- [ ] **Step 1: Write the failing tests**

`app/src/lib/map/snap.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  nodeKey, haversineM, splitAtJunctions, buildGraph, nearestNode, routeBetween,
  type Point
} from './snap';

const A: Point = [18.400, -34.000];
const B: Point = [18.410, -34.000];
const C: Point = [18.420, -34.000];
const NORTH: Point = [18.410, -33.990];
const FAR: Point = [18.500, -34.000];
const FAR_EAST: Point = [18.510, -34.000];

describe('nodeKey', () => {
  it('rounds to seven places, which is how two lines are recognised as meeting', () => {
    expect(nodeKey([18.4012345678, -33.9587654321])).toBe(nodeKey([18.40123456, -33.95876543]));
  });

  it('keeps genuinely different nodes apart', () => {
    expect(nodeKey([18.4012346, -33.9587654])).not.toBe(nodeKey([18.4012347, -33.9587654]));
  });
});

describe('haversineM', () => {
  it('matches a known distance — a degree of latitude is ~111 km', () => {
    const d = haversineM([18.4, -34.0], [18.4, -33.0]);
    expect(d).toBeGreaterThan(110_000);
    expect(d).toBeLessThan(112_000);
  });
});

describe('splitAtJunctions', () => {
  it('leaves a line with no junction inside it alone', () => {
    expect(splitAtJunctions([[A, B, C]])).toEqual([[A, B, C]]);
  });

  it('cuts a line where another meets it mid-span', () => {
    // THE reason this function exists. A third of junctions in the shipped
    // tiles are interior vertices of some feature, so joining only at feature
    // endpoints leaves the network in disconnected pieces and no click can
    // route to the next one.
    const pieces = splitAtJunctions([[A, B, C], [B, NORTH]]);
    expect(pieces).toHaveLength(3);
    expect(pieces).toContainEqual([A, B]);
    expect(pieces).toContainEqual([B, C]);
  });

  it('does not cut a line where it touches only itself', () => {
    // A lollipop shares a coordinate with itself, not with another line.
    expect(splitAtJunctions([[A, B, C, B, NORTH]])).toHaveLength(1);
  });
});

describe('buildGraph', () => {
  it('joins two lines that share an endpoint', () => {
    const graph = buildGraph([[A, B], [B, C]]);
    expect(graph.adjacency.get(nodeKey(B))).toHaveLength(2);
  });

  it('records every node so a click has something to snap to', () => {
    const graph = buildGraph([[A, B]]);
    expect([...graph.nodes.keys()].sort()).toEqual([nodeKey(A), nodeKey(B)].sort());
  });
});

describe('nearestNode', () => {
  it('finds the node under the click', () => {
    const graph = buildGraph([[A, B]]);
    // ~90 m east of A at this latitude.
    expect(nearestNode(graph, [18.401, -34.0], 250)).toBe(nodeKey(A));
  });

  it('refuses a click with no trail near it', () => {
    const graph = buildGraph([[A, B]]);
    expect(nearestNode(graph, [18.5, -34.0], 250)).toBe(null);
  });
});

describe('routeBetween', () => {
  it('follows the trails across a join', () => {
    const graph = buildGraph([[A, B], [B, C]]);
    expect(routeBetween(graph, nodeKey(A), nodeKey(C))).toEqual([A, B, C]);
  });

  it('walks a split line, so an interior junction is usable', () => {
    const graph = buildGraph(splitAtJunctions([[A, B, C], [B, NORTH]]));
    expect(routeBetween(graph, nodeKey(A), nodeKey(NORTH))).toEqual([A, B, NORTH]);
  });

  it('takes the shorter of two ways round', () => {
    const detour: Point = [18.405, -34.05];
    const graph = buildGraph([[A, detour], [detour, C], [A, C]]);
    expect(routeBetween(graph, nodeKey(A), nodeKey(C))).toEqual([A, C]);
  });

  it('returns null when the two points are not connected', () => {
    // Two trails on opposite sides of the peninsula. The editor shows this as
    // "no trail connects that to the last point" rather than drawing a straight
    // line across the mountain.
    const graph = buildGraph([[A, B], [FAR, FAR_EAST]]);
    expect(routeBetween(graph, nodeKey(A), nodeKey(FAR))).toBe(null);
  });

  it('returns a single point when asked to route to where it already is', () => {
    const graph = buildGraph([[A, B]]);
    expect(routeBetween(graph, nodeKey(A), nodeKey(A))).toEqual([A]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd app && npx vitest run src/lib/map/snap.test.ts`
Expected: FAIL — `Failed to resolve import "./snap"`.

- [ ] **Step 3: Implement the engine**

`app/src/lib/map/snap.ts`:

```ts
/**
 * Snapping a click to the trail network, and walking the trails between two
 * clicks.
 *
 * A port of tools/routelines/kaap_routelines/{geo,graph}.py, whose behaviour is
 * pinned by that tool's tests. The source of lines here is the vector tiles the
 * map has already loaded, so the editor needs no extra download and no server.
 *
 * `splitAtJunctions` is the load-bearing piece. Measured over 29 z14 tiles of
 * Table Mountain's path network: 2,063 junctions are visible endpoint-to-
 * endpoint and 1,027 are interior vertices of some feature. Joining only at
 * endpoints would therefore miss a third of them and leave the network in
 * pieces a click cannot route across.
 */

export type Point = [number, number]; // [lon, lat]
export type NodeKey = string;

const PLACES = 7; // ~1 cm; two distinct nodes are never that close
const EARTH_RADIUS_M = 6_371_008.8;

export function nodeKey(point: Point): NodeKey {
  return `${point[0].toFixed(PLACES)},${point[1].toFixed(PLACES)}`;
}

export function haversineM(a: Point, b: Point): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const [lon1, lat1] = [toRad(a[0]), toRad(a[1])];
  const [lon2, lat2] = [toRad(b[0]), toRad(b[1])];
  const h =
    Math.sin((lat2 - lat1) / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin((lon2 - lon1) / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/** Cut every line at the vertices it shares with a DIFFERENT line. */
export function splitAtJunctions(lines: Point[][]): Point[][] {
  const carrying = new Map<NodeKey, number>();
  for (const line of lines) {
    // One vote per line, so a line touching itself makes no junction.
    const own = new Set(line.map(nodeKey));
    for (const key of own) carrying.set(key, (carrying.get(key) ?? 0) + 1);
  }

  const pieces: Point[][] = [];
  for (const line of lines) {
    const keys = line.map(nodeKey);
    const cuts = [0];
    for (let i = 1; i < keys.length - 1; i++) {
      if ((carrying.get(keys[i]) ?? 0) > 1) cuts.push(i);
    }
    cuts.push(keys.length - 1);
    for (let c = 0; c < cuts.length - 1; c++) {
      const piece = line.slice(cuts[c], cuts[c + 1] + 1);
      if (piece.length >= 2) pieces.push(piece);
    }
  }
  return pieces;
}

export interface Edge {
  a: NodeKey;
  b: NodeKey;
  coords: Point[];
  lengthM: number;
}

export interface SnapGraph {
  adjacency: Map<NodeKey, Edge[]>;
  nodes: Map<NodeKey, Point>;
}

export function buildGraph(lines: Point[][]): SnapGraph {
  const adjacency = new Map<NodeKey, Edge[]>();
  const nodes = new Map<NodeKey, Point>();
  const push = (key: NodeKey, edge: Edge) => {
    const list = adjacency.get(key);
    if (list) list.push(edge);
    else adjacency.set(key, [edge]);
  };

  for (const coords of lines) {
    if (coords.length < 2) continue;
    const a = nodeKey(coords[0]);
    const b = nodeKey(coords[coords.length - 1]);
    let lengthM = 0;
    for (let i = 1; i < coords.length; i++) lengthM += haversineM(coords[i - 1], coords[i]);
    const edge: Edge = { a, b, coords, lengthM };
    nodes.set(a, coords[0]);
    nodes.set(b, coords[coords.length - 1]);
    push(a, edge);
    // A closed loop would otherwise list itself twice from one node.
    if (b !== a) push(b, edge);
  }
  return { adjacency, nodes };
}

export function nearestNode(graph: SnapGraph, point: Point, withinM: number): NodeKey | null {
  let best: NodeKey | null = null;
  let bestD = withinM;
  for (const [key, node] of graph.nodes) {
    const d = haversineM(point, node);
    if (d <= bestD) {
      best = key;
      bestD = d;
    }
  }
  return best;
}

/** The coordinates walked from `from` to `to` along the trails, or null. */
export function routeBetween(graph: SnapGraph, from: NodeKey, to: NodeKey): Point[] | null {
  const start = graph.nodes.get(from);
  if (!start) return null;
  if (from === to) return [start];

  const best = new Map<NodeKey, number>([[from, 0]]);
  const cameBy = new Map<NodeKey, { edge: Edge; prev: NodeKey }>();
  // A plain array used as a priority queue: the editor's graph is the loaded
  // tiles, thousands of edges, and a binary heap would be more machinery than
  // the problem needs.
  const queue: { key: NodeKey; cost: number }[] = [{ key: from, cost: 0 }];

  while (queue.length) {
    queue.sort((x, y) => x.cost - y.cost);
    const { key, cost } = queue.shift()!;
    if (key === to) break;
    if (cost > (best.get(key) ?? Infinity)) continue;
    for (const edge of graph.adjacency.get(key) ?? []) {
      const next = edge.a === key ? edge.b : edge.a;
      const nextCost = cost + edge.lengthM;
      if (nextCost < (best.get(next) ?? Infinity)) {
        best.set(next, nextCost);
        cameBy.set(next, { edge, prev: key });
        queue.push({ key: next, cost: nextCost });
      }
    }
  }

  if (!best.has(to)) return null;

  // Walk back, collecting each edge's coordinates in the direction travelled.
  const legs: Point[][] = [];
  let at = to;
  while (at !== from) {
    const step = cameBy.get(at);
    if (!step) return null;
    const forward = nodeKey(step.edge.coords[0]) === step.prev;
    legs.push(forward ? step.edge.coords : [...step.edge.coords].reverse());
    at = step.prev;
  }
  legs.reverse();

  const out: Point[] = [];
  for (const leg of legs) out.push(...(out.length ? leg.slice(1) : leg));
  return out;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd app && npx vitest run src/lib/map/snap.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/map/snap.ts app/src/lib/map/snap.test.ts
git commit -m "feat(map): follow the trails between two clicks"
```

---

## Task 2: What a drawing is

**Files:**
- Create: `app/src/lib/draw/state.ts`, `app/src/lib/draw/state.test.ts`

**Interfaces:**
- Consumes: `Point` (Task 1).
- Produces:
  - `interface Leg { at: Point; coords: Point[] }`
  - `interface Variant { name: string; note: string; legs: Leg[] }`
  - `newVariant(name?: string): Variant`
  - `variantCoords(variant: Variant): Point[]`
  - `undoLeg(variant: Variant): Variant`
  - `toFeatures(routeId: string, variants: Variant[], drawn: string): RouteLineFeature[]`
  - `fromFeatures(routeId: string, features: RouteLineFeature[]): Variant[]`
  - `interface RouteLineFeature` — the committed file's shape

A **leg** is one click and the trail coordinates that reaching it added, which is what makes undo mean "take back that click" rather than "take back one bend". Pure data: no map, no Svelte, so it tests without WebGL.

- [ ] **Step 1: Write the failing tests**

`app/src/lib/draw/state.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  newVariant, variantCoords, undoLeg, toFeatures, fromFeatures,
  type Variant
} from './state';
import type { Point } from '../map/snap';

const A: Point = [18.400, -34.000];
const B: Point = [18.410, -34.000];
const C: Point = [18.420, -34.000];

const drawnVariant = (): Variant => ({
  name: 'Right Hand',
  note: 'The 1952 line.',
  legs: [
    { at: A, coords: [A] },
    { at: B, coords: [A, B] },
    { at: C, coords: [B, C] }
  ]
});

describe('variantCoords', () => {
  it('joins the legs into one line without repeating the shared point', () => {
    expect(variantCoords(drawnVariant())).toEqual([A, B, C]);
  });

  it('is empty for a variant nothing has been clicked into yet', () => {
    expect(variantCoords(newVariant())).toEqual([]);
  });
});

describe('undoLeg', () => {
  it('takes back the last click and the trail it added', () => {
    expect(variantCoords(undoLeg(drawnVariant()))).toEqual([A, B]);
  });

  it('does nothing to an empty variant, rather than throwing', () => {
    expect(undoLeg(newVariant()).legs).toEqual([]);
  });
});

describe('toFeatures', () => {
  it('writes one feature per variant, carrying its name and note', () => {
    const [feature] = toFeatures('area--x', [drawnVariant()], '2026-08-17');
    expect(feature.geometry.coordinates).toEqual([A, B, C]);
    expect(feature.properties).toEqual({
      routeId: 'area--x', variant: 'Right Hand', note: 'The 1952 line.', drawn: '2026-08-17'
    });
  });

  it('omits a variant with fewer than two points, which is not a line', () => {
    const barely = { ...newVariant(), legs: [{ at: A, coords: [A] }] };
    expect(toFeatures('area--x', [barely], '2026-08-17')).toEqual([]);
  });

  it('leaves name and note off a single unnamed variant', () => {
    // One line needs no label, and an empty string in the file would render as
    // a blank chip in the panel.
    const only = { ...newVariant(), legs: drawnVariant().legs };
    const [feature] = toFeatures('area--x', [only], '2026-08-17');
    expect(feature.properties.variant).toBeUndefined();
    expect(feature.properties.note).toBeUndefined();
  });
});

describe('fromFeatures', () => {
  it('reads a saved route back for editing, keeping its variants', () => {
    const features = toFeatures('area--x', [drawnVariant()], '2026-08-17');
    const [variant] = fromFeatures('area--x', features);
    expect(variant.name).toBe('Right Hand');
    expect(variant.note).toBe('The 1952 line.');
    expect(variantCoords(variant)).toEqual([A, B, C]);
  });

  it('ignores features belonging to other routes', () => {
    const features = toFeatures('area--other', [drawnVariant()], '2026-08-17');
    expect(fromFeatures('area--x', features)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd app && npx vitest run src/lib/draw/state.test.ts`
Expected: FAIL — cannot resolve `./state`.

- [ ] **Step 3: Implement it**

`app/src/lib/draw/state.ts`:

```ts
/**
 * What a drawn route is, before it reaches the map or the disk.
 *
 * A LEG is one click plus the trail coordinates that reaching it added. Storing
 * the drawing that way is what lets undo mean "take back that click" instead of
 * "take back one bend of the path", which is the only undo an author wants.
 *
 * Pure data — no map, no Svelte — so the editor's behaviour is testable without
 * WebGL, which jsdom does not have.
 */

import type { Point } from '../map/snap';

export interface Leg {
  /** Where the author clicked (already snapped to a trail node). */
  at: Point;
  /** The trail walked to get here, starting at the previous leg's `at`. */
  coords: Point[];
}

export interface Variant {
  name: string;
  note: string;
  legs: Leg[];
}

export interface RouteLineFeature {
  type: 'Feature';
  geometry: { type: 'LineString'; coordinates: Point[] };
  properties: {
    routeId: string;
    variant?: string;
    note?: string;
    drawn: string;
  };
}

export function newVariant(name = ''): Variant {
  return { name, note: '', legs: [] };
}

export function variantCoords(variant: Variant): Point[] {
  const out: Point[] = [];
  for (const leg of variant.legs) {
    out.push(...(out.length ? leg.coords.slice(1) : leg.coords));
  }
  return out;
}

export function undoLeg(variant: Variant): Variant {
  return { ...variant, legs: variant.legs.slice(0, -1) };
}

export function toFeatures(
  routeId: string,
  variants: Variant[],
  drawn: string
): RouteLineFeature[] {
  const named = variants.length > 1;
  const features: RouteLineFeature[] = [];
  for (const variant of variants) {
    const coordinates = variantCoords(variant);
    // One point is a click, not a line. Dropping it here keeps half-drawn work
    // out of the committed file rather than shipping a degenerate geometry.
    if (coordinates.length < 2) continue;
    const properties: RouteLineFeature['properties'] = { routeId, drawn };
    if (named && variant.name) properties.variant = variant.name;
    if (named && variant.note) properties.note = variant.note;
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates },
      properties
    });
  }
  return features;
}

export function fromFeatures(routeId: string, features: RouteLineFeature[]): Variant[] {
  return features
    .filter((f) => f.properties.routeId === routeId)
    .map((f) => ({
      name: f.properties.variant ?? '',
      note: f.properties.note ?? '',
      // Read back as one leg: the trail it followed is already in the file, and
      // an author re-editing an old line redraws it rather than un-clicking it.
      legs: [{ at: f.geometry.coordinates[0], coords: f.geometry.coordinates }]
    }));
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd app && npx vitest run src/lib/draw/state.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/draw
git commit -m "feat(app): describe a drawn route as the clicks that made it"
```

---

## Task 3: A page that cannot ship

**Files:**
- Create: `app/src/routes/draw/+page.ts`, `app/src/routes/draw/+page.svelte`, `app/build-output.test.ts`
- Modify: `app/svelte.config.js`

**Interfaces:**
- Consumes: nothing.
- Produces: a `/draw` route that exists under `npm run dev` and is absent from `app/build`.

Do this before the editor itself, so the guarantee is in place before there is anything worth hiding.

- [ ] **Step 1: Add the route**

`app/src/routes/draw/+page.ts`:

```ts
// The editor is the author's tool, not part of the site. `prerender = false`
// with `strict: false` on adapter-static (svelte.config.js) means the adapter
// emits nothing for this route, so a static host has no such page to serve.
export const prerender = false;
```

`app/src/routes/draw/+page.svelte`:

```svelte
<script lang="ts">
  // Filled in by Task 4. This exists now so the build-output test below has
  // something it could accidentally ship, and proves it does not.
</script>

<h1>Route editor</h1>
<p>Development only.</p>
```

- [ ] **Step 2: Allow the adapter to skip it**

In `app/svelte.config.js`, change the adapter line:

```js
    adapter: adapter({ fallback: undefined }),
```

to:

```js
    // strict: false lets a route opt out of prerendering and simply not be
    // emitted — which is how /draw stays out of the built site. The adapter's
    // own error text describes this exact use. It does weaken a safety net for
    // OTHER routes, so build-output.test.ts asserts what the build contains.
    adapter: adapter({ fallback: undefined, strict: false }),
```

- [ ] **Step 3: Write the failing build-output test**

`app/build-output.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Guarded like transform.test.ts's anti-drift check: CI runs the unit tests
// before anything is built, so this asserts on a developer machine that has
// run `npm run build` and stays quiet on a clean checkout.
const build = resolve(process.cwd(), 'build');

describe('the built site', () => {
  it('does not ship the route editor', () => {
    if (!existsSync(build)) return;
    expect(existsSync(resolve(build, 'draw'))).toBe(false);
    expect(existsSync(resolve(build, 'draw.html'))).toBe(false);
  });

  it('still ships the pages that matter', () => {
    // strict: false removes the adapter's own guarantee that every route was
    // prerendered, so the pages we DO want are asserted here instead.
    if (!existsSync(build)) return;
    expect(existsSync(resolve(build, 'index.html'))).toBe(true);
    expect(existsSync(resolve(build, 'route'))).toBe(true);
    expect(existsSync(resolve(build, 'data', 'routes-index.json'))).toBe(true);
  });
});
```

- [ ] **Step 4: Build and run it**

```bash
cd app && npm run build && npx vitest run build-output.test.ts
```
Expected: PASS, and `app/build/draw` does not exist. If the build fails with a
prerender error, Step 2 was not applied.

- [ ] **Step 5: Confirm the page exists in dev**

```bash
cd app && npm run dev
```
Visit `/draw` and see the heading. Stop the server.

- [ ] **Step 6: Commit**

```bash
git add app/svelte.config.js app/src/routes/draw app/build-output.test.ts
git commit -m "feat(app): add an editor route the site will not carry"
```

---

## Task 4: Drawing on the trails

**Files:**
- Modify: `app/src/routes/draw/+page.svelte`

**Interfaces:**
- Consumes: `snap.ts` (Task 1), `state.ts` (Task 2).
- Produces: an editor that draws one route's variants. Saving is Task 5.

- [ ] **Step 1: Write the page**

`app/src/routes/draw/+page.svelte`:

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { base } from '$app/paths';
  import maplibre, { Map as MapLibreMap, type GeoJSONSource } from 'maplibre-gl';
  import { Protocol } from 'pmtiles';
  import 'maplibre-gl/dist/maplibre-gl.css';
  import { buildStyle, SHIPPED_BASEMAP } from '$lib/map/style';
  import { buildGraph, nearestNode, routeBetween, splitAtJunctions, nodeKey,
           type Point, type SnapGraph } from '$lib/map/snap';
  import { newVariant, undoLeg, variantCoords, type Variant } from '$lib/draw/state';
  import type { RouteIndexEntry } from '$lib/data/types';

  const SNAP_PX = 15;

  let container: HTMLDivElement;
  let map: MapLibreMap | undefined;
  let graph: SnapGraph | null = null;

  let entries = $state<RouteIndexEntry[]>([]);
  let routeId = $state<string>('');
  let variants = $state<Variant[]>([newVariant()]);
  let active = $state(0);
  let message = $state('');

  let route = $derived(entries.find((e) => e.id === routeId) ?? null);

  function redraw(): void {
    const source = map?.getSource('draw-preview') as GeoJSONSource | undefined;
    source?.setData({
      type: 'FeatureCollection',
      features: variants
        .map((v, i) => ({
          type: 'Feature' as const,
          geometry: { type: 'LineString' as const, coordinates: variantCoords(v) },
          properties: { active: i === active }
        }))
        .filter((f) => f.geometry.coordinates.length >= 2)
    });
  }

  /** Rebuild the snapping graph from whatever path features are loaded. */
  function rebuildGraph(): void {
    if (!map) return;
    const features = map.querySourceFeatures('trails', { sourceLayer: 'paths' });
    const lines: Point[][] = [];
    for (const feature of features) {
      const geometry = feature.geometry;
      if (geometry.type === 'LineString') lines.push(geometry.coordinates as Point[]);
      else if (geometry.type === 'MultiLineString') {
        for (const part of geometry.coordinates) lines.push(part as Point[]);
      }
    }
    graph = buildGraph(splitAtJunctions(lines));
  }

  /** 15 screen pixels, expressed in metres at the current centre and zoom. */
  function snapRadiusM(): number {
    if (!map) return 0;
    const centre = map.getCenter();
    const a = map.project(centre);
    const b = map.unproject([a.x + SNAP_PX, a.y]);
    return Math.abs(b.lng - centre.lng) * 111_320 * Math.cos((centre.lat * Math.PI) / 180);
  }

  function onMapClick(lngLat: { lng: number; lat: number }): void {
    if (!graph) return;
    if (!routeId) {
      message = 'Pick a route first.';
      return;
    }
    const click: Point = [lngLat.lng, lngLat.lat];
    const node = nearestNode(graph, click, snapRadiusM());
    if (!node) {
      // Refused rather than dropped free-hand: an off-trail point would be
      // indistinguishable from a snapped one afterwards, and off-path geometry
      // is deliberately out of scope (see the spec).
      message = 'No trail within 15 px of that click.';
      return;
    }
    const point = graph.nodes.get(node)!;
    const variant = variants[active];
    if (variant.legs.length === 0) {
      variant.legs.push({ at: point, coords: [point] });
      message = '';
    } else {
      const from = nodeKey(variant.legs[variant.legs.length - 1].at);
      const walked = routeBetween(graph, from, node);
      if (!walked) {
        message = 'No trail connects that to the last point.';
        return;
      }
      variant.legs.push({ at: point, coords: walked });
      message = '';
    }
    variants = [...variants];
    redraw();
  }

  onMount(() => {
    maplibre.addProtocol('pmtiles', new Protocol().tile);
    map = new MapLibreMap({
      container,
      style: buildStyle(SHIPPED_BASEMAP, base),
      center: [18.41, -33.96],
      zoom: 14
    });
    map.on('load', () => {
      map!.addSource('draw-preview', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });
      map!.addLayer({
        id: 'draw-preview-line',
        type: 'line',
        source: 'draw-preview',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['case', ['get', 'active'], '#c2410c', '#9a9a9a'],
          'line-width': 4
        }
      });
      rebuildGraph();
    });
    map.on('idle', rebuildGraph);
    map.on('click', (e) => onMapClick(e.lngLat));

    fetch(`${base}/data/routes-index.json`)
      .then((r) => r.json())
      .then((loaded: RouteIndexEntry[]) => (entries = loaded));

    return () => map?.remove();
  });

  function pickRoute(id: string): void {
    routeId = id;
    variants = [newVariant()];
    active = 0;
    redraw();
    const target = entries.find((e) => e.id === id);
    if (target?.coords) map?.flyTo({ center: [target.coords.lon, target.coords.lat], zoom: 15 });
  }
</script>

<div class="editor">
  <div class="map" bind:this={container} data-testid="draw-map"></div>

  <aside>
    <label>
      Route
      <select value={routeId} onchange={(e) => pickRoute(e.currentTarget.value)}>
        <option value="">Pick a route…</option>
        {#each entries as entry (entry.id)}
          <option value={entry.id}>{entry.hasLine ? '● ' : '○ '}{entry.title}</option>
        {/each}
      </select>
    </label>

    {#if route}
      <p class="hint">Click along the trails. Each click follows the paths from the last one.</p>

      {#each variants as variant, i (i)}
        <fieldset class:active={i === active}>
          <button type="button" onclick={() => (active = i)}>Variant {i + 1}</button>
          <input placeholder="Name (e.g. Right Hand)" bind:value={variant.name} />
          <input placeholder="What is it, and when would you take it?" bind:value={variant.note} />
          <span>{variantCoords(variant).length} points</span>
        </fieldset>
      {/each}

      <button type="button" onclick={() => { variants = [...variants, newVariant()]; active = variants.length - 1; }}>
        Add variant
      </button>
      <button type="button" onclick={() => { variants[active] = undoLeg(variants[active]); variants = [...variants]; redraw(); }}>
        Undo point
      </button>
      <button type="button" onclick={() => { variants[active] = { ...variants[active], legs: [] }; variants = [...variants]; redraw(); }}>
        Clear
      </button>
    {/if}

    {#if message}<p class="message">{message}</p>{/if}
  </aside>
</div>

<style>
  .editor { display: grid; grid-template-columns: 1fr 22rem; height: 100vh; }
  .map { width: 100%; height: 100%; }
  aside { padding: 1rem; overflow-y: auto; display: flex; flex-direction: column; gap: 0.6rem; }
  fieldset { display: grid; gap: 0.3rem; border: 1px solid #ddd; }
  fieldset.active { border-color: #c2410c; }
  .hint, .message { font-size: 0.85rem; }
  .message { color: #b45309; }
</style>
```

- [ ] **Step 2: Draw one route by hand**

```bash
cd app && npm run dev
```

Open `/draw`, pick *Platteklip Gorge*, and click from the bottom of the gorge to the top. Confirm:
the line follows the path rather than cutting straight between clicks; **Undo point** removes the
last click's segment; a click on blank hillside is refused with the message rather than adding a
point.

- [ ] **Step 3: Commit**

```bash
git add app/src/routes/draw/+page.svelte
git commit -m "feat(app): draw a route by following the trails under the cursor"
```

---

## Task 5: Saving to the repository

**Files:**
- Create: `app/vite-plugin-route-lines.ts`, `app/vite-plugin-route-lines.test.ts`
- Modify: `app/vite.config.ts`, `app/src/routes/draw/+page.svelte`

**Interfaces:**
- Consumes: `toFeatures`, `fromFeatures` (Task 2).
- Produces: `routeLinesPlugin(): Plugin` — dev-only; `saveRouteLines(existing, incoming, routeId)` — the pure merge the handler uses.

- [ ] **Step 1: Write the failing test**

`app/vite-plugin-route-lines.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { saveRouteLines } from './vite-plugin-route-lines';
import type { RouteLineFeature } from './src/lib/draw/state';

const feature = (routeId: string, variant?: string): RouteLineFeature => ({
  type: 'Feature',
  geometry: { type: 'LineString', coordinates: [[18.4, -34.0], [18.41, -34.0]] },
  properties: { routeId, drawn: '2026-08-17', ...(variant ? { variant } : {}) }
});

describe('saveRouteLines', () => {
  it('adds a route that had no line', () => {
    const out = saveRouteLines([], [feature('area--x')], 'area--x');
    expect(out).toHaveLength(1);
  });

  it('replaces every variant of the route being saved', () => {
    // Saving is "this is the route now", not "add another line to it" —
    // otherwise redrawing leaves the old shape behind for ever.
    const existing = [feature('area--x', 'Old A'), feature('area--x', 'Old B')];
    const out = saveRouteLines(existing, [feature('area--x', 'New')], 'area--x');
    expect(out.map((f) => f.properties.variant)).toEqual(['New']);
  });

  it('leaves other routes untouched', () => {
    const existing = [feature('area--other')];
    const out = saveRouteLines(existing, [feature('area--x')], 'area--x');
    expect(out.map((f) => f.properties.routeId).sort()).toEqual(['area--other', 'area--x']);
  });

  it('removes a route whose variants were all cleared', () => {
    const existing = [feature('area--x')];
    expect(saveRouteLines(existing, [], 'area--x')).toEqual([]);
  });

  it('keeps the features sorted by route id, so the committed diff is stable', () => {
    const out = saveRouteLines([feature('area--b')], [feature('area--a')], 'area--a');
    expect(out.map((f) => f.properties.routeId)).toEqual(['area--a', 'area--b']);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd app && npx vitest run vite-plugin-route-lines.test.ts`
Expected: FAIL — cannot resolve `./vite-plugin-route-lines`.

- [ ] **Step 3: Implement the plugin**

`app/vite-plugin-route-lines.ts`:

```ts
/**
 * Lets the /draw editor write data/route-lines.geojson directly.
 *
 * Registered with `apply: 'serve'`, so it exists under `npm run dev` and never
 * in a build — the deployed site is static files and has no endpoint at all.
 * Without this the author would download a file and move it into place by hand
 * after every route, which is the difference between drawing 184 routes and
 * not bothering.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';
import type { RouteLineFeature } from './src/lib/draw/state';

const FILE = resolve(process.cwd(), '..', 'data', 'route-lines.geojson');

/** The whole collection after saving one route's variants over its old ones. */
export function saveRouteLines(
  existing: RouteLineFeature[],
  incoming: RouteLineFeature[],
  routeId: string
): RouteLineFeature[] {
  const others = existing.filter((f) => f.properties.routeId !== routeId);
  return [...others, ...incoming].sort((a, b) =>
    a.properties.routeId.localeCompare(b.properties.routeId)
  );
}

export function routeLinesPlugin(): Plugin {
  return {
    name: 'kaapspoor-route-lines',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__route-lines', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('POST only');
          return;
        }
        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', () => {
          try {
            const { routeId, features } = JSON.parse(body) as {
              routeId: string;
              features: RouteLineFeature[];
            };
            const existing = existsSync(FILE)
              ? (JSON.parse(readFileSync(FILE, 'utf-8')).features as RouteLineFeature[])
              : [];
            const merged = saveRouteLines(existing, features, routeId);
            writeFileSync(
              FILE,
              JSON.stringify({ type: 'FeatureCollection', features: merged }, null, 1) + '\n',
              'utf-8'
            );
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ saved: features.length, total: merged.length }));
          } catch (err) {
            res.statusCode = 500;
            res.end(String(err));
          }
        });
      });
    }
  };
}
```

- [ ] **Step 4: Register it**

In `app/vite.config.ts`:

```ts
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { routeLinesPlugin } from './vite-plugin-route-lines';

export default defineConfig({
  plugins: [sveltekit(), routeLinesPlugin()],
```

Also add `'*.test.ts'` coverage by extending the test `include` so the plugin's test runs:

```ts
    include: ['src/**/*.{test,spec}.ts', 'scripts/**/*.{test,spec}.ts', '*.test.ts']
```

- [ ] **Step 5: Add Save to the editor**

In `app/src/routes/draw/+page.svelte`, add to the `<script>`:

```ts
  import { toFeatures, fromFeatures } from '$lib/draw/state';

  let saving = $state(false);

  async function save(): Promise<void> {
    if (!routeId) return;
    saving = true;
    try {
      const today = new Date().toISOString().slice(0, 10);
      const res = await fetch('/__route-lines', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ routeId, features: toFeatures(routeId, variants, today) })
      });
      const result = (await res.json()) as { saved: number; total: number };
      message = `Saved ${result.saved} line(s); ${result.total} in the file.`;
    } catch (err) {
      message = `Save failed: ${String(err)}`;
    } finally {
      saving = false;
    }
  }
```

and to the markup, beneath the Clear button:

```svelte
      <button type="button" onclick={save} disabled={saving}>Save</button>
```

Extend `pickRoute` to load any existing drawing back:

```ts
  async function pickRoute(id: string): Promise<void> {
    routeId = id;
    active = 0;
    const res = await fetch(`${base}/data/route-lines.geojson`);
    const collection = res.ok ? await res.json() : { features: [] };
    const saved = fromFeatures(id, collection.features);
    variants = saved.length ? saved : [newVariant()];
    redraw();
    const target = entries.find((e) => e.id === id);
    if (target?.coords) map?.flyTo({ center: [target.coords.lon, target.coords.lat], zoom: 15 });
  }
```

- [ ] **Step 6: Run the tests, then save a real route**

```bash
cd app && npx vitest run vite-plugin-route-lines.test.ts && npm run dev
```

Draw *Platteklip Gorge* again and press Save. Confirm `data/route-lines.geojson` now contains it
(`git diff data/route-lines.geojson`), then reload `/draw`, pick the same route, and confirm the
line comes back.

- [ ] **Step 7: Commit**

```bash
git add app/vite-plugin-route-lines.ts app/vite-plugin-route-lines.test.ts \
        app/vite.config.ts app/src/routes/draw/+page.svelte
git commit -m "feat(app): let the editor write the route lines file"
```

---

## Task 6: The data the app reads

**Files:**
- Modify: `app/src/lib/data/types.ts`, `app/scripts/transform.ts`, `app/scripts/transform.test.ts`, `data/route-lines.geojson`
- Modify (fixtures lose a field): every test file listing `lineSource`

**Interfaces:**
- Consumes: the file shape from Task 2.
- Produces: `RouteIndexEntry.hasLine: boolean`; `RouteContent.lines: { variant: string | null; note: string | null }[]`. `lineSource` is **removed**.

- [ ] **Step 1: Empty the file**

`data/route-lines.geojson` becomes:

```json
{
 "type": "FeatureCollection",
 "features": []
}
```

The 21 derived lines go with it — the map draws only what is drawn from here on.

- [ ] **Step 2: Write the failing transform tests**

Replace the `describe('route lines', …)` block in `app/scripts/transform.test.ts` with:

```ts
describe('route lines', () => {
  function rawWith(slugs: string[]): RawDataset {
    return {
      routes: slugs.map((slug) => ({
        slug, title: slug, url: `https://example.test/${slug}`, area: ['Area'],
        coords: { lat: -34, lon: 18.4, zoom: 15 },
        grade: null, grade_source: null, stats: {}, sections: {}, description: '',
        related: [], attachments: [], photos: { deck_ids: [], inline_urls: [] }
      }))
    };
  }

  const line = (routeId: string, variant?: string, note?: string) => ({
    type: 'Feature' as const,
    geometry: { type: 'LineString' as const, coordinates: [[18.4, -34], [18.41, -34]] },
    properties: { routeId, drawn: '2026-08-17', ...(variant ? { variant } : {}), ...(note ? { note } : {}) }
  });

  it('marks a route that has a drawn line', () => {
    const lines = { type: 'FeatureCollection' as const, features: [line('area--with-line')] };
    const { index } = transform(rawWith(['with-line', 'without-line']), {}, [], lines);
    expect(index.find((e) => e.id === 'area--with-line')!.hasLine).toBe(true);
    // Never absent: the panel and the map both branch on it.
    expect(index.find((e) => e.id === 'area--without-line')!.hasLine).toBe(false);
  });

  it('carries each variant and its caption onto the route content', () => {
    // The panel needs the names and notes; only the map needs the geometry, so
    // the coordinates stay out of the per-route JSON entirely.
    const lines = {
      type: 'FeatureCollection' as const,
      features: [
        line('area--x', 'Left Hand', 'The original line.'),
        line('area--x', 'Right Hand', 'Steeper, and what most parties climb.')
      ]
    };
    const { content } = transform(rawWith(['x']), {}, [], lines);
    expect(content[0].lines).toEqual([
      { variant: 'Left Hand', note: 'The original line.' },
      { variant: 'Right Hand', note: 'Steeper, and what most parties climb.' }
    ]);
  });

  it('gives a single unnamed line an entry with no variant name', () => {
    const lines = { type: 'FeatureCollection' as const, features: [line('area--x')] };
    const { content } = transform(rawWith(['x']), {}, [], lines);
    expect(content[0].lines).toEqual([{ variant: null, note: null }]);
  });

  it('defaults to no lines when nothing has been drawn', () => {
    const { index, content } = transform(rawWith(['x']), {}, []);
    expect(index[0].hasLine).toBe(false);
    expect(content[0].lines).toEqual([]);
  });

  // Deliberately NOT a staleness check against the OSM extract. CI has no PBF
  // when unit tests run, so such a check could only ever take the degraded path
  // and fail for being right.
  it('every line in the committed file belongs to a real route', async () => {
    const { readFileSync, existsSync } = await import('node:fs');
    const { resolve, dirname } = await import('node:path');
    let root = process.cwd();
    while (!existsSync(resolve(root, 'data/routes.json')) && dirname(root) !== root) {
      root = dirname(root);
    }
    const linesPath = resolve(root, 'data/route-lines.geojson');
    const indexPath = resolve(root, 'app/static/data/routes-index.json');
    if (!existsSync(linesPath) || !existsSync(indexPath)) return;
    const lines = JSON.parse(readFileSync(linesPath, 'utf-8')) as RouteLines;
    const ids = new Set(
      (JSON.parse(readFileSync(indexPath, 'utf-8')) as { id: string }[]).map((e) => e.id)
    );
    for (const f of lines.features) expect(ids.has(f.properties.routeId)).toBe(true);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd app && npx vitest run scripts`
Expected: FAIL — `content[0].lines` is undefined.

- [ ] **Step 4: Change the types**

In `app/src/lib/data/types.ts`, **delete** the `lineSource` field and its comment, leave `hasLine`
with this comment, and add `RouteLine` plus a field on `RouteContent`:

```ts
  /**
   * True when the author has drawn this route's line. The geometry itself
   * lives in one static file the map fetches once — see
   * docs/superpowers/specs/2026-08-17-drawn-route-lines-design.md.
   */
  hasLine: boolean;
```

```ts
/** One drawn line of a route: an alternative, with a caption saying what it is. */
export interface RouteLine {
  variant: string | null;
  note: string | null;
}
```

and inside `RouteContent`:

```ts
  /** Empty when nothing is drawn. One entry per variant, in file order. */
  lines: RouteLine[];
```

- [ ] **Step 5: Change transform.ts**

Replace the `RouteLineFeature` interface with the drawn shape and set both fields:

```ts
export interface RouteLineFeature {
  properties: { routeId: string; variant?: string; note?: string };
}
export interface RouteLines {
  features: RouteLineFeature[];
}
```

Inside `transform`, replace the `lineSources` map with:

```ts
  const linesByRoute = new Map<string, RouteLine[]>();
  for (const feature of lines.features) {
    const list = linesByRoute.get(feature.properties.routeId) ?? [];
    list.push({ variant: feature.properties.variant ?? null, note: feature.properties.note ?? null });
    linesByRoute.set(feature.properties.routeId, list);
  }
```

In the `entry` literal, replace the two `lineSource`/`hasLine` lines with:

```ts
      // A flag rather than the geometry: the line itself is fetched once,
      // lazily, from a single static file the first time a selection needs it.
      hasLine: linesByRoute.has(id),
```

In the `content.push({ … })` call, add:

```ts
      lines: linesByRoute.get(id) ?? [],
```

Import `RouteLine` alongside the other types, and change the closing log's line count to
`` `${index.filter((e) => e.hasLine).length} have a drawn line` ``.

- [ ] **Step 6: Fix every fixture the removed field breaks**

`npm run check` will list them. In each, delete the `lineSource: null,` line; add `lines: [],` to
any `RouteContent` fixture (`RoutePreview.test.ts`, `route-page.test.ts`, and `library.test.ts`'s
`content`).

- [ ] **Step 7: Run everything**

```bash
cd app && npm test && npm run check && npm run build:data
```
Expected: PASS, and the build logs `0 have a drawn line` until routes are drawn.

- [ ] **Step 8: Commit**

```bash
git add app/src app/scripts data/route-lines.geojson
git commit -m "feat(app): carry each drawn variant and its caption to the page"
```

---

## Task 7: The map draws every variant

**Files:**
- Modify: `app/src/lib/map/route-lines.ts`, `app/src/lib/map/route-lines.test.ts`, `app/src/lib/map/style.ts`, `app/src/lib/map/style.test.ts`, `app/src/lib/components/MapView.svelte`, `app/src/lib/components/LocatorMap.svelte`

**Interfaces:**
- Consumes: `hasLine` (Task 6).
- Produces: `ROUTE_LINE_LAYERS: readonly ['route-line-casing', 'route-line', 'route-line-active']`; `routeLineFilter(routeId: string | null): FilterSpecification`; `activeVariantFilter(routeId: string | null, variant: string | null): FilterSpecification`.

- [ ] **Step 1: Write the failing tests**

Add to `app/src/lib/map/route-lines.test.ts`:

```ts
import { activeVariantFilter } from './route-lines';

describe('variants', () => {
  it('names three layers, the active one last so it draws on top', () => {
    expect(ROUTE_LINE_LAYERS).toEqual(['route-line-casing', 'route-line', 'route-line-active']);
  });

  it('draws every variant of the selected route', () => {
    expect(routeLineFilter('a--b--c')).toEqual(['in', ['get', 'routeId'], ['literal', ['a--b--c']]]);
  });

  it('matches nothing when no variant is being pointed at', () => {
    expect(activeVariantFilter('a--b--c', null)).toEqual([
      'in', ['get', 'variant'], ['literal', []]
    ]);
  });

  it('matches one route AND one variant, never a namesake on another route', () => {
    // 'Right Hand' is a name several entries will use.
    expect(activeVariantFilter('a--b--c', 'Right Hand')).toEqual([
      'all',
      ['in', ['get', 'routeId'], ['literal', ['a--b--c']]],
      ['in', ['get', 'variant'], ['literal', ['Right Hand']]]
    ]);
  });
});
```

Add to `app/src/lib/map/style.test.ts`, inside `describe('route lines and named paths', …)`:

```ts
  it('carries a third layer for the variant being pointed at', () => {
    const layers = ids();
    expect(layers).toContain('route-line-active');
    expect(layers.indexOf('route-line-active')).toBeGreaterThan(layers.indexOf('route-line'));
    expect(layers.indexOf('route-line-active')).toBeLessThan(layers.indexOf('region-mask'));
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd app && npx vitest run src/lib/map`
Expected: FAIL — `activeVariantFilter` is not exported; `route-line-active` missing.

- [ ] **Step 3: Extend route-lines.ts**

Change the layer list and add the filter:

```ts
/** Casing, then every variant, then the one being pointed at, on top. */
export const ROUTE_LINE_LAYERS = ['route-line-casing', 'route-line', 'route-line-active'] as const;

/**
 * One route AND one variant. Both halves matter: variant names repeat across
 * entries — several routes have a "Right Hand" — so filtering on the name alone
 * would light a line on another mountain.
 */
export function activeVariantFilter(
  routeId: string | null,
  variant: string | null
): FilterSpecification {
  if (!routeId || !variant) return ['in', ['get', 'variant'], ['literal', []]];
  return [
    'all',
    ['in', ['get', 'routeId'], ['literal', [routeId]]],
    ['in', ['get', 'variant'], ['literal', [variant]]]
  ];
}

export function routeLineActivePaint(): NonNullable<LineLayerSpecification['paint']> {
  return {
    'line-color': [
      'case',
      ['boolean', ['feature-state', 'done'], false],
      PIN_COLOR_DONE,
      PIN_COLOR_TODO
    ],
    // Wider and opaque against the same colour at 0.55: the difference reads as
    // "this one" without turning the others into a different kind of thing.
    'line-width': ['interpolate', ['linear'], ['zoom'], 10, 4, 16, 7],
    'line-opacity': 1
  };
}
```

and change `routeLinePaint`'s opacity from `0.9` to `0.55`, so an unemphasised variant sits back
when several are drawn. Leave its width alone.

- [ ] **Step 4: Add the layer to the style**

In `app/src/lib/map/style.ts`, import `activeVariantFilter` and `routeLineActivePaint` alongside
the existing route-line imports, and add immediately after the `route-line` layer:

```ts
      {
        // The variant the reader is pointing at in the panel. A separate layer
        // rather than a paint expression on `route-line`, because feature-state
        // already carries the journal's done colour and stacking a second
        // meaning onto it would make both harder to reason about.
        id: 'route-line-active',
        type: 'line',
        source: 'route-lines',
        filter: activeVariantFilter(null, null),
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: routeLineActivePaint()
      },
```

- [ ] **Step 5: Wire MapView**

In `app/src/lib/components/MapView.svelte`, the selection effect already filters
`ROUTE_LINE_LAYERS`. Because the active layer needs a different filter, replace that loop with:

```ts
    if (target?.hasLine) {
      void ensureRouteLines().then(() => {
        if (!map || $selection.selectedId !== selectedId) return;
        map.setFilter('route-line-casing', routeLineFilter(selectedId));
        map.setFilter('route-line', routeLineFilter(selectedId));
        map.setFilter('route-line-active', activeVariantFilter(selectedId, $selection.hoveredVariant));
      });
    } else {
      map.setFilter('route-line-casing', routeLineFilter(null));
      map.setFilter('route-line', routeLineFilter(null));
      map.setFilter('route-line-active', activeVariantFilter(null, null));
    }
```

`$selection.hoveredVariant` arrives in Task 8; until then it does not exist, so for this task use
`null` in its place and change it in Task 8.

In `app/src/lib/components/LocatorMap.svelte`, the same three `setFilter` calls replace its loop
over `ROUTE_LINE_LAYERS`, with `activeVariantFilter(routeId, null)` — the route page has no
pointer-driven emphasis.

- [ ] **Step 6: Run the tests**

```bash
cd app && npx vitest run src/lib/map && npm run check
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/src/lib/map app/src/lib/components/MapView.svelte app/src/lib/components/LocatorMap.svelte
git commit -m "feat(map): draw a route's alternatives together, and lift the one being read"
```

---

## Task 8: The panel names the alternatives

**Files:**
- Create: `app/src/lib/components/RouteVariants.svelte`, `app/src/lib/components/RouteVariants.test.ts`
- Modify: `app/src/lib/map/selection.ts`, `app/src/lib/map/selection.test.ts`, `app/src/lib/components/RoutePreview.svelte`, `app/src/lib/components/MapView.svelte`, `app/src/routes/route/[id]/+page.svelte`

**Interfaces:**
- Consumes: `RouteContent.lines` (Task 6); `activeVariantFilter` (Task 7).
- Produces: `setHoveredVariant(name: string | null): void` and `SelectionState.hoveredVariant`; `<RouteVariants lines={RouteLine[]} />`.

- [ ] **Step 1: Write the failing selection test**

Add to `app/src/lib/map/selection.test.ts`:

```ts
it('carries the variant being pointed at, and forgets it when the route changes', () => {
  // A stale variant name would light a line on the newly selected route if the
  // two happened to share a variant name.
  setSelected('a--b--c');
  setHoveredVariant('Right Hand');
  expect(get(selection).hoveredVariant).toBe('Right Hand');
  setSelected('a--b--other');
  expect(get(selection).hoveredVariant).toBe(null);
});
```

- [ ] **Step 2: Extend the store**

In `app/src/lib/map/selection.ts`:

```ts
export interface SelectionState {
  hoveredId: string | null;
  selectedId: string | null;
  /** The variant name the reader is pointing at in the panel, if any. */
  hoveredVariant: string | null;
}

const EMPTY: SelectionState = { hoveredId: null, selectedId: null, hoveredVariant: null };
```

and in `setSelected`, clear it with the hover:

```ts
export function setSelected(id: string | null): void {
  // Clearing hover avoids two highlights surviving a click; clearing the
  // variant avoids a name from the previous route lighting a line on this one.
  state.set({ hoveredId: null, selectedId: id, hoveredVariant: null });
}

export function setHoveredVariant(name: string | null): void {
  state.update((s) => ({ ...s, hoveredVariant: name }));
}
```

- [ ] **Step 3: Write the failing component test**

`app/src/lib/components/RouteVariants.test.ts`:

```ts
import { render, screen, fireEvent } from '@testing-library/svelte';
import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import RouteVariants from './RouteVariants.svelte';
import { selection, clearSelection } from '$lib/map/selection';

beforeEach(() => clearSelection());

describe('RouteVariants', () => {
  it('says nothing when the route has no drawn line', () => {
    const { container } = render(RouteVariants, { lines: [] });
    expect(container.textContent?.trim()).toBe('');
  });

  it('says nothing when there is one unnamed line, which needs no list', () => {
    render(RouteVariants, { lines: [{ variant: null, note: null }] });
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('lists each alternative with the caption that explains it', () => {
    render(RouteVariants, {
      lines: [
        { variant: 'Left Hand', note: 'The original line.' },
        { variant: 'Right Hand', note: 'Steeper.' }
      ]
    });
    expect(screen.getByText('Ways up this route')).toBeTruthy();
    expect(screen.getByText('Left Hand')).toBeTruthy();
    expect(screen.getByText('The original line.')).toBeTruthy();
    expect(screen.getByText('Right Hand')).toBeTruthy();
  });

  it('tells the map which alternative is being read', () => {
    render(RouteVariants, {
      lines: [{ variant: 'Left Hand', note: '' }, { variant: 'Right Hand', note: '' }]
    });
    fireEvent.mouseEnter(screen.getByText('Right Hand'));
    expect(get(selection).hoveredVariant).toBe('Right Hand');
  });
});
```

- [ ] **Step 4: Write the component**

`app/src/lib/components/RouteVariants.svelte`:

```svelte
<script lang="ts">
  /**
   * A route's alternatives, with the caption that says what each one is.
   *
   * The caption is the point. Two lines on a mountain with no explanation is
   * worse than one line: the reader cannot tell whether they are choices, a
   * route and its escape, or a mistake. Pointing at one lifts it on the map.
   */
  import { setHoveredVariant } from '$lib/map/selection';
  import type { RouteLine } from '$lib/data/types';

  let { lines }: { lines: RouteLine[] } = $props();

  // One unnamed line needs no list — the map is already showing it.
  let named = $derived(lines.filter((l) => l.variant));
</script>

{#if named.length}
  <section class="variants">
    <h3>Ways up this route</h3>
    <ul>
      {#each named as line (line.variant)}
        <li
          onmouseenter={() => setHoveredVariant(line.variant)}
          onmouseleave={() => setHoveredVariant(null)}
        >
          <span class="name">{line.variant}</span>
          {#if line.note}<span class="note">{line.note}</span>{/if}
        </li>
      {/each}
    </ul>
  </section>
{/if}

<style>
  .variants { margin: 0.75rem 0; }
  h3 { margin: 0 0 0.35rem; font-size: 0.85rem; opacity: 0.7; font-weight: 600; }
  ul { margin: 0; padding: 0; list-style: none; display: grid; gap: 0.35rem; }
  li { display: grid; gap: 0.1rem; padding: 0.25rem 0.45rem; border-left: 3px solid #c2410c; }
  .name { font-size: 0.9em; font-weight: 600; }
  .note { font-size: 0.82em; opacity: 0.75; }
</style>
```

- [ ] **Step 5: Render it in both surfaces**

In `app/src/lib/components/RoutePreview.svelte`, import it beside `MentionedPaths` and place it
directly above that component:

```svelte
      <RouteVariants lines={r.lines} />
```

In `app/src/routes/route/[id]/+page.svelte`, place the same line directly beneath `<ProvenanceNote route={r} />`.

- [ ] **Step 6: Read the variant in MapView**

In `app/src/lib/components/MapView.svelte`, change the Task 7 placeholder to the real value:

```ts
        map.setFilter('route-line-active', activeVariantFilter(selectedId, $selection.hoveredVariant));
```

The effect already reads `$selection`, so pointing at a variant re-runs it.

- [ ] **Step 7: Run the suite**

```bash
cd app && npm test && npm run check
```
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add app/src
git commit -m "feat(app): say what each alternative is, and light the one being read"
```

---

## Task 9: One sentence about how the line is known

**Files:**
- Modify: `app/src/lib/components/ProvenanceNote.svelte`, `app/src/lib/components/ProvenanceNote.test.ts`

**Interfaces:**
- Consumes: `hasLine` (Task 6).
- Produces: nothing new.

- [ ] **Step 1: Replace the failing tests**

In `app/src/lib/components/ProvenanceNote.test.ts`, replace the `describe('how the line is known', …)`
block with:

```ts
describe('how the line is known', () => {
  const entry = (overrides: Partial<RouteIndexEntry>): RouteIndexEntry => ({ ...base, ...overrides });

  it('says the line was drawn from the guide and from walking it', () => {
    render(ProvenanceNote, { route: entry({ hasLine: true }) });
    expect(screen.getByTestId('line-provenance').textContent).toMatch(
      /drawn from the Mountain Meanders description/i
    );
  });

  it('says nothing at all when there is no line', () => {
    // Most routes have none, and a sentence on each would be noise.
    render(ProvenanceNote, { route: entry({ hasLine: false }) });
    expect(screen.queryByTestId('line-provenance')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd app && npx vitest run src/lib/components/ProvenanceNote.test.ts`
Expected: FAIL — the old `osm-relation` wording is still rendered.

- [ ] **Step 3: Replace the derivation**

In `app/src/lib/components/ProvenanceNote.svelte`, replace the whole `lineText` block with:

```ts
  // One sentence, because there is now one way a line comes to exist. The two
  // Phase 4d sentences named a tier because there were two tiers; naming a
  // single source tells the reader nothing they cannot see.
  let lineText = $derived(
    route.hasLine
      ? 'Line drawn from the Mountain Meanders description and from walking the route.'
      : null
  );
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd app && npx vitest run src/lib/components/ProvenanceNote.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/components/ProvenanceNote.svelte app/src/lib/components/ProvenanceNote.test.ts
git commit -m "feat(app): state plainly who drew the line"
```

---

## Task 10: Delete the tiers that inferred lines

**Files:**
- Delete: `tools/routelines/kaap_routelines/{cli,walk,report,mentions,ids}.py`, `tools/routelines/tests/test_{walk,report,cli}.py`, `data/route-relations.json`
- Modify: `tools/routelines/README.md`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing. This removes code no longer reachable.

`geo.py`, `ways.py`, `graph.py`, `relations.py` and `trails.py` **stay**, with their tests: `snap.ts`
is a port of the first three and those tests document the behaviour it must keep, and the last two
remain the only reader of the relation export if a later phase wants it.

- [ ] **Step 1: Delete the modules and their tests**

```bash
cd tools/routelines
git rm kaap_routelines/cli.py kaap_routelines/walk.py kaap_routelines/report.py \
       kaap_routelines/mentions.py kaap_routelines/ids.py \
       tests/test_walk.py tests/test_report.py tests/test_cli.py
cd ../.. && git rm data/route-relations.json
```

- [ ] **Step 2: Run the remaining Python tests**

Run: `cd tools/routelines && python -m pytest -q`
Expected: PASS — the geo, ways, graph, split, relations and trails tests remain.

- [ ] **Step 3: Rewrite the README**

Replace `tools/routelines/README.md` with a description of what is left: that it no longer emits
`data/route-lines.geojson` (the `/draw` editor does), that `geo.py`/`ways.py`/`graph.py` are the
reference implementation `app/src/lib/map/snap.ts` was ported from and their tests are the contract
that port must keep, and that `relations.py`/`trails.py` read the relation export for any future
phase. State the measurement that justifies the split step: 156,643 of 219,996 junctions in the raw
way export are interior vertices, against 1,027 of 3,090 in the shipped tiles.

- [ ] **Step 4: Commit**

```bash
git add tools/routelines
git commit -m "chore(routelines): remove the tiers that guessed at route lines"
```

---

## Task 11: Prove it in a browser, end to end

**Files:**
- Modify: `app/e2e/map.spec.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: e2e coverage of drawn lines and variants.

- [ ] **Step 1: Draw two routes, one with alternatives**

```bash
cd app && npm run dev
```

In `/draw`, draw *Platteklip Gorge* as a single line, and draw one route with two named variants
with captions (*Llandudno Ravine*, "Left Hand" and "Right Hand"). Save both, then:

```bash
cd app && npm run build:data && npm run build
```

Expected: `build:data` logs `2 have a drawn line`.

- [ ] **Step 2: Replace the route-line e2e block**

In `app/e2e/map.spec.ts`, inside `test.describe('route lines', …)`, keep the existing
`selecting a route with a line draws it`, `deselecting clears the line`,
`a route with no line draws none, and still previews`, `the whole-name path highlight is gone` and
`a route page with a line shows it on the locator map` tests unchanged — they read
`hasLine` from the committed data and do not care how it got there. Add:

```ts
  test('an entry with alternatives draws them all, and lifts the one being read', async ({ page }) => {
    await ready(page);
    const target = await page.evaluate(async () => {
      const routes = (await (await fetch('data/routes-index.json')).json()) as Array<{
        id: string; title: string; hasLine: boolean;
      }>;
      const lines = (await (await fetch('data/route-lines.geojson')).json()) as {
        features: { properties: { routeId: string; variant?: string } }[];
      };
      const counts = new Map<string, number>();
      for (const f of lines.features) {
        if (!f.properties.variant) continue;
        counts.set(f.properties.routeId, (counts.get(f.properties.routeId) ?? 0) + 1);
      }
      const id = [...counts].find(([, n]) => n > 1)?.[0];
      return routes.find((r) => r.id === id)?.title ?? null;
    });
    test.skip(!target, 'no entry in this build has alternatives drawn yet');

    await selectFromPanel(page, target!);
    await expect.poll(() => renderedCount(page, 'route-line'), { timeout: 15_000 })
      .toBeGreaterThan(0);
    // Nothing is lifted until the reader points at one.
    expect(await renderedCount(page, 'route-line-active')).toBe(0);

    await page.getByRole('heading', { name: 'Ways up this route' })
      .locator('xpath=following-sibling::ul')
      .getByText(/./)
      .first()
      .hover();
    await expect.poll(() => renderedCount(page, 'route-line-active'), { timeout: 15_000 })
      .toBeGreaterThan(0);
  });
```

- [ ] **Step 3: Run the whole suite**

```bash
cd app && npm test && npm run check && npm run test:e2e
```
Expected: PASS at both base paths.

- [ ] **Step 4: Commit**

```bash
git add app/e2e/map.spec.ts data/route-lines.geojson
git commit -m "test(e2e): assert a route's alternatives draw together"
```

---

## Task 12: Look at it, then record what shipped

**Files:**
- Modify: `docs/superpowers/specs/2026-08-17-drawn-route-lines-design.md`

- [ ] **Step 1: Look at the map**

```bash
cd app && npm run build && npm run preview
```

Check, at the opening view, mid zoom and close in:

- a drawn single line: does it follow the ravine the description describes, and read as the route against the contours?
- an entry with alternatives: are two lines legible together, or does the pair read as one confused shape?
- pointing at a variant in the panel: does the right line lift, and does the caption explain why there are two?
- a route with nothing drawn: is the map quieter but still useful?
- a route marked done: are the lines green?

**A line up the wrong ravine passes every assertion in this plan.** If the emphasis is not legible,
adjust `routeLinePaint`'s opacity or `routeLineActivePaint`'s width — do not edit the geometry by
hand.

- [ ] **Step 2: Record the outcome in the spec**

Add a short section to the spec stating: how many routes are drawn, how long a route took to draw
in practice, and whether the snapping held up (how often a click had to be refused). Those three
numbers decide whether the remaining routes are worth drawing or whether the editor needs work
first.

- [ ] **Step 3: Commit**

```bash
git add docs
git commit -m "docs: record what the drawn-lines editor actually cost"
```

---

## Self-review

**Spec coverage.** Snapping engine and its measurement → Task 1. Leg/variant data and captions →
Task 2. `/draw` kept out of the build via `prerender = false` + `strict: false`, with the
build-output test that pays for the weakened net → Task 3. Editor with route picker, snapped
clicks, undo, clear, 15-px tolerance and refusal rather than free-hand → Task 4. Vite dev
middleware writing `data/route-lines.geojson`, and reloading an existing drawing → Task 5. Schema,
`hasLine`, variants on route content, `lineSource` removed → Task 6. Every variant drawn with one
emphasised → Tasks 7 and 8. Single provenance sentence → Task 9. Deletion of the automatic tiers
and `route-relations.json` → Task 10. Tests that need no extract and no tiles → throughout; e2e →
Task 11; mandatory browser pass → Task 12.

**Two things the spec names that this plan deliberately does not build:** free-hand drawing for
off-path scrambles, and editing a drawn line's shape beyond undo and redraw. Both are listed under
"Deliberately not attempted" in the spec.

**Type consistency.** `Point` is `[number, number]` in `snap.ts` and is the only point type used by
`state.ts` and the editor. `RouteLineFeature` is defined once in `state.ts` and imported by the
Vite plugin; `transform.ts` keeps its own narrower structural copy (properties only) because it
must not import from `$lib` at build time — the two are asserted compatible by Task 6's tests
reading the committed file. `ROUTE_LINE_LAYERS` gains a third member in Task 7 and every consumer
(`MapView`, `LocatorMap`) is updated in that same task, so no caller sees the two-element version.
`hoveredVariant` is added to `SelectionState` in Task 8 and used in `MapView` in the same task; Task
7 explicitly writes `null` in its place and says so.

**One risk carried into execution.** Task 4's `querySourceFeatures` returns tile-clipped geometry
for the *loaded* tiles only, so the graph covers what is on screen. Drawing a route longer than the
viewport means panning mid-draw, and the graph rebuilds on `idle`. If that proves awkward in Step 2
of Task 4, the fix is to widen the map's `maxBounds` padding or to keep previously seen edges in
the graph rather than replacing it — decide with the editor in front of you, not here.
