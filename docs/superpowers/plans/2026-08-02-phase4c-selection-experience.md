# Phase 4c — The Selection Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Selecting a hike shows what the hike actually is, and the map finally tells the truth about how well it knows where each route is.

**Architecture:** A `RoutePreview` component fetches the per-route JSON already published at `/data/routes/<id>.json` and renders it in the existing sidebar (which is already a bottom sheet on mobile). Alongside it, `area-approx` routes get hollow pins plus an uncertainty circle drawn **only for the selected route**, which is what finally lets the gate in `transform.ts` come off.

**Tech Stack:** SvelteKit 2 / Svelte 5 runes · MapLibre GL expressions · Vitest · Playwright.

## The measurements this plan is built on

Taken from `data/route-locations.json` against the shipped region `18.27,-34.33,18.51,-33.89`:

| | |
|---|---|
| Pins on the map today | **102** (91 `crawl` + 11 `osm-match`) |
| `area-approx` held back by the gate, **inside** the region | **31** |
| Their accuracy radii | 2.0–5.5 km, median 3.2 km |
| **Distinct centroids those 31 sit on** | **9** |

That last number decides the design. The 31 routes are not 31 places — they are 9 area centroids, with **7 routes stacked on one point** (Table Mountain / Atlantic West, r=3911 m), 5 on another, 5 on a third. Radii of 2–5.5 km over a peninsula ~20 km wide.

**So uncertainty circles cannot be a permanent basemap layer.** Nine overlapping translucent discs covering most of the map would obscure everything and say nothing. The circle is an *explanation of a selection* — you select a route, and the map shows you how loosely it knows where that route is. The permanent, always-visible honesty signal is the **hollow pin**.

Lifting the gate takes the map from 102 to 133 pins, a 30% increase.

## Global Constraints

- **Honesty about location is the governing principle.** An `area-approx` position must never be presented as precise. It is why the gate exists and why it may only be lifted once both the hollow pin and the uncertainty circle are in place.
- **The gate in `app/scripts/transform.ts` comes off LAST**, in its own task, after the rendering that justifies it. Its comment names the failure it prevents (the Otter Trail pinned 450 km out); read it before touching it.
- `RouteIndexEntry.coordsSource` is a discriminated union (`crawl` | `curated` | `osm-match` | `area-approx`); `coordsAccuracyM` is set for `area-approx` only, `coordsOsm` for `osm-match` only. The compiler enforces the shape — never cast around it.
- **Base path:** every URL through `base` from `$app/paths`, including the preview's fetch.
- TypeScript strict, no `any`. MapLibre behaviour tested in Playwright only.
- Attribution obligations unchanged.

## File structure

```
app/src/lib/components/RoutePreview.svelte       # NEW — the preview panel
app/src/lib/components/RoutePreview.test.ts      # NEW
app/src/lib/components/ProvenanceNote.svelte     # NEW — the wording, shared
app/src/lib/components/ProvenanceNote.test.ts    # NEW
app/src/routes/+page.svelte                      # MODIFY — show preview on selection
app/src/lib/components/MapView.svelte            # MODIFY — hollow pins, uncertainty circle
app/src/lib/components/RouteRow.svelte           # MODIFY — approximate glyph
app/src/routes/route/[id]/+page.svelte           # MODIFY — provenance wording
app/scripts/transform.ts                         # MODIFY — lift the gate (last task)
app/e2e/map.spec.ts                              # MODIFY
```

---

### Task 1: The provenance note

**Files:** Create `app/src/lib/components/ProvenanceNote.svelte` and its test.

One component, used by both the preview panel and the route page, so the two can never describe the same coordinate differently.

**Interfaces:** `<ProvenanceNote route={entry} />` where `entry` is a `RouteIndexEntry`.

Wording per `coordsSource`:

| source | text |
|---|---|
| `crawl` | *Location from the Mountain Meanders page.* |
| `curated` | *Location checked and corrected by hand.* |
| `osm-match` | *Location matched to “{coordsOsm.name}” in OpenStreetMap.* |
| `area-approx` | *Approximate — somewhere within about {km} km of this point, averaged from other routes in this area.* |
| `null` | *Location not recorded.* |

- Round the radius to one decimal (`3.2 km`), computed from `coordsAccuracyM`.
- The `area-approx` note must be visually distinct — it is a caveat, not a footnote. Give it a subdued warning treatment, not the same muted grey as the others.
- Tests: one per source, asserting the text; that `osm-match` includes the feature name; that `area-approx` shows the rounded kilometres; that a null source says location not recorded.

