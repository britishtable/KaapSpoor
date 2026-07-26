# Map follow-ups (deferred from Phase 2 Plan 2)

**Date:** 2026-07-27
**Status:** Open — none of these block the map shipping

Recorded when Plan 2 merged. Each was raised by a review, adjudicated as non-blocking, and
deliberately deferred rather than dropped.

## Needs a decision before it can be built

- **One WebGL2 capability guard, with a graceful fallback.** Three `try/catch` blocks in
  `MapView.svelte` and `LocatorMap.svelte` exist only because jsdom has no WebGL2. A single
  up-front capability check would replace all three *and* serve real users on WebGL2-less
  devices, who currently get an empty grey pane with no explanation. `LocatorMap` already
  degrades gracefully (its coordinate caption), `MapView` does not. Needs a UX decision on
  what the fallback shows.
- **Collapse area `<details>` by default.** The panel renders all 184 routes expanded, so its
  content is ~7180 px tall. It scrolls correctly now, but collapsing areas would cut initial
  DOM work and make the tree easier to scan. A UX change, so it needs its own thought.

## Straightforward, just not done

- **Keyboard cross-highlight.** `RouteRow` wires hover/select to `onmouseenter`/`onmouseleave`/
  `onclick` only, so tabbing the list gives no map feedback. Adding `onfocus`/`onblur` would
  make the map/panel sync — "the entire value of the design" — usable without a pointer.
- **Fold `setWorkerUrl` and the pmtiles protocol registration into one `$lib/map/` helper.**
  Both are duplicated across the two map components, and `removeProtocol` mutates a module
  global from a per-component teardown: if two maps ever overlap during a client navigation,
  the last to unmount unregisters the protocol under the live one. Ref-counting in a shared
  helper removes the hazard and the duplication together.
- **Licence notices for the redistributed assets.** Copernicus DEM prescribes a specific
  attribution form naming DLR/Airbus/EU/ESA; the style says only "contours from Copernicus
  DEM". And the site now serves Open Sans glyph PBFs (Apache-2.0) with no licence file —
  `fetch-fonts.sh` should write one alongside them.
- **Checksums for the `tiles-v1` release assets.** CI asserts size floors, which catch
  truncation but not substitution. Publishing and verifying a checksum would close that.
- **`npm audit`: 10 advisories** (1 critical, 1 high) since `maplibre-gl` became a runtime
  dependency. A static site with no server and no user input, so low risk — but confirm none
  of the high-severity entries are in `maplibre-gl` or `pmtiles` themselves.
- **Vite chunk-size warning** — the maplibre bundle is ~997 kB. Worth a look if first paint
  matters on mobile data.
- **Unit-test stderr is no longer pristine.** `LocatorMap`'s `console.warn` fires under jsdom
  on every located-route test. Honest signal; resolving it properly is the capability-guard
  decision above.

## Testing gaps left open

- **Nothing covers visual correctness** — contour legibility, water contrast, dashed-path
  rendering, label placement and overlap. The e2e proves function and, since Plan 2's final
  fix, layout *size*, but not appearance. Pixel diffing is probably overkill; a human look at
  the deployed map is the cheap version.
- **The CI e2e run has never actually executed on GitHub Actions.** It was verified locally on
  Windows. `npx playwright install --with-deps chromium` should supply what WebGL needs on
  `ubuntu-latest`, but confirm on the first run rather than assuming.

## Lesson worth keeping

Two defects on this branch were invisible to unit tests, type-checking and eleven task
reviews, and only a real browser found them: maplibre's worker 404'd after a Vite build so the
map never became ready in production, and MapLibre silently `parseInt`s string feature ids on
GeoJSON sources, so `promoteId` was required for any pin styling to work at all. Both passed
every check that did not open a browser. When something can only be verified in a browser,
verify it in a browser.
