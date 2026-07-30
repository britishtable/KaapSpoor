# Phase 3 · Plan 1 — Geocoding with Provenance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the 59 routes without coordinates a location where one can honestly be found, and attach a provenance field to every coordinate in the dataset so the app can later show how well each position is known.

**Architecture:** A new Python tool under `tools/geocode/` (mirroring `tools/scraper`) applies a four-tier ladder — `curated` → `crawl` → `osm-match` → `area-approx` — and writes one committed artifact, `data/route-locations.json`. OSM candidate features are extracted once by a WSL shell script into a gitignored work directory, so every Python unit is pure and testable against small fixtures with no OSM dependency. The app's existing `app/scripts/transform.ts` merges that artifact into `routes-index.json`.

**Tech Stack:** Python 3.11+ · pytest · `osmium-tool` (WSL) for OSM extraction · TypeScript/Vitest for the app-side merge.

## Global Constraints

- **Honesty about location is a design principle.** A coordinate never exists without a `coords_source`. `area-approx` positions must carry an accuracy radius and must never be presented as precise.
- **`data/routes.json` is the crawler's output and must not be written by this tool.** `tools/scraper/mm_scraper/cli.py:62` writes it; anything this tool put there would be destroyed by the next crawl. Same reasoning applies to `data/coverage-report.md`.
- **Route ids come from one place:** `app/src/lib/data/ids.ts` — `routeId(area, slug) = [...area, slug].map(slugify).join('--')`. The Python side must reproduce this exactly; it is the journal's persistence key.
- **Grades stay raw.** This tool touches coordinates only.
- **TypeScript strict; no `any`** in the app-side changes.
- **Python style follows `tools/scraper`:** `from __future__ import annotations`, modern type hints, module docstrings, pytest with `testpaths = tests`.
- **Large intermediates are gitignored.** Only `data/route-locations.json`, `data/geocode-overrides.json` and `data/geocode-report.md` are committed.

## Deviations from the spec (deliberate, flagged)

The spec at `docs/superpowers/specs/2026-07-30-phase3-map-made-good-design.md` says coordinates "merge back into `routes.json`" and that `coverage-report.md` regenerates with the tier mix. Both are wrong for the same reason: **the crawler owns both files and would clobber them.** This plan therefore writes a separate `data/route-locations.json` plus its own `data/geocode-report.md`, and the app's transform does the merge. Everything else follows the spec as written.

## File structure

```
tools/geocode/                        # NEW — Python, mirrors tools/scraper
  README.md                           # prerequisites + exact commands (Task 8)
  requirements.txt                    # pytest only; stdlib otherwise
  pytest.ini
  extract-osm-features.sh             # WSL: osmium -> gitignored geojsonseq
  kaap_geocode/
    __init__.py
    ids.py                            # slugify/route_id, mirroring ids.ts
    normalise.py                      # title -> ordered candidate names + comparison key
    areas.py                          # per-area scope walk and bbox
    features.py                       # read geojsonseq -> named point features
    match.py                          # candidates x features x bbox -> match | None
    overrides.py                      # curated tier, source citation required
    approx.py                         # area centroid + accuracy radius
    pipeline.py                       # the tier ladder
    report.py                         # geocode-report.md
    cli.py                            # entry point
  tests/
    conftest.py
    fixtures/named-features.geojsonl
    test_ids.py  test_normalise.py  test_areas.py  test_features.py
    test_match.py  test_overrides.py  test_approx.py  test_pipeline.py
  work/                               # gitignored: clipped/filtered pbf + geojsonseq

data/
  geocode-overrides.json              # NEW, committed — curated tier
  route-locations.json                # NEW, committed — this tool's output
  geocode-report.md                   # NEW, committed — tier mix + review queue

app/
  src/lib/data/types.ts               # + CoordsSource and provenance fields
  scripts/transform.ts                # merge route-locations.json
  scripts/transform.test.ts           # merge tests (runs in CI)
```

---

### Task 1: Scaffold the tool and reproduce route ids in Python

**Files:**
- Create: `tools/geocode/requirements.txt`, `tools/geocode/pytest.ini`, `tools/geocode/kaap_geocode/__init__.py`, `tools/geocode/kaap_geocode/ids.py`
- Test: `tools/geocode/tests/test_ids.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `slugify(s: str) -> str` and `route_id(area: list[str], slug: str) -> str`, used by every later task to key routes.

- [ ] **Step 1: Create the package scaffolding**

`tools/geocode/requirements.txt`:

```
pytest>=8.0
```

`tools/geocode/pytest.ini`:

```ini
[pytest]
testpaths = tests
pythonpath = . tests
```

`tools/geocode/kaap_geocode/__init__.py`:

```python
"""Locate KaapSpoor routes that the crawl left without coordinates."""
```

- [ ] **Step 2: Write the failing test**

`tools/geocode/tests/test_ids.py`:

```python
from __future__ import annotations

from kaap_geocode.ids import route_id, slugify


def test_slugify_lowercases_and_collapses_non_alphanumerics():
    assert slugify("Lion's Head B (Twirly-Whirly route)") == "lion-s-head-b-twirly-whirly-route"


def test_slugify_strips_leading_and_trailing_separators():
    assert slugify("--Devils Peak--") == "devils-peak"


def test_route_id_joins_area_and_slug_with_double_hyphen():
    assert (
        route_id(["Table-Mountain", "atlantic-west"], "kasteelspoort")
        == "table-mountain--atlantic-west--kasteelspoort"
    )


def test_route_id_disambiguates_the_duplicate_klipspringer_slugs():
    # 'slug' is not unique in the source data; the area path is what separates them.
    a = route_id(["cape-country", "overberg"], "klipspringer")
    b = route_id(["peninsula", "silvermine"], "klipspringer")
    assert a != b
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd tools/geocode && python -m pytest tests/test_ids.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'kaap_geocode.ids'`

- [ ] **Step 4: Write the implementation**

`tools/geocode/kaap_geocode/ids.py`:

```python
"""Route ids, mirroring app/src/lib/data/ids.ts exactly.

This must stay byte-identical in behaviour to the TypeScript version: the id is
the journal's IndexedDB key, so a divergence here would silently orphan a user's
recorded hikes.
"""

from __future__ import annotations

import re

_NON_ALNUM = re.compile(r"[^a-z0-9]+")
_EDGE_HYPHENS = re.compile(r"^-+|-+$")


def slugify(s: str) -> str:
    return _EDGE_HYPHENS.sub("", _NON_ALNUM.sub("-", s.lower()))


def route_id(area: list[str], slug: str) -> str:
    return "--".join(slugify(part) for part in [*area, slug])
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd tools/geocode && python -m pytest tests/test_ids.py -v`
Expected: PASS, 4 tests

- [ ] **Step 6: Commit**

```bash
git add tools/geocode/
git commit -m "feat(geocode): scaffold the tool and mirror route id derivation in Python"
```

---

### Task 2: Name normalisation — titles to candidate feature names

**Files:**
- Create: `tools/geocode/kaap_geocode/normalise.py`
- Test: `tools/geocode/tests/test_normalise.py`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `comparison_key(name: str) -> str` — the string used for equality between a route candidate and an OSM feature name.
  - `candidates(title: str) -> list[str]` — candidate feature names, **most specific first**. Task 4 tries them in order and records which one matched.

This is the substance of the `osm-match` tier. The 59 unlocated titles are named topographic features wrapped in route vocabulary, so the job is to peel the vocabulary off in stages rather than in one shot — and to keep the order, because a match on the full title is worth more than a match on a two-word remnant.

- [ ] **Step 1: Write the failing test**

`tools/geocode/tests/test_normalise.py`:

```python
from __future__ import annotations

from kaap_geocode.normalise import candidates, comparison_key


def test_comparison_key_lowercases_and_drops_punctuation():
    assert comparison_key("Lion's Head") == "lions head"
    assert comparison_key("Carrel's  Ledge") == "carrels ledge"


def test_comparison_key_expands_abbreviations():
    assert comparison_key("Elsies Pk") == "elsies peak"
    assert comparison_key("Mt Zebra Park") == "mount zebra park"


def test_comparison_key_normalises_afrikaans_english_variants():
    # The wiki says "Long Kloof"; OSM says "Lang Kloof".
    assert comparison_key("Long Kloof") == comparison_key("Lang Kloof")


def test_candidates_start_with_the_cleaned_full_title():
    assert candidates("Newlands Ravine")[0] == "Newlands Ravine"


def test_candidates_strip_parentheticals_and_quoted_nicknames():
    got = candidates("Lion's Head B (Twirly-Whirly route)")
    assert "Lion's Head B" in got
    assert "Lion's Head" in got
    # Most specific first: the parenthetical-stripped form precedes the
    # letter-variant-stripped one.
    assert got.index("Lion's Head B") < got.index("Lion's Head")


def test_candidates_strip_a_leading_quoted_nickname():
    got = candidates("'Skywalk' - Right Face to Platteklip")
    assert "Right Face to Platteklip" in got


def test_candidates_strip_trailing_route_vocabulary():
    assert "Elsies Pk" in candidates("Elsies Pk Circular Rte")
    assert "Constantiaberg" in candidates("Constantiaberg North West route")


def test_candidates_keep_feature_type_words():
    # "Buttress", "Ravine", "Kloof", "Gully" are part of the OSM name, not route
    # vocabulary, so they must survive.
    got = candidates("Nursery Buttress")
    assert got[0] == "Nursery Buttress"
    assert "Nursery" not in got


