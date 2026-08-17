# Route Direction, Distance and Elevation — Design

**Goal:** give a drawn route a direction you can see, a distance, and an elevation profile you can
run a marker along — the reading a hiker expects before committing to a walk.

Built on the drawn lines from `2026-08-17-drawn-route-lines-design.md`: the author's own line is
what makes any of this trustworthy, because a profile is only as honest as the geometry under it.

---

## What already exists

| | |
|---|---|
| Direction | **Already in the data.** A drawn line's coordinate order is the order the author clicked. Nothing to store. |
| Distance | **Already computable.** `haversineM` in `app/src/lib/map/snap.ts`. |
| Elevation | **The DEM is already downloaded.** `build-contours.sh` clips `dem-<region>.tif`; `build-hillshade.sh` reuses it. |

The Cape Town DEM, measured: **864 × 1584 pixels, Float32, pixel size 0.000277778° — 1 arc-second,
about 30 m on the ground.** That number governs every claim this feature makes.

---

## The decision

**Elevation is sampled once, at Save time, and stored in the geometry.**

The `/draw` editor's Vite middleware already writes `data/route-lines.geojson`. It gains a step:
read the DEM with `geotiff` (a **dev-only** dependency), sample each coordinate, and write GeoJSON's
standard third ordinate — `[lon, lat, elevation]`. Positions with three values are RFC 7946, so no
schema is invented and nothing downstream needs to know a new shape.

Everything else derives from that geometry at read time: total distance, cumulative distance per
point, total ascent, and the profile itself.

**Why not sample in the browser from terrain-RGB tiles.** It would need a new raster archive in the
tiles release and a `TILES_TAG` change, and would ship a DEM to every reader — to compute, on every
phone, numbers that never change after the author draws the line. The line is fixed at Save; so
should the numbers be.

**Why not an elevation API.** This map has been keyless and offline since Phase 2. A per-route
network call to a third party would be the first external dependency in the reading path, and the
first thing to break when that service changes terms.

**Rejected — computing ascent from the contours archive.** The contour tiles carry elevation, but
interpolating a point's height between contour lines is strictly worse than reading the DEM those
contours were generated from.

---

## Where each part appears

- **Route page** — the full treatment: direction markers on the locator map, a distance and ascent
  line, and the elevation profile with a marker that tracks the cursor.
- **Map panel (preview)** — distance and ascent as **figures only**, no chart. The panel is a
  narrow column already carrying stats, provenance, variants and the full prose; a chart in it
  would be too small to scrub and would push the description below the fold.

That split is a decision, not an oversight: the panel answers *"is this the walk I want?"* and the
route page answers *"what am I in for?"*.

---

## Architecture

```
tools/tiles/build-contours.sh        already writes dem-<region>.tif   (WSL, gdal)
        │
        ▼  copied once to a gitignored local path
app/vite-plugin-route-lines.ts       samples the DEM on Save (geotiff, dev only)
        │
        ▼
data/route-lines.geojson             COMMITTED — coordinates become [lon, lat, ele]
        │
        ▼
app/src/lib/map/profile.ts           pure: cumulative distance, ascent, profile points
        │
        ├─▶ app/src/lib/components/RouteProfile.svelte   the chart, with scrubbing
        ├─▶ app/src/lib/map/route-lines.ts               direction markers
        └─▶ StatsStrip / RoutePreview                    distance and ascent figures
```

### Sampling (`vite-plugin-route-lines.ts`)

- Bilinear sample of the Float32 band at each coordinate, so a point between pixel centres does not
  step.
- The DEM path comes from `KAAPSPOOR_DEM` or defaults to `data/dem/dem-<region>.tif`, gitignored.
  **Absent DEM is not an error**: the line saves without elevation, the profile does not render,
  and distance still works. A clone with no DEM must still be able to draw.
- `npm run draw -- --elevate` re-samples every line already in the file, for the routes drawn
  before this existed.

### Derived values (`profile.ts`, pure)

- `cumulativeDistance(coords): number[]` — metres from the start at each point.
- `totalDistanceM(coords): number`
- `totalAscentM(coords): number` — sum of positive elevation differences, **with a 10 m threshold**:
  at 30 m resolution, consecutive samples wobble by a few metres, and summing that noise inflates
  ascent badly on a long line. The threshold is the difference between a defensible estimate and a
  number that is simply wrong.
