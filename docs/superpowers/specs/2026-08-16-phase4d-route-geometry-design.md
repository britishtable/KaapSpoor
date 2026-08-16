# Phase 4d — Route Geometry Design

**Goal:** draw the route's own line, with a start and an end — and retire the highlight that
stands in for one today.

Phase 4e lit up every mapped path a description names. In use that is unreadable, for four
reasons at once: *Contour Path* lights the length of the peninsula, unnamed connecting ways leave
the highlight dashed and patchy, approach and escape paths appear as co-equal with the route, and
a route naming nothing shows nothing at all. None of those is a defect in the matcher. They are
the limit of name-matching: a name has no extent.

This phase replaces that with geometry that does — and where it cannot, draws nothing.

---

## The measurements this design is built on

Taken from `data/routes-index.json` (the 2026-08-16 build) and from Overpass over the peninsula
bbox `-34.40,18.28 → -33.80,18.65`.

| | |
|---|---|
| Routes with a location | 181 / 184 |
| Routes with a location and ≥1 named path | **108** |
| …and ≥2 named paths | **67** |
| …and ≥3 named paths | 44 |
| Routes naming no mapped path | 76 of 184 |
| **`type=route, route=hiking\|foot` relations in the region** | **36** |
| Route titles matching a relation name (substring, before review) | 13 |

The 36 relations are the finding that reshaped this design. A hiking relation is an **ordered list
of member ways, authored by a mapper** — the artifact this phase was otherwise going to
reconstruct by inference. Member counts, sampled:

| relation | ways | roles |
|---|---|---|
| Contour Path | **27** | — |
| Apostles Path | 14 | `forward`, `backward` |
| Devil's Peak Route | 12 | — |
| Wood Ravine | 6 | — |
| India Venster | 5 | — |
| Platteklip Gorge | 4 | — |
| Diagonal Route | 4 | — |
| Kasteelspoort | 3 | `forward` |
| Mowbray Ridge | 3 | — |
| Newlands Ravine | 2 | — |
| Kloof Corner | 2 | — |
| Nursery Ravine | 1 | — |
| Corridor Ravine | 1 | — |

**Contour Path is 27 ways in the relation and 27 features in the tiles.** The relation is exactly
the segment list Phase 4e measured and could not join. That is the second, larger use of
relations: even where a relation is not a route we ship, it defines a named trail's ways *in
order, including the unnamed connectors that carry no `name` tag at all*. Name-matching cannot
see those connectors, which is precisely why the 4e highlight looks broken.

**13 title matches, and they need a human eye.** *"Platteklip Gorge - Table Mountain Hiking
Guide" → Platteklip Gorge* is right. *"Devil's Peak contour paths" → Contour Path* is not — that
route walks along a trail the relation describes end to end. *"Diagonal Route on 3rd Ridge" →
Diagonal Route* is a different route sharing a word. 16 candidate pairs is small enough to
confirm by hand, and hand-confirmation is a tier this project already has: `curated`.

---

## The decision, and what was rejected

A route gets a line in one of two ways, or gets none.

- **`osm-relation`** — the route's line **is** a hiking relation's geometry, stitched from its
  member ways. The route-to-relation mapping is hand-confirmed and committed. Highest confidence:
  the extent was decided by a mapper, not by us.
- **`osm-stitch`** — an ordered corridor walk. The route's named paths, **in the order the prose
  introduces them**, are treated as a waypoint sequence; the line is the walk from the route's
  anchor through those trails in that order.
- **no line** — a pin, and nothing drawn. Silence is the design, not a gap in it.

**The ordering signal is the whole basis of the stitch tier.** A guidebook describes a route in
the order you walk it, and Phase 4e already extracts the names in reading order into
`mentionedPaths`. That ordering is what supplies extent: the line starts where the sequence
starts and ends where it ends, instead of covering everything that shares a name.