def test_candidates_are_unique_and_non_empty():
    got = candidates("Otter Trail")
    assert got == list(dict.fromkeys(got))
    assert all(c.strip() for c in got)
    # "Otter Trail" is itself the OSM name, so the full title must be tried first.
    assert got[0] == "Otter Trail"
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd tools/geocode && python -m pytest tests/test_normalise.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'kaap_geocode.normalise'`

- [ ] **Step 3: Write the implementation**

`tools/geocode/kaap_geocode/normalise.py`:

```python
"""Turn a route title into candidate OSM feature names.

Two separate jobs, deliberately not conflated:

* `comparison_key` is how two names are judged equal. It is lossy on purpose
  (case, punctuation, abbreviations, a small Afrikaans/English variant table).
* `candidates` peels route vocabulary off a title in stages, most specific
  first, because a match on the whole title is far stronger evidence than a
  match on what is left after stripping words away. Task 4 records which
  candidate matched so a human can audit the weaker ones.

Feature-type words (Buttress, Ravine, Kloof, Gully, Gorge, Ledge, Arete) are
NOT stripped: they are part of the OSM name. Only route vocabulary is.
"""

from __future__ import annotations

import re

# Expanded inside comparison_key, so both sides of a comparison get the same
# treatment. Keys are whole lowercase tokens.
ABBREVIATIONS = {
    "pk": "peak",
    "pks": "peaks",
    "rte": "route",
    "mt": "mount",
    "mtn": "mountain",
    "st": "saint",
    "ne": "north east",
    "nw": "north west",
    "se": "south east",
    "sw": "south west",
}

# Whole-string equivalences for names the wiki and OSM spell differently.
# Applied after tokenisation, so the left side is already a comparison key.
# Possessive apostrophes need no entry here — they are deleted, not split, so
# "Devil's Peak" and "Devils Peak" already collapse to the same key.
VARIANTS = {
    "long kloof": "lang kloof",
}

# Route vocabulary stripped from the *end* of a title, one layer at a time.
# "Trail" is deliberately absent: "Otter Trail" and "Robberg Trail" are the OSM
# names, so stripping it would destroy the match rather than enable it.
TRAILING_ROUTE_WORDS = {
    "route",
    "routes",
    "rte",
    "traverse",
    "hike",
    "hikes",
    "walk",
    "circular",
    "circumnavigation",
    "circuit",
}

# Also peeled from the end, because a route is often a named feature approached
# from a particular side: "Constantiaberg North West route" is Constantiaberg.
# Feature-type words (Buttress, Ridge, Arete, Face) stay — they are part of the
# name, so peeling them would over-generalise.
TRAILING_DIRECTION_WORDS = {
    "north",
    "south",
    "east",
    "west",
    "northern",
    "southern",
    "eastern",
    "western",
    "upper",
    "lower",
    "ne",
    "nw",
    "se",
    "sw",
}

PEELABLE = TRAILING_ROUTE_WORDS | TRAILING_DIRECTION_WORDS

_PARENTHETICAL = re.compile(r"\s*\([^)]*\)")
_QUOTED_PREFIX = re.compile(r"^\s*['\"][^'\"]+['\"]\s*[-–]\s*")
# Apostrophes are deleted before punctuation becomes whitespace, so "Lion's"
# collapses to "lions" rather than splitting into "lion s".
_APOSTROPHE = re.compile(r"['’`]")
_PUNCTUATION = re.compile(r"[^a-z0-9]+")
_SINGLE_LETTER_SUFFIX = re.compile(r"\s+['\"]?[A-Z]['\"]?$")


def comparison_key(name: str) -> str:
    """The string used to decide whether two names are the same place."""
    cleaned = _PUNCTUATION.sub(" ", _APOSTROPHE.sub("", name.lower()))
    tokens = [t for t in cleaned.split() if t]
    expanded: list[str] = []
    for token in tokens:
        expanded.extend(ABBREVIATIONS.get(token, token).split())
    key = " ".join(expanded)
    return VARIANTS.get(key, key)


def candidates(title: str) -> list[str]:
    """Candidate feature names for a route title, most specific first."""
    out: list[str] = []

    def add(value: str) -> None:
        value = value.strip().strip("-–").strip()
        if value and value not in out:
            out.append(value)

    add(title)

    # A leading quoted nickname ("'Skywalk' - Right Face...") is a route name,
    # never a place name; what follows it may be a place.
    without_nickname = _QUOTED_PREFIX.sub("", title)
    add(without_nickname)

    # Parentheticals are annotations, not part of any OSM name.
    base = _PARENTHETICAL.sub("", without_nickname)
    add(base)

    # Peel trailing route vocabulary and direction words one at a time, adding
    # each layer, so the caller can try the most specific form first.
    words = base.split()
    while len(words) > 1 and words[-1].lower().strip("'\".,") in PEELABLE:
        words = words[:-1]
        add(" ".join(words))

    # "Steenberg 'B'", "Lion's Head B" — a single-letter variant marker.
    stripped_letter = _SINGLE_LETTER_SUFFIX.sub("", " ".join(words))
    add(stripped_letter)

    return out
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd tools/geocode && python -m pytest tests/test_normalise.py -v`
Expected: PASS, 9 tests

- [ ] **Step 5: Commit**

```bash
git add tools/geocode/kaap_geocode/normalise.py tools/geocode/tests/test_normalise.py
git commit -m "feat(geocode): peel route vocabulary off titles to get candidate feature names"
```

---

### Task 3: Area scope and bounding box from located siblings

**Files:**
- Create: `tools/geocode/kaap_geocode/areas.py`
- Test: `tools/geocode/tests/test_areas.py`

**Interfaces:**
- Consumes: `route_id` from Task 1.
- Produces:
  - `BBox` — a `NamedTuple(west, south, east, north)`.
  - `located_scope(routes, area) -> tuple[list[str], list[dict]]` — the narrowest area path (walking up from `area`) that has at least one located route, and those routes. `([], [])` if none.
  - `bbox_of(routes, margin_deg=0.05) -> BBox | None`.

This is the defence against `osm-match` false positives: a name match only counts if it falls inside the route's own area, and "its own area" is defined by where its already-located siblings actually are.

- [ ] **Step 1: Write the failing test**

`tools/geocode/tests/test_areas.py`:

```python
from __future__ import annotations

from kaap_geocode.areas import bbox_of, located_scope


def route(area, slug, lat=None, lon=None):
    coords = None if lat is None else {"lat": lat, "lon": lon, "zoom": 17}
    return {"area": area, "slug": slug, "coords": coords}


ROUTES = [
    route(["Table-Mountain", "atlantic-west"], "kasteelspoort", -33.97, 18.39),
    route(["Table-Mountain", "atlantic-west"], "woody-ravine", -33.98, 18.38),
    route(["Table-Mountain", "atlantic-west"], "corridor-rib"),          # unlocated
    route(["Table-Mountain", "newlands-east"], "newlands-ravine"),       # unlocated
    route(["Table-Mountain", "devils-peak"], "saddle-ravine"),           # unlocated
    route(["Table-Mountain"], "back-table", -33.99, 18.41),
]


def test_located_scope_prefers_the_exact_area():
    path, siblings = located_scope(ROUTES, ["Table-Mountain", "atlantic-west"])
    assert path == ["Table-Mountain", "atlantic-west"]
    assert len(siblings) == 2


def test_located_scope_walks_up_when_the_exact_area_has_no_located_routes():
    # newlands-east has no located routes at all, so the scope widens to the parent.
    path, siblings = located_scope(ROUTES, ["Table-Mountain", "newlands-east"])
    assert path == ["Table-Mountain"]
    assert len(siblings) == 3  # the parent's own located route plus both children's


def test_located_scope_returns_empty_when_nothing_is_located_anywhere_above():
    path, siblings = located_scope([route(["other-areas"], "mt-zebra")], ["other-areas"])
    assert path == []
    assert siblings == []


def test_bbox_of_covers_all_points_with_a_margin():
    box = bbox_of(
        [
            route(["a"], "x", -33.97, 18.39),
            route(["a"], "y", -33.99, 18.41),
        ],
        margin_deg=0.05,
    )
    assert box is not None
    assert box.west == 18.39 - 0.05
    assert box.east == 18.41 + 0.05
    assert box.south == -33.99 - 0.05
    assert box.north == -33.97 + 0.05


def test_bbox_of_returns_none_for_no_located_routes():
    assert bbox_of([route(["a"], "x")]) is None


def test_bbox_contains():
    box = bbox_of([route(["a"], "x", -33.97, 18.39)], margin_deg=0.05)
    assert box.contains(-33.97, 18.39)
    assert box.contains(-33.95, 18.42)
    assert not box.contains(-33.50, 18.39)
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd tools/geocode && python -m pytest tests/test_areas.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'kaap_geocode.areas'`

- [ ] **Step 3: Write the implementation**

`tools/geocode/kaap_geocode/areas.py`:

```python
"""Where an area is, according to the routes already located inside it.

A name match is only believable if it lands in the right part of the world. The
route's own area supplies that constraint, and the area's extent is not
hard-coded anywhere — it is derived from the coordinates the crawl already has.
Areas with no located routes of their own widen to their parent rather than
being given up on.
"""

from __future__ import annotations

from typing import Any, NamedTuple


class BBox(NamedTuple):
    west: float
    south: float
    east: float
    north: float

    def contains(self, lat: float, lon: float) -> bool:
        return self.west <= lon <= self.east and self.south <= lat <= self.north


def _is_located(route: dict[str, Any]) -> bool:
    coords = route.get("coords")
    return bool(coords) and coords.get("lat") is not None and coords.get("lon") is not None


def _under(route: dict[str, Any], path: list[str]) -> bool:
    area = route.get("area") or []
    return area[: len(path)] == path


def located_scope(
    routes: list[dict[str, Any]], area: list[str]
) -> tuple[list[str], list[dict[str, Any]]]:
    """Narrowest prefix of `area` containing located routes, and those routes."""
    for depth in range(len(area), 0, -1):
        path = area[:depth]
        siblings = [r for r in routes if _is_located(r) and _under(r, path)]
        if siblings:
            return path, siblings
    return [], []