- [ ] **Step 1:** Write `ProvenanceNote.test.ts` covering all five cases. Use `@testing-library/svelte`, following `RouteRow.test.ts` for the existing pattern.
- [ ] **Step 2:** Run it, confirm it fails (component does not exist).
- [ ] **Step 3:** Write the component.
- [ ] **Step 4:** Run tests; run `npm test && npm run check`.
- [ ] **Step 5:** Commit — `feat(app): state how each route's position is known`

---

### Task 2: The preview panel

**Files:** Create `app/src/lib/components/RoutePreview.svelte` and its test.

**Interfaces:** `<RoutePreview routeId={id} onclose={() => …} />`. It fetches `${base}/data/routes/${routeId}.json` — the per-route content already published by `transform.ts` — and renders it.

That JSON is `RouteContent`: everything in `RouteIndexEntry` plus `sections`, `description`, `related`, `attachments`, `photoCount`, `sourceUrl`. **Read `app/src/lib/data/types.ts` for the exact shape rather than assuming.**

The panel shows: title, area breadcrumb, `StatsStrip` (grade, time, height gain — reuse the existing component), `ProvenanceNote` from Task 1, the description sections, and a link through to the full route page. Plus a close control returning to the route tree.

- **Fetch on demand, and handle all three states** — loading, loaded, failed. A failed fetch must say so, not render an empty panel.
- **Re-fetch when `routeId` changes** — selecting a second route while the first is open must replace it. Use `$effect` with the id as the dependency.
- **Guard against a stale response**: if the user selects B while A is in flight, A's response must not overwrite B. Track the in-flight id and discard mismatches.
- Tests: renders title and stats once loaded; shows a loading state first; shows an error state on a rejected fetch; a second `routeId` replaces the content; a late response for a previous id is ignored. Mock `fetch`.

- [ ] **Step 1:** Write the test file covering those five behaviours.
- [ ] **Step 2:** Run; confirm failure.
- [ ] **Step 3:** Write the component.
- [ ] **Step 4:** `npm test && npm run check`.
- [ ] **Step 5:** Commit — `feat(app): preview a route's Mountain Meanders entry without leaving the map`

---

### Task 3: Show the preview on selection

**Files:** Modify `app/src/routes/+page.svelte`.

When `$selection.selectedId` is set, the sidebar shows `RoutePreview` instead of the area tree; closing it clears the selection and returns the tree. On mobile this inherits the existing bottom-sheet behaviour for free — **read `BottomSheet.svelte` and the current `+page.svelte` layout before changing anything**, and do not restructure the layout.

Selection already works both ways (a pin click and a row click both call `setSelected`), so this needs no new wiring — verify that by reading `MapView.svelte` and `RouteRow.svelte`.

