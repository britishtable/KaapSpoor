# Phase 4e — Named Paths Design

**Goal:** make the map readable against the prose. The route descriptions say *"up Porcupine
ravine"*; today the map draws that path as an anonymous brown dash. This phase labels the paths
the guides actually name, and highlights a selected route's named paths so the description and
the terrain can be read together.

This phase is **style and build-time data only**. No tile rebuild, no WSL, no new release asset.

---

## The measurements this design is built on

Taken from `app/static/tiles/trails-cape-town.pmtiles` (all 168 z14 tiles of the shipped region)
against `data/routes.json`.

| | |
|---|---|
| Path features (tile-clipped) | 25,640 — `footway` 18,841, `path` 4,935, `steps` 1,078, `track` 782 |
| Carrying a `name` | **3.2%** |
| Distinct path names | **364** |
| Of those, single-word | 16 |
| Distinct names appearing in guide prose | **83** |
| **Routes whose description names ≥1 mapped path** | **101 / 133** |
| Named paths per route | median **2**, p75 3, p90 4, max **8** |
| Routes naming none | 32 |
| Route titles that are exactly an OSM path name | **45 / 133** |

Two numbers decide the design. **101 of 133** is why this is worth building: the guides and OSM
speak the same language about this mountain. **Median 2, max 8** is why the highlight can follow
the selection without becoming clutter.

`Pipe Track` is named by 19 route descriptions, `Ledges` by 15, `Contour Path` by 11,
`Platteklip Gorge` and `Nursery Ravine` by 9 each.

**These are the recomputed figures, measured under the final matching rules** by
`npm run build:data` on 2026-08-11 — they replace the case-insensitive, two-word-minimum
estimates this spec was drafted from (109 / 133, 81 names, p90 5). Treat them as the true ones.
Across all 184 routes the build reports 108 naming a mapped path and 83 distinct names used of
the 364 available.

**Case sensitivity costs more than the estimate assumed, and the cost is concentrated in one
name.** `Contour Path` fell from 41 route descriptions to 11: 26 in-region descriptions write
*contour path* in lower case and 24 of those never write it any other way, so the rule that
separates *Ledges* the path from *ledges* the rock feature also discards them. The headline
barely moved (109 → 101) because those routes name something else as well, and the rule is kept
as specified — a false highlight is a wrong claim about the mountain, where a missing one is only
a quieter map. Recorded here because it is the obvious candidate for a later refinement: a
case-insensitive pass restricted to multi-word names would recover most of the 24 without
readmitting the single-word false positives the rule exists to stop.

### A finding this phase does not act on

45 route titles are *exactly* an OSM path name. The geocoder found 11 matches in total, because
`tools/geocode/kaap_geocode/match.py` treats two features sharing a name inside the area bbox as
an ambiguity rather than a match. That rule is right for peaks — two summits called Klipspringer
are two places — and **wrong for ways**, where 27 segments called *Contour Path* are one trail cut
at every junction. Fragmentation is being read as ambiguity.

Several of the 45 are routes currently pinned as `area-approx`: *Muizenberg Buttress* sits hollow
on a 5,543 m circle while an OSM way of that exact name exists. Fixing the rule belongs to
**Phase 4d**, where segment-stitching is the core work. It is recorded here because this phase's
measurements are what surfaced it.

---

## The decision, and what was rejected

Selecting a route highlights the paths its description names, **framed as mentions, not as the
route**.

Those paths are not the route. The 7 Buttresses text names *Porcupine Ravine* on the way in and
*Kasteels Poort* as a bail-out. Drawing them in one colour under one label would assert a route
that isn't the route — undoing, in the opposite direction, the honesty work of Phase 4c.

**Rejected — labels only, no highlight.** Zero over-claim, but it leaves *"go up Porcupine
ravine"* as text you still have to hunt for, which is the problem this phase exists to solve.

**Rejected — ranking mentions by role** (ascent / descent / escape, coloured accordingly). Much
better if it worked. It is NLP over guide prose, and it is the only option here that can be
confidently wrong. Deferred indefinitely.

**Rejected — labelling all 364 names.** The `name` field carries mapper annotations, not only
names: *"Pipe Track (alternative route, closed off)"*, *"Possible connection to Disa River paths"*,
*"Red Hill alternate return via One Bollock"*. Longest is 42 characters. A filter is needed
regardless, and the guides' vocabulary is the most defensible one available.

---

## Architecture

```
tools/pathnames/          reads app/static/tiles/trails-<region>.pmtiles
  (Node, run by hand)     emits  data/osm-path-names.json   ← COMMITTED
        │
        ▼
app/scripts/transform.ts  matches those names against each route's prose
        │                 emits  mentionedPaths[] per route
        ▼
app/src/lib/map/          static tier + referenced lines + referenced labels
```