def bbox_of(routes: list[dict[str, Any]], margin_deg: float = 0.05) -> BBox | None:
    located = [r for r in routes if _is_located(r)]
    if not located:
        return None
    lats = [r["coords"]["lat"] for r in located]
    lons = [r["coords"]["lon"] for r in located]
    return BBox(
        west=min(lons) - margin_deg,
        south=min(lats) - margin_deg,
        east=max(lons) + margin_deg,
        north=max(lats) + margin_deg,
    )
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd tools/geocode && python -m pytest tests/test_areas.py -v`
Expected: PASS, 6 tests

- [ ] **Step 5: Commit**

```bash
git add tools/geocode/kaap_geocode/areas.py tools/geocode/tests/test_areas.py
git commit -m "feat(geocode): derive area extents from already-located sibling routes"
```

---

### Task 4: Extract named OSM features (WSL) and read them

**Files:**
- Create: `tools/geocode/extract-osm-features.sh`, `tools/geocode/kaap_geocode/features.py`, `tools/geocode/tests/fixtures/named-features.geojsonl`
- Modify: `.gitignore`
- Test: `tools/geocode/tests/test_features.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `Feature` dataclass (`name: str`, `lat: float`, `lon: float`, `osm_type: str`, `osm_id: int`, `kind: str`) and `read_features(path) -> list[Feature]`.

The shell script stays deliberately dumb — clip, filter, export — so all the logic that needs testing lives in Python and runs against a checked-in fixture with no OSM data present.

- [ ] **Step 1: Write the extraction script**

`tools/geocode/extract-osm-features.sh`:

```bash
#!/usr/bin/env bash
# Extract named OSM features that a route title could plausibly name.
#
# Must run inside WSL Ubuntu, same as tools/tiles/*.sh: osmium-tool is a Linux
# package and the cached OSM extract already lives on WSL's own filesystem.
#   sudo apt install osmium-tool
#
# Reuses the extract tools/tiles/build-trails.sh already downloaded
# ($HOME/kaapspoor-tiles/downloads/region.osm.pbf) — no second 400 MB download.
#
# Output is a GeoJSON-seq file (one Feature per line) under work/, which is
# gitignored: it is an intermediate, not a deliverable. The committed artifact
# of this phase is data/route-locations.json.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK="${WORK:-$HOME/kaapspoor-tiles}"
PBF="$WORK/downloads/region.osm.pbf"
OUT_DIR="$HERE/work"
OUT="$OUT_DIR/named-features.geojsonl"

if [ ! -f "$PBF" ]; then
  echo "error: $PBF not found. Run tools/tiles/build-trails.sh first — it downloads it." >&2
  exit 1
fi

command -v osmium >/dev/null || { echo "error: osmium not found (sudo apt install osmium-tool)" >&2; exit 1; }

mkdir -p "$OUT_DIR"

# Clip generously: wide enough for every route including Mt Zebra Park (~25.5E),
# which sits outside the tile bbox but still needs a coordinate.
echo "==> clipping to the routes' region"
osmium extract --overwrite --bbox 17.5,-35.0,26.0,-31.5 "$PBF" -o "$OUT_DIR/clipped.osm.pbf"

# Only tags a route title could name. Peaks and saddles come from the same
# tags the tile profile already uses; the rest are the landform and reserve
# tags that ravines, buttresses, gorges and nature reserves carry.
echo "==> filtering to nameable features"
osmium tags-filter --overwrite "$OUT_DIR/clipped.osm.pbf" \
  n/natural=peak,saddle \
  nw/natural=ridge,arete,cliff,valley,gorge,water,bay,beach,cape \
  w/waterway=stream,river \
  w/highway=path \
  nwr/leisure=nature_reserve \
  nwr/boundary=protected_area \
  nwr/protect_class \
  -o "$OUT_DIR/filtered.osm.pbf"

# --add-unique-id=type_id puts "n123"/"w456" in each feature's "@id", which is
# what provenance records so an osm-match claim can be re-checked later.
echo "==> exporting to GeoJSON-seq"
osmium export --overwrite "$OUT_DIR/filtered.osm.pbf" \
  -f geojsonseq \
  --add-unique-id=type_id \
  -o "$OUT"

echo "==> wrote $OUT ($(wc -l < "$OUT") features before the name filter)"
```

- [ ] **Step 2: Make it executable and gitignore the work directory**

```bash
chmod +x tools/geocode/extract-osm-features.sh
```

Add to `.gitignore`, after the existing `tools/tiles/work/` line:

```
tools/geocode/work/
```

- [ ] **Step 3: Write the fixture**

`tools/geocode/tests/fixtures/named-features.geojsonl` — six lines, covering a point, a way with a linestring, a polygon, an unnamed feature and a feature far outside the Cape:

```
{"type":"Feature","id":"n1","properties":{"@id":"n1","name":"Devil's Peak","natural":"peak","ele":"1000"},"geometry":{"type":"Point","coordinates":[18.4575,-33.9525]}}
{"type":"Feature","id":"w2","properties":{"@id":"w2","name":"Newlands Ravine","natural":"valley"},"geometry":{"type":"LineString","coordinates":[[18.4300,-33.9700],[18.4400,-33.9600]]}}
{"type":"Feature","id":"w3","properties":{"@id":"w3","name":"Robberg Nature Reserve","leisure":"nature_reserve"},"geometry":{"type":"Polygon","coordinates":[[[23.3700,-34.1100],[23.4100,-34.1100],[23.4100,-34.0900],[23.3700,-34.0900],[23.3700,-34.1100]]]}}
{"type":"Feature","id":"n4","properties":{"@id":"n4","natural":"peak"},"geometry":{"type":"Point","coordinates":[18.5000,-33.9000]}}
{"type":"Feature","id":"n5","properties":{"@id":"n5","name":"Elsies Peak","natural":"peak"},"geometry":{"type":"Point","coordinates":[18.4380,-34.1300]}}
{"type":"Feature","id":"n6","properties":{"@id":"n6","name":"Newlands Ravine","natural":"valley"},"geometry":{"type":"Point","coordinates":[25.0000,-32.0000]}}
```

- [ ] **Step 4: Write the failing test**

`tools/geocode/tests/test_features.py`:

```python
from __future__ import annotations

from pathlib import Path

from kaap_geocode.features import read_features

FIXTURE = Path(__file__).parent / "fixtures" / "named-features.geojsonl"


def test_reads_named_features_and_drops_unnamed_ones():
    features = read_features(FIXTURE)
    names = sorted(f.name for f in features)
    # n4 has no name and must be dropped: an unnamed feature can never match.
    assert names == [
        "Devil's Peak",
        "Elsies Peak",
        "Newlands Ravine",
        "Newlands Ravine",
        "Robberg Nature Reserve",
    ]


def test_parses_osm_type_and_id_from_the_unique_id():
    devils = next(f for f in read_features(FIXTURE) if f.name == "Devil's Peak")
    assert devils.osm_type == "node"
    assert devils.osm_id == 1
    assert devils.kind == "natural=peak"


def test_point_geometry_keeps_its_own_coordinates():
    devils = next(f for f in read_features(FIXTURE) if f.name == "Devil's Peak")
    assert (round(devils.lat, 4), round(devils.lon, 4)) == (-33.9525, 18.4575)


def test_linestring_collapses_to_the_midpoint_of_its_bounding_box():
    ravine = next(
        f for f in read_features(FIXTURE) if f.name == "Newlands Ravine" and f.osm_type == "way"
    )
    assert (round(ravine.lat, 4), round(ravine.lon, 4)) == (-33.965, 18.435)


def test_polygon_collapses_to_the_midpoint_of_its_bounding_box():
    robberg = next(f for f in read_features(FIXTURE) if f.name == "Robberg Nature Reserve")
    assert (round(robberg.lat, 4), round(robberg.lon, 4)) == (-34.1, 23.39)
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `cd tools/geocode && python -m pytest tests/test_features.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'kaap_geocode.features'`

- [ ] **Step 6: Write the implementation**

`tools/geocode/kaap_geocode/features.py`:

```python
"""Read osmium's GeoJSON-seq export into flat, named point features.

Routes are single points (the source has no tracks), so a ravine's linestring
or a reserve's polygon collapses to the midpoint of its bounding box. That is
imprecise by construction, which is exactly why the match it produces is
recorded as `osm-match` with the feature named rather than presented as a
surveyed position.

Unnamed features are dropped: matching is by name, so they can never match, and
carrying them would multiply the search space for nothing.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterator

# Tags that make a feature nameable by a route title, in the order they are
# reported as `kind`. Purely descriptive — it appears in the review report so a
# human can see what a route was matched to.
KIND_TAGS = ("natural", "waterway", "leisure", "boundary", "highway")

_OSM_TYPES = {"n": "node", "w": "way", "r": "relation"}


@dataclass(frozen=True)
class Feature:
    name: str
    lat: float
    lon: float
    osm_type: str
    osm_id: int
    kind: str


def _coordinates(geometry: dict[str, Any]) -> Iterator[tuple[float, float]]:
    """Yield (lon, lat) pairs from any GeoJSON geometry, at any nesting depth."""

    def walk(node: Any) -> Iterator[tuple[float, float]]:
        if (
            isinstance(node, list)
            and len(node) == 2
            and all(isinstance(v, (int, float)) for v in node)
        ):
            yield float(node[0]), float(node[1])
        elif isinstance(node, list):
            for child in node:
                yield from walk(child)

    yield from walk(geometry.get("coordinates"))


def _kind(properties: dict[str, Any]) -> str:
    for tag in KIND_TAGS:
        if properties.get(tag):
            return f"{tag}={properties[tag]}"
    return "unknown"


def read_features(path: Path) -> list[Feature]:
    features: list[Feature] = []
    with open(path, encoding="utf-8") as handle:
        for line in handle:
            line = line.strip().lstrip("\x1e")  # geojsonseq may use RS separators
            if not line:
                continue
            raw = json.loads(line)
            properties = raw.get("properties") or {}
            name = (properties.get("name") or "").strip()
            if not name:
                continue

            points = list(_coordinates(raw.get("geometry") or {}))
            if not points:
                continue
            lons = [p[0] for p in points]
            lats = [p[1] for p in points]

            unique_id = str(properties.get("@id") or raw.get("id") or "")
            osm_type = _OSM_TYPES.get(unique_id[:1], "unknown")
            digits = unique_id[1:]
            osm_id = int(digits) if digits.isdigit() else 0

            features.append(
                Feature(
                    name=name,
                    lat=(min(lats) + max(lats)) / 2,
                    lon=(min(lons) + max(lons)) / 2,
                    osm_type=osm_type,
                    osm_id=osm_id,
                    kind=_kind(properties),
                )
            )
    return features
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `cd tools/geocode && python -m pytest tests/test_features.py -v`
Expected: PASS, 5 tests

- [ ] **Step 8: Commit**

```bash
git add tools/geocode/extract-osm-features.sh tools/geocode/kaap_geocode/features.py tools/geocode/tests/test_features.py tools/geocode/tests/fixtures/named-features.geojsonl .gitignore
git commit -m "feat(geocode): extract named OSM features in WSL and read them as points"
```

---

### Task 5: The matcher

**Files:**
- Create: `tools/geocode/kaap_geocode/match.py`
- Test: `tools/geocode/tests/test_match.py`

**Interfaces:**
- Consumes: `comparison_key` (Task 2), `BBox` (Task 3), `Feature` (Task 4).
- Produces:
  - `Match` dataclass (`feature: Feature`, `candidate: str`).
  - `find_match(candidate_names: list[str], features: list[Feature], bbox: BBox) -> Match | None`
  - `AmbiguousMatch` exception carrying `candidate` and `count`, raised when a candidate matches more than one feature inside the bbox.

Ambiguity is raised rather than resolved. Picking the nearest of several same-named features would be a guess wearing the clothes of a match; the curated overrides file is the documented escape hatch, and Task 8's report lists every ambiguity so it can be worked through.

- [ ] **Step 1: Write the failing test**

`tools/geocode/tests/test_match.py`:

```python
from __future__ import annotations

import pytest

from kaap_geocode.areas import BBox
from kaap_geocode.features import Feature
from kaap_geocode.match import AmbiguousMatch, find_match

CAPE = BBox(west=18.0, south=-34.4, east=19.0, north=-33.5)


def feature(name, lat, lon, osm_id=1, osm_type="node", kind="natural=peak"):
    return Feature(name=name, lat=lat, lon=lon, osm_type=osm_type, osm_id=osm_id, kind=kind)


def test_matches_an_exact_name_inside_the_bbox():
    features = [feature("Newlands Ravine", -33.965, 18.435)]
    got = find_match(["Newlands Ravine"], features, CAPE)
    assert got is not None
    assert got.feature.osm_id == 1
    assert got.candidate == "Newlands Ravine"


def test_rejects_a_correct_name_outside_the_bbox():
    # The same name exists in the Eastern Cape. Without the bbox constraint this
    # is exactly the false positive that would damage trust most.
    features = [feature("Newlands Ravine", -32.0, 25.0)]
    assert find_match(["Newlands Ravine"], features, CAPE) is None


def test_matching_ignores_case_punctuation_and_abbreviations():
    features = [feature("Elsies Peak", -34.13, 18.438)]
    got = find_match(["Elsies Pk"], features, CAPE)
    assert got is not None
    assert got.candidate == "Elsies Pk"


def test_tries_candidates_in_order_and_prefers_the_most_specific():
    features = [
        feature("Lion's Head", -33.935, 18.389, osm_id=10),
        feature("Lion's Head B", -33.936, 18.390, osm_id=11),
    ]
    got = find_match(["Lion's Head B", "Lion's Head"], features, CAPE)
    assert got is not None
    assert got.feature.osm_id == 11  # the first candidate that matched, not the last


def test_returns_none_when_no_candidate_matches():
    features = [feature("Devil's Peak", -33.9525, 18.4575)]
    assert find_match(["Carrel's Ledge", "Carrel"], features, CAPE) is None


def test_raises_on_two_features_with_the_same_name_inside_the_bbox():
    features = [
        feature("Window Gorge", -33.98, 18.43, osm_id=20),
        feature("Window Gorge", -33.99, 18.44, osm_id=21),
    ]
    with pytest.raises(AmbiguousMatch) as excinfo:
        find_match(["Window Gorge"], features, CAPE)
    assert excinfo.value.candidate == "Window Gorge"
    assert excinfo.value.count == 2


def test_ambiguity_outside_the_bbox_does_not_block_a_match_inside_it():
    features = [
        feature("Window Gorge", -33.98, 18.43, osm_id=20),
        feature("Window Gorge", -32.0, 25.0, osm_id=21),
    ]
    got = find_match(["Window Gorge"], features, CAPE)
    assert got is not None
    assert got.feature.osm_id == 20
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd tools/geocode && python -m pytest tests/test_match.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'kaap_geocode.match'`

- [ ] **Step 3: Write the implementation**

`tools/geocode/kaap_geocode/match.py`:

```python
"""Match a route's candidate names against named OSM features in its area.

Two rules carry the honesty of this tier:

1. A match must fall inside the route's own area bbox. A right name in the wrong
   province is the failure that would damage trust most, and this is the defence.
2. Two features sharing a name inside that bbox is an ambiguity, not a match.
   Choosing the nearer one would be a guess presented as evidence, so it raises
   instead and lands in the review report for curation.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass

from .areas import BBox
from .features import Feature
from .normalise import comparison_key


class AmbiguousMatch(Exception):
    """A candidate name matched more than one feature inside the area bbox."""

    def __init__(self, candidate: str, count: int) -> None:
        super().__init__(f"{candidate!r} matches {count} features inside the area")
        self.candidate = candidate
        self.count = count


@dataclass(frozen=True)
class Match:
    feature: Feature
    candidate: str


def find_match(
    candidate_names: list[str], features: list[Feature], bbox: BBox
) -> Match | None:
    by_key: dict[str, list[Feature]] = defaultdict(list)
    for feature in features:
        if bbox.contains(feature.lat, feature.lon):
            by_key[comparison_key(feature.name)].append(feature)

    for candidate in candidate_names:
        hits = by_key.get(comparison_key(candidate), [])
        if len(hits) > 1:
            raise AmbiguousMatch(candidate, len(hits))
        if hits:
            return Match(feature=hits[0], candidate=candidate)
    return None
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd tools/geocode && python -m pytest tests/test_match.py -v`
Expected: PASS, 7 tests

- [ ] **Step 5: Commit**

```bash
git add tools/geocode/kaap_geocode/match.py tools/geocode/tests/test_match.py
git commit -m "feat(geocode): match candidate names to OSM features inside the route's area"
```

---

### Task 6: The curated tier

**Files:**
- Create: `tools/geocode/kaap_geocode/overrides.py`, `data/geocode-overrides.json`
- Test: `tools/geocode/tests/test_overrides.py`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `Override` dataclass (`route_id: str`, `lat: float`, `lon: float`, `source: str`, `note: str`, `zoom: int`).
  - `load_overrides(path) -> dict[str, Override]`, keyed by route id.
  - `OverrideError` for validation failures.

`source` is required. An override is the one tier a human personally vouched for, so an entry that does not say where its coordinate came from is a validation error, not a silent accept.

- [ ] **Step 1: Write the failing test**

`tools/geocode/tests/test_overrides.py`:

```python
from __future__ import annotations

import json

import pytest

from kaap_geocode.overrides import OverrideError, load_overrides


def write(tmp_path, payload):
    path = tmp_path / "geocode-overrides.json"
    path.write_text(json.dumps(payload), encoding="utf-8")
    return path


VALID = {
    "overrides": [
        {
            "routeId": "other-areas--mt-zebra-park-idwala-hiking-trail",
            "lat": -32.2296,
            "lon": 25.5289,
            "source": "https://www.sanparks.org/parks/mountain_zebra/",
            "note": "Park rest camp; the trail head is signposted from there.",
        }
    ]
}


def test_loads_a_valid_override_keyed_by_route_id(tmp_path):
    got = load_overrides(write(tmp_path, VALID))
    entry = got["other-areas--mt-zebra-park-idwala-hiking-trail"]
    assert entry.lat == -32.2296
    assert entry.source.startswith("https://")
    assert entry.zoom == 15  # default when unspecified


def test_respects_an_explicit_zoom(tmp_path):
    payload = {"overrides": [{**VALID["overrides"][0], "zoom": 12}]}
    got = load_overrides(write(tmp_path, payload))
    assert got["other-areas--mt-zebra-park-idwala-hiking-trail"].zoom == 12


def test_a_missing_file_is_an_empty_override_set(tmp_path):
    assert load_overrides(tmp_path / "absent.json") == {}


def test_rejects_an_override_with_no_source(tmp_path):
    payload = {"overrides": [{"routeId": "a--b", "lat": -33.0, "lon": 18.0}]}
    with pytest.raises(OverrideError, match="source"):
        load_overrides(write(tmp_path, payload))


def test_rejects_an_override_with_an_empty_source(tmp_path):
    payload = {"overrides": [{"routeId": "a--b", "lat": -33.0, "lon": 18.0, "source": "  "}]}
    with pytest.raises(OverrideError, match="source"):
        load_overrides(write(tmp_path, payload))


def test_rejects_out_of_range_coordinates(tmp_path):
    payload = {"overrides": [{"routeId": "a--b", "lat": -100.0, "lon": 18.0, "source": "x"}]}
    with pytest.raises(OverrideError, match="lat"):
        load_overrides(write(tmp_path, payload))