- `profilePoints(coords): { distanceM, elevationM }[]`
- All return null/empty for 2D coordinates, so a line drawn before sampling degrades quietly.

### Direction

- **Arrows along the line**, as an icon symbol layer: `icon-image` with
  `symbol-placement: 'line'`, `icon-rotation-alignment: 'map'` and a `symbol-spacing` wide enough
  to read without crowding. The arrow is a small image registered at runtime with `map.addImage()`,
  drawn to a canvas — **no fontstack is involved**, since `text-font` governs text and this layer
  carries no text.
- Start and end markers as well: a filled dot at the start, a ring at the end.

**Markers alone are not enough, and this is the case that proves it.** A route that goes out and
back along the same trail puts the start and the end in the same place, so two markers say nothing
at all. Arrows are what carry direction there.

**But an out-and-back line also defeats the arrows**, and the design should not pretend otherwise:
the geometry covers the same ground twice, so the outbound and return arrows sit on top of each
other pointing opposite ways. On such a route the arrows cancel out visually and the honest answer
is the **profile marker**: dragging it runs a marker along the line in walking order, which is the
only thing that unambiguously shows direction on geometry that doubles back. The chart is therefore
not a nicety for these routes — it is the direction indicator.

Deliberately NOT attempted: offsetting the return leg to separate the two directions. It would draw
a line where the route does not go, which is the one thing this map does not do.

### The profile chart (`RouteProfile.svelte`)

- Inline SVG, no charting library.
- Hovering or dragging moves a marker along the chart **and** a matching marker along the line on
  the locator map, showing distance-so-far and elevation.
- Keyboard accessible: arrow keys step the marker, so the reading is not mouse-only.
- **Load the `dataviz` skill before building it**, so it reads as part of this map rather than a
  widget dropped onto it.

---

## Honesty constraints

These are the point of the feature, not a footnote.

- **Ascent is an estimate and says so.** Rendered as *"≈ 520 m ascent"*, never to three significant
  figures, and always **beside** the guide's own prose figure rather than replacing it. The guide
  says *"560m : from Rontree parking 170m to 730m approx"*; that sentence is the author's, and
  outranks a computed number.
- **30 m sampling cannot see a 20 m step.** A short sharp pitch reads as a gentle ramp. The profile
  is for the shape of the walk, not for planning a rope length.
- **Distance is the drawn line's length**, which follows simplified tile geometry — a percent or two
  short of the ground truth, and never presented as a measured track.
- Nothing here claims to be a GPS trace. If GPX from a walked hike ever lands (the Phase 4 spec
  reserves it), it supersedes all of this and should say so.

---

## Testing

- **`profile.ts` unit tests**: cumulative distance on a known line; ascent ignoring sub-threshold
  noise; ascent counting a real climb; empty results for 2D input.
- **Sampling tests** run against a tiny generated GeoTIFF fixture committed under `app/scripts/`,
  so they need neither WSL nor the real DEM.
- **Component tests** for the chart: renders points, moving the marker reports the right distance,
  keyboard stepping works.
- **An e2e** that a route page with a drawn line shows a profile, and that moving the marker moves
  the map marker.
- **No test may require the DEM or the tiles.** CI runs `npm test` before either exists.
- **A browser pass is mandatory**, as every phase here has been: three defects reached `main` past
  a green suite and were caught only by looking.

---

## Risks

- **Ascent noise.** The 10 m threshold is a judgement, not a law. It should be checked against the
  guides' own height-gain figures on the routes that state one — if the computed figure is wildly
  off on several, the threshold or the sampling is wrong, and the number should not ship.
- **A drawn line that leaves the DEM's extent** (the region bbox) samples nothing. Those points get
  no elevation, and the profile renders the portion it has rather than pretending.
- **`geotiff` is a new dependency**, dev-only and never in the built site. Worth confirming it stays
  out of the client bundle.

## What shipped (Task 8 browser pass, 2026-08-17)

Four routes carry drawn lines with sampled heights: Grootkop + Yellowwood Traverse (158 pts,
716–824 m), Lekkerwater Traverse (75 pts, 480–685 m), Pimple Traverse (65 pts, 518–695 m), Dark
Gorge (154 pts, 378–756 m).