### Why extraction is a separate committed artifact

The names exist only inside the pmtiles, and the tiles are gitignored. CI downloads them at
`.github/workflows/deploy.yml:29` — **after** `npm test` and `npm run check` have already run —
and a fresh `npm run dev` runs `build:data` with no tiles present at all. If `transform.ts` read
the archive directly, unit tests would depend on a file that does not exist yet at that point in
the workflow, and a clean clone would fail to start.

So the tile-reading step is a manual tool whose output is committed, and everything downstream
reads only committed data. This is the shape `tools/geocode` established: a tool with heavyweight
inputs, a committed artifact, and `transform.ts` merging it.

**Unlike geocode and the tile builds, this needs no WSL.** It reads a pmtiles archive already in
the working tree, which pure Node can do via `pmtiles` (already an app dependency) plus
`@mapbox/vector-tile` and `pbf`. Verified during design — the measurements in this document were
produced that way.

`data/osm-path-names.json` records each name **and its segment count**. The count is the signal
that separates a real trail from a stub, and 4d will need it.

### Why matching lives in `transform.ts`

The two inputs change on different clocks: prose changes whenever the crawler reruns, names only
when tiles rebuild. Matching at data-build time means a re-crawl picks up new mentions with no
tile step and no WSL, and it is testable in Vitest against fixtures with no archive present.

### The matching rules

Each rule does one job, and each exists because of a specific observed failure.

- **Case-sensitive matching against raw prose.** *Ledges* capitalised is the path; *ledges*
  lowercase is a rock feature. This separates *Boulders* (1 capitalised, 10 lowercase), *Bridge*
  (2 / 9) and *Bypass* (3 / 10) from *Ledges* (42 / 30) and *Simonsberg* (4 / 0). The matcher
  therefore folds apostrophes and punctuation but **preserves case**.
