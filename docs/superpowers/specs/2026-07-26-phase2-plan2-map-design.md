# Phase 2 · Plan 2 — The Map

**Date:** 2026-07-26
**Status:** Approved for planning
**Scope:** A hiking-appropriate map of the route library, self-hosted and keyless.
Supersedes the map sections of `2026-07-21-phase2-map-and-journal-design.md` where they differ.

## Purpose

Plan 1 shipped a working route library and journal at
<https://britishtable.github.io/KaapSpoor/>, but every route's location is text only.
This plan adds the map: the spatial discovery tool the library has been built to accept.

It also builds a **purpose-made hiking basemap** rather than reusing a general one. A
street map is close to useless on a mountain; what matters is footpaths, contours, peaks
and water.

## Starting state (verified 2026-07-26)

| Fact | Value |
|---|---|
| Routes with coordinates (pinnable) | **125** of 184 |
| Routes without (list-only) | **59** |
| Bounding box of located routes | lat −34.3945…−32.5612, lon 17.9990…20.7091 |
| Span | 1.83° lat × 2.71° lon (Cape Peninsula → Cederberg → Swartberg) |
| Coordinates sharing a position | 17 (needs clustering) |
| Published site size today | 4.5 MB of a 1 GB limit |

Plan 1 deliberately left two things for this plan: the route page's locator mini-map and
the mobile bottom sheet. Both depend on MapLibre.

## Decisions

- **Keyless and self-hosted.** No API keys, no usage caps, no external tile dependency.
- **Contours, not hillshade.** Vector contour lines from a DEM: small, crisp at any zoom,
  and precise enough to read a height band — which pairs with the `Height gain` stat
  already on the route pages. Hillshade is prettier but costs several times the bytes.
- **Trails, not roads** — with a deliberate exception. A *thin* road layer stays, because
  routes are described from their access points ("park at the top of Theresa Avenue") and
  a map with no roads cannot answer "where do I start". Concretely: trunk, primary,
  secondary, tertiary, residential and **unclassified**, and nothing below that — no
  service roads, driveways, parking aisles, buildings or address points.
  `unclassified` is included deliberately: rural farm and access roads in the Cederberg
  and Karoo are usually tagged that way, and those are precisely the roads that reach a
  trailhead. Residential ways are not name-filtered — unnamed streets still help you
  orient, and the size saving would be negligible: trails is 34 MB of the 125 MB total,
  so contours dominate and the road layer is not where the budget goes.
- **Home becomes the map plus a synchronized panel**, not a separate route or a toggle.
  The panel/map cross-highlighting is the entire value of the design; splitting them
  loses it.
- **Staged delivery.** The map UX is built against OpenTopoMap (keyless, zero setup), then
  the self-hosted tiles swap in as a style-config change. The uncertain half never blocks
  the feature.

## The tile pipeline

A new `tools/tiles/` directory, sibling to `tools/scraper/`, following the same
conventions: one clear job, a documented repeatable build command, and a measured size
report rather than an estimate.

**Inputs**

- An OSM extract clipped to the route bbox plus a margin: lat −34.5…−32.4,
  lon 17.8…20.9. Sourced from a regional download rather than the planet file.
- A public DEM (SRTM 30 m or Copernicus GLO-30) for the same window. Elevation is not in
  OSM — it must come from a DEM.

**Outputs — two PMTiles archives**

1. `trails.pmtiles`, built with planetiler under a **custom minimal profile**: footpaths,
   tracks, peaks, water, cliffs, place names, plus the thin road layer for access. Every
   omitted class (buildings, POIs, most label sets, minor road detail) is what keeps this
   small — this is why "no roads" is a size decision as much as a styling one.
   **"Thin" means concretely:** roads that get you to a trailhead — trunk, primary,
   secondary, tertiary, residential and unclassified — and nothing below that. No service
   roads, driveways, parking aisles, buildings or address points.
2. `contours.pmtiles`: `gdal_contour` over the DEM → tippecanoe → PMTiles. 20 m intervals
   with indexed 100 m lines.

**Hosting decision, deferred to measurement.** The earlier spec said commit the extract to
the repo. That is reasonable at ~50 MB and unpleasant at 300 MB, because git keeps blobs
forever and every clone pays for them. So: build, measure, then either commit it or
publish it as a GitHub Release asset that CI downloads at build time. The existing CI 1 GB
size gate already catches the failure mode either way.

