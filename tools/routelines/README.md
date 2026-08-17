# tools/routelines

Derives each route's own line — the shape the hike actually walks — and writes:

- `data/route-lines.geojson` — the deliverable, committed
- `data/route-lines-report.md` — every line it drew and every one it declined, committed

Both are read by `app/scripts/transform.ts`; nothing in the app build runs this tool.

## Running it

The OSM extract comes first, and it is the only step that needs WSL:

    # in WSL Ubuntu, from the repo root
    tools/geocode/extract-osm-features.sh

That writes `tools/geocode/work/walkable-ways.geojsonl` and
`tools/geocode/work/route-relations.json`. Then, on Windows or WSL:

    cd tools/routelines
    python -m kaap_routelines.cli

Both work files are git-ignored. A clone that has never run the extract still
works: the tool warns, writes an empty `FeatureCollection`, and the app draws no
lines — the pre-4d behaviour.

Tests need neither the extract nor the tiles:

    cd tools/routelines && python -m pytest

## The two tiers

**`osm-relation`** — the route's line *is* an OSM `type=route` hiking relation,
stitched from its member ways in the mapper's order. This is the highest
confidence available anywhere in the pipeline: the extent was decided by a
person who walked it, not inferred by us. Member way ids and roles are kept so
any drawn claim can be re-checked against OSM, which is why the extract reads
OSM JSON rather than `osmium export` — the GeoJSON export drops both.

**`osm-stitch`** — an ordered corridor walk. The paths a description names, *in
the order the prose introduces them*, are treated as a waypoint sequence, and
the line is the walk from the route's anchor through those trails in that
order. The ordering is what supplies extent; without it a name covers the whole
peninsula, which is the limit Phase 4e ran into.

**Neither** — a pin, and nothing drawn. Silence is the design, not a gap in it.

## `data/route-relations.json` is written by hand

The tool **proposes** relation candidates in the report and promotes none of
them. A route title overlapping a relation name is a question: *"Platteklip
Gorge - Table Mountain Hiking Guide" → Platteklip Gorge* is right, while
*"Devil's Peak contour paths" → Contour Path* is not — that route merely walks
along a trail the relation describes end to end. Confirm the true ones by hand
in `data/route-relations.json` and rerun; that file is the only answer the tool
accepts.

## The gates, and why each number

Every threshold errs toward rejection. A route rejected costs a pin; a route
accepted wrongly costs trust in every other line on the map.

| gate | value | why |
|---|---|---|
| snap radius | 250 m | How far a route's recorded position may sit from the path network before we admit we do not know where it starts. |
| single connector | 500 m | One unnamed way longer than this between two named paths is not a connector, it is a different walk. |
| connector share | 20 % | A line mostly made of paths the description never named is evidence the prose order was not a route order. |
| total length | 40 km | Nothing in this archive is a 40 km day walk on one line. |

A relation is also refused outright if any member way is missing from the
extract, or if its plain members do not join at all: a line with a hole in it is
not the route.