def test_rejects_a_duplicate_route_id(tmp_path):
    entry = {"routeId": "a--b", "lat": -33.0, "lon": 18.0, "source": "x"}
    with pytest.raises(OverrideError, match="duplicate"):
        load_overrides(write(tmp_path, {"overrides": [entry, entry]}))
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd tools/geocode && python -m pytest tests/test_overrides.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'kaap_geocode.overrides'`

- [ ] **Step 3: Write the implementation**

`tools/geocode/kaap_geocode/overrides.py`:

```python
"""The curated tier: coordinates a human looked up and vouched for.

Highest precedence of all four tiers, including over the crawl's own
coordinates, because it is the only tier somebody personally checked. That
authority is why `source` is mandatory: an unsourced override is indistinguishable
from a guess, and this file is meant to be reviewable in a diff years later.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

DEFAULT_ZOOM = 15


class OverrideError(Exception):
    """A geocode-overrides.json entry is invalid."""


@dataclass(frozen=True)
class Override:
    route_id: str
    lat: float
    lon: float
    source: str
    note: str = ""
    zoom: int = DEFAULT_ZOOM


def load_overrides(path: Path) -> dict[str, Override]:
    if not Path(path).exists():
        return {}

    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    out: dict[str, Override] = {}

    for raw in payload.get("overrides", []):
        route_id = str(raw.get("routeId") or "").strip()
        if not route_id:
            raise OverrideError("override is missing routeId")
        if route_id in out:
            raise OverrideError(f"duplicate routeId {route_id!r} in overrides")

        source = str(raw.get("source") or "").strip()
        if not source:
            raise OverrideError(
                f"override {route_id!r} has no source — every curated coordinate "
                "must say where it came from"
            )

        try:
            lat = float(raw["lat"])
            lon = float(raw["lon"])
        except (KeyError, TypeError, ValueError) as exc:
            raise OverrideError(f"override {route_id!r} has invalid lat/lon") from exc

        if not -90.0 <= lat <= 90.0:
            raise OverrideError(f"override {route_id!r} has out-of-range lat {lat}")
        if not -180.0 <= lon <= 180.0:
            raise OverrideError(f"override {route_id!r} has out-of-range lon {lon}")

        out[route_id] = Override(
            route_id=route_id,
            lat=lat,
            lon=lon,
            source=source,
            note=str(raw.get("note") or ""),
            zoom=int(raw.get("zoom") or DEFAULT_ZOOM),
        )

    return out
```

- [ ] **Step 4: Create the empty overrides file**

`data/geocode-overrides.json`:

```json
{
  "comment": "Curated route coordinates. Highest precedence of all tiers, including over the crawl's own coordinates, because these are the only ones a human personally checked. Every entry MUST carry a `source` (a URL or citation) — the loader rejects the file otherwise. Add entries here for routes the OSM name match cannot reach or reports as ambiguous; data/geocode-report.md lists both queues.",
  "overrides": []
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd tools/geocode && python -m pytest tests/test_overrides.py -v`
Expected: PASS, 7 tests

- [ ] **Step 6: Commit**

```bash
git add tools/geocode/kaap_geocode/overrides.py tools/geocode/tests/test_overrides.py data/geocode-overrides.json
git commit -m "feat(geocode): add the curated tier, requiring a source citation per entry"
```

---

### Task 7: The area-approximate tier

**Files:**
- Create: `tools/geocode/kaap_geocode/approx.py`
- Test: `tools/geocode/tests/test_approx.py`

**Interfaces:**
- Consumes: nothing (takes the sibling list `located_scope` returns).
- Produces:
  - `haversine_m(lat1, lon1, lat2, lon2) -> float`
  - `Approx` dataclass (`lat: float`, `lon: float`, `accuracy_m: int`).
  - `area_approx(siblings: list[dict]) -> Approx | None`

`accuracy_m` is the point of this tier. It is what lets Plan 3 draw an uncertainty circle instead of a dot, so an area-level guess can never masquerade as a surveyed position.

- [ ] **Step 1: Write the failing test**

`tools/geocode/tests/test_approx.py`:

```python
from __future__ import annotations

from kaap_geocode.approx import area_approx, haversine_m


def sibling(lat, lon):
    return {"coords": {"lat": lat, "lon": lon, "zoom": 17}}


def test_haversine_is_zero_for_the_same_point():
    assert haversine_m(-33.97, 18.39, -33.97, 18.39) == 0


def test_haversine_matches_a_known_distance():
    # One degree of latitude is ~111.2 km.
    got = haversine_m(-33.0, 18.0, -34.0, 18.0)
    assert 110_000 < got < 112_000


def test_area_approx_centroid_is_the_mean_of_the_siblings():
    got = area_approx([sibling(-33.90, 18.30), sibling(-34.10, 18.50)])
    assert got is not None
    assert round(got.lat, 4) == -34.0
    assert round(got.lon, 4) == 18.4


def test_accuracy_is_the_distance_to_the_furthest_sibling():
    got = area_approx([sibling(-33.90, 18.40), sibling(-34.10, 18.40)])
    assert got is not None
    # Centroid sits midway, so the furthest sibling is ~0.1 deg ~ 11 km away.
    assert 10_000 < got.accuracy_m < 12_000


def test_a_single_sibling_still_gets_a_non_zero_accuracy():
    # One sibling would give a radius of 0, which would render as a precise dot
    # and defeat the whole point of this tier.
    got = area_approx([sibling(-33.97, 18.39)])
    assert got is not None
    assert got.accuracy_m > 0


def test_no_siblings_gives_no_approximation():
    assert area_approx([]) is None
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd tools/geocode && python -m pytest tests/test_approx.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'kaap_geocode.approx'`

- [ ] **Step 3: Write the implementation**

`tools/geocode/kaap_geocode/approx.py`:

```python
"""The last tier: the area, not the route.

When a route cannot be tied to any named feature, the honest fallback is where
its area is — with a radius saying how loosely that is meant. The radius is not
decoration: Plan 3 draws it as an uncertainty circle, which is what stops an
area-level guess from looking like a surveyed position.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

EARTH_RADIUS_M = 6_371_000

# A lone located sibling would give a radius of zero, which would render as a
# precise dot — precisely the impression this tier must not create. Floor it at
# a value that reads as "somewhere around here" at trail scale.
MIN_ACCURACY_M = 2_000


@dataclass(frozen=True)
class Approx:
    lat: float
    lon: float
    accuracy_m: int


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    d_phi = phi2 - phi1
    d_lambda = math.radians(lon2 - lon1)
    a = (
        math.sin(d_phi / 2) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
    )
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(a))


def area_approx(siblings: list[dict[str, Any]]) -> Approx | None:
    points = [
        (s["coords"]["lat"], s["coords"]["lon"])
        for s in siblings
        if s.get("coords") and s["coords"].get("lat") is not None
    ]
    if not points:
        return None

    lat = sum(p[0] for p in points) / len(points)
    lon = sum(p[1] for p in points) / len(points)
    furthest = max(haversine_m(lat, lon, p[0], p[1]) for p in points)
    return Approx(lat=lat, lon=lon, accuracy_m=max(MIN_ACCURACY_M, round(furthest)))
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd tools/geocode && python -m pytest tests/test_approx.py -v`
Expected: PASS, 6 tests

- [ ] **Step 5: Commit**

```bash
git add tools/geocode/kaap_geocode/approx.py tools/geocode/tests/test_approx.py
git commit -m "feat(geocode): add the area-approximate tier with an accuracy radius"
```

---

### Task 8: The tier ladder

**Files:**
- Create: `tools/geocode/kaap_geocode/pipeline.py`
- Test: `tools/geocode/tests/test_pipeline.py`

**Interfaces:**
- Consumes: `route_id` (1), `candidates` (2), `located_scope`/`bbox_of` (3), `Feature` (4), `find_match`/`AmbiguousMatch` (5), `Override` (6), `area_approx` (7).
- Produces:
  - `Location` dataclass: `route_id`, `lat`, `lon`, `zoom`, `source` (`'curated' | 'crawl' | 'osm-match' | 'area-approx'`), `accuracy_m: int | None`, `osm: dict | None`, `matched_candidate: str | None`.
  - `Outcome` dataclass: `locations: dict[str, Location]`, `unlocated: list[str]`, `ambiguous: list[tuple[str, str, int]]`.
  - `locate_all(routes, features, overrides) -> Outcome`

Precedence is `curated` → `crawl` → `osm-match` → `area-approx`, and `Outcome.locations` contains an entry for **every** located route including the crawl's own 125, so there is one source of truth for provenance rather than two.

- [ ] **Step 1: Write the failing test**

`tools/geocode/tests/test_pipeline.py`:

```python
from __future__ import annotations

from kaap_geocode.features import Feature
from kaap_geocode.overrides import Override
from kaap_geocode.pipeline import locate_all


def route(area, slug, lat=None, lon=None, zoom=17):
    coords = None if lat is None else {"lat": lat, "lon": lon, "zoom": zoom}
    return {"area": area, "slug": slug, "title": slug.replace("-", " ").title(), "coords": coords}


def titled(area, slug, title, lat=None, lon=None):
    r = route(area, slug, lat, lon)
    r["title"] = title
    return r


def feature(name, lat, lon, osm_id=1):
    return Feature(name=name, lat=lat, lon=lon, osm_type="node", osm_id=osm_id, kind="natural=peak")


def test_crawl_coordinates_are_kept_and_labelled():
    routes = [route(["Table-Mountain", "atlantic-west"], "kasteelspoort", -33.97, 18.39)]
    out = locate_all(routes, [], {})
    loc = out.locations["table-mountain--atlantic-west--kasteelspoort"]
    assert loc.source == "crawl"
    assert (loc.lat, loc.lon, loc.zoom) == (-33.97, 18.39, 17)
    assert loc.accuracy_m is None