**Consider and decide, stating your choice in the report:** `RouteRow` currently navigates to the route page on click *and* sets selection. With a preview panel, navigating away on every click is probably wrong. Either make the row set selection only (and let the preview's link navigate), or keep both. Whichever you choose, the existing e2e test `hovering a panel row highlights it` must still pass, and the popup's "Open route" link must still navigate client-side.

- [ ] **Step 1:** Read the three components; decide the click behaviour.
- [ ] **Step 2:** Write a test for the sidebar swap (preview when selected, tree when not).
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm test && npm run check`.
- [ ] **Step 5:** Commit — `feat(app): show the route preview in the panel on selection`

---

### Task 4: Hollow pins and the uncertainty circle

**Files:** Modify `app/src/lib/components/MapView.svelte`, `app/src/lib/map/geojson.ts` and their tests.

Two separate signals:

**Hollow pins — permanent.** An `area-approx` route's pin renders unfilled (transparent fill, coloured stroke) so it is distinguishable from a surveyed one at a glance, always. Precise sources keep their solid fill. `coordsSource` must therefore reach the GeoJSON properties — check `routesToGeoJSON` in `geojson.ts` and add it if absent.

**The uncertainty circle — on selection only.** For the reason in the header: 31 routes sit on 9 centroids with 2–5.5 km radii over a 20 km peninsula, so permanent circles would be a soup. Draw it for the selected route alone.

Sizing it in **metres, not pixels**, needs an expression, because MapLibre's `circle-radius` is pixels:

```
radius_px = accuracyM × 2^zoom / 129774
```

129774 ≈ 156543.03 × cos(34°), the metres-per-pixel constant at this region's latitude. The region spans 0.44° of latitude, so treating cos(lat) as constant is accurate to well under a percent here — **document that assumption in a comment**, because it would not hold for a region spanning many degrees.

Cap the rendered radius so a 5.5 km circle does not swallow the screen when zoomed in close — `['min', <computed>, 140]` or similar. State the cap you chose and why.

- [ ] **Step 1:** Add `coordsSource` (and `coordsAccuracyM`) to the GeoJSON properties; test it.
- [ ] **Step 2:** Test that the `pins` layer's `circle-opacity` is data-driven on `coordsSource`.
- [ ] **Step 3:** Implement hollow pins.
- [ ] **Step 4:** Implement the selected-route uncertainty circle beneath the pins.
- [ ] **Step 5:** `npm test && npm run check`.
- [ ] **Step 6:** Commit — `feat(app): draw approximate positions as uncertainty, not as points`

---

### Task 5: Lift the gate

**Files:** Modify `app/scripts/transform.ts`, `app/src/lib/components/RouteRow.svelte`, `app/src/routes/route/[id]/+page.svelte`, and their tests.

**Only start this once Task 4 is merged and reviewed.** The gate's comment says it may not come off until the map can draw uncertainty; that is now true, and the comment must be replaced with one recording that the condition was met and what still guarantees it (the hollow pin and the circle).

- Merge `area-approx` locations through, and stop forcing `coordsAccuracyM` to null.
- `RouteRow`: an `area-approx` route now has coords, so its "no location" glyph disappears. Give it a distinct glyph instead — approximate is not the same as absent, and both differ from precise.
- The route page: render `ProvenanceNote`, and for `area-approx` the `LocatorMap` should not imply precision. Decide between a wider zoom, an uncertainty circle, or a caption; state your choice and reasoning.
- The existing transform tests assert `area-approx` is gated out. **Those assertions are now wrong and must be inverted** — say so explicitly in your report rather than quietly editing them.

Expected outcome: `npm run build:data` reports **133 located** in region rather than 102.

- [ ] **Step 1:** Invert the transform tests; confirm they fail.
- [ ] **Step 2:** Lift the gate; rewrite its comment.
- [ ] **Step 3:** Update `RouteRow` and the route page; test both.
- [ ] **Step 4:** `npm test && npm run check && npm run build:data` — report the summary line.
- [ ] **Step 5:** Commit — `feat(app): let approximate positions onto the map, drawn as approximate`

---

### Task 6: e2e, then look at it

**Files:** Modify `app/e2e/map.spec.ts`.

e2e additions:
- Clicking a pin opens the preview panel showing that route's title.
- Selecting an `area-approx` route draws the uncertainty circle; selecting a precise one does not.
- The pin count at the opening view rises to reflect the lifted gate — assert it is greater than before rather than hard-coding a number that will drift.

Use the existing `of()` helper, which returns `-1` for an absent layer.

**Then look at it in a browser.** Non-negotiable for this phase: every visual defect in Phase 4b — the dark hillshade, the missing peak labels, the smeared close-in shading — passed the tests and was found by looking.

**Before diagnosing anything, check `document.visibilityState`.** A MapLibre map in a hidden tab never loads its style, and the symptoms mimic total breakage. Ask the human partner to bring the browser window to the front rather than fighting it.

Judge: does the preview read well on desktop and at mobile width? Do hollow pins actually read as different from solid ones at a glance? Is one uncertainty circle informative or alarming? Do the 7 routes stacked on one centroid behave sensibly when selected from the list?

- [ ] **Step 1:** Write the e2e additions.
- [ ] **Step 2:** `npm run test:e2e` — both base paths.
- [ ] **Step 3:** Serve the build, capture the four views above, record a verdict.
- [ ] **Step 4:** Commit any adjustment separately so the reasoning stays visible.

---

## Definition of done

- `npm test && npm run check` clean; `npm run test:e2e` passes at both base paths.
- Selecting a route anywhere shows its Mountain Meanders information without leaving the map.
- Every route states how its position is known, in the same words in both places.
- `area-approx` routes are on the map, hollow, with an uncertainty circle when selected — and 133 routes are located in region rather than 102.
- A human has looked at it.

## Known limitation, not solved here

**Seven routes share one centroid** (and five share another). Clustering hides this below z13, but above it they stack exactly, and the map cannot distinguish them — only the panel can. Spiderfying co-located pins is a real improvement and explicitly out of scope; it also affects the 17 shared coordinates Phase 0 found among crawl routes, so it deserves its own treatment rather than being bolted on here.

## Out of scope

- Route geometry / highlighting a route's shape — Phase 4d.
- Photos, offline/PWA, journal sync, grade normalisation.
- A second region or a region picker.
