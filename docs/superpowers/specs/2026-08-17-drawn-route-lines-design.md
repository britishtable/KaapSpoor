# Drawn Route Lines — Design

**Goal:** make the route's line something the author draws, snapped to the mapped trails, with
alternatives under one entry — and retire the two tiers that inferred lines from prose.

Phase 4d derived lines automatically and shipped 21 of 184. This replaces that with one tier whose
claim is the strongest available anywhere in the project: **a person who walked it drew it.**

---

## Why the automatic tiers are being retired

4d's yield, and why each route was refused:

| | |
|---|---|
| Routes with a line | **21 / 184** (9 `osm-relation`, 12 `osm-stitch`) |
| Pin only, nothing drawn | 163 |
| Refused: single connector over 500 m | 48 |
| Refused: `area-approx` position | 38 |
| Refused: no path within 250 m of the anchor | 31 |
| Refused: description names no mapped path | 22 |
| Refused: walk retraced itself | 7 |
| Refused: every named trail out of range | 7 |

**One case makes the argument.** *Lekkerwater Traverse* names three trails — *Llandudno Ravine*,
*Grove Walk*, *Lekkerwater Traverse* — and all three exist in OSM, connected, within a kilometre
of the route. It draws nothing because a single connecting way between two of them is **512 m
against a 500 m limit**. It missed by twelve metres.

That is not a bug to fix by moving the number. Every gate in 4d is a proxy for a judgement the
tool cannot make — *is this the walk the guide describes?* — and each one is either too strict
(163 routes silent) or too loose (lines up the wrong ravine). The author can answer that question
directly, in seconds, per route. **The gates exist because the drawing hand was missing.**

A second reason: the panel lists the paths a description names while the map draws nothing beside
it, because 4d removed the 4e highlight and replaced it for only 21 routes. Whatever ships next
has to close that gap rather than widen it.

---

## The decision

**One tier. Every line on the map is drawn by the author**, by clicking along the rendered hiking
trails, and committed to the repository. Mountain Meanders' text renders exactly as it does today;
the geometry beside it is the author's own reading of that text plus experience on the ground.

An entry may carry **several named variants**, each with a short caption saying what it is. A
route with nothing drawn keeps its pin and draws nothing, as before.

**Rejected — keep the automatic tiers as a fallback.** More coverage immediately, but the map
would mix "I walked this" with "an algorithm guessed", and no reader could tell which line was
which. The provenance ladder this project has maintained since Phase 3 is the reason its claims
can be defended; a mixed tier spends that for coverage.

**Rejected — loosen the gates instead.** Moving 500 m to 600 m buys *Lekkerwater Traverse* and
some unknown number of wrong lines with it. The gates cannot be tuned into judgement.

**Rejected — draw in an external editor** (geojson.io, JOSM) and commit the file. Nothing to
build, but no snapping to the trail network and no binding to a route id, so every line is traced
bend by bend and wired to its entry by hand.

**Rejected for now — off-path geometry.** Grade 5 scrambles that OSM does not map as paths cannot
be drawn by snapping to paths. They keep their pin. Free-hand drawing is a later phase; the
snapping editor is worth having on its own, and free-hand can be added to it.

---

## The measurements this design is built on

**The tiles are mostly split at junctions, and that is what makes in-browser snapping possible.**
Measured over 29 z14 tiles covering Table Mountain's path network (4,218 path features):

| | |
|---|---|
| Coordinates that are an endpoint of 2+ features | **2,063** |
| Endpoints sitting *inside* another feature | **1,027** |

So about a third of junctions are interior vertices. For comparison, the same measurement over the
raw `osmium` way export was 63,353 against **156,643** — 71% hidden, which is what shattered 4d's
first graph into 127,109 components. The editor must therefore apply the same
split-at-shared-vertex step the Python tool does, but once it does, the tiles the map has already
downloaded are a sufficient snapping network. No precomputed graph file, and no Python at draw
time.

---

## Architecture

```
app/src/lib/map/snap.ts          the snapping engine — node keys, split, Dijkstra
        │                        (pure TS, ported from tools/routelines; Vitest, no WebGL)
        ▼
app/src/routes/draw/+page.svelte the editor, dev-only, excluded from the built site
        │
        ▼  Save (POST, dev server only)
vite dev middleware              writes data/route-lines.geojson
        │
        ▼
data/route-lines.geojson         COMMITTED — one Feature per variant
        │
        ▼
app/scripts/transform.ts         copies it to static/data/, sets hasLine + variant count
        ▼
app/src/lib/map/route-lines.ts   the public map: all variants of the selection, one emphasised
```

### The snapping engine (`snap.ts`)

Three functions, ported from `tools/routelines/kaap_routelines/{geo,graph}.py`, whose behaviour is
already pinned by 64 Python tests:

- `nodeKey(point)` — coordinates rounded to 7 places, the join key.
- `splitAtJunctions(features)` — cut every line where it shares a vertex with a different line. A
  junction is a coordinate carried by two *different* features, so a path touching itself is not
  cut.
- `route(graph, from, to)` — Dijkstra between two snapped nodes, returning the coordinates walked.

Fed from `map.querySourceFeatures('trails', { sourceLayer: 'paths' })`, which returns the loaded
tiles' path features. Tile clipping splits a path at tile borders into features whose endpoints
coincide there, so clipping helps connectivity rather than hurting it.

The graph is rebuilt when the map settles (`idle`) and covers the loaded tiles — which is the area
the author is drawing in by definition.

### The editor (`/draw`)

