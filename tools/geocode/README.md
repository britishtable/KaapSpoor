# tools/geocode — locating the routes the crawl missed

Gives every route a coordinate where one can honestly be found, and labels all of
them with where the coordinate came from. Output is committed; this is an
occasional data task, not part of the app build or CI.

## Tiers, highest precedence first

| Source | Meaning |
|---|---|
| `curated` | A human looked it up and cited a source (`data/geocode-overrides.json`). |
| `crawl` | The coordinate the Mountain Meanders page itself carried. |
| `osm-match` | The route's name matched a named OSM feature inside its own area. |
| `area-approx` | No feature match; the area's centroid, with an accuracy radius. |

Routes reaching the bottom without a position stay unlocated, and the app keeps
showing them as such.

Two limits keep the bottom tier honest. Below `MIN_ACCURACY_M` (2 km) the radius
is floored, so a lone sibling cannot masquerade as a surveyed dot; above
`MAX_ACCURACY_M` (25 km) `area_approx` refuses outright and the route stays
unlocated, because a centroid that vague no longer says where the hike is.

**The app does not render `area-approx` at all yet.** `app/scripts/transform.ts`
merges only `curated`, `crawl` and `osm-match` into the route index; nothing in
the app reads `coordsAccuracyM`, so an area centroid would draw as a pin
indistinguishable from a surveyed one. The entries stay in
`data/route-locations.json` for the plan that teaches the map to draw
uncertainty. Do not lift that gate before then.

## Prerequisites

- Python 3.11+ and `pip install -r requirements.txt` (pytest only; the tool
  itself is stdlib).
- For the `osm-match` tier: **WSL Ubuntu** with `sudo apt install osmium-tool`,
  same environment as `tools/tiles/*.sh`.

## Running it

```bash
# 1. Extract named OSM features (WSL). Reuses the OSM extract that
#    tools/tiles/build-trails.sh already downloaded, and writes to the
#    gitignored work/ directory.
cd tools/geocode
./extract-osm-features.sh

# 2. Apply the ladder and write the artifacts.
python -m kaap_geocode.cli

# 3. Read the report, then curate.
#    data/geocode-report.md lists three queues: features that were ambiguous,
#    overrides whose routeId matches nothing in the crawl, and routes still
#    unlocated. Add or fix entries in data/geocode-overrides.json — every
#    entry needs a `source`, or the loader rejects the file.
#    Re-run step 2 after editing.
```

Step 1 is skippable: without the features file the tool warns and runs the other
three tiers, which is useful for iterating on overrides.

## Outputs (all committed)

- `data/route-locations.json` — one entry per located route, with `source` and,
  for `area-approx`, `accuracyM`. The app's `app/scripts/transform.ts` merges it.
- `data/geocode-report.md` — tier mix, the OSM matches with the candidate that
  matched each one, and the three curation queues (ambiguous, orphaned
  overrides, still unlocated).

## Why it does not write routes.json

`data/routes.json` and `data/coverage-report.md` belong to the crawler
(`tools/scraper`), which rewrites them wholesale. Anything this tool put there
would vanish on the next crawl, so it keeps its own artifacts instead.

## Tests

```bash
cd tools/geocode && python -m pytest -v
```

Every unit is pure and runs against `tests/fixtures/named-features.geojsonl` —
no OSM data, no network.