**Rejected — the anchored budget walk.** Flood outward from the anchor along mentioned-name
segments, capped by a distance budget, with no use of ordering. It covers the 41 single-mention
routes too, but it returns a *subnetwork*, not a route: at every junction it takes both branches,
so it still draws shapes the hike does not walk. Under a right-or-absent bar that is the wrong
trade.

**Rejected — a length budget as a hard gate.** `time` is prose, not a duration: *"5 hrs up and
down for a fit party, 7 hrs for average party. 3-4 hours if using one of the shorter options."*
134 routes carry the field and few parse cleanly. It appears in the review report as a sanity
note; it never decides whether a line ships.

**Rejected — approximate corridors, drawn softer.** More coverage at the cost of sometimes showing
a shape that is not the hike. Considered and declined at design time: this map's provenance ladder
exists so that what is drawn can be defended.

**Rejected — hand-drawing 184 routes**, as the Phase 4 spec already recorded. A later phase can
let the journal accept GPX for hikes actually walked, which fits the personal-journal framing far
better than borrowed geometry.

---

## Architecture

```
tools/geocode/extract-osm-features.sh   NOW ALSO keeps walkable ways + relations
  (WSL, osmium, hand-run)               emits work/named-features.geojsonl
        │                                     + work/walkable-ways.geojsonl
        │                                     + work/route-relations.json
        ▼
tools/routelines/  (Python, hand-run)   builds the walk graph, stitches both tiers
        │                               emits  data/route-lines.geojson   ← COMMITTED
        │                                      data/route-lines-report.md ← COMMITTED
        │                               reads  data/route-relations.json  ← COMMITTED, hand-confirmed
        ▼
app/scripts/transform.ts                merges hasLine + lineSource onto the route index
        ▼
app/src/lib/map/                        a GeoJSON source and two line layers
```

This is the shape `tools/geocode` established and 4e repeated: a hand-run tool with heavyweight
inputs, a committed artifact, and `transform.ts` merging it. Everything downstream of the commit
reads only committed data, so `npm test` and `npm run check` — which CI runs **before** the tiles
land — never touch an archive.

**No tile rebuild.** Route lines ship as a GeoJSON overlay, not as a tile layer, so this phase
needs no new release asset and does not touch `TILES_TAG`. The Phase 4 budget allowed 1–2 MB for
route lines; **at most** ~80 lines (13 relation candidates plus 67 stitch candidates, before
either gate) of a few hundred coordinates each is far under that, and the tool asserts the written
file's size so a regression is loud.

**Why osmium and not Overpass.** Overpass was the design-time probe — every number in this
document came from it — but the pipeline reads the cached PBF, because that is the source the
tiles and the geocoder already agree on. Two sources of OSM truth on different fetch dates is a
divergence bug waiting to happen. The extract script gains `r/type=route` and a second export;
the PBF it reads is already on disk in WSL.

**Why a new `tools/routelines/` rather than more of `tools/geocode/`.** Different deliverable,
different cadence, and the geocoder's job is a *point* per route. They share the extract script's
output, not their internals. Python for both, so the reader and the pytest setup are familiar.

---

## The relation tier

`data/route-relations.json` maps a route id to an OSM relation id, with the confirming note:

```json
{
  "table-mountain--front-face--platteklip-gorge-table-mountain-hiking-guide": {
    "relation": 2934380,
    "note": "Relation 'Platteklip Gorge' is the same ascent the guide describes."
  }
}
```

**Hand-written and committed**, the way `curated` positions are. The tool proposes candidates into
the report — every route title whose normalised form contains, or is contained by, a relation name
— and refuses to promote any of them on its own. A proposal in the report is a question; only the
JSON file is an answer.

**Relations are read as OSM JSON, not as exported geometry.** `osmium export` writes a relation as
a MultiLineString and drops both the member way ids and their roles on the way through — which
would cost the provenance every drawn line has to carry, and the role distinction below. The
relation file therefore carries ids and roles, and member geometry is joined back on by way id
from the walkable-ways export. (Found while writing the implementation plan, not while running it.)

