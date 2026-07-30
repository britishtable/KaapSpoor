# Phase 3 — The Map Made Good

**Date:** 2026-07-30
**Status:** Approved for planning
**Scope:** Make the shipped map legible at the zoom it opens at, and complete its coverage by
locating the 59 routes the crawl left without coordinates — each pin carrying its provenance.

## Why this phase

Phase 2 Plan 2 shipped a working self-hosted map. A browser look at the deployed site on
2026-07-30 confirmed the pipeline is sound — PMTiles range requests, glyph PBFs, the module
worker and WebGL all verified healthy in production — and at z13 over Table Mountain the
cartography is good. The opening view is not. Rendered feature counts at the default camera
(z7.97, the `fitBounds` result over all located routes):

| layer | features rendered |
|---|---|
| `paths` | 10,555 |
| `roads` | 5,180 |
| `peaks` | 188 labels |
| `contours` | 0 (correct — built z10–14) |
| `pins` + `pins-cluster` | 13 |

The route pins — the entire point of the discovery map — are 13 objects competing with ~15,700
lines and 188 labels. The cause is structural and sits in one place: **no layer in
`app/src/lib/map/style.ts` has a `minzoom`, and no width, size or opacity is zoom-interpolated.**
Every layer draws full-strength at every zoom.

Two further defects found in the same look:

- **Green is ambiguous.** Cluster circles are `#4a6741` (`MapView.svelte:84`) and done-pins are
  also `#4a6741` (`MapView.svelte:101`). A green blob is either "several routes" or "done".
- **No geographic anchors.** `peaks` is the only label layer, so the overview names 188 obscure
  summits but not Cape Town, Ceres or Stellenbosch.

This phase also closes the follow-up doc's open item *"nothing covers visual correctness"* — not
by pixel diffing, but by turning the defect above into a deterministic assertion.

## Constraints (inherited)

- Static site, **GitHub Pages, 1 GB hard limit**. 130 MB of tiles today; photos hold a deferred
  ~230 MB claim, so this phase must not spend the budget carelessly.
- **Keyless and capless in the shipped app.** Build-time tooling may use public data sources;
  the deployed site may not depend on any keyed or rate-limited service.
- **Grades stay raw.** Never normalise or parse grade strings.
- **Base path:** every asset and link URL goes through `base` from `$app/paths`.
- TypeScript strict, no `any`. MapLibre behaviour is tested in Playwright only — jsdom has no
  WebGL.
- **Honesty about location is a design principle, not a nicety.** Phase 2 deliberately refused to
  fake positions for the 59 unlocated routes; that principle survives this phase intact, which is
  why every coordinate gains a provenance field and approximate pins never look precise.

## Decisions taken

- **Tiered geocoding with visible provenance.** All three tiers ship; each pin carries where its
  coordinate came from, and approximate pins render differently from located ones.
- **Extend the tile bbox east, cap at 24.0°E.** Otter Trail (~23.6–23.9°E) and Robberg (~23.4°E)
  come inside, along with Swartberg, Donkey Trail, Gamkaberg and Elandsberg. Mt Zebra Park
  (~25.5°E) stays outside and gets the honest out-of-area treatment.
- **Add place labels** (`city`/`town`/`village` and `suburb`) to the tile schema, since planetiler
  is being re-run anyway.
- **`bbox.json` becomes derived**, not hand-set. Its comment already claims to be "bounding box of
  all located KaapSpoor routes plus ~0.2 deg margin"; after this phase that is true.

## Plan 1 — Geocoding with provenance

A new build-time step under `tools/geocode/`. Not shipped code; it rewrites data that the app
consumes.

**Inputs**

- `data/routes.json` — the crawl output.
- `region.osm.pbf` — the full South Africa extract `tools/tiles/build-trails.sh` already
  downloads and caches under `$WORK/downloads/`. No new download, no Overpass dependency.
- `data/geocode-overrides.json` — new, hand-maintained, reviewed in git.

**The tier ladder**, highest precedence first:

1. **`curated`** — an entry in `geocode-overrides.json`: `{ routeId, lat, lon, source, note }`.
   `source` is a URL or citation, and is required — an override without a stated source is a
   validation error, not a silent accept. Wins over everything, including a crawl coordinate,
   because it is the only tier a human has personally checked.