def test_a_curated_override_beats_a_crawl_coordinate():
    routes = [route(["Table-Mountain", "atlantic-west"], "kasteelspoort", -33.97, 18.39)]
    overrides = {
        "table-mountain--atlantic-west--kasteelspoort": Override(
            route_id="table-mountain--atlantic-west--kasteelspoort",
            lat=-33.98,
            lon=18.40,
            source="surveyed on site",
            zoom=16,
        )
    }
    out = locate_all(routes, [], overrides)
    loc = out.locations["table-mountain--atlantic-west--kasteelspoort"]
    assert loc.source == "curated"
    assert (loc.lat, loc.lon, loc.zoom) == (-33.98, 18.40, 16)


def test_an_unlocated_route_matches_a_named_feature_in_its_area():
    routes = [
        route(["Table-Mountain", "newlands-east"], "sibling", -33.97, 18.43),
        titled(["Table-Mountain", "newlands-east"], "newlands-ravine", "Newlands Ravine"),
    ]
    out = locate_all(routes, [feature("Newlands Ravine", -33.965, 18.435, osm_id=7)], {})
    loc = out.locations["table-mountain--newlands-east--newlands-ravine"]
    assert loc.source == "osm-match"
    assert loc.osm == {"type": "node", "id": 7, "name": "Newlands Ravine"}
    assert loc.matched_candidate == "Newlands Ravine"
    assert loc.accuracy_m is None


def test_a_same_named_feature_outside_the_area_falls_through_to_area_approx():
    routes = [
        route(["Table-Mountain", "newlands-east"], "sibling", -33.97, 18.43),
        titled(["Table-Mountain", "newlands-east"], "newlands-ravine", "Newlands Ravine"),
    ]
    # Right name, Eastern Cape coordinates.
    out = locate_all(routes, [feature("Newlands Ravine", -32.0, 25.0)], {})
    loc = out.locations["table-mountain--newlands-east--newlands-ravine"]
    assert loc.source == "area-approx"
    assert loc.accuracy_m is not None and loc.accuracy_m > 0


def test_an_ambiguous_match_is_recorded_and_falls_through_to_area_approx():
    routes = [
        route(["Table-Mountain", "newlands-east"], "sibling", -33.97, 18.43),
        titled(["Table-Mountain", "newlands-east"], "window-gorge", "Window Gorge"),
    ]
    features = [
        feature("Window Gorge", -33.975, 18.432, osm_id=20),
        feature("Window Gorge", -33.976, 18.433, osm_id=21),
    ]
    out = locate_all(routes, features, {})
    loc = out.locations["table-mountain--newlands-east--window-gorge"]
    assert loc.source == "area-approx"
    assert ("table-mountain--newlands-east--window-gorge", "Window Gorge", 2) in out.ambiguous


def test_a_route_whose_area_has_no_located_siblings_stays_unlocated():
    routes = [titled(["other-areas"], "mt-zebra", "Mt Zebra Park")]
    out = locate_all(routes, [], {})
    assert "other-areas--mt-zebra" not in out.locations
    assert "other-areas--mt-zebra" in out.unlocated


def test_every_location_carries_a_source():
    routes = [
        route(["Table-Mountain", "atlantic-west"], "kasteelspoort", -33.97, 18.39),
        titled(["Table-Mountain", "atlantic-west"], "corridor-rib", "Corridor Rib"),
    ]
    out = locate_all(routes, [], {})
    assert out.locations
    for loc in out.locations.values():
        assert loc.source in {"curated", "crawl", "osm-match", "area-approx"}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd tools/geocode && python -m pytest tests/test_pipeline.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'kaap_geocode.pipeline'`

- [ ] **Step 3: Write the implementation**

`tools/geocode/kaap_geocode/pipeline.py`:

```python
"""The tier ladder: curated, then crawl, then OSM match, then area-approximate.

Every located route gets an entry, including the 125 the crawl already had, so
provenance has exactly one source of truth instead of the app having to infer
"no entry means crawl". Routes that reach the bottom of the ladder without a
position stay unlocated and keep the honest unmapped path the app already has.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

from .approx import area_approx
from .areas import bbox_of, located_scope
from .features import Feature
from .ids import route_id
from .match import AmbiguousMatch, find_match
from .normalise import candidates
from .overrides import Override

Source = Literal["curated", "crawl", "osm-match", "area-approx"]

# An OSM feature is a real place, so the locator map can sit in close. An
# area-level guess must not: opening at trail zoom would imply a precision the
# coordinate does not have.
ZOOM_OSM_MATCH = 15
ZOOM_AREA_APPROX = 11


@dataclass(frozen=True)
class Location:
    route_id: str
    lat: float
    lon: float
    zoom: int
    source: Source
    accuracy_m: int | None = None
    osm: dict[str, Any] | None = None
    matched_candidate: str | None = None


@dataclass
class Outcome:
    locations: dict[str, Location]
    unlocated: list[str]
    # (route_id, candidate, feature_count) — the curation queue.
    ambiguous: list[tuple[str, str, int]]


def locate_all(
    routes: list[dict[str, Any]],
    features: list[Feature],
    overrides: dict[str, Override],
) -> Outcome:
    locations: dict[str, Location] = {}
    unlocated: list[str] = []
    ambiguous: list[tuple[str, str, int]] = []

    for raw in routes:
        rid = route_id(raw.get("area") or [], raw.get("slug") or "")

        override = overrides.get(rid)
        if override is not None:
            locations[rid] = Location(
                route_id=rid,
                lat=override.lat,
                lon=override.lon,
                zoom=override.zoom,
                source="curated",
            )
            continue

        coords = raw.get("coords")
        if coords and coords.get("lat") is not None and coords.get("lon") is not None:
            locations[rid] = Location(
                route_id=rid,
                lat=float(coords["lat"]),
                lon=float(coords["lon"]),
                zoom=int(coords.get("zoom") or ZOOM_OSM_MATCH),
                source="crawl",
            )
            continue

        # Unlocated: what does its area know?
        _scope, siblings = located_scope(routes, raw.get("area") or [])
        if not siblings:
            unlocated.append(rid)
            continue

        bbox = bbox_of(siblings)
        assert bbox is not None  # siblings are located by construction

        match = None
        try:
            match = find_match(candidates(raw.get("title") or ""), features, bbox)
        except AmbiguousMatch as exc:
            ambiguous.append((rid, exc.candidate, exc.count))

        if match is not None:
            locations[rid] = Location(
                route_id=rid,
                lat=match.feature.lat,
                lon=match.feature.lon,
                zoom=ZOOM_OSM_MATCH,
                source="osm-match",
                osm={
                    "type": match.feature.osm_type,
                    "id": match.feature.osm_id,
                    "name": match.feature.name,
                },
                matched_candidate=match.candidate,
            )
            continue

        approx = area_approx(siblings)
        if approx is None:
            unlocated.append(rid)
            continue

        locations[rid] = Location(
            route_id=rid,
            lat=approx.lat,
            lon=approx.lon,
            zoom=ZOOM_AREA_APPROX,
            source="area-approx",
            accuracy_m=approx.accuracy_m,
        )

    return Outcome(locations=locations, unlocated=unlocated, ambiguous=ambiguous)
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd tools/geocode && python -m pytest tests/test_pipeline.py -v`
Expected: PASS, 7 tests

- [ ] **Step 5: Run the whole Python suite**

Run: `cd tools/geocode && python -m pytest -v`
Expected: PASS, 51 tests (4+9+6+5+7+7+6+7)

- [ ] **Step 6: Commit**

```bash
git add tools/geocode/kaap_geocode/pipeline.py tools/geocode/tests/test_pipeline.py
git commit -m "feat(geocode): apply the curated/crawl/osm-match/area-approx ladder"
```

---

### Task 9: CLI, report and runbook

**Files:**
- Create: `tools/geocode/kaap_geocode/report.py`, `tools/geocode/kaap_geocode/cli.py`, `tools/geocode/README.md`
- Test: `tools/geocode/tests/test_report.py`

**Interfaces:**
- Consumes: `Outcome`/`Location` (Task 8), `load_overrides` (6), `read_features` (4).
- Produces: `data/route-locations.json` and `data/geocode-report.md`; `build_report(outcome, routes, extract_date) -> str`.

The report is not decoration — it is how the ambiguity and unlocated queues become actionable, and how a reviewer sees which weak candidate a match came from.

- [ ] **Step 1: Write the failing test**

`tools/geocode/tests/test_report.py`:

```python
from __future__ import annotations

from kaap_geocode.pipeline import Location, Outcome
from kaap_geocode.report import build_report


def location(rid, source, **kw):
    return Location(route_id=rid, lat=-33.9, lon=18.4, zoom=15, source=source, **kw)


OUTCOME = Outcome(
    locations={
        "a--crawled": location("a--crawled", "crawl"),
        "a--matched": location(
            "a--matched",
            "osm-match",
            osm={"type": "node", "id": 7, "name": "Newlands Ravine"},
            matched_candidate="Newlands Ravine",
        ),
        "a--rough": location("a--rough", "area-approx", accuracy_m=4200),
        "a--curated": location("a--curated", "curated"),
    },
    unlocated=["b--nowhere"],
    ambiguous=[("a--rough", "Window Gorge", 2)],
)
ROUTES = [{"area": ["a"], "slug": "crawled", "title": "Crawled"}]


def test_report_counts_each_tier():
    text = build_report(OUTCOME, ROUTES, extract_date="2026-07-28")
    assert "| `crawl` | 1 |" in text
    assert "| `osm-match` | 1 |" in text
    assert "| `area-approx` | 1 |" in text
    assert "| `curated` | 1 |" in text


def test_report_records_the_extract_date_for_reproducibility():
    assert "2026-07-28" in build_report(OUTCOME, ROUTES, extract_date="2026-07-28")


def test_report_lists_matches_with_the_candidate_that_matched():
    text = build_report(OUTCOME, ROUTES, extract_date="2026-07-28")
    assert "a--matched" in text
    assert "Newlands Ravine" in text
    assert "node/7" in text


def test_report_lists_the_ambiguity_queue():
    text = build_report(OUTCOME, ROUTES, extract_date="2026-07-28")
    assert "Ambiguous" in text
    assert "Window Gorge" in text


def test_report_lists_still_unlocated_routes():
    assert "b--nowhere" in build_report(OUTCOME, ROUTES, extract_date="2026-07-28")
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd tools/geocode && python -m pytest tests/test_report.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'kaap_geocode.report'`

- [ ] **Step 3: Write the report builder**

`tools/geocode/kaap_geocode/report.py`:

```python
"""data/geocode-report.md — the tier mix and the two work queues.