Stitching a relation: take member ways in relation order, join on shared endpoints, and emit a
`LineString` where the members form one connected run, a `MultiLineString` where they do not.
**Members with `forward`/`backward` roles are alternatives or directional sections** — two of the
sampled relations use them — and are emitted as separate parts rather than concatenated into a
line that doubles back. A relation whose members do not join at all is reported and skipped, not
guessed at.

---

## The stitch tier

**The graph.** Every `highway=path|footway|track|steps` way in the region becomes an edge.
Connectivity is by endpoint coordinate equality: OSM ways genuinely share node coordinates, and
osmium's GeoJSON export emits the same rounded value for both sides of a shared node, so exact
string equality on the rounded pair is a sound join key.

**Measured at design time rather than assumed:** rounded to 7 decimal places, consecutive members
of *Platteklip Gorge* share an endpoint at 3 of 3 joins and *India Venster* at 4 of 4. The
assumption holds on real data from this region at the precision the export emits. This is the one
assumption in the tier
that could silently halve the graph, so it gets a direct test: a fixture of two ways meeting at a
node must produce one connected component, and the tool reports the component-count distribution
so a broken join shows up as thousands of singletons rather than as quietly missing routes.

**Named trails come from relations first.** A trail named *Contour Path* is the 27 ways its
relation lists, not the ways carrying that `name` tag — so the connectors are included and the
trail is continuous. Where no relation carries the name, the trail is the name-tagged ways, and
the report says which of the two it used.

**The walk**, per route with ≥2 mentioned paths:

1. Snap the anchor (`crawl`, `curated` or `osm-match` coordinates) to the nearest graph node
   within **250 m**. No snap → no line.
2. Shortest path from the anchor to the nearest node of the first named trail.
3. Traverse that trail's connected run to the endpoint nearest the next trail — this is what makes
   the line *follow* a trail rather than merely touch it.
4. Shortest path to the next trail; repeat in prose order.
5. Emit the concatenation.

**The gate.** A line ships only if every waypoint was reached, the anchor snapped, connector
segments total **≤ 20 %** of the line's length with no single connector over **500 m**, and the
total is under a 40 km sanity ceiling. Anything else is reported with its reason and drawn as
nothing. The connector cap is the load-bearing rule: a shortest path that has to run 3 km of
unrelated trail between two named paths is evidence the prose order was not a route order, and
that is exactly the case where a drawn line would be confidently wrong.

**Single-mention routes** (41 of them) get a line only when that one named trail is a single
connected run whose nearest point is within the snap radius — that is a trail identified and
located, with no ordering claim to get wrong.

### The `match.py` ambiguity rule, corrected here

Phase 4e recorded that `tools/geocode/kaap_geocode/match.py:63` treats two features sharing a name
inside the area bbox as an ambiguity. That is right for peaks — two summits called Klipspringer
are two places — and **wrong for ways**, where 27 segments called *Contour Path* are one trail cut
at every junction. 45 route titles are exactly an OSM path name and the geocoder returned 11
matches.

The fix belongs here because this phase builds the graph that makes it decidable: **for way
features, multiple hits are a match rather than an ambiguity when they form one connected run, or
are members of one relation** — matched at the run's midpoint. Count is not the test;
connectedness is. Ways that share a name and do not connect stay an ambiguity, because that is
what they are. Node features are untouched.

The expected effect is more `osm-match` positions and fewer `area-approx` ones — *Muizenberg
Buttress* sits hollow on a 5,543 m circle while an OSM way of that exact name exists. **The
geocode report is re-reviewed before those positions ship**; this is a rule change to a tier whose
whole value is that its claims were checked.

---

## Rendering