**Kept out of the built site**, so it cannot ship, and reachable under `npm run dev` only. The
mechanism is `export const prerender = false` on the route plus `strict: false` on
`adapter-static` (3.0.10, already installed): the adapter then emits nothing for `/draw`, and a
static host has no such page to serve. The adapter's own error text describes this exact use —
*"Only do this if you are sure you don't need the routes in question in your final app, as they
will be unavailable."*

`strict: false` does weaken a safety net: another route silently failing to prerender would no
longer fail the build. That is paid for by a test on the built output — `/draw` absent, and every
page that *should* exist present — so the net is asserted rather than assumed.

- **Route picker** — all 184 routes, showing which already have a line, filterable by title.
- **Drawing** — click a point on a trail to start; each further click extends the line along the
  trails between the last point and the new one. A click snaps to the nearest graph node **within
  15 screen pixels** — screen space rather than metres, so the tolerance means the same thing to
  the hand at every zoom. A click with no trail that close is refused with a message rather than
  dropping a free-hand point, since free-hand geometry is out of scope here and a silent
  off-trail point would be indistinguishable from a snapped one afterwards.
- **Undo / clear** — undo removes the last click and the segment it added.
- **Variants** — an entry holds a list. Add one, give it a name (*Right Hand*) and a caption
  saying what it is and when you'd take it. The caption is the thing that makes several lines
  legible instead of confusing.
- **Save** — POSTs the whole collection to a Vite dev-server middleware that writes
  `data/route-lines.geojson`. The middleware is registered only when Vite runs in dev, so the
  built site has no such endpoint.

### Data

`data/route-lines.geojson`, committed. One `Feature` per variant:

```json
{
  "type": "Feature",
  "geometry": { "type": "LineString", "coordinates": [[18.3912, -33.9701], [18.3925, -33.9714]] },
  "properties": {
    "routeId": "table-mountain--atlantic-west--llandudno-ravine",
    "variant": "Right Hand",
    "note": "The 1952 line. Steeper, and the one most parties climb today.",
    "drawn": "2026-08-17"
  }
}
```

`variant` and `note` are optional: a route with one line needs neither, and the panel then shows
no variant list. `routeId` must match a real route — the existing anti-drift test in
`transform.test.ts` already asserts that and is kept.

### The app

- `transform.ts` copies the file into `static/data/` and sets `hasLine` on the index, as today.
  `lineSource` is removed — there is only one source now, so a field naming it says nothing.
- The map draws **every variant of the selected route**. Pointing at a variant in the panel
  emphasises that line; the rest stay visible but quieter, so you see both the option you are
  reading about and how it relates to the others.
- The panel lists the variants with their captions beneath the existing route text.
- `ProvenanceNote` replaces the two 4d sentences with one: the line was drawn by the author from
  the Mountain Meanders description and from walking the route. That is the whole claim, and it is
  true of every line on the map.

### What is deleted

- The `osm-relation` and `osm-stitch` tiers in `tools/routelines/kaap_routelines/cli.py`, and
  `walk.py` with them.
- `data/route-relations.json` and the 21 derived lines.
- `lineSource` from the route index and its two provenance sentences.

`geo.py`, `ways.py`, `graph.py`, `relations.py` and `trails.py` stay, with their tests: the
extract is still how the trail data is rebuilt, and `snap.ts` is a port of that logic whose
behaviour they document.

---

## Testing

- **`snap.ts` unit tests** mirror the Python ones that already pass: two lines meeting at a shared
  interior vertex become one connected graph; a line touching itself is not cut; the route between
  two points follows the shorter of two ways; an unreachable target returns nothing.
- **Editor component tests** cover the parts that are not MapLibre: adding and removing points,
  variant add/rename/caption, and that Save posts what is on screen.
- **An e2e** selects a route with several variants and asserts every variant draws, that pointing
  at one emphasises it, and that deselecting clears them all.
- **No test may require the OSM extract or the tiles.** CI runs `npm test` and `npm run check`
  before the tiles release is downloaded, exactly as today.
- **A build-output test** asserts `/draw` is absent from `app/build` and that the pages which
  should exist still do — the net that `strict: false` removes.
- **A browser pass is mandatory before shipping.** Three defects in this project reached `main`
  past a green suite and were caught only by looking at the map: maplibre's worker 404ing after a
  Vite build, the `promoteId` coercion, and 4d's stitched lines running out and back.

---

## Risks

- **The graph only covers loaded tiles.** Drawing a long route while panning means the graph is
  rebuilt as tiles arrive; a click before the rebuild lands could fail to snap. Mitigated by
  rebuilding on `idle` and refusing an unsnappable click rather than guessing.
- **Tile geometry is simplified**, so a drawn line follows the tile's rendering of a path rather
  than its full OSM precision. This is the right trade — the line matches what the reader sees on
  the map — but it means the geometry is not survey-grade, and the provenance sentence should not
  imply it is.
- **Author effort is the real cost.** 184 routes at even a minute each is a sitting. The editor's
  value is entirely in how fast a route can be drawn, which is why snapping is the feature rather
  than a nicety.
- **`/draw` must never ship.** Asserted by a test on the built output, not by care.

---

## Deliberately not attempted

- Free-hand drawing for off-path scrambles. A later phase; the schema does not need to change for
  it, only the editor.
- Direction of travel, or start/end markers on the line.
- Editing a line's shape after it is drawn beyond undo — redraw the variant instead.
- Any user-facing editing. The geometry is the author's; nothing in the shipped app writes to it.