Written so the weak links are visible rather than buried: every osm-match names
the candidate string that matched, so a reviewer can spot a match that came from
an over-stripped title and correct it with an override.
"""

from __future__ import annotations

from typing import Any

from .pipeline import Outcome

TIERS = ("curated", "crawl", "osm-match", "area-approx")


def build_report(outcome: Outcome, routes: list[dict[str, Any]], extract_date: str) -> str:
    counts = {tier: 0 for tier in TIERS}
    for location in outcome.locations.values():
        counts[location.source] += 1

    total = len(routes)
    located = len(outcome.locations)

    lines = [
        "# Geocoding report",
        "",
        f"**OSM extract date:** {extract_date}",
        "",
        f"Located **{located} / {total}** routes; **{len(outcome.unlocated)}** remain unlocated.",
        "",
        "## Tier mix",
        "",
        "| Source | Routes |",
        "|---|---|",
    ]
    for tier in TIERS:
        lines.append(f"| `{tier}` | {counts[tier]} |")

    matches = sorted(
        (loc for loc in outcome.locations.values() if loc.source == "osm-match"),
        key=lambda loc: loc.route_id,
    )
    lines += [
        "",
        "## OSM matches",
        "",
        "Each row names the candidate string that matched. A match on a heavily",
        "stripped candidate is weaker evidence than one on a full title — review",
        "those and override where wrong.",
        "",
        "| Route | Matched candidate | OSM feature |",
        "|---|---|---|",
    ]
    for loc in matches:
        osm = loc.osm or {}
        ref = f"{osm.get('type', '?')}/{osm.get('id', '?')}"
        lines.append(
            f"| `{loc.route_id}` | {loc.matched_candidate} | {osm.get('name', '?')} ({ref}) |"
        )

    lines += [
        "",
        "## Ambiguous — needs a curated override",
        "",
        "More than one feature of this name sits inside the route's area, so no",
        "match was claimed. These fell through to `area-approx`.",
        "",
    ]
    if outcome.ambiguous:
        lines += ["| Route | Candidate | Features |", "|---|---|---|"]
        for rid, candidate, count in sorted(outcome.ambiguous):
            lines.append(f"| `{rid}` | {candidate} | {count} |")
    else:
        lines.append("None.")

    lines += ["", "## Still unlocated", ""]
    if outcome.unlocated:
        lines += [f"- `{rid}`" for rid in sorted(outcome.unlocated)]
    else:
        lines.append("None.")

    approx = sorted(
        (loc for loc in outcome.locations.values() if loc.source == "area-approx"),
        key=lambda loc: loc.route_id,
    )
    lines += ["", "## Area-approximate", "", "| Route | Accuracy (m) |", "|---|---|"]
    for loc in approx:
        lines.append(f"| `{loc.route_id}` | {loc.accuracy_m} |")

    return "\n".join(lines) + "\n"
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd tools/geocode && python -m pytest tests/test_report.py -v`
Expected: PASS, 5 tests

- [ ] **Step 5: Write the CLI**

`tools/geocode/kaap_geocode/cli.py`:

```python
"""Entry point: read routes + features + overrides, write locations + report."""

from __future__ import annotations

import argparse
import json
from datetime import date
from pathlib import Path

from .features import read_features
from .overrides import load_overrides
from .pipeline import locate_all
from .report import build_report

HERE = Path(__file__).resolve().parent.parent
DATA = HERE.parent.parent / "data"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Locate KaapSpoor routes.")
    parser.add_argument("--routes", type=Path, default=DATA / "routes.json")
    parser.add_argument("--features", type=Path, default=HERE / "work" / "named-features.geojsonl")
    parser.add_argument("--overrides", type=Path, default=DATA / "geocode-overrides.json")
    parser.add_argument("--out", type=Path, default=DATA / "route-locations.json")
    parser.add_argument("--report", type=Path, default=DATA / "geocode-report.md")
    parser.add_argument(
        "--extract-date",
        default=None,
        help="Date of the OSM extract, recorded for reproducibility "
        "(defaults to the features file's mtime).",
    )
    args = parser.parse_args(argv)

    routes = json.loads(args.routes.read_text(encoding="utf-8"))["routes"]

    if args.features.exists():
        features = read_features(args.features)
        extract_date = args.extract_date or date.fromtimestamp(
            args.features.stat().st_mtime
        ).isoformat()
    else:
        # Without the extract the osm-match tier simply cannot fire; the other
        # three still can, so this is a degraded run rather than a failure.
        print(f"warning: {args.features} missing — run extract-osm-features.sh in WSL")
        features = []
        extract_date = args.extract_date or "none"

    overrides = load_overrides(args.overrides)
    outcome = locate_all(routes, features, overrides)

    payload = {
        "generated": date.today().isoformat(),
        "osm_extract_date": extract_date,
        "locations": {
            rid: {
                "coords": {"lat": loc.lat, "lon": loc.lon, "zoom": loc.zoom},
                "source": loc.source,
                **({"accuracyM": loc.accuracy_m} if loc.accuracy_m is not None else {}),
                **({"osm": loc.osm} if loc.osm else {}),
            }
            for rid, loc in sorted(outcome.locations.items())
        },
    }
    args.out.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    args.report.write_text(build_report(outcome, routes, extract_date), encoding="utf-8")

    counts: dict[str, int] = {}
    for loc in outcome.locations.values():
        counts[loc.source] = counts.get(loc.source, 0) + 1
    print(
        f"geocode: {len(outcome.locations)}/{len(routes)} located "
        f"({', '.join(f'{k}={v}' for k, v in sorted(counts.items()))}), "
        f"{len(outcome.unlocated)} unlocated, {len(outcome.ambiguous)} ambiguous"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 6: Write the runbook**

`tools/geocode/README.md`:

```markdown
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
#    data/geocode-report.md lists two queues: features that were ambiguous, and
#    routes still unlocated. Add entries to data/geocode-overrides.json for
#    both — every entry needs a `source`, or the loader rejects the file.
#    Re-run step 2 after editing.
```

Step 1 is skippable: without the features file the tool warns and runs the other
three tiers, which is useful for iterating on overrides.

## Outputs (all committed)

- `data/route-locations.json` — one entry per located route, with `source` and,
  for `area-approx`, `accuracyM`. The app's `app/scripts/transform.ts` merges it.
- `data/geocode-report.md` — tier mix, the OSM matches with the candidate that
  matched each one, and the two curation queues.

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
```

- [ ] **Step 7: Run the tool end to end**

Run (from the repo root, without the OSM extract — the degraded path):

```bash
cd tools/geocode && python -m kaap_geocode.cli
```

Expected: a warning about the missing features file, then a summary line showing
`crawl=125` and `area-approx` covering most of the 59, with `data/route-locations.json`
and `data/geocode-report.md` written.

- [ ] **Step 8: Run the whole Python suite**

Run: `cd tools/geocode && python -m pytest -v`
Expected: PASS, 56 tests

- [ ] **Step 9: Commit**

```bash
git add tools/geocode/ data/route-locations.json data/geocode-report.md
git commit -m "feat(geocode): add the CLI, the review report and the runbook"
```

---

### Task 10: Merge provenance into the app's data pipeline

**Files:**
- Modify: `app/src/lib/data/types.ts:1-13`, `app/scripts/transform.ts:1-73`
- Test: `app/scripts/transform.test.ts`

**Interfaces:**
- Consumes: `data/route-locations.json` from Task 9.
- Produces: `RouteIndexEntry.coordsSource`, `.coordsAccuracyM`, `.coordsOsm` — the fields Plan 3 renders. `transform(raw, locations)` gains a second parameter.

- [ ] **Step 1: Write the failing test**

`app/scripts/transform.test.ts` already exists and has its own `import { describe, it, expect } from 'vitest'` on line 1 and a top-level `const raw` fixture. **Do not repeat the imports** — a second `import { describe, it, expect }` in the same module is a redeclaration error. Instead, first extend the existing import on line 2 to:

```typescript
import { transform, statValue, type RawDataset } from './transform';
```

Then append this block to the end of the file (the helper is named `dataset` so it cannot collide with the existing `raw`):

```typescript
function dataset(routes: Partial<RawDataset['routes'][number]>[]): RawDataset {
  return {
    routes: routes.map((r) => ({
      slug: 'x', title: 'X', url: 'u', area: ['a'], coords: null,
      grade: null, grade_source: null, stats: {}, sections: {},
      description: '', related: [], attachments: [],
      photos: { deck_ids: [], inline_urls: [] },
      ...r
    }))
  } as RawDataset;
}

describe('transform provenance', () => {
  it('labels a crawl coordinate as crawl when no location entry exists', () => {
    const raw = dataset([{ slug: 'kasteelspoort', coords: { lat: -33.97, lon: 18.39, zoom: 17 } }]);
    const { index } = transform(raw, {});
    expect(index[0].coords).toEqual({ lat: -33.97, lon: 18.39, zoom: 17 });
    expect(index[0].coordsSource).toBe('crawl');
    expect(index[0].coordsAccuracyM).toBeNull();
  });

  it('leaves an unlocated route with a null source', () => {
    const { index } = transform(dataset([{ slug: 'corridor-rib' }]), {});
    expect(index[0].coords).toBeNull();
    expect(index[0].coordsSource).toBeNull();
  });

  it('applies a location entry over a crawl coordinate', () => {
    const raw = dataset([{ slug: 'kasteelspoort', coords: { lat: -33.97, lon: 18.39, zoom: 17 } }]);
    const { index } = transform(raw, {
      'a--kasteelspoort': {
        coords: { lat: -33.98, lon: 18.4, zoom: 16 },
        source: 'curated'
      }
    });
    expect(index[0].coords).toEqual({ lat: -33.98, lon: 18.4, zoom: 16 });
    expect(index[0].coordsSource).toBe('curated');
  });

  it('carries the accuracy radius for an area-approximate location', () => {
    const { index } = transform(dataset([{ slug: 'corridor-rib' }]), {
      'a--corridor-rib': {
        coords: { lat: -33.97, lon: 18.39, zoom: 11 },
        source: 'area-approx',
        accuracyM: 4200
      }
    });
    expect(index[0].coordsSource).toBe('area-approx');
    expect(index[0].coordsAccuracyM).toBe(4200);
  });

  it('carries the matched OSM feature for an osm-match location', () => {
    const { index } = transform(dataset([{ slug: 'newlands-ravine' }]), {
      'a--newlands-ravine': {
        coords: { lat: -33.965, lon: 18.435, zoom: 15 },
        source: 'osm-match',
        osm: { type: 'node', id: 7, name: 'Newlands Ravine' }
      }
    });
    expect(index[0].coordsSource).toBe('osm-match');
    expect(index[0].coordsOsm).toEqual({ type: 'node', id: 7, name: 'Newlands Ravine' });
  });

  it('propagates provenance to the per-route content as well as the index', () => {
    const { content } = transform(dataset([{ slug: 'corridor-rib' }]), {
      'a--corridor-rib': {
        coords: { lat: -33.97, lon: 18.39, zoom: 11 },
        source: 'area-approx',
        accuracyM: 4200
      }
    });
    expect(content[0].coordsSource).toBe('area-approx');
    expect(content[0].coordsAccuracyM).toBe(4200);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd app && npx vitest run scripts/transform.test.ts`
Expected: FAIL — `coordsSource` does not exist on `RouteIndexEntry`, and `transform` accepts only one argument.

- [ ] **Step 3: Add the types**

In `app/src/lib/data/types.ts`, replace lines 1-13 with:

```typescript
export interface Coords { lat: number; lon: number; zoom: number; }

/**
 * How well a route's position is known. `crawl` is the coordinate the source
 * page carried; `curated` was looked up and cited by hand; `osm-match` was tied
 * to a named OSM feature inside the route's own area; `area-approx` is the
 * area's centroid and is only as good as `coordsAccuracyM` says.
 */
export type CoordsSource = 'crawl' | 'curated' | 'osm-match' | 'area-approx';

export interface OsmRef { type: string; id: number; name: string; }

/** One entry of data/route-locations.json, written by tools/geocode. */
export interface RouteLocation {
  coords: Coords;
  source: CoordsSource;
  accuracyM?: number;
  osm?: OsmRef;
}

export interface RouteIndexEntry {
  id: string;
  title: string;
  area: string[];
  coords: Coords | null;
  /** Never null when `coords` is non-null, and vice versa. */
  coordsSource: CoordsSource | null;
  /** Metres. Set for `area-approx` only. */
  coordsAccuracyM: number | null;
  /** Set for `osm-match` only. */
  coordsOsm: OsmRef | null;
  grade: string | null;
  gradeSource: 'label' | 'prose' | null;
  time: string | null;
  heightGain: string | null;
  isFullEntry: boolean;
}
```

- [ ] **Step 4: Merge locations in the transform**

In `app/scripts/transform.ts`, change the import on line 6 to:

```typescript
import type { RouteIndexEntry, RouteContent, RouteLocation } from '../src/lib/data/types';
```

Change the `transform` signature (line 23) to take locations as an **optional** second parameter — the six existing tests in this file call `transform(raw)` with one argument, and defaulting keeps them compiling and meaningful (no locations means every coordinate is a crawl coordinate, which is the pre-Phase-3 behaviour):

```typescript
export function transform(
  raw: RawDataset,
  locations: Record<string, RouteLocation> = {}
): { index: RouteIndexEntry[]; content: RouteContent[] } {
```

and inside the route loop, replace the `entry` literal with:

```typescript
    // route-locations.json is the single source of truth for provenance and
    // wins over the crawl's own coords: a curated entry exists precisely
    // because somebody judged the crawl coordinate wrong or missing.
    const location = locations[id];
    const entry: RouteIndexEntry = {
      id, title: r.title, area: r.area,
      coords: location?.coords ?? r.coords,
      coordsSource: location?.source ?? (r.coords ? 'crawl' : null),
      coordsAccuracyM: location?.accuracyM ?? null,
      coordsOsm: location?.osm ?? null,
      grade: r.grade, gradeSource: r.grade_source,
      time: statValue(r.stats, 'Time'),
      heightGain: statValue(r.stats, 'Height gain'),
      isFullEntry: Object.keys(r.stats).length > 0 || r.grade_source === 'label'
    };
```

Then update `main()` (lines 62-71) to load the artifact, tolerating its absence:

```typescript
async function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const raw = JSON.parse(readFileSync(resolve(here, '../../data/routes.json'), 'utf-8')) as RawDataset;
  // Absent on a fresh clone that has not run tools/geocode yet; every route
  // then falls back to its crawl coordinate, which is the pre-Phase-3 behaviour.
  const locationsPath = resolve(here, '../../data/route-locations.json');
  const locations = existsSync(locationsPath)
    ? (JSON.parse(readFileSync(locationsPath, 'utf-8')).locations as Record<string, RouteLocation>)
    : {};
  const { index, content } = transform(raw, locations);
  const out = resolve(here, '../static/data');
  await mkdir(resolve(out, 'routes'), { recursive: true });
  await writeFile(resolve(out, 'routes-index.json'), JSON.stringify(index));
  for (const c of content) await writeFile(resolve(out, `routes/${c.id}.json`), JSON.stringify(c));
  const bySource = new Map<string, number>();
  for (const e of index) if (e.coordsSource) bySource.set(e.coordsSource, (bySource.get(e.coordsSource) ?? 0) + 1);
  console.log(
    `transform: ${index.length} routes, ${index.filter((e) => e.coords).length} located ` +
      `(${[...bySource].map(([k, v]) => `${k}=${v}`).join(', ')})`
  );
}
```

Change the `node:fs` import on line 2 to:

```typescript
import { existsSync, readFileSync } from 'node:fs';
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd app && npx vitest run scripts/transform.test.ts`
Expected: PASS, including the six new provenance tests.

- [ ] **Step 6: Run the full app suite and the type check**

Run: `cd app && npm test && npm run check`

The three new fields on `RouteIndexEntry` are **required**, so every existing
fixture that builds an entry literal now fails to type-check. That is the point —
the compiler is enumerating everywhere provenance has to be considered. Add
`coordsSource: null, coordsAccuracyM: null, coordsOsm: null` to each (or
`coordsSource: 'crawl'` where the fixture has coords and the test reads more
naturally that way). Do **not** loosen the type to make this go away.

The seven fixture sites, all of them test files:

- `app/src/lib/components/AreaTree.test.ts:8`
- `app/src/lib/components/RouteRow.test.ts:9`
- `app/src/lib/data/areas.test.ts:6`
- `app/src/lib/data/filter.test.ts:6`
- `app/src/lib/map/geojson.test.ts:5-8`
- `app/src/routes/library.test.ts:8`
- `app/src/routes/route/route-page.test.ts:10`

Expected after fixing: `npm test` passes and `svelte-check` reports 0 errors.

- [ ] **Step 7: Rebuild the data and confirm the summary line**

Run: `cd app && npm run build:data`
Expected: a line like
`transform: 184 routes, 18x located (crawl=125, area-approx=5x, ...)`.

- [ ] **Step 8: Commit**

```bash
git add app/src/lib/data/types.ts app/scripts/transform.ts app/scripts/transform.test.ts \
  app/src/lib/components/AreaTree.test.ts app/src/lib/components/RouteRow.test.ts \
  app/src/lib/data/areas.test.ts app/src/lib/data/filter.test.ts \
  app/src/lib/map/geojson.test.ts app/src/routes/library.test.ts \
  app/src/routes/route/route-page.test.ts
git commit -m "feat(app): merge route locations and provenance into the data transform"
```

---

## Definition of done

- `cd tools/geocode && python -m pytest` passes.
- `cd app && npm test && npm run check` passes.
- `data/route-locations.json` carries an entry for every located route, each with a `source`.
- `data/geocode-report.md` shows the tier mix and both curation queues.
- The pre-existing app behaviour is unchanged for the 125 crawl-located routes: same coordinates, now labelled `crawl`.
- Plan 2 can derive the tile bbox from `data/route-locations.json`; Plan 3 can render provenance from `routes-index.json`.

## What this plan deliberately does not do

- **No app UI changes.** Provenance reaches `routes-index.json` and stops there; rendering it (hollow pins, uncertainty circles, wording on route pages) is Plan 3.
- **No tile changes.** The bbox derivation and `places` layer are Plan 2.
- **No curation.** The tool produces the queues; filling `geocode-overrides.json` is a data task to do while reading the report, and it needs no code change.