**Computed ascent vs. the guides' own figures:**

| Route | Computed (10 m threshold) | Guide's prose |
|---|---|---|
| Grootkop + Yellowwood Traverse | ≈ 172 m | no height-gain sentence to compare against |
| Lekkerwater Traverse | ≈ 225 m | "400m : From 150m at Ruyteplaats parking to approximately 550m" |
| Pimple Traverse | ≈ 230 m | "575m : from 160m to 711m" |
| Dark Gorge | ≈ 381 m | "610m : from 90m at Newlands Forest Stn parking to 700m at Saddle" |

On the three comparable routes the computed figure lands at 40–62% of the guide's stated gain — a
factor, exactly the kind of gap the brief said would disqualify the number. It is explained, not
dismissed: every guide figure starts at the **parking area** (150 m, 160 m, 90 m), well below where
the drawn line itself begins. Dark Gorge is the clean check — its computed ascent (381 m) is within
a few metres of its own elevation *range* (756 − 378 = 378 m), so the threshold is not silently
inflating or eating real climb on the geometry it was actually given; the gap to the guide's 610 m
is the un-drawn approach walk from the station, not sampling error. Pimple Traverse's drawn line
starts at 518 m against the guide's 160 m parking figure — over 350 m of the guide's own gain
happens before the drawn line starts at all.

**Decision: the 10 m threshold is kept, unchanged, and the ascent figure ships** — as a figure
*beside* the guide's prose (`StatsStrip`), never replacing it, exactly as the honesty constraints
above require. The two numbers are allowed to disagree because they measure different things: the
guide's full trailhead-to-summit gain vs. the drawn line's own climb. Nothing here indicates the
sampling or the threshold is wrong.

**A real defect found in this pass, fixed:** `RouteProfile.svelte`'s figcaption and `aria-label`
rendered the *unrounded* float from `totalAscentM()` — "≈ 380.59999999999997 m of climb" — while
`StatsStrip` showed the correctly build-time-rounded "≈ 381 m" for the same route. This directly
violated the honesty constraint above ("never to three significant figures"). Fixed by rounding
`climb` in the component (`Math.round`), matching how `transform.ts` already rounds `lineStats.ascentM`
at build time. Covered by the existing component tests (whole-number fixture elevations mask
rounding, but the fix is a one-line `Math.round` with no behavioural surface beyond display).

**Browser pass, other findings:**
- Dark Gorge's profile reads as a single sustained climb — a broad rounded hump from 378 m up to
  756 m and back down — matching its reputation and the guide's own "610m... to Saddle" framing.
  Grootkop + Yellowwood's profile shows a smaller bump then a larger sustained climb, consistent
  with it being a loop around Grootkop rather than a simple there-and-back.
- Scrubbing verified end-to-end in a real browser on Dark Gorge: hovering the chart placed a
  marker on the profile ("at 1.33 km: 618 m") and a matching dark scrub dot appeared on the drawn
  line on the locator map at the corresponding point.
- None of the four drawn routes is a true out-and-back (same line walked both ways); Grootkop +
  Yellowwood is a loop with distinct outbound/return paths. The "opposing arrows cancel, scrub
  marker carries direction" scenario the design calls out could not be exercised against real data
  in this pass — noted here rather than claimed.
- Direction arrows were visible but faint on the locator map at the zoom `fitBounds` settles a
  short (1.9 km) line at (roughly z14–15) — consistent with the already-documented "marginal at
  z13, legible at z15/z16" finding from commit `94218e8`'s pass; not a new regression.
- `≈ 381 m` sits as its own `ASCENT` column beside `HEIGHT GAIN`'s guide sentence in `StatsStrip`,
  visually equal-weighted with it, not styled as more authoritative.
- Narrow-viewport (phone-width) rendering could not be confirmed live — the available browser
  tooling's window resize did not change the captured viewport in this pass. Not claiming it works;
  noting the gap. The chart (`viewBox` + `width: 100%`) and locator map use relative sizing, which
  is suggestive but not a substitute for having looked.

## Deliberately not attempted

- Elevation for off-path geometry, which does not exist yet.
- Grade or steepness colouring on the line.
- Units switching; this is a South African guide in metres.
- Elevation on the map panel's preview chart — figures only there, by the decision above.
