# Phase 4 — The Cape Town Map

**Date:** 2026-07-30
**Status:** Approved for planning
**Supersedes:** the unbuilt "Plan 2" of `2026-07-30-phase3-map-made-good-design.md` (tile bbox east to 24°E + places layer). That plan is abandoned; this replaces it.

## Purpose

Re-cut the basemap from one large rectangle into **standalone regional maps**, starting with Cape Town — and use the resources that frees to make the map detailed and colourful, to preview a route's information on selection, and to highlight a route's shape rather than just its point.

## The decision that drives everything

**Each region is its own map, not a tile of a continuous surface.**

This is not "load more tiles as you pan". There is no expectation of continuity between regions, so there are no seams to blend, no multi-source composition, and no viewport-driven attachment. Cape Town is a map. Boland will be a map. Panning off the edge of one is like panning off the edge of a printed sheet.

That model is what makes the rest affordable, and it settles a problem the previous plan could not: a bounding rectangle that reaches from Cape Town to the Cederberg is **47% of the current area to gain 39 routes**, and most of that box is empty Swartland and Karoo with no hiking in it. Regions skip the empty space entirely.

## Why Cape Town first

Measured against `data/route-locations.json` (181 located routes):

| extent | routes with terrain | area vs current | DEM cells (now 12) |
|---|---|---|---|
| **Table Mountain + Peninsula** | **133 (73%)** | **1.7%** | **2** |
| Cape Town metro | 133 (73%) | 6% | 2 |
| CT + Hottentots-Holland | 152 (84%) | 11% | 4 |
| CT + Boland + Cederberg | 172 (95%) | 47% | 6 |
| Current tiles | 178 (98%) | 100% | 12 |

Cape Town alone holds **96 Table Mountain routes plus 37 peninsula routes** — the densest concentration in the dataset, in roughly a sixtieth of the area. Tiles drop from ~130 MB to an estimated 5–15 MB, which is what makes hillshade and landcover affordable rather than a budget gamble.

**The box is derived, not chosen.** Those 133 routes span `lon 18.3154–18.4623, lat -34.2814 to -33.9350`; the region below is that extent plus a 0.05° (~6 km) margin, which guarantees a full viewport of terrain around any route even at close zoom. The nearest route *outside* it is Koeberg on the West Coast, 26 km away, so no route sits awkwardly on the boundary.

**Routes outside the current map are not lost.** They stay listed, searchable, filterable and openable, with their route pages intact — they simply are not pinned on a map they do not belong to. The app already behaves this way after Phase 3a's `BASEMAP_BOUNDS` framing fix; this generalises it.

## Constraints (inherited)

- Static site, **GitHub Pages, 1 GB hard limit**, shared with a deferred ~230 MB photo claim.
- **Keyless and capless** in the shipped app.
- **Grades stay raw.**
- **Base path:** every asset and link URL goes through `base` from `$app/paths`.
- TypeScript strict, no `any`. MapLibre behaviour is tested in Playwright only.
- **Honesty about location survives intact.** Nothing here may present an approximate position as a precise one, and no route may appear on a map it is not actually within.

---

## 4a — The Cape Town re-cut

**Goal:** one regional map, built by a pipeline that treats a region as a parameter rather than a constant.

### Pipeline changes

`tools/tiles/bbox.json` becomes `tools/tiles/regions.json` — a list of named regions, each with a box and the area-tree prefixes that belong to it:

```json
{
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

Build scripts take a region id and emit `trails-<id>.pmtiles`, `contours-<id>.pmtiles` and (if it passes the gate below) `hillshade-<id>.pmtiles`. `verify-layers.sh` and CI's size floors iterate regions rather than assuming one archive. Adding the Boland later is then a `regions.json` entry plus a build — not a refactor.

**The multi-region UI is explicitly out of scope.** Only the *pipeline* is parameterised now. The app ships one region and has no picker.

### Schema additions

- **`landcover`** — `natural=wood|scrub|heath|bare_rock|sand|grassland`, `landuse=forest|vineyard`. Vector polygons, cheap, and the largest colour-per-byte gain available.
- **`places`** — `place=city|town|village|suburb` with `name` and `population`. This is the layer that finally orients the overview; Phase 3a proved peak labels cannot, because the Peninsula's peaks are low *and* route cluster badges correctly win the symbol collision against them.
- Keep `paths`, `roads`, `water`, `peaks` as they are, plus the tile-side `paths` `min_zoom` the previous plan specified.

### Hillshade, behind a measurement gate

Hillshade is the single biggest visual gain and the only item that could threaten the budget, because it is raster. **Build it for Cape Town, measure the archive, and only then decide** whether it ships and at which zoom range. The gate is explicit: if hillshade exceeds **60 MB** for this region, restrict its zoom range or drop it, rather than absorbing it silently.

The DEM is already downloaded and the contour build already clips it, so this is incremental work on an existing script.

### Definition of done

`tiles-v2` (or per-region tags) published, CI updated, the Cape Town map builds reproducibly from `regions.json`, and the published output is measured and recorded.

---

## 4b — The styling pass

**Goal:** make it look like a map worth reading.

- **Landcover palette** — greens for fynbos and forest, greys for rock, sand for beaches, against the existing cream. This is where "more colour" becomes visible.
- **Hillshade blend** beneath the contours, if it passed the gate.
- **Place labels** — `places-town` and `places-suburb`, with the density and zoom discipline Phase 3a established.
- Re-tune the Phase 3a zoom thresholds for a region-sized map: those values were chosen for a province-wide extent and the opening view is now far tighter.

Every layer keeps the properties Phase 3a fought for: a `minzoom` no lower than its archive's floor, zoom-interpolated widths with a first stop of at least 0.8 px, and `symbol-sort-key` on label layers.

**Verification is a browser, not a feature count.** Phase 3a demonstrated that rendered-feature counts can pass while the map is unreadable — and that they can be measured at the wrong camera entirely. Every zoom threshold gets looked at.

---

## 4c — The selection experience

**Goal:** selecting a hike shows what the hike actually is.

Today clicking a pin opens a popup with a title, a grade and a link. Everything needed for a rich preview already ships: `routes-index.json` carries grade, time and height gain, and each route's content JSON carries description sections, related routes, attribution and a photo count. **No new data is required.**

- A preview panel on selection, showing the Mountain Meanders information without leaving the map.
- **Provenance rendering**, folded in here because it touches the same surface: `osm-match` and `curated` pins render solid, `area-approx` renders hollow with an uncertainty circle sized by `coordsAccuracyM`, and the route page states in words how its position is known.
- Lifting the `area-approx` gate in `app/scripts/transform.ts` — which exists precisely because the map could not yet draw uncertainty. **It may only be lifted once the uncertainty rendering is in place**, and the discriminated union in `types.ts` is what makes removing it a compile error rather than an accident.

---

## 4d — Route geometry

**Goal:** highlight a route's shape, not just its point.

The obstacle is real: Phase 0 established that Mountain Meanders publishes no GPX or KML, so all 184 routes are single points. There is nothing to highlight.

The way through reuses the machinery Phase 3 Plan 1 already built. `tools/geocode` matches route titles against named OSM *peaks*; the same extraction can match them against named OSM **ways**. The evidence this works is already in `data/geocode-report.md`: *Twelve Apostles Path* came back as **13 OSM ways** — not ambiguity so much as a trail in segments — and Otter Trail's numbered escape routes likewise.

- Extend the geocoder to match and stitch named path segments, emitting a committed `data/route-lines.geojson`.
- Provenance applies unchanged: a line records the OSM ways it came from, and a route that matches nothing keeps a highlighted **pin** rather than a fabricated line.
- The app renders the selected route's line highlighted, as a GeoJSON overlay — not from tiles, so this work is independent of 4a and can proceed in parallel.

**Deliberately not attempted:** hand-drawing 184 routes. A later phase could let the journal accept GPX for hikes actually walked, which fits the personal-journal framing better than borrowed geometry.

---

## Sequencing

```
4a re-cut ──> 4b styling
4d route geometry (independent — reuses the osmium pipeline)
4c selection experience (independent — no new data)
```

4a blocks 4b and nothing else. 4c and 4d can run at any time. 4a is the only one with significant machine time, so starting it early and doing 4c or 4d while it builds is the efficient order.

## Budget

| item | estimate |
|---|---|
| Cape Town vector tiles | 5–15 MB |
| Landcover | included above |
| Hillshade | gated at 30 MB (the region is a sixtieth of the old area) |
| Route lines | 1–2 MB |
| Photos (deferred claim) | ~230 MB |
| **Total** | **~280 MB of 1 GB** |

Against the abandoned 24°E plan's ~310 MB of vector alone, this leaves roughly four times the headroom — and each future region adds only its own footprint. At this size the practical ceiling stops being GitHub Pages and starts being how many regions are worth building.

## Risks

- **Hillshade size** — mitigated by the measurement gate; it is a decision point, not an assumption.
- **Region model leaking into the app before it should** — 4a parameterises the *pipeline* only. If region concepts start appearing in components, the scope has slipped.
- **Re-tuning drift in 4b** — Phase 3a's thresholds were tuned for a province; a tighter map may want different ones. This is expected work, not a regression.
- **Route-line quality** — a stitched OSM match may be a different alignment from the route described. Provenance makes it auditable; a bad match is corrected with an override, as coordinates already are.

## Out of scope

- **The multi-region picker UI** and any second region pack. The pipeline supports them; the app does not, yet.
- **Photos** — unchanged, still deferred.
- **Offline/PWA, journal cloud sync, grade normalisation** — unchanged.
- Hand-drawn or user-recorded route tracks.

## Exit condition

A fast, colourful Cape Town map showing 133 routes over real terrain with landcover and place names; selecting a hike previews its Mountain Meanders information and highlights its shape where one can honestly be derived; approximate positions render as uncertainty rather than points; and adding the next region is a `regions.json` entry plus a build.