2. **`osm-match`** — a normalised name match against named OSM features, constrained to the
   route's **own area bbox**, derived from that area's already-located siblings plus a margin.
   Candidate tags: `natural=peak|saddle|ridge|cliff|valley|arete`, named `waterway=*`, named
   `highway=path`, `leisure=nature_reserve`, `boundary=protected_area`. Records `osm_type`,
   `osm_id` and the matched name so the claim is auditable.
3. **`area-approx`** — the centroid of located siblings in the narrowest containing area, with an
   accuracy radius derived from how far those siblings spread from that centroid. Explicitly
   approximate; never presented as a precise position.

A route matching no tier stays unlocated and keeps the graceful unmapped path Phase 2 built.

**Name normalisation** is the substance of tier 2. The 59 titles are overwhelmingly named
topographic features wrapped in route vocabulary: strip route-type words (Route, Traverse, Gully,
Buttress, Ravine qualifiers, hike, Trail, Path, "Circular Rte"), quoted nicknames
(`'Skywalk'`), parentheticals (`(Twirly-Whirly route)`, `(Maclear's Beacon)`) and single-letter
variants (`Steenberg 'B'`, `Corridor "B"`); expand abbreviations (`Pk`→`Peak`, `Rte`→`Route`,
`Mt`→`Mount`); and handle Afrikaans/English pairs (`Long Kloof` / `Lang Kloof`).

**Output.** Coordinates merge back into `routes.json`, and through the existing transform into
`routes-index.json`, with:

- `coords_source: 'crawl' | 'curated' | 'osm-match' | 'area-approx'` — set whenever `coords` is
  non-null, for all 184 routes including the original 125 (which become `crawl`).
- `coords_accuracy_m` — for `area-approx` only.
- `coords_osm_ref` — for `osm-match` only.

**Reproducibility.** The step is deterministic given the same OSM extract, and records the
extract's date so a coverage change can be attributed. Re-running must not move a coordinate
without the extract changing.

**Coverage reporting.** `data/coverage-report.md` regenerates, reporting the tier mix. Expectations
are deliberately unset here: several Table Mountain climbing features (Carrel's Ledge, Finsteraar
Crack, Nursery Buttress, Room with a View) may not exist in OSM at all, so tier 2 may catch only a
minority and tiers 1 and 3 carry the rest. The tool reports what happened rather than promising a
number.

**Tests (Vitest).** Name normalisation cases; tier precedence (curated beats osm-match beats
area-approx); rejection of a correct-name match that falls outside the area bbox; centroid and
radius maths; and the invariant that `coords` never exists without a `coords_source`.

## Plan 2 — Wider tiles with place labels (`tiles-v2`)

**Derived bbox.** A script computes `bbox.json` from all located routes after Plan 1, plus 0.2°
margin, subject to the 24.0°E cap. It writes the file and prints which routes it excluded, so the
exclusion is a recorded decision rather than an invisible one.

**Schema additions** to `tools/tiles/profile/trails-profile.yml`:

- New `places` layer: `place=city|town|village|suburb`, attributes `name` and `population` so the
  style can rank labels rather than drawing them all equally.
- Tile-side `min_zoom` on `paths`, so the archive stops carrying footpath geometry at zooms that
  will no longer draw it. This partly offsets the bbox growth.

**Release.** Rebuild both archives, publish as `tiles-v2`, update `TILES_TAG` in
`.github/workflows/deploy.yml`, and re-derive the CI size floors from the measured output rather
than guessing them. Extend `verify-layers.sh` to require the `places` layer, so a profile that
silently fails to emit it fails the build — the same silent-failure class that motivated that
script.

`tiles-v1` stays published until `tiles-v2` is verified in a real deploy.

**Out-of-area routes.** Mt Zebra Park is located but outside the mapped box. Its route page and
its pin say so plainly; the map does not pretend it has terrain there.

## Plan 3 — Cartography and provenance in the app

**`style.ts`**, driven by the measured counts above:

| layer | change |
|---|---|
| `paths` | `minzoom: 12`; zoom-ramped width. Removes the 10,555-feature mush by itself. |
| `roads` | `minzoom: 9`; zoom-ramped width — hairline at overview, thicker close in. |
| `peaks` | split into `peaks-major` (`minzoom: 10`, filtered on `ele`) and `peaks-minor` (`minzoom: 13`); `symbol-sort-key` descending by `ele` so the big names win collisions; interpolated `text-size`. |
| `contours` | split into `contours-index` (100 m, `minzoom: 10`, matching the archive's own minimum zoom) and `contours-intermediate` (20 m, `minzoom: 13`), replacing the single `['%', ['get','ele'], 100]` width case. Same intent; intermediates stop crowding mid zooms. |
| `places-town` | new, `minzoom: 6`, size ranked by `population`. |
| `places-suburb` | new, `minzoom: 12` — kept out of the overview so the Cape Town metro does not fill with suburb names where the pins are densest. |

**`MapView.svelte`**

- Clusters stop using `#4a6741`, so green means *done* and nothing else.
- `area-approx` pins render hollow; `crawl`, `curated` and `osm-match` render solid. The map's
  visual vocabulary distinguishes "we know where this is" from "we know roughly which area".

**Route page and `RouteRow`.** State provenance in words: matched to a named OSM feature,
approximate at area level, or the existing "no location" glyph for the still-unlocated. The
locator mini-map draws an uncertainty circle for `area-approx` rather than a precise dot.

**Testing — style invariants, not pixels.** Pixel diffing was judged overkill in the follow-up doc
and still is. Instead, Playwright asserts the properties that were violated, via
`queryRenderedFeatures`: at z8, `paths` and `peaks-minor` each render exactly 0 features while the
`pins` and `pins-cluster` layers together render more than 0; at z14, `paths` and `peaks-minor`
both render more than 0. Concrete counts, not a judgement about prominence. That converts a defect that
eleven task reviews, type-checking and the existing e2e all missed into a deterministic regression
test.

## Testing summary

- **Vitest** — geocoding normalisation, tier precedence, area-bbox rejection, centroid/radius
  maths, provenance invariant. Style layer shape (minzooms present, no layer unscoped).
- **Playwright** — style invariants at z8 and z14; provenance rendering; the existing map suite
  continues to pass at both base paths.
- **CI** — size floors re-derived from measured `tiles-v2` output; `verify-layers.sh` requires
  `places`; the published-output size check remains the 1 GB backstop.
- **A human look at the deployed map** stays part of done. This phase exists because that look was
  never taken; it should be taken again after it ships.

## Risks

- **Archive size.** Contours grow roughly with area, and the 24.0°E cap is a meaningful widening.
  Mitigations: tile-side `min_zoom` on `paths`, and CI's size check as the backstop. If the
  measured result is bad, the cap tightens rather than the budget stretching.
- **Geocoding false positives.** A right-name match in the wrong place is the failure that would
  damage trust most. The area-bbox constraint is the primary defence, curated overrides the escape
  hatch, and provenance makes every claim auditable after the fact.
- **`tiles-v2` is a deployment dependency.** Keep `tiles-v1` published until a real deploy proves
  v2, so a bad release is a revert rather than an outage.

## Out of scope

- **Photos** — still deferred, with its ~230 MB WebP 640px q70 claim on the budget.
- **Offline / PWA**, **journal cloud sync**, **grade normalisation** — unchanged from Phase 2.
- **The two deferred UX decisions** from `2026-07-27-map-followups.md` — the WebGL2 capability
  guard with a graceful fallback, and collapsing area `<details>` by default. Independent of this
  phase; still open.
- The remaining small debt in that doc (keyboard cross-highlight, the shared `$lib/map/` helper,
  licence notices, release-asset checksums, `npm audit`, the 997 kB maplibre chunk).

## Exit condition

The deployed map opens on a view where route pins are the most prominent thing on it, place names
give the Western Cape recognisable anchors, and paths and minor peaks appear only when you are
zoomed in far enough for them to mean something. Every route that can honestly be located is
located, each pin declaring whether its position came from the crawl, an OSM match, a curated
entry, or is approximate at area level —
and the routes that still cannot be located keep saying so. Under the 1 GB budget, enforced in CI,
with the opening view's legibility protected by a test.