- **A minimum name length of 3 characters.** `B` is an OSM path name in this region, and it
  matches 98 times across 40 routes because `B` is a grade in this archive (*"a 'B' grade
  scramble"*). The length floor rejects it on the honest grounds that a one-letter name carries no
  evidence.
- **Longest match wins.** *Twelve Apostles* and *Twelve Apostles Path* are both OSM names, and
  *Ledges* sits inside the route title *Fountain Ledges*. Without this, one path gets two labels
  and short names steal credit from long ones.

**No word-count minimum.** An earlier draft required two words; it would have discarded *Ledges*,
a genuine title-to-path match, and it would have rejected `B` only by accident.

The tool reports what it declined and why, as `data/geocode-report.md` does — including
`FarmersCliffsWalkMiddle` (a mapper's unspaced string, fine as data and ugly as a label) and the
Boulders snake-named paths (*Mamba*, *Boomslang*, *Cobra*, *Rhinkals*), which are real names no
guide happens to mention.

### Where `mentionedPaths` ships

In the per-route JSON at `/data/routes/<id>.json`, which `RoutePreview` already fetches on
selection — so the highlight rides an existing request rather than growing `routes-index.json` for
all 184 routes. The cost is that the highlight appears on fetch-completion rather than instantly,
the same beat the preview panel already has.

### Corpus-agnostic by construction

The matcher's input is a list of `{ routeId, text }`, not "the Mountain Meanders archive". Adding
a second site later is another producer of that list, not a rewrite. Cross-referencing other route
sites is **out of scope here** and needs its own spec — it raises licensing and terms questions
the archive did not.

---

## The layers

Three concerns, four layers in `style.ts`, inserted after `paths` and before the peak labels — so
referenced lines sit above ordinary paths but under every label, and all of them before
`region-mask`, which pins are still appended above at runtime.

| layer | type | minzoom | filter |
|---|---|---|---|
| `paths-referenced-casing` | line | 11 | selected route's names |
| `paths-referenced` | line | 11 | selected route's names |
| `paths-referenced-label` | symbol, `symbol-placement: 'line'` | 12 | selected route's names |
| `paths-named` | symbol, `symbol-placement: 'line'` | 13 | the ~81-name vocabulary |

Selection drives `setFilter`, the pattern `MapView` already runs for pins. The unselected state is
`['in', ['get','name'], ['literal', []]]` — matches nothing, no special-casing.

### Zoom floors, and the gap they leave

The density argument that gated ordinary `paths` at z12 does not apply to a 2–8 feature subset, so
referenced lines draw a zoom earlier. **They cannot go below z11: `tools/tiles/profile/trails-profile.yml`
sets `min_zoom: 11` on the paths layer, so below that there are no path features to filter.**

Consequence: **selecting a pin at the opening view (z9.9–10.3, lower on a phone) shows no highlight
until the camera arrives.** `MapView` already flies in on selection, so the highlight is present
when the flight lands. The fix, if it proves annoying, is a tiles rebuild with a lower `min_zoom`
for *named* paths only — a tiles phase, not this one. **Do not "fix" it by lowering the layer's
minzoom into a zoom that has no data.**

### The treatment: emphasis, not a new category

Referenced paths keep the brown hue of `paths` (`#8a5a3b`) but go **solid instead of dashed**,
darker (~`#6b3f24`), heavier (2.0 px at z11 → 3.5 px at z14), over a background-coloured casing
that lifts them off the contours.

Solid-vs-dashed carries the signal. Shifting hue would say "different kind of thing"; it is not
one — it is the same path the guide is talking about. It also stays clear of the pin colours,
where green means done and nothing else.

**Only `Open Sans Regular` ships.** `tools/tiles/fetch-fonts.sh` fetches exactly one stack and it
is baked into the release asset, so a promoted label cannot be *bolder*. Labels differentiate by
size, darkness and halo. Adding a bold stack means editing the script, rebuilding `fonts.tar.gz`,
cutting a release and bumping `TILES_TAG` plus the CI size assertions — possible, but it turns a
style-only phase into a release change.

### Segmentation, and why `text-allow-overlap` stays off

*Contour Path* is 27 features, and `symbol-placement: 'line'` labels each feature — so the name
repeats along the trail at `symbol-spacing` intervals. That is ordinary topographic cartography,
not a defect. **It is also why `text-allow-overlap` must stay off**: forcing 27 labels to draw is
the disaster version.

The known consequence is that promoted labels compete for placement and will sometimes lose —
route cluster badges outrank them, because MapLibre places later symbol layers first and the pins
are added at runtime after the style.

The signals are therefore tiered deliberately:

1. **The line is guaranteed** — lines do not collide.
2. **The label is best-effort** — it appears when there is room.
3. **The panel text is guaranteed.**

Losing a label costs polish, never information.

---

## The panel, and what it claims

**A `MentionedPaths` component**, following the `ProvenanceNote` precedent: one component owning
the wording, so no two surfaces can describe the same relationship differently. It renders in
`RoutePreview` beneath `ProvenanceNote`, and takes **only** the matched names — it knows nothing
about the map, and has no click behaviour in this phase.

**The wording is the design.** The heading states the relation exactly: **"Paths this description
names."** Not "the route", not "the way up". We cannot tell an ascent from an escape, and the
panel must not imply we can.

It lists the **OSM** spelling rather than the guide's, because that is what is printed on the map
beside it — *Smuts' Track* even where the prose wrote it differently.

**The 24 routes that name nothing** get one quiet line rather than an empty gap: *"No mapped paths
are named in this description."* Silence would leave a user who saw highlights on the previous
route assuming this one is broken — the same reasoning behind `RoutePreview` rendering all three
of its states explicitly.

**The route page gets it too.** `LocatorMap` already shares `style.ts` and clamps to z≥13, at or
above every new layer's floor, so the same filter lights the same paths where the full description
is actually read. This is the one piece to cut if the phase runs long.

**No new attribution obligation** — the names come from the `trails` source, already carrying
`ATTRIBUTION_OSM`.

**Inherited failure mode:** if the per-route fetch fails there are no names, so no filter is set
and no highlight appears, while `RoutePreview` shows the error state it already has.

---

## Testing

Split by what CI can see: `npm test` and `npm run check` run **before** the tiles land, so every
unit test must work with no archive present.

### Vitest

**The matcher carries the weight** — pure functions over fixtures, one case per rule, each named
for the failure it prevents:

- *Smuts' Track* / *Smuts Track* fold to one match, not two labels on one path
- *Ledges* matches; *ledges* does not
- `B` is rejected on the 3-character floor, with fixture prose containing `'B' grade` so the test
  fails loudly if the floor is removed
- *Twelve Apostles Path* wins over *Twelve Apostles*; *Fountain Ledges* wins over *Ledges*
- a route naming nothing yields `[]`, not `null` or absent

**`style.test.ts` additions:**

- the four layers exist, and sit after `paths` and before `region-mask` — ordering is not
  cosmetic; the mask draws over anything below it, and that bug class has hit this map before
- `paths-referenced` minzoom is **11, the archive's own floor**
- every width's first stop is ≥0.8 px
- the unselected filter matches nothing

**An anti-drift test**, mirroring the one tying `region.ts` to `regions.json`: the static tier's
vocabulary is *derived from* `data/osm-path-names.json`, never hand-listed.

**`MentionedPaths.test.ts`:** renders the names in OSM spelling; renders the empty-state line.

**Deliberately absent: any staleness check on `osm-path-names.json`.** CI has no tiles when unit
tests run, so such a check could only take the degraded path and fail for being right — the same
reasoning `tools/geocode` records for its own. This must be commented in the file, or someone adds
it later and CI goes red for a good build.

### Playwright

Anything about rendering. jsdom has no WebGL, and this project has twice shipped bugs that passed
every check except a browser.

- select *7 Buttresses* → the `paths-referenced` filter contains its names, and
  `queryRenderedFeatures` on that layer returns > 0 once the camera settles
- deselect → filter matches nothing, zero rendered
- select a route naming nothing → zero rendered, and the panel's line is visible
- at z≥13, `paths-named` renders labels

**Do not assert exact label counts at the opening view.** Placement there turns on viewport luck
and cluster badges win collisions; such an assertion passes or fails on pane size, not on
correctness.

### A manual look, as a step rather than an assumption

Overview, mid and close-in — a value tuned at one zoom is wrong at another, as the hillshade
demonstrated twice. Specifically: **whether solid-vs-dashed reads as emphasis at z12 against the
contours.** That is the one judgement in this design no assertion can make.

---

## Relationship to Phase 4d

This phase does not compete with 4d and is not a substitute for it.

- 4e highlights **paths the description mentions**, filtered from existing tiles by name.
- 4d draws **the route's own line**, stitched from OSM ways into a committed
  `data/route-lines.geojson`.

When 4d lands, the route's line joins the map in the pin colours and these stay clearly secondary,
as what the text refers to. 4e also does 4d's groundwork twice over: it establishes the
name-matching vocabulary, and its measurements identified the `match.py` ambiguity rule as the
reason 4d's yield looked small.

### What actually happened (4d shipped, 2026-08-17)

**The referenced-path highlight was removed.** `paths-referenced`, `paths-referenced-casing` and
`paths-referenced-label` are gone from `style.ts`, and a test in `style.test.ts` asserts their
absence so the removal reads as a decision rather than a regression. The reason is the one this
spec could not have known before the tier was used: **a name has no extent.** *Contour Path* lit
the length of the peninsula, the highlight broke wherever an unnamed connector carried the trail,
escape routes drew as co-equal with the ascent, and a route naming nothing showed nothing at all.
None of that is a defect in the matcher — it is the ceiling of name-matching, and 4d's geometry is
what replaces it.

**What survived, and is still doing its job:**

- `paths-named`, the quiet label tier. It states a fact — this path is called that — which needs
  no extent to be true.
- `MentionedPaths.svelte` and the `mentionedPaths` field. The panel section is unchanged, and the
  ordering it captures turned out to be load-bearing for 4d: the stitch tier walks a route's named
  paths **in the order the prose introduces them**, and that ordering is the only thing supplying
  extent to a tier that would otherwise cover everything sharing a name.
- The matcher itself, mirrored into Python as `tools/routelines/kaap_routelines/mentions.py`.

**The `match.py` finding recorded above was fixed** in 4d's Task 8: connected same-named ways are
now read as one fragmented trail rather than as an ambiguity, and the match is positioned at the
midpoint of the whole run. `osm-match` went 11 → 13, gaining *Disa River Walk* and
*Twelve Apostles Path*, and two routes moved off an `area-approx` centroid.

**The case-sensitivity cost recorded above stands**, and 4d inherits it: the stitch tier can only
walk trails the matcher found.

---

## Risks

- **Solid-vs-dashed may not read as emphasis** at mid zoom against the contours. Mitigated by the
  casing and by the manual look; if it fails, the fallback is a lightness step rather than a hue
  change, keeping the "same thing, emphasised" claim.
- **Promoted labels lose collisions** to cluster badges. Accepted, and the reason the panel text is
  the guaranteed tier.
- **Case sensitivity is a heuristic.** A description that opens a sentence with a common noun
  matching a path name produces a false positive. The review report is the defence; the cost of a
  wrong entry is one extra highlighted path, not a wrong position.
- **The opening-view gap** (no highlight below z11). Documented above with its non-fix.

## Deliberately not attempted

- Ranking mentions by role (ascent / descent / escape).
- Clicking a name to fly to that path, and hover-to-isolate — both need `querySourceFeatures` and
  a decision about which of N segments to frame. Better after 4d.
- Labelling all 364 names.
- A second prose corpus. The matcher is built to accept one; sourcing it is its own spec.
