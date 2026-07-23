# Phase 2 — Map, Route Library & Journal (App v1)

**Date:** 2026-07-21
**Status:** Approved for planning
**Scope:** The first buildable KaapSpoor app — static-site shell, interactive map,
browsable route library, and a personal hiking journal. Built on the Phase 0 dataset.

## Purpose

KaapSpoor is a **personal hiking journal and trail guide**. It presents the 184
Mountain Meanders routes extracted in Phase 0 as a browsable, mappable library, and
lets the owner record the hikes they have done — marking routes complete with a date
and notes. The map is the primary discovery tool; the journal is the reason to return.

Single user, no accounts, no backend. Everything runs as a static site on GitHub Pages
with journal data held in the browser.

## Constraints (inherited from Phase 0)

- Static site, **GitHub Pages, 1 GB hard limit** shared with the PMTiles base map.
- **Coordinate coverage is partial:** **125/184** routes have coordinates and can be
  pinned; **59** do not and cannot. (Among the 147 *full route entries* specifically,
  coverage is 114/147 = 77.6%; the map, though, pins every located route regardless of
  type.) The map must handle the 59 unlocated routes gracefully rather than fake their
  positions — this drove the whole design.
- **Two independent classifications**, not to be conflated: *located vs unlocated*
  (has coordinates — decides pinnability) and *full route entry vs traverse note*
  (has a Key Statistics table or labelled grade — decides how it reads). 11 routes are
  located traverse notes; they are real places and get pinned.
- No GPX/KML tracks exist on the source, so routes are **single points, not lines**.
- `slug` is **not unique** (two "Klipspringer" routes), so a stable id is required.
- All photos are **deferred** (Mountain Meanders decks and the user's own journal
  photos alike). This phase records none.

## Stack

- **SvelteKit** with `adapter-static` — every page prerendered, no SSR at runtime.
- **MapLibre GL JS** + the **PMTiles** protocol for the base map.
- **`idb`** for IndexedDB access; journal state exposed as a Svelte store.
- **Vitest** + **Playwright** for tests.
- **GitHub Actions** → GitHub Pages for deploy.

Rationale for SvelteKit over Astro/React/vanilla: it prerenders the 184 content pages,
keeps bundles small (matters on mobile/on-trail), and gives a unified reactive store so
the map, index panel, and route pages share journal state with little friction.

## Data pipeline

A new build-time transform under `tools/` reads `data/routes.json` and emits two
artifacts. It has one clear job: turn the crawl output into what the app consumes.

1. **`routes-index.json`** — the slim index loaded by the map and the index panel on
   every page. Per route: `id`, `title`, `area` (path), `coords` (or null), `grade`,
   `grade_source`, `time`, `height_gain`, and `is_full_entry`. Kept minimal so it is
   cheap to ship everywhere.
2. **Per-route content** — the fuller record (description sections, related links,
   attribution, photo count) consumed by the 184 prerendered route pages.

**Stable route id.** Derived deterministically as the slugified `area-path + slug`, so
it survives re-crawls and disambiguates the duplicate slugs. Journal entries key on this
id; if the id scheme ever changes, existing journals must be migrated, so the derivation
lives in one documented place.

**PMTiles base map.** A **Western Cape extract** built from OSM data (via planetiler or
the protomaps build tooling) and served as a static `.pmtiles` file. This is the single
heaviest task in the phase and the other half of the 1 GB budget. Specified as its own
isolated `tools/` step with a hard size target and a documented, repeatable build
command. The extract is committed to the repo (decided over release-asset hosting for
simplicity and self-containment); if it approaches the budget, revisit as a build asset.

## The three views

### Map view — the located 125

MapLibre over the Western Cape PMTiles. One pin per located route (all 125 with
coordinates, full entries and located notes alike), styled two ways:
**done vs not-done**, driven by the journal store. Overlapping pins (Phase 0 found 17
shared coordinates) use MapLibre's native **clustering**; clusters expand or spiderfy on
click. Clicking a pin opens a compact popup — title, grade, a done-toggle, and an "open
route" link. Map and index panel share hover/selection state so highlighting one
highlights the other. Initial view fits the route extent.

### Index panel — all 184

A collapsible tree following the area hierarchy (Table Mountain → Atlantic West →
route). Each row shows grade and a done checkmark; **unmapped routes carry a "no
location" glyph**. Row click behaviour: mapped routes fly the map to their pin; unmapped
routes open the route page directly. Filters at the top: by area, by grade, and a
done/not-done toggle. Per-area headers show a `done / total` count, making the panel
double as a progress view. On mobile the panel becomes a **bottom sheet** over the map.

### Route page — prerendered, ×184

Area breadcrumb, title, and a stats strip: grade (with a caveat marker when
`grade_source` is prose-inferred rather than a labelled field), time, and height gain.
Then the description sections, related-route links, and source attribution. Located
routes get a small **locator mini-map**; unmapped routes get an honest "location not
recorded" note. Journal controls live here: mark done, a date picker, and free-text
notes, all written to IndexedDB.

## Journal

A Svelte store hydrated from IndexedDB on load. The map, index panel, and route pages
all read it reactively, so a done-toggle anywhere updates everywhere at once.

- **Entry schema:** `{ routeId, done, date, notes }`. `routeId` is the stable id above.
- **Storage:** IndexedDB via `idb`, single object store keyed by `routeId`.
- **Export:** downloads the whole journal as a JSON file.
- **Import:** loads a JSON file, with a choice to merge into or replace the current
  journal. Import is validated against the schema; unknown `routeId`s are kept (a route
  may have been renamed) but flagged.

Export/import is the only backup and cross-device path — there is no sync. This is a
deliberate v1 simplification.

## Testing

Proportionate, focused on the pieces that carry real logic:

- **Vitest** — the data transform (id stability across runs, index shape, duplicate-slug
  disambiguation) and the journal store (toggle, export round-trips to import, merge vs
  replace semantics, schema validation).
- **Playwright** — one thin smoke test: the map mounts, pins render, and a done-toggle
  persists across a reload.

## Deploy

GitHub Actions workflow: install → build → prerender → publish to GitHub Pages. The
workflow includes a **size check** that fails if the published output (app + PMTiles)
exceeds the budget, so the 1 GB ceiling is enforced in CI rather than discovered later.

## Out of scope (deferred to later phases)

- **All photos** — Mountain Meanders decks and the user's own journal photos. Route
  pages show a photo-count placeholder only.
- **Offline / PWA** — no service worker, no tile caching. v1 is online-only; installable
  offline use is its own later phase.
- **Hand-geocoding** the 59 unlocated routes — a later version. The graceful unmapped
  path in this design is what makes deferring it safe.
- **Cloud sync** of the journal — export/import only.
- **Grade normalisation** — grades stay raw, per Phase 0.

## Exit condition

A deployed static site where the owner can browse all 184 routes by area, see the 125
located ones on the map, open any route, and mark hikes done with a date and notes that
survive a reload and can be exported. Under the 1 GB budget, enforced in CI.