`data/route-lines.geojson` is fetched **once, lazily, on the first selection that has a line** —
one small static file rather than a per-route request, since the whole set is a few hundred
kilobytes. Until then the map behaves exactly as it does today.

Two layers, inserted above `paths` and below every label layer, so a line sits over the terrain
and under the names:

| layer | type | purpose |
|---|---|---|
| `route-line-casing` | line | background-coloured casing, lifting the line off the contours |
| `route-line` | line | the route itself |

The line is drawn in **the pin colours** — the same green-when-done, terracotta-when-not the pins
already use — because unlike 4e's mentions, this *is* the route, and colouring it as the pin says
so without a legend. Selection sets the layers' filter to the selected route id, the pattern
`MapView` already runs for pins and 4e ran for paths; the unselected state is a filter that
matches nothing.

**No minzoom floor from the tiles.** These lines come from a GeoJSON source, not the `trails`
tiles, so the z11 floor that leaves 4e's highlight invisible at the opening view does not apply
here. The line draws as soon as the route is selected, at any zoom. Selecting a route with a line
also frames it: the camera fits the line's bounds rather than flying to the pin.

`LocatorMap` gets the same source and layers, so the route page shows the shape beside the
description that describes it.

### What happens to the 4e highlight

`paths-referenced`, `paths-referenced-casing` and `paths-referenced-label` are **removed**. They
make a claim about extent that name-matching cannot support, and they are the reason the map is
currently hard to use.

**`paths-named` — the quiet label tier — stays.** It states a fact (this path is called *Nursery
Ravine*) rather than a claim about your hike, and it is ordinary topographic cartography.

**The `MentionedPaths` panel stays**, wording unchanged: *"Paths this description names."* It was
always the guaranteed, honest tier of the three, and with the highlight gone it carries that
information alone. Where a route has a line, the panel sits below the line's provenance note, and
the distinction the 4e spec insisted on becomes visible instead of merely stated: the line is the
route, the list is what the text refers to.

### Saying how a line is known

`ProvenanceNote` already tells a route page how its *position* is known; a line needs the same
sentence. Extended, not duplicated — one component owning the wording, so no two surfaces can
describe the same relationship differently:

- `osm-relation` — *"Drawn from the OpenStreetMap hiking route ‘Platteklip Gorge’."*
- `osm-stitch` — *"Stitched from 6 OpenStreetMap paths, following the order this description
  names them."*
- no line — no sentence. The absence of a line is not an error to explain on every page.

Both lines carry their OSM way ids in the GeoJSON properties, so any drawn claim can be re-checked
against OSM later. No new attribution obligation: `ATTRIBUTION_OSM` already ships.

---

## Testing

Split by what CI can see, as 4e was: unit tests must pass with no archive and no tiles present.

### pytest (`tools/routelines`)

The stitcher carries the weight, over small hand-built fixtures:

- two ways meeting at a shared node form one connected component — the join-key assumption, tested
  directly because breaking it fails silently
- a relation's members join in order into one `LineString`; members with `forward`/`backward` roles
  emit separate parts rather than a doubling-back line
- a relation whose members do not join is reported and skipped, not concatenated
- an ordered walk over A → B follows A to the endpoint nearest B, rather than clipping its corner
- a walk needing a 3 km connector is **rejected by the 20 % cap**, with the reason recorded
- an anchor 2 km from any path yields no line
- a single-mention route whose trail is one connected run yields a line; one whose trail is three
  disjoint runs does not

And for the corrected match rule:

- ways sharing a name that form one connected run are a **match**, at the run's midpoint
- ways sharing a name that do not connect remain an `AmbiguousMatch`
- two nodes sharing a name remain an `AmbiguousMatch` — the peak rule is untouched

### Vitest

- `transform.ts` merges `hasLine`/`lineSource` onto the index; a route with no line gets `false`
  and `null`, never absent