**Budget context.** 4.5 MB is used today. Photos have a projected ~230 MB claim
(deferred). Whatever the tiles cost must leave that room.

## The app

Four small modules under `app/src/lib/map/`, each with one job and independently testable:

- **`geojson.ts`** — `routesToGeoJSON(entries: RouteIndexEntry[])` returns a
  FeatureCollection of the located routes, each feature carrying `id`, `title` and `grade`.
  Pure and trivially testable.
- **`style.ts`** — builds the MapLibre style object. This is the **single swap point**
  between OpenTopoMap and the self-hosted PMTiles, which is what makes staged delivery
  cost one function rather than a rewrite.
- **`selection.ts`** — a store holding `hoveredId` and `selectedId`. The seam the whole
  map/panel sync hangs on.
- **`MapView.svelte`** — MapLibre init, pmtiles protocol registration, the pin layer,
  the popup, and the geolocate control.

**The sync.** `RouteRow` gains hover and click handlers that write to `selection`;
`MapView` reads it to highlight and fly to a pin. Because both sides talk only to that
store, neither knows the other exists and `RouteRow` stays a presentational component.

**Pins.** One GeoJSON source with MapLibre's native clustering, which covers both the 17
shared coordinates and the dense Table Mountain grouping. Clusters expand on click.
Done vs not-done styling comes from `feature-state` driven by the journal store, so
toggling a route done anywhere in the app repaints its pin at once.

**Geolocation.** MapLibre's `GeolocateControl` — a locate button that drops a position dot
and can follow. Honest limitation: the app is online-only, so on a mountain without signal
the tiles will not load; its full value arrives with the deferred offline phase.

**Layout.** Home becomes a split view — map beside the panel on desktop; on narrow screens
the panel becomes a bottom sheet over the map. CSS only, no JavaScript layout logic.

**Route page.** `LocatorMap.svelte`, a small non-interactive map centred on the route,
replacing the coordinates-as-text placeholder from Plan 1. Unlocated routes keep their
honest "Location not recorded" note.

## Attribution (a licence obligation, not a courtesy)

OSM data is ODbL-licensed and **requires visible attribution**; OpenTopoMap requires it
too while it is the basemap during staging. The map must carry an on-canvas attribution
control reading at least "© OpenStreetMap contributors" (plus OpenTopoMap and the DEM
source when in use), alongside the existing Mountain Meanders credit. MapLibre's
`AttributionControl` handles this; it must not be suppressed to tidy the layout.

## Journal toggle fix

Carried over from Plan 1's final review. `store.ts` currently awaits the IndexedDB write
before updating the store, while the checkbox flips optimistically on click — so a reload
inside that window loses the toggle. Fix: update the store first, then persist, rolling
back on write failure. Plus a regression test.

## Testing

MapLibre requires WebGL, which jsdom does not provide, so there is no value in
unit-testing the rendered canvas. The split follows that constraint:

- **Vitest** — the pure logic: `routesToGeoJSON`, the shape of `style.ts` output, the
  selection store, and the corrected journal toggle.
- **Playwright** (real Chromium, real WebGL) — what only a browser can prove: the map
  mounts, pins render, clicking a panel row flies the map to that pin, and the locate
  control is present.
- **The tile build** is verified by its own size report, not by unit tests.

## Out of scope

- **Hillshade** — contours only, per the size decision above.
- **Offline / PWA** — still deferred. The self-hosted tiles are the groundwork for it.
- **Photos** — still deferred (WebP 640 q70 tier already chosen).
- **Hand-geocoding the 59 unlocated routes** — a later version; they remain list-only,
  which is why the panel lists all 184 rather than only the mapped ones.
- **GPX tracks** — the source has none, so routes are single points, not lines.

## Exit condition

Home shows the 125 located routes as pins on a keyless, self-hosted hiking basemap with
contours; hovering or clicking a panel row highlights and flies to its pin; done state is
visible on the map; a locate button shows your position; route pages show a locator
mini-map; the 59 unlocated routes remain reachable and honestly labelled; OSM and DEM
attribution is visible on the map; and the published site stays under the 1 GB limit with
room for the deferred photo pass.