- an **anti-drift test**: every route id in `data/route-lines.geojson` exists in the route index,
  mirroring the check tying `region.ts` to `regions.json`
- `style.test.ts`: both layers exist, sit above `paths` and below the label layers and
  `region-mask`; every width's first stop is ≥ 0.8 px; the unselected filter matches nothing
- `style.test.ts`: the three `paths-referenced*` layers are **gone** — a removal is worth a test,
  because the next person to read the 4e spec will otherwise wonder whether it regressed
- `ProvenanceNote.test.ts`: each of the three line states renders its sentence, and the no-line
  state renders none

**Deliberately absent: any staleness check on `route-lines.geojson`** against the OSM extract. CI
has no PBF when unit tests run, so such a check could only take the degraded path and fail for
being right — the same reasoning `tools/geocode` and `tools/pathnames` both record. Comment it in
the file, or someone adds it later and CI goes red on a good build.

### Playwright

Anything about rendering. jsdom has no WebGL, and this project has twice shipped bugs that passed
every check except a browser.

- select a relation-tier route (*Platteklip Gorge*) → `queryRenderedFeatures` on `route-line`
  returns > 0 once the camera settles, and the camera has fitted the line's bounds
- deselect → zero rendered
- select a route with no line → zero rendered, the pin is still selected, and the panel shows no
  provenance sentence for a line
- the route page's `LocatorMap` renders the line for a route that has one

### A manual look, as a step rather than an assumption

Every accepted line, at the zoom it is read at. The report makes this cheap — it lists each line
with its length, its tier and its connector fraction — but **the report cannot see that a line
runs up the wrong ravine.** That judgement is the reason the tier gate is conservative, and it is
the one check no assertion in this design can make.

---

## Risks

- **The stitch tier may pass very few routes.** The 20 % connector cap is deliberately strict and
  67 candidates is the ceiling, not the yield. If the accepted count is small enough not to be
  worth the layer, the relation tier still stands alone — a dozen routes drawn correctly is a
  better map than 67 drawn hopefully. The report tells us which world we are in before any app
  code is written, and **the plan should order the work so that number arrives first.**
- **Prose order is not always walk order.** A description that mentions the descent before the
  ascent produces a line that doubles back. The connector cap catches the severe cases; the manual
  look catches the rest. A route rejected costs a pin; a route accepted wrongly costs trust, which
  is why the cap errs toward rejection.
- **The coordinate join key.** Covered by a direct test and by reporting the component-count
  distribution, because the failure mode is silence.
- **Relation quality varies.** These are volunteer-authored, and one may be a mapper's sketch. The
  hand-confirmation step is the defence, and every line records its relation id so a bad one can be
  traced.
- **Removing the 4e highlight is a visible subtraction.** For the 76 routes naming no path and the
  routes that fail the gate, the map goes quieter than it is today. That is the intended trade,
  and it is why the `MentionedPaths` panel and the quiet label tier both stay.

## Deliberately not attempted

- Hand-drawing routes, or accepting user GPX. The journal-GPX idea remains the better long-term
  answer and needs its own spec.
- Elevation profiles from the line. Contours are in the tiles, not in a queryable form, and this
  phase's job is extent.
- Direction of travel — arrows, start/end markers. We do not know which end the hike starts from
  unless the anchor says so, and the anchor is a trailhead only sometimes.
- Ranking mentions by role, still. It remains NLP over guide prose.

## Carry-overs recorded, not scoped

The OSM hiking-map guidance names three tags this map does not yet read: **`sac_scale`** (T1–T6
difficulty), **`trail_visibility`**, and **`osmc:symbol`** (waymarking). A path that is *"sometimes
difficult to follow"* should not render identically to a graded contour path, and this archive's
routes include plenty of both. That is **Phase 4b styling** work — it changes how every path is
drawn, not how a route's line is derived — and it needs the tile profile to carry the tags, so it
is a tiles change too. Recorded here because this phase's research surfaced it.
