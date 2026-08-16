# Phase 4d — Route Geometry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** draw each route's own line where it can be defended — from an OSM hiking relation, or from an ordered walk through the paths its description names — and remove the whole-name highlight that stands in for one today.

**Architecture:** A new hand-run Python tool, `tools/routelines/`, reads the osmium export that `tools/geocode` already depends on, builds a walking graph, and writes a committed `data/route-lines.geojson` plus a review report. `app/scripts/transform.ts` copies that file into `app/static/data/` and merges two flags onto the route index. The app declares an empty `route-lines` GeoJSON source in the shared style, fills it lazily on the first selection that has a line, and filters two line layers to the selected route.

**Tech Stack:** Python 3 + pytest (tools), TypeScript + Svelte 5 runes + Vitest (app), MapLibre GL v6, Playwright (e2e), osmium-tool in WSL (extraction only).

**Spec:** `docs/superpowers/specs/2026-08-16-phase4d-route-geometry-design.md`

## Global Constraints

- **Right or absent.** A route gets a line only if it passes its tier's gate. A failing route keeps its pin and draws nothing. Never emit a "best effort" line.
- **Gate constants**, exact values: snap radius **250 m**; single connector maximum **500 m**; connectors **≤ 20 %** of total line length; total length ceiling **40 000 m**.
- **Coordinates are rounded to 7 decimal places** before being used as a graph node key. Verified at design time: consecutive members of *Platteklip Gorge* share an endpoint at 3 of 3 joins, *India Venster* at 4 of 4.
- **Coordinate order is `(lon, lat)`** everywhere in the Python tool and in GeoJSON, matching `tools/geocode/kaap_geocode/features.py`.
- **Unit tests must pass with no OSM extract and no tiles present.** CI runs `npm test` and `npm run check` *before* it downloads the tiles release. Never write a test that requires `work/*.geojsonl` or a `.pmtiles` file.
- **No tile rebuild, no new release asset, no change to `TILES_TAG`.** Route lines ship as a GeoJSON overlay.
- **Route ids** come from `route_id(area, slug)` in `tools/geocode/kaap_geocode/ids.py` and `routeId()` in `app/src/lib/data/ids.ts`. Never construct an id by hand.
- **Commit messages** describe what the change does for the map, in the voice of the existing log (`git log --oneline`). Never add a `Co-Authored-By: Claude` trailer.
- **Python style:** `from __future__ import annotations`, frozen dataclasses, module docstrings that say *why*, matching `tools/geocode/kaap_geocode/`.

---

## File Structure

**Created — `tools/routelines/` (Python, hand-run):**

| file | responsibility |
|---|---|
| `pytest.ini` | `testpaths = tests`, `pythonpath = . tests` — copied from `tools/geocode/pytest.ini` |
| `README.md` | how to run it, and that it needs WSL only for the extract step |
| `kaap_routelines/__init__.py` | one-line docstring |
| `kaap_routelines/geo.py` | haversine distance, polyline length, node keys |
| `kaap_routelines/ways.py` | read osmium GeoJSON-seq into `Way` records |
| `kaap_routelines/graph.py` | adjacency over node keys, connected components, Dijkstra |
| `kaap_routelines/relations.py` | read route relations, stitch members into parts |
| `kaap_routelines/trails.py` | a named trail's ways — from a relation if one exists, else name-tagged — and its connected runs |
| `kaap_routelines/walk.py` | the ordered corridor walk and its gate |
| `kaap_routelines/report.py` | the review report |
| `kaap_routelines/cli.py` | entry point; writes `data/route-lines.geojson` |
| `tests/test_*.py` | one test module per source module |

**Created — data (committed):**

- `data/route-relations.json` — hand-confirmed route id → relation id
- `data/route-lines.geojson` — the deliverable
- `data/route-lines-report.md` — the review report

**Created — app:**

- `app/src/lib/map/route-lines.ts` + `route-lines.test.ts` — layer ids, filter, paint, bounds

**Modified:**

- `tools/geocode/extract-osm-features.sh` — also keep and export `r/type=route`
- `tools/geocode/kaap_geocode/match.py` — connected same-named ways are a match, not an ambiguity
- `tools/geocode/kaap_geocode/features.py` — carry the geometry needed to judge connectedness
- `app/src/lib/data/types.ts` — `hasLine`, `lineSource`
- `app/scripts/transform.ts` — merge the flags, copy the GeoJSON into `static/data/`
- `app/src/lib/map/style.ts` — remove three layers, add a source and two layers
- `app/src/lib/components/MapView.svelte` — fetch, filter, frame
- `app/src/lib/components/LocatorMap.svelte` — same line on the route page
- `app/src/lib/components/ProvenanceNote.svelte` — say how the line is known
- `app/src/routes/route/[id]/+page.svelte` — pass the line through
- `app/e2e/map.spec.ts` — rendering assertions

---

## Task 1: The geometry primitives

**Files:**
- Create: `tools/routelines/pytest.ini`, `tools/routelines/kaap_routelines/__init__.py`, `tools/routelines/kaap_routelines/geo.py`
- Test: `tools/routelines/tests/test_geo.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `Point = tuple[float, float]` (lon, lat); `NodeKey = tuple[float, float]`; `node_key(point: Point) -> NodeKey`; `haversine_m(a: Point, b: Point) -> float`; `length_m(coords: Sequence[Point]) -> float`.

- [ ] **Step 1: Create the package skeleton**

`tools/routelines/pytest.ini`:

```ini
[pytest]
testpaths = tests
pythonpath = . tests
```

`tools/routelines/kaap_routelines/__init__.py`:

```python
"""Derive each KaapSpoor route's own line from OpenStreetMap ways."""
```

Create the empty directory `tools/routelines/tests/`.

- [ ] **Step 2: Write the failing test**

`tools/routelines/tests/test_geo.py`:

```python
from kaap_routelines.geo import haversine_m, length_m, node_key


def test_node_key_rounds_to_seven_places():
    # Two ways meeting at a shared OSM node export the same rounded coordinate.
    # This rounding IS the join key for the whole graph; if it drifts, the graph
    # silently falls apart into singletons.
    assert node_key((18.4012345678, -33.9587654321)) == (18.4012346, -33.9587654)


def test_node_key_separates_genuinely_different_nodes():
    assert node_key((18.4012346, -33.9587654)) != (18.4012347, -33.9587654)


def test_haversine_matches_a_known_distance():
    # One degree of latitude is ~111.2 km anywhere on the globe.
    d = haversine_m((18.4, -34.0), (18.4, -33.0))
    assert 110_000 < d < 112_000


def test_length_m_sums_the_segments():
    coords = [(18.4, -34.0), (18.4, -33.99), (18.4, -33.98)]
    assert length_m(coords) == round(2 * haversine_m((18.4, -34.0), (18.4, -33.99)), 6)


def test_length_m_of_a_single_point_is_zero():
    assert length_m([(18.4, -34.0)]) == 0.0
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd tools/routelines && python -m pytest tests/test_geo.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'kaap_routelines.geo'`

- [ ] **Step 4: Write the implementation**

`tools/routelines/kaap_routelines/geo.py`:

```python
"""Distances and node keys.

The node key is the load-bearing piece. OSM ways that meet genuinely share a
node, and osmium's GeoJSON export writes the same rounded coordinate on both
sides of it — so rounding to the export's own precision and comparing exactly
is a sound join, where a floating-point equality on raw values would not be.
Seven places is ~1 cm; two distinct OSM nodes are never that close in practice.
"""

from __future__ import annotations

from math import asin, cos, radians, sin, sqrt
from typing import Sequence

Point = tuple[float, float]  # (lon, lat), as GeoJSON and osmium write it
NodeKey = tuple[float, float]

_PLACES = 7
_EARTH_RADIUS_M = 6_371_008.8  # mean radius; the region spans ~40 km


def node_key(point: Point) -> NodeKey:
    return (round(point[0], _PLACES), round(point[1], _PLACES))


def haversine_m(a: Point, b: Point) -> float:
    lon1, lat1 = radians(a[0]), radians(a[1])
    lon2, lat2 = radians(b[0]), radians(b[1])
    h = sin((lat2 - lat1) / 2) ** 2 + cos(lat1) * cos(lat2) * sin((lon2 - lon1) / 2) ** 2
    return 2 * _EARTH_RADIUS_M * asin(sqrt(h))


def length_m(coords: Sequence[Point]) -> float:
    # Rounded so that a length computed two different ways (summed once, or
    # summed per-segment and added) compares equal — lengths are reported and
    # compared against the gate thresholds, and float noise there is noise in
    # the report.
    return round(sum(haversine_m(a, b) for a, b in zip(coords, coords[1:])), 6)
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd tools/routelines && python -m pytest tests/test_geo.py -v`
Expected: PASS, 5 tests

- [ ] **Step 6: Commit**

```bash
git add tools/routelines
git commit -m "feat(routelines): measure the ground, and key the nodes that join two ways"
```

---

## Task 2: Reading ways, and the graph they form

**Files:**
- Create: `tools/routelines/kaap_routelines/ways.py`, `tools/routelines/kaap_routelines/graph.py`
- Test: `tools/routelines/tests/test_ways.py`, `tools/routelines/tests/test_graph.py`

**Interfaces:**
- Consumes: `Point`, `NodeKey`, `node_key`, `length_m` from Task 1.
- Produces: `Way(osm_id: int, name: str | None, coords: tuple[Point, ...])` with properties `.start`, `.end`, `.length_m`; `read_ways(path: Path) -> list[Way]`; `Graph` with `.adjacency: dict[NodeKey, list[Way]]`, `.components() -> list[set[NodeKey]]`, `.shortest_path(start: NodeKey, targets: set[NodeKey]) -> PathResult | None`; `PathResult(ways: tuple[Way, ...], end: NodeKey, length_m: float)`; `build_graph(ways: Iterable[Way]) -> Graph`.

- [ ] **Step 1: Write the failing test for reading ways**

`tools/routelines/tests/test_ways.py`:

```python
import json
from pathlib import Path

from kaap_routelines.ways import Way, read_ways

WALKABLE = {"path", "footway", "track", "steps"}


def _line(tmp_path: Path, features: list[dict]) -> Path:
    p = tmp_path / "paths.geojsonl"
    p.write_text("\n".join(json.dumps(f) for f in features) + "\n", encoding="utf-8")
    return p


def _feature(way_id: int, coords: list[list[float]], **props) -> dict:
    return {
        "type": "Feature",
        "properties": {"@id": f"w{way_id}", "highway": "path", **props},
        "geometry": {"type": "LineString", "coordinates": coords},
    }


def test_reads_id_name_and_coordinates(tmp_path):
    path = _line(tmp_path, [_feature(1, [[18.4, -34.0], [18.41, -34.0]], name="Pipe Track")])
    ways = read_ways(path)
    assert ways == [Way(osm_id=1, name="Pipe Track", coords=((18.4, -34.0), (18.41, -34.0)))]


def test_keeps_unnamed_ways(tmp_path):
    # The opposite of tools/geocode's reader, which drops them: an unnamed way
    # is exactly the connector that makes a fragmented trail continuous, and
    # dropping them is why name-matching alone leaves the map patchy.
    path = _line(tmp_path, [_feature(2, [[18.4, -34.0], [18.41, -34.0]])])
    assert read_ways(path)[0].name is None


def test_ignores_non_walkable_highways(tmp_path):
    path = _line(tmp_path, [_feature(3, [[18.4, -34.0], [18.41, -34.0]], highway="motorway")])
    assert read_ways(path) == []


def test_ignores_a_way_with_fewer_than_two_points(tmp_path):
    path = _line(tmp_path, [_feature(4, [[18.4, -34.0]])])
    assert read_ways(path) == []


def test_start_end_and_length(tmp_path):
    way = Way(osm_id=5, name=None, coords=((18.4, -34.0), (18.4, -33.99)))
    assert way.start == (18.4, -34.0)
    assert way.end == (18.4, -33.99)
    assert way.length_m > 1000
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd tools/routelines && python -m pytest tests/test_ways.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'kaap_routelines.ways'`

- [ ] **Step 3: Implement the reader**

`tools/routelines/kaap_routelines/ways.py`:

```python
"""Read osmium's GeoJSON-seq export into walkable ways.

Unlike tools/geocode/kaap_geocode/features.py this KEEPS unnamed ways. A trail
in OSM is named on some segments and not on others, and the unnamed ones are
precisely the connectors that make it continuous — dropping them is what makes
a name-matched highlight look broken.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from .geo import Point, length_m

#: Ways a walker can use. `steps` and `track` matter for connectivity even
#: where a route would not be described as following them.
WALKABLE_HIGHWAYS = frozenset({"path", "footway", "track", "steps"})


@dataclass(frozen=True)
class Way:
    osm_id: int
    name: str | None
    coords: tuple[Point, ...]

    @property
    def start(self) -> Point:
        return self.coords[0]

    @property
    def end(self) -> Point:
        return self.coords[-1]

    @property
    def length_m(self) -> float:
        return length_m(self.coords)


def _osm_id(raw: dict) -> int:
    unique_id = str((raw.get("properties") or {}).get("@id") or raw.get("id") or "")
    digits = unique_id[1:]
    return int(digits) if digits.isdigit() else 0


def read_ways(path: Path) -> list[Way]:
    ways: list[Way] = []
    with open(path, encoding="utf-8") as handle:
        for line in handle:
            line = line.strip().lstrip("\x1e")  # geojsonseq may use RS separators
            if not line:
                continue
            raw = json.loads(line)
            properties = raw.get("properties") or {}
            if properties.get("highway") not in WALKABLE_HIGHWAYS:
                continue
            geometry = raw.get("geometry") or {}
            if geometry.get("type") != "LineString":
                continue
            coords = tuple((float(c[0]), float(c[1])) for c in geometry.get("coordinates") or [])
            if len(coords) < 2:
                continue
            name = (properties.get("name") or "").strip() or None
            ways.append(Way(osm_id=_osm_id(raw), name=name, coords=coords))
    return ways
```

`length_m` is a plain `property`, not `functools.cached_property` — a frozen dataclass blocks the attribute write a cached property needs. These are thousands of ways, not millions; recomputing is cheap.

- [ ] **Step 4: Run it to verify it passes**

Run: `cd tools/routelines && python -m pytest tests/test_ways.py -v`
Expected: PASS, 5 tests

- [ ] **Step 5: Write the failing test for the graph**

`tools/routelines/tests/test_graph.py`:

```python
from kaap_routelines.graph import build_graph
from kaap_routelines.geo import node_key
from kaap_routelines.ways import Way

A = (18.400, -34.000)
B = (18.410, -34.000)
C = (18.420, -34.000)
FAR = (18.500, -34.000)


def w(osm_id: int, *points, name=None) -> Way:
    return Way(osm_id=osm_id, name=name, coords=tuple(points))


def test_two_ways_meeting_at_a_node_are_one_component():
    # THE load-bearing assumption of this whole tier. If the join key ever
    # stops working, the graph shatters into singletons and every stitched
    # route silently disappears — with no error anywhere.
    graph = build_graph([w(1, A, B), w(2, B, C)])
    assert len(graph.components()) == 1


def test_ways_that_do_not_meet_are_separate_components():
    graph = build_graph([w(1, A, B), w(2, FAR, (18.51, -34.0))])
    assert len(graph.components()) == 2


def test_shortest_path_walks_across_a_join():
    graph = build_graph([w(1, A, B), w(2, B, C)])
    result = graph.shortest_path(node_key(A), {node_key(C)})
    assert result is not None
    assert [way.osm_id for way in result.ways] == [1, 2]
    assert result.end == node_key(C)
    assert result.length_m > 0


def test_shortest_path_prefers_the_shorter_of_two_routes():
    # A->C directly, or A->B->C the long way round.
    direct = w(3, A, C)
    graph = build_graph([w(1, A, (18.405, -34.05)), w(2, (18.405, -34.05), C), direct])
    result = graph.shortest_path(node_key(A), {node_key(C)})
    assert result is not None
    assert [way.osm_id for way in result.ways] == [3]


def test_shortest_path_returns_none_when_unreachable():
    graph = build_graph([w(1, A, B), w(2, FAR, (18.51, -34.0))])
    assert graph.shortest_path(node_key(A), {node_key(FAR)}) is None


def test_shortest_path_to_the_start_is_empty_and_free():
    graph = build_graph([w(1, A, B)])
    result = graph.shortest_path(node_key(A), {node_key(A)})
    assert result is not None
    assert result.ways == ()
    assert result.length_m == 0.0


def test_nearest_node_within_radius():
    graph = build_graph([w(1, A, B)])
    # ~90 m east of A at this latitude.
    assert graph.nearest_node((18.401, -34.000), 250) == node_key(A)


def test_nearest_node_returns_none_beyond_the_radius():
    graph = build_graph([w(1, A, B)])
    assert graph.nearest_node((18.500, -34.000), 250) is None
```

- [ ] **Step 6: Run it to verify it fails**

Run: `cd tools/routelines && python -m pytest tests/test_graph.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'kaap_routelines.graph'`

- [ ] **Step 7: Implement the graph**

`tools/routelines/kaap_routelines/graph.py`:

```python
"""A walking graph over OSM ways.

Nodes are rounded coordinates (see geo.node_key), not OSM node ids: osmium's
GeoJSON export does not carry node ids, and ways that meet genuinely share the
coordinate. Edges are whole ways, traversable from either end — a way is a
segment between junctions in this data, so splitting them further buys nothing.
"""

from __future__ import annotations

import heapq
from dataclasses import dataclass
from typing import Iterable

from .geo import NodeKey, Point, haversine_m, node_key
from .ways import Way


@dataclass(frozen=True)
class PathResult:
    ways: tuple[Way, ...]
    end: NodeKey
    length_m: float


class Graph:
    def __init__(self, adjacency: dict[NodeKey, list[Way]]) -> None:
        self.adjacency = adjacency

    def nodes_of(self, way: Way) -> tuple[NodeKey, NodeKey]:
        return node_key(way.start), node_key(way.end)

    def other_end(self, way: Way, node: NodeKey) -> NodeKey:
        start, end = self.nodes_of(way)
        return end if node == start else start

    def components(self) -> list[set[NodeKey]]:
        seen: set[NodeKey] = set()
        found: list[set[NodeKey]] = []
        for node in self.adjacency:
            if node in seen:
                continue
            stack = [node]
            group: set[NodeKey] = set()
            while stack:
                current = stack.pop()
                if current in group:
                    continue
                group.add(current)
                for way in self.adjacency.get(current, ()):
                    stack.append(self.other_end(way, current))
            seen |= group
            found.append(group)
        return found

    def nearest_node(self, point: Point, radius_m: float) -> NodeKey | None:
        best: NodeKey | None = None
        best_d = radius_m
        for node in self.adjacency:
            d = haversine_m(point, node)
            if d <= best_d:
                best, best_d = node, d
        return best

    def shortest_path(self, start: NodeKey, targets: set[NodeKey]) -> PathResult | None:
        """Dijkstra from `start` to whichever of `targets` is cheapest."""
        if start in targets:
            return PathResult(ways=(), end=start, length_m=0.0)
        # (cost, counter, node, ways-so-far). The counter keeps heapq from ever
        # comparing the Way tuples when costs tie — Way is not orderable.
        counter = 0
        queue: list[tuple[float, int, NodeKey, tuple[Way, ...]]] = [(0.0, counter, start, ())]
        best: dict[NodeKey, float] = {start: 0.0}
        while queue:
            cost, _, node, taken = heapq.heappop(queue)
            if node in targets:
                return PathResult(ways=taken, end=node, length_m=cost)
            if cost > best.get(node, float("inf")):
                continue
            for way in self.adjacency.get(node, ()):
                nxt = self.other_end(way, node)
                nxt_cost = cost + way.length_m
                if nxt_cost < best.get(nxt, float("inf")):
                    best[nxt] = nxt_cost
                    counter += 1
                    heapq.heappush(queue, (nxt_cost, counter, nxt, (*taken, way)))
        return None


def build_graph(ways: Iterable[Way]) -> Graph:
    adjacency: dict[NodeKey, list[Way]] = {}
    for way in ways:
        start, end = node_key(way.start), node_key(way.end)
        adjacency.setdefault(start, []).append(way)
        # A closed loop would otherwise list itself twice from one node.
        if end != start:
            adjacency.setdefault(end, []).append(way)
    return Graph(adjacency)
```

- [ ] **Step 8: Run both test modules**

Run: `cd tools/routelines && python -m pytest tests/ -v`
Expected: PASS, 13 tests

- [ ] **Step 9: Commit**

```bash
git add tools/routelines
git commit -m "feat(routelines): build a walking graph, connectors and all"
```

---

## Task 3: Relations, stitched into lines

**Files:**
- Create: `tools/routelines/kaap_routelines/relations.py`
- Modify: `tools/geocode/extract-osm-features.sh`
- Test: `tools/routelines/tests/test_relations.py`

**Interfaces:**
- Consumes: `Point` (Task 1), `Way` (Task 2).
- Produces: `Member(way: Way, role: str)`; `Relation(osm_id: int, name: str, members: tuple[Member, ...])`; `read_relations(path: Path) -> list[Relation]`; `stitch(relation: Relation) -> StitchedRelation`; `StitchedRelation(parts: tuple[tuple[Point, ...], ...], way_ids: tuple[int, ...], joined: bool)`.

- [ ] **Step 1: Teach the extract script to keep relations**

Modify `tools/geocode/extract-osm-features.sh`. In the `osmium tags-filter` call, add the relation filter:

```bash
osmium tags-filter --overwrite "$OUT_DIR/clipped.osm.pbf" \
  n/natural=peak,saddle \
  nw/natural=ridge,arete,cliff,valley,gorge,water,bay,beach,cape \
  w/waterway=stream,river \
  w/highway=path \
  nwr/leisure=nature_reserve \
  nwr/boundary=protected_area \
  nwr/protect_class \
  -o "$OUT_DIR/filtered.osm.pbf"
```

becomes:

```bash
osmium tags-filter --overwrite "$OUT_DIR/clipped.osm.pbf" \
  n/natural=peak,saddle \
  nw/natural=ridge,arete,cliff,valley,gorge,water,bay,beach,cape \
  w/waterway=stream,river \
  w/highway=path \
  nwr/leisure=nature_reserve \
  nwr/boundary=protected_area \
  nwr/protect_class \
  -o "$OUT_DIR/filtered.osm.pbf"

# Phase 4d needs two more exports from the same clip, and they are separate
# files because they answer different questions. `walkable-ways` is every way a
# person can walk — INCLUDING the unnamed connectors the name filter above
# drops, which are exactly what makes a fragmented trail continuous. Sharing
# one clipped PBF keeps every tier reading the same OSM snapshot; two Overpass
# fetches on different dates would diverge silently.
echo "==> filtering to walkable ways"
osmium tags-filter --overwrite "$OUT_DIR/clipped.osm.pbf" \
  w/highway=path,footway,track,steps \
  -o "$OUT_DIR/walkable.osm.pbf"
osmium export --overwrite "$OUT_DIR/walkable.osm.pbf" \
  -f geojsonseq --add-unique-id=type_id \
  -o "$OUT_DIR/walkable-ways.geojsonl"

# Hiking route relations: an ordered, mapper-authored member list, which is the
# highest-confidence route geometry available anywhere in this pipeline.
#
# NOT `osmium export`. That writes a relation as a MultiLineString and drops
# both the member WAY IDS and their ROLES on the way through — which would cost
# us the provenance every drawn line has to carry, and the forward/backward
# distinction that keeps an alternative section from being concatenated into a
# line that doubles back. OSM JSON keeps both; the geometry is joined back on
# by way id from walkable-ways.geojsonl above.
#
# -R omits referenced objects: we want the relations themselves, not a second
# copy of every member way.
echo "==> filtering to hiking route relations"
osmium tags-filter --overwrite -R "$OUT_DIR/clipped.osm.pbf" \
  r/type=route \
  -o "$OUT_DIR/routes.osm.pbf"
osmium cat --overwrite "$OUT_DIR/routes.osm.pbf" \
  -f json \
  -o "$OUT_DIR/route-relations.json"
```

`osmium cat -f json` needs osmium-tool ≥ 1.13 (Ubuntu 22.04 ships 1.14). Check with `osmium --version` before running; if it is older, `sudo apt install osmium-tool` from a newer release rather than falling back to another format — the reader below expects OSM JSON.

Also update the script's closing `echo` block to report all three outputs:

```bash
echo "==> wrote $OUT ($(wc -l < "$OUT") features before the name filter)"
echo "==> wrote $OUT_DIR/walkable-ways.geojsonl ($(wc -l < "$OUT_DIR/walkable-ways.geojsonl") ways)"
echo "==> wrote $OUT_DIR/route-relations.json"
```

- [ ] **Step 2: Write the failing test**

`tools/routelines/tests/test_relations.py`:

```python
import json
from pathlib import Path

from kaap_routelines.relations import Member, Relation, read_relations, stitch
from kaap_routelines.ways import Way

# `read_relations` needs a way lookup, since geometry is joined on by id from
# the walkable-ways export rather than carried by the relation file itself.

A = (18.400, -34.000)
B = (18.410, -34.000)
C = (18.420, -34.000)
FAR = (18.500, -34.000)


def w(osm_id: int, *points) -> Way:
    return Way(osm_id=osm_id, name=None, coords=tuple(points))


def rel(*members: Member, name="Test Route", osm_id=99) -> Relation:
    return Relation(osm_id=osm_id, name=name, members=tuple(members))


def test_members_joining_end_to_start_make_one_part():
    result = stitch(rel(Member(w(1, A, B), ""), Member(w(2, B, C), "")))
    assert result.joined is True
    assert result.parts == (((18.400, -34.000), (18.410, -34.000), (18.420, -34.000)),)
    assert result.way_ids == (1, 2)


def test_a_member_recorded_backwards_is_reversed_to_join():
    # Mappers add members in walking order but a way's own direction is
    # arbitrary, so the second way here runs C->B. Refusing to flip it would
    # report a perfectly good relation as broken.
    result = stitch(rel(Member(w(1, A, B), ""), Member(w(2, C, B), "")))
    assert result.joined is True
    assert result.parts[0][-1] == C


def test_members_that_do_not_touch_stay_separate_parts():
    result = stitch(rel(Member(w(1, A, B), ""), Member(w(2, FAR, (18.51, -34.0)), "")))
    assert result.joined is False
    assert len(result.parts) == 2


def test_forward_and_backward_roles_are_emitted_as_their_own_parts():
    # Two of the region's relations use these roles for alternative or
    # directional sections. Concatenating them draws a line that doubles back
    # on itself, which is a shape the hike does not have.
    result = stitch(
        rel(
            Member(w(1, A, B), ""),
            Member(w(2, B, C), "forward"),
            Member(w(3, B, C), "backward"),
        )
    )
    assert result.joined is False
    assert len(result.parts) == 3
    assert result.way_ids == (1, 2, 3)


def _osm_json(tmp_path, elements) -> Path:
    path = tmp_path / "route-relations.json"
    path.write_text(json.dumps({"version": "0.6", "elements": elements}), encoding="utf-8")
    return path


def _relation_element(osm_id, name, members, route="hiking"):
    return {
        "type": "relation",
        "id": osm_id,
        "tags": {"type": "route", "route": route, "name": name},
        "members": [{"type": "way", "ref": ref, "role": role} for ref, role in members],
    }


def test_reads_members_with_their_ids_and_roles(tmp_path):
    # The ids are the provenance every drawn line has to carry, and the roles
    # are what stops an alternative section being concatenated into the line.
    # osmium's GeoJSON export drops both, which is why this reads OSM JSON.
    path = _osm_json(tmp_path, [
        _relation_element(2934380, "Platteklip Gorge", [(101, ""), (102, "forward")])
    ])
    ways_by_id = {101: w(101, A, B), 102: w(102, B, C)}

    relations = read_relations(path, ways_by_id)
    assert len(relations) == 1
    assert relations[0].osm_id == 2934380
    assert relations[0].name == "Platteklip Gorge"
    assert [(m.way.osm_id, m.role) for m in relations[0].members] == [(101, ""), (102, "forward")]
    assert relations[0].missing == 0


def test_counts_a_member_whose_geometry_is_absent(tmp_path):
    # A member that is not a walkable highway is not in walkable-ways.geojsonl.
    # Counted, not silently dropped: a relation with a hole in it must not be
    # promoted to a route line as though it were complete.
    path = _osm_json(tmp_path, [_relation_element(1, "Gappy", [(101, ""), (999, "")])])
    relations = read_relations(path, {101: w(101, A, B)})
    assert relations[0].missing == 1
    assert len(relations[0].members) == 1


def test_ignores_a_relation_that_is_not_a_hiking_route(tmp_path):
    path = _osm_json(tmp_path, [_relation_element(1, "Bus 104", [(101, "")], route="bus")])
    assert read_relations(path, {101: w(101, A, B)}) == []


def test_ignores_ways_and_nodes_in_the_same_file(tmp_path):
    path = _osm_json(tmp_path, [
        {"type": "way", "id": 101, "nodes": [1, 2], "tags": {"highway": "path"}},
        _relation_element(1, "Real Route", [(101, "")]),
    ])
    assert len(read_relations(path, {101: w(101, A, B)})) == 1
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd tools/routelines && python -m pytest tests/test_relations.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'kaap_routelines.relations'`

- [ ] **Step 4: Implement relations**

`tools/routelines/kaap_routelines/relations.py`:

```python
"""Hiking route relations — the highest-confidence geometry in this pipeline.

A `type=route, route=hiking` relation is an ORDERED member list authored by a
mapper, which is the one thing this project cannot derive: extent. Where a
relation matches a route, its geometry is the route's line.

Relations also serve the stitch tier: a relation names a trail's ways in order
INCLUDING the unnamed connectors, which is why a relation-backed trail is
continuous where a name-matched one is 27 disjoint pieces.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from .geo import Point, node_key
from .ways import Way

#: Roles marking a member as an alternative or a one-way section rather than
#: part of the single continuous line. Sampled in this region on Apostles Path
#: and Kasteelspoort.
ALTERNATIVE_ROLES = frozenset({"forward", "backward"})

HIKING_ROUTES = frozenset({"hiking", "foot"})


@dataclass(frozen=True)
class Member:
    way: Way
    role: str


@dataclass(frozen=True)
class Relation:
    osm_id: int
    name: str
    members: tuple[Member, ...]
    #: Members whose geometry was not in the walkable-ways export. A relation
    #: with any is incomplete, and the CLI refuses to draw it — a line with a
    #: hole in it is not the route.
    missing: int = 0


@dataclass(frozen=True)
class StitchedRelation:
    parts: tuple[tuple[Point, ...], ...]
    way_ids: tuple[int, ...]
    #: True when every plain member joined into exactly one part. False is not
    #: a failure to hide — it is reported, and the caller decides.
    joined: bool


def _elements(raw: object) -> list[dict]:
    """The elements of an OSM JSON document, however osmium framed it."""
    if isinstance(raw, dict):
        return list(raw.get("elements") or [])
    return list(raw) if isinstance(raw, list) else []


def read_relations(path: Path, ways_by_id: dict[int, Way]) -> list[Relation]:
    """Read hiking relations, joining member geometry on by way id.

    The relation file carries ids and roles but no geometry; walkable-ways
    carries geometry keyed by id. Joining them here is what keeps both — an
    `osmium export` of the relations would have dropped the ids and the roles.
    """
    text = path.read_text(encoding="utf-8").strip()
    try:
        raw = json.loads(text)
        elements = _elements(raw)
    except json.JSONDecodeError:
        # Some osmium builds write one JSON object per line rather than a
        # single document. Both are accepted so a version bump cannot silently
        # empty this tier.
        elements = [json.loads(line) for line in text.splitlines() if line.strip()]

    relations: list[Relation] = []
    for element in elements:
        if element.get("type") != "relation":
            continue
        tags = element.get("tags") or {}
        if tags.get("route") not in HIKING_ROUTES:
            continue
        name = (tags.get("name") or "").strip()
        if not name:
            continue
        members: list[Member] = []
        missing = 0
        for member in element.get("members") or []:
            if member.get("type") != "way":
                continue
            way = ways_by_id.get(int(member.get("ref", 0)))
            if way is None:
                missing += 1
                continue
            members.append(Member(way=way, role=str(member.get("role") or "")))
        if members:
            relations.append(
                Relation(
                    osm_id=int(element.get("id", 0)),
                    name=name,
                    members=tuple(members),
                    missing=missing,
                )
            )
    return relations


def _joinable(tail: tuple[Point, ...], candidate: tuple[Point, ...]) -> tuple[Point, ...] | None:
    """`candidate` appended to `tail`, flipped if that is how they meet."""
    end = node_key(tail[-1])
    if node_key(candidate[0]) == end:
        return tail + candidate[1:]
    if node_key(candidate[-1]) == end:
        return tail + tuple(reversed(candidate))[1:]
    return None


def stitch(relation: Relation) -> StitchedRelation:
    parts: list[tuple[Point, ...]] = []
    current: tuple[Point, ...] | None = None
    alternatives: list[tuple[Point, ...]] = []

    for member in relation.members:
        if member.role in ALTERNATIVE_ROLES:
            alternatives.append(member.way.coords)
            continue
        if current is None:
            current = member.way.coords
            continue
        joined = _joinable(current, member.way.coords)
        if joined is None:
            parts.append(current)
            current = member.way.coords
        else:
            current = joined
    if current is not None:
        parts.append(current)

    plain_parts = tuple(parts)
    return StitchedRelation(
        parts=plain_parts + tuple(alternatives),
        way_ids=tuple(m.way.osm_id for m in relation.members),
        joined=len(plain_parts) == 1 and not alternatives,
    )
```

- [ ] **Step 5: Run it to verify it passes**

Run: `cd tools/routelines && python -m pytest tests/test_relations.py -v`
Expected: PASS, 6 tests

- [ ] **Step 6: Commit**

```bash
git add tools/routelines tools/geocode/extract-osm-features.sh
git commit -m "feat(routelines): read the hiking routes a mapper already drew"
```

---

## Task 4: Named trails, and their connected runs

**Files:**
- Create: `tools/routelines/kaap_routelines/trails.py`
- Test: `tools/routelines/tests/test_trails.py`

**Interfaces:**
- Consumes: `Way` (Task 2), `Graph`/`build_graph` (Task 2), `Relation`/`stitch` (Task 3).
- Produces: `Trail(name: str, ways: tuple[Way, ...], source: str)` where `source` is `"relation"` or `"name"`; `build_trails(ways, relations) -> dict[str, Trail]`; `runs(trail: Trail) -> list[tuple[Way, ...]]` — the trail's ways grouped into connected runs.

- [ ] **Step 1: Write the failing test**

`tools/routelines/tests/test_trails.py`:

```python
from kaap_routelines.relations import Member, Relation
from kaap_routelines.trails import build_trails, runs
from kaap_routelines.ways import Way

A = (18.400, -34.000)
B = (18.410, -34.000)
C = (18.420, -34.000)
FAR = (18.500, -34.000)
FAR2 = (18.510, -34.000)


def w(osm_id: int, *points, name=None) -> Way:
    return Way(osm_id=osm_id, name=name, coords=tuple(points))


def test_a_trail_is_built_from_ways_carrying_the_name():
    trails = build_trails([w(1, A, B, name="Pipe Track"), w(2, B, C)], [])
    assert set(trails) == {"Pipe Track"}
    assert trails["Pipe Track"].source == "name"
    assert [way.osm_id for way in trails["Pipe Track"].ways] == [1]


def test_a_relation_supplies_the_trail_instead_and_brings_its_connectors():
    # The whole point: way 2 carries no name, so name-matching cannot see it,
    # and the trail is two disjoint pieces with a hole in the middle. The
    # relation lists it, so the relation-backed trail is continuous.
    named_a = w(1, A, B, name="Contour Path")
    connector = w(2, B, C)
    named_b = w(3, C, (18.430, -34.0), name="Contour Path")
    relation = Relation(
        osm_id=2934370,
        name="Contour Path",
        members=(Member(named_a, ""), Member(connector, ""), Member(named_b, "")),
    )
    trails = build_trails([named_a, connector, named_b], [relation])
    trail = trails["Contour Path"]
    assert trail.source == "relation"
    assert [way.osm_id for way in trail.ways] == [1, 2, 3]
    assert len(runs(trail)) == 1


def test_a_name_matched_trail_reports_its_disjoint_runs():
    trails = build_trails(
        [w(1, A, B, name="Ledges"), w(2, FAR, FAR2, name="Ledges")], []
    )
    assert len(runs(trails["Ledges"])) == 2


def test_runs_of_a_connected_trail_is_one_run():
    trails = build_trails([w(1, A, B, name="X"), w(2, B, C, name="X")], [])
    assert len(runs(trails["X"])) == 1
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd tools/routelines && python -m pytest tests/test_trails.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'kaap_routelines.trails'`

- [ ] **Step 3: Implement trails**

`tools/routelines/kaap_routelines/trails.py`:

```python
"""A named trail: the ways that make it up, and whether they actually join.

Relations win over name tags. A trail named in OSM is named on some of its
segments and not on others — Contour Path is 27 features in the tiles — so a
name-matched trail has holes exactly where the connectors are. A relation lists
those connectors, so it defines the trail properly. Where no relation carries a
name, the name-tagged ways are all we have, and `runs()` says how broken they
are rather than pretending otherwise.
"""

from __future__ import annotations

from dataclasses import dataclass

from .graph import build_graph
from .geo import node_key
from .relations import Relation
from .ways import Way


@dataclass(frozen=True)
class Trail:
    name: str
    ways: tuple[Way, ...]
    #: "relation" or "name" — reported, so a reader can tell which evidence
    #: a drawn line rests on.
    source: str


def build_trails(ways: list[Way], relations: list[Relation]) -> dict[str, Trail]:
    by_name: dict[str, list[Way]] = {}
    for way in ways:
        if way.name:
            by_name.setdefault(way.name, []).append(way)

    trails: dict[str, Trail] = {
        name: Trail(name=name, ways=tuple(group), source="name")
        for name, group in by_name.items()
    }
    # Relations overwrite, deliberately: where both exist the relation is the
    # better answer, and a name-matched trail of the same name is a subset of
    # it with the connectors missing.
    for relation in relations:
        members = tuple(m.way for m in relation.members)
        if members:
            trails[relation.name] = Trail(
                name=relation.name, ways=members, source="relation"
            )
    return trails


def runs(trail: Trail) -> list[tuple[Way, ...]]:
    """The trail's ways grouped into connected runs, longest first."""
    graph = build_graph(trail.ways)
    components = graph.components()
    grouped: list[tuple[Way, ...]] = []
    for component in components:
        members = tuple(
            way for way in trail.ways if node_key(way.start) in component
        )
        if members:
            grouped.append(members)
    grouped.sort(key=lambda group: sum(way.length_m for way in group), reverse=True)
    return grouped
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd tools/routelines && python -m pytest tests/test_trails.py -v`
Expected: PASS, 4 tests

- [ ] **Step 5: Commit**

```bash
git add tools/routelines
git commit -m "feat(routelines): let a relation define a trail its name tags leave in pieces"
```

---

## Task 5: The ordered corridor walk, and its gate

**Files:**
- Create: `tools/routelines/kaap_routelines/walk.py`
- Test: `tools/routelines/tests/test_walk.py`

**Interfaces:**
- Consumes: everything above.
- Produces: `SNAP_RADIUS_M`, `MAX_CONNECTOR_M`, `MAX_CONNECTOR_FRACTION`, `MAX_TOTAL_M`; `WalkResult(coords: tuple[Point, ...], way_ids: tuple[int, ...], length_m: float, connector_m: float)`; `Rejected(reason: str)`; `walk_route(anchor: Point, names: list[str], trails: dict[str, Trail], graph: Graph) -> WalkResult | Rejected`.

- [ ] **Step 1: Write the failing test**

`tools/routelines/tests/test_walk.py`:

```python
from kaap_routelines.graph import build_graph
from kaap_routelines.trails import build_trails
from kaap_routelines.walk import Rejected, WalkResult, walk_route
from kaap_routelines.ways import Way

# A west-to-east chain of nodes ~90 m apart at this latitude.
P = [(18.400 + 0.001 * i, -34.000) for i in range(12)]


def w(osm_id: int, a, b, name=None) -> Way:
    return Way(osm_id=osm_id, name=name, coords=(a, b))


def _world(ways):
    trails = build_trails(ways, [])
    return trails, build_graph(ways)


def test_walks_two_named_trails_in_prose_order():
    ways = [
        w(1, P[0], P[1], name="First Path"),
        w(2, P[1], P[2], name="First Path"),
        w(3, P[2], P[3], name="Second Path"),
    ]
    trails, graph = _world(ways)
    result = walk_route(P[0], ["First Path", "Second Path"], trails, graph)
    assert isinstance(result, WalkResult)
    assert result.way_ids == (1, 2, 3)
    assert result.coords[0] == P[0]
    assert result.coords[-1] == P[3]


def test_follows_a_trail_to_its_far_end_rather_than_clipping_its_corner():
    # The route joins First Path at its start and must walk its whole length,
    # not touch it and leave. This is the difference between a route and a
    # shortest path that happens to graze one.
    ways = [
        w(1, P[0], P[1], name="First Path"),
        w(2, P[1], P[2], name="First Path"),
        w(3, P[2], P[3], name="Second Path"),
    ]
    trails, graph = _world(ways)
    result = walk_route(P[0], ["First Path", "Second Path"], trails, graph)
    assert isinstance(result, WalkResult)
    assert 2 in result.way_ids


def test_an_unnamed_connector_bridges_a_gap():
    ways = [
        w(1, P[0], P[1], name="First Path"),
        w(2, P[1], P[2]),  # unnamed connector
        w(3, P[2], P[3], name="Second Path"),
    ]
    trails, graph = _world(ways)
    result = walk_route(P[0], ["First Path", "Second Path"], trails, graph)
    assert isinstance(result, WalkResult)
    assert result.connector_m > 0
    assert 2 in result.way_ids


def test_a_long_connector_is_rejected_by_the_fraction_cap():
    # 8 unnamed segments between two short named ones: the walk is mostly
    # unrelated trail, which is evidence the prose order was not a route order.
    ways = [w(1, P[0], P[1], name="First Path")]
    ways += [w(10 + i, P[1 + i], P[2 + i]) for i in range(8)]
    ways += [w(2, P[9], P[10], name="Second Path")]
    trails, graph = _world(ways)
    result = walk_route(P[0], ["First Path", "Second Path"], trails, graph)
    assert isinstance(result, Rejected)
    assert "connector" in result.reason


def test_an_anchor_far_from_any_path_is_rejected():
    ways = [w(1, P[0], P[1], name="First Path"), w(2, P[1], P[2], name="Second Path")]
    trails, graph = _world(ways)
    result = walk_route((18.6, -34.0), ["First Path", "Second Path"], trails, graph)
    assert isinstance(result, Rejected)
    assert "anchor" in result.reason


def test_an_unreachable_second_trail_is_rejected():
    ways = [
        w(1, P[0], P[1], name="First Path"),
        w(2, (18.7, -34.0), (18.71, -34.0), name="Second Path"),
    ]
    trails, graph = _world(ways)
    result = walk_route(P[0], ["First Path", "Second Path"], trails, graph)
    assert isinstance(result, Rejected)
    assert "reach" in result.reason


def test_a_name_with_no_trail_at_all_is_rejected():
    ways = [w(1, P[0], P[1], name="First Path")]
    trails, graph = _world(ways)
    result = walk_route(P[0], ["First Path", "Nowhere Path"], trails, graph)
    assert isinstance(result, Rejected)
    assert "unknown" in result.reason


def test_a_single_mention_on_one_connected_run_yields_a_line():
    # No ordering claim to get wrong: one trail, identified and located.
    ways = [w(1, P[0], P[1], name="Only Path"), w(2, P[1], P[2], name="Only Path")]
    trails, graph = _world(ways)
    result = walk_route(P[0], ["Only Path"], trails, graph)
    assert isinstance(result, WalkResult)
    assert result.way_ids == (1, 2)


def test_a_single_mention_split_across_disjoint_runs_is_rejected():
    ways = [
        w(1, P[0], P[1], name="Only Path"),
        w(2, (18.7, -34.0), (18.71, -34.0), name="Only Path"),
    ]
    trails, graph = _world(ways)
    result = walk_route(P[0], ["Only Path"], trails, graph)
    assert isinstance(result, Rejected)
    assert "runs" in result.reason


def test_no_names_is_rejected():
    trails, graph = _world([w(1, P[0], P[1], name="First Path")])
    result = walk_route(P[0], [], trails, graph)
    assert isinstance(result, Rejected)
    assert "names" in result.reason
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd tools/routelines && python -m pytest tests/test_walk.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'kaap_routelines.walk'`

- [ ] **Step 3: Implement the walk**

`tools/routelines/kaap_routelines/walk.py`:

```python
"""The ordered corridor walk.

A guidebook describes a route in the order you walk it, and Phase 4e already
extracts the named paths in reading order. That ordering is what supplies
extent: the line starts where the sequence starts and ends where it ends,
instead of covering everything that shares a name.

Every threshold here errs toward rejection. A route rejected costs a pin; a
route accepted wrongly costs trust.
"""

from __future__ import annotations

from dataclasses import dataclass

from .geo import NodeKey, Point, node_key
from .graph import Graph
from .trails import Trail, runs
from .ways import Way

#: How far a route's recorded position may sit from the path network.
SNAP_RADIUS_M = 250.0
#: A single unnamed bridge longer than this is not a connector, it is a walk.
MAX_CONNECTOR_M = 500.0
#: Connectors may be at most this share of the finished line.
MAX_CONNECTOR_FRACTION = 0.20
#: Nothing in this archive is a 40 km day walk on one line.
MAX_TOTAL_M = 40_000.0


@dataclass(frozen=True)
class WalkResult:
    coords: tuple[Point, ...]
    way_ids: tuple[int, ...]
    length_m: float
    connector_m: float


@dataclass(frozen=True)
class Rejected:
    reason: str


def _run_nodes(run: tuple[Way, ...]) -> set[NodeKey]:
    nodes: set[NodeKey] = set()
    for way in run:
        nodes.add(node_key(way.start))
        nodes.add(node_key(way.end))
    return nodes


def _append(coords: list[Point], way: Way, entry: NodeKey) -> NodeKey:
    """Append `way` walked from `entry`, and return the node walked out to."""
    points = way.coords if node_key(way.start) == entry else tuple(reversed(way.coords))
    coords.extend(points[1:] if coords else points)
    return node_key(points[-1])


def walk_route(
    anchor: Point, names: list[str], trails: dict[str, Trail], graph: Graph
) -> WalkResult | Rejected:
    if not names:
        return Rejected("no names: the description names no mapped path")

    chosen: list[tuple[Way, ...]] = []
    for name in names:
        trail = trails.get(name)
        if trail is None:
            return Rejected(f"unknown trail: {name!r} is not in the extract")
        trail_runs = runs(trail)
        if len(names) == 1 and len(trail_runs) > 1:
            return Rejected(
                f"disjoint runs: {name!r} is {len(trail_runs)} unconnected pieces "
                "and there is no second name to order them by"
            )
        chosen.append(trail_runs[0])

    start = graph.nearest_node(anchor, SNAP_RADIUS_M)
    if start is None:
        return Rejected(f"anchor: no path within {SNAP_RADIUS_M:.0f} m of the position")

    coords: list[Point] = []
    way_ids: list[int] = []
    connector_m = 0.0
    current = start

    for index, run in enumerate(chosen):
        # 1. Get to this trail, over whatever lies between. Everything walked
        #    here is a connector: it is not a path the description named.
        approach = graph.shortest_path(current, _run_nodes(run))
        if approach is None:
            return Rejected(f"cannot reach: {names[index]!r} is not connected to the walk so far")
        # Checked before anything is recorded, so a walk with an absurd bridge
        # is abandoned rather than half-built: one long unnamed way between two
        # named paths is not a connector, it is a different walk.
        for way in approach.ways:
            if way.length_m > MAX_CONNECTOR_M:
                return Rejected(
                    f"connector: a single {way.length_m:.0f} m bridge exceeds "
                    f"{MAX_CONNECTOR_M:.0f} m before {names[index]!r}"
                )
        for way in approach.ways:
            current = _append(coords, way, current)
            way_ids.append(way.osm_id)
            connector_m += way.length_m

        # 2. Follow the trail itself to its far end. This is what makes the
        #    line follow a path rather than merely touch it.
        remaining = {way.osm_id: way for way in run}
        while True:
            options = [
                way
                for way in graph.adjacency.get(current, ())
                if way.osm_id in remaining
            ]
            if not options:
                break
            way = max(options, key=lambda candidate: candidate.length_m)
            del remaining[way.osm_id]
            current = _append(coords, way, current)
            way_ids.append(way.osm_id)

    if len(coords) < 2:
        return Rejected("empty: the walk covered no ground")

    from .geo import length_m as measure

    total = measure(coords)
    if total > MAX_TOTAL_M:
        return Rejected(f"too long: {total / 1000:.1f} km exceeds the {MAX_TOTAL_M / 1000:.0f} km ceiling")
    if connector_m > total * MAX_CONNECTOR_FRACTION:
        return Rejected(
            f"connectors: {connector_m:.0f} m of {total:.0f} m is over the "
            f"{MAX_CONNECTOR_FRACTION:.0%} cap"
        )
    return WalkResult(
        coords=tuple(coords),
        way_ids=tuple(way_ids),
        length_m=total,
        connector_m=round(connector_m, 6),
    )
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd tools/routelines && python -m pytest tests/test_walk.py -v`
Expected: PASS, 10 tests

- [ ] **Step 5: Run the whole suite**

Run: `cd tools/routelines && python -m pytest -v`
Expected: PASS, all tests from Tasks 1–5

- [ ] **Step 6: Commit**

```bash
git add tools/routelines
git commit -m "feat(routelines): walk a route in the order its description tells it"
```

---

## Task 6: The CLI, the report, and the yield

**Files:**
- Create: `tools/routelines/kaap_routelines/report.py`, `tools/routelines/kaap_routelines/cli.py`, `tools/routelines/README.md`, `data/route-relations.json`
- Test: `tools/routelines/tests/test_report.py`, `tools/routelines/tests/test_cli.py`

**Interfaces:**
- Consumes: everything above; `route_id` from `tools/geocode/kaap_geocode/ids.py` (copied, not imported — the two tools are separate packages).
- Produces: `data/route-lines.geojson` — a `FeatureCollection` whose features carry `properties: {routeId, source, osmWays, lengthM, connectorM, relation}`; `data/route-lines-report.md`.

- [ ] **Step 1: Create the hand-confirmed mapping, empty**

`data/route-relations.json`:

```json
{
  "comment": "Route id -> OSM hiking relation id, confirmed by hand. The tool proposes candidates in data/route-lines-report.md and refuses to promote any of them on its own: a title containing a relation's name is a question, and this file is the only answer. 'Devil's Peak contour paths' contains 'Contour Path' and is NOT that relation.",
  "confirmed": {}
}
```

- [ ] **Step 2: Write the failing test for the report**

`tools/routelines/tests/test_report.py`:

```python
from kaap_routelines.report import build_report, Outcome, Proposal


def test_lists_accepted_lines_with_their_evidence():
    outcome = Outcome(
        accepted=[
            {"routeId": "a--b--platteklip", "source": "osm-relation", "lengthM": 2400.0,
             "connectorM": 0.0, "ways": 4, "relation": 2934380},
        ],
        rejected=[],
        proposals=[],
    )
    text = build_report(outcome, extract_date="2026-08-16")
    assert "a--b--platteklip" in text
    assert "osm-relation" in text
    assert "2.4 km" in text


def test_states_every_rejection_and_its_reason():
    outcome = Outcome(
        accepted=[],
        rejected=[{"routeId": "a--b--c", "reason": "anchor: no path within 250 m of the position"}],
        proposals=[],
    )
    text = build_report(outcome, extract_date="2026-08-16")
    assert "a--b--c" in text
    assert "no path within 250 m" in text


def test_proposals_are_marked_as_questions_not_answers():
    outcome = Outcome(
        accepted=[],
        rejected=[],
        proposals=[Proposal(route_id="a--b--c", title="Devil's Peak contour paths",
                            relation_id=2934370, relation_name="Contour Path")],
    )
    text = build_report(outcome, extract_date="2026-08-16")
    assert "Contour Path" in text
    assert "data/route-relations.json" in text
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd tools/routelines && python -m pytest tests/test_report.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'kaap_routelines.report'`

- [ ] **Step 4: Implement the report**

`tools/routelines/kaap_routelines/report.py`:

```python
"""The review report — what shipped, what did not, and what needs a human.

Mirrors data/geocode-report.md: every claim this pipeline makes is reviewable,
and a rejection is information rather than a silence.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class Proposal:
    route_id: str
    title: str
    relation_id: int
    relation_name: str


@dataclass
class Outcome:
    accepted: list[dict] = field(default_factory=list)
    rejected: list[dict] = field(default_factory=list)
    proposals: list[Proposal] = field(default_factory=list)


def build_report(outcome: Outcome, extract_date: str) -> str:
    lines = [
        "# Route lines review",
        "",
        f"OSM extract: {extract_date}",
        "",
        f"**{len(outcome.accepted)} routes have a line**; {len(outcome.rejected)} were rejected.",
        "A rejected route keeps its pin and draws nothing, which is the design:",
        "a wrong line is a wrong claim about the mountain.",
        "",
        "## Accepted",
        "",
        "| route | tier | length | connectors | ways | relation |",
        "|---|---|---|---|---|---|",
    ]
    for row in outcome.accepted:
        relation = row.get("relation") or "—"
        lines.append(
            f"| `{row['routeId']}` | {row['source']} | {row['lengthM'] / 1000:.1f} km | "
            f"{row['connectorM'] / 1000:.1f} km | {row['ways']} | {relation} |"
        )

    lines += ["", "## Rejected", "", "| route | reason |", "|---|---|"]
    for row in outcome.rejected:
        lines.append(f"| `{row['routeId']}` | {row['reason']} |")

    lines += [
        "",
        "## Relation candidates awaiting confirmation",
        "",
        "These route titles overlap a relation name. **Each one is a question, not a",
        "match** — add the true ones to `data/route-relations.json` by hand and rerun.",
        "",
        "| route | title | relation | relation name |",
        "|---|---|---|---|",
    ]
    for proposal in outcome.proposals:
        lines.append(
            f"| `{proposal.route_id}` | {proposal.title} | {proposal.relation_id} | "
            f"{proposal.relation_name} |"
        )
    return "\n".join(lines) + "\n"
```

- [ ] **Step 5: Run it to verify it passes**

Run: `cd tools/routelines && python -m pytest tests/test_report.py -v`
Expected: PASS, 3 tests

- [ ] **Step 6: Write the failing test for the CLI**

`tools/routelines/tests/test_cli.py`:

```python
import json

from kaap_routelines.cli import main


def _routes(tmp_path, routes):
    path = tmp_path / "routes.json"
    path.write_text(json.dumps({"generated": "2026-08-16", "routes": routes}), encoding="utf-8")
    return path


def _ways(tmp_path, features):
    path = tmp_path / "walkable-ways.geojsonl"
    path.write_text("\n".join(json.dumps(f) for f in features) + "\n", encoding="utf-8")
    return path


def _way_feature(way_id, coords, name=None):
    props = {"@id": f"w{way_id}", "highway": "path"}
    if name:
        props["name"] = name
    return {"type": "Feature", "properties": props,
            "geometry": {"type": "LineString", "coordinates": coords}}


P = [[18.400 + 0.001 * i, -34.000] for i in range(6)]


def test_writes_a_line_for_a_walkable_route(tmp_path):
    routes = _routes(tmp_path, [{
        "slug": "test-route", "area": ["Area"], "title": "Test Route",
        "coords": {"lat": -34.0, "lon": 18.400, "zoom": 15},
        "sections": {"Route": "Go up First Path then along Second Path."},
    }])
    ways = _ways(tmp_path, [
        _way_feature(1, [P[0], P[1]], "First Path"),
        _way_feature(2, [P[1], P[2]], "Second Path"),
    ])
    out = tmp_path / "route-lines.geojson"
    report = tmp_path / "route-lines-report.md"

    # --relations is pointed at a path that does not exist ON PURPOSE. Left to
    # its default it would read whatever extract the developer's own machine
    # happens to have, and the test would pass or fail on that rather than on
    # the code.
    assert main([
        "--routes", str(routes), "--ways", str(ways), "--out", str(out),
        "--report", str(report), "--relations-map", str(tmp_path / "missing.json"),
        "--relations", str(tmp_path / "no-relations.json"),
    ]) == 0

    payload = json.loads(out.read_text(encoding="utf-8"))
    assert payload["type"] == "FeatureCollection"
    assert len(payload["features"]) == 1
    feature = payload["features"][0]
    assert feature["properties"]["routeId"] == "area--test-route"
    assert feature["properties"]["source"] == "osm-stitch"
    assert feature["geometry"]["type"] == "LineString"


def test_writes_no_feature_for_a_route_that_names_nothing(tmp_path):
    routes = _routes(tmp_path, [{
        "slug": "quiet", "area": ["Area"], "title": "Quiet Route",
        "coords": {"lat": -34.0, "lon": 18.400, "zoom": 15},
        "sections": {"Route": "Wander about a bit."},
    }])
    ways = _ways(tmp_path, [_way_feature(1, [P[0], P[1]], "First Path")])
    out = tmp_path / "route-lines.geojson"
    report = tmp_path / "route-lines-report.md"

    main(["--routes", str(routes), "--ways", str(ways), "--out", str(out),
          "--report", str(report), "--relations-map", str(tmp_path / "missing.json"),
          "--relations", str(tmp_path / "no-relations.json")])

    assert json.loads(out.read_text(encoding="utf-8"))["features"] == []
    assert "Quiet Route" in report.read_text(encoding="utf-8") or "quiet" in report.read_text(encoding="utf-8")


def test_a_confirmed_relation_becomes_the_route_line(tmp_path):
    routes = _routes(tmp_path, [{
        "slug": "platteklip", "area": ["Area"], "title": "Platteklip Gorge",
        "coords": {"lat": -34.0, "lon": 18.400, "zoom": 15},
        "sections": {"Route": "Straight up."},
    }])
    ways = _ways(tmp_path, [_way_feature(101, [P[0], P[1]]), _way_feature(102, [P[1], P[2]])])
    relations = tmp_path / "route-relations.json"
    relations.write_text(json.dumps({"elements": [{
        "type": "relation", "id": 2934380,
        "tags": {"type": "route", "route": "hiking", "name": "Platteklip Gorge"},
        "members": [{"type": "way", "ref": 101, "role": ""}, {"type": "way", "ref": 102, "role": ""}],
    }]}), encoding="utf-8")
    confirmed = tmp_path / "confirmed.json"
    confirmed.write_text(json.dumps({"confirmed": {
        "area--platteklip": {"relation": 2934380, "note": "same ascent"}
    }}), encoding="utf-8")
    out = tmp_path / "route-lines.geojson"

    main(["--routes", str(routes), "--ways", str(ways), "--relations", str(relations),
          "--relations-map", str(confirmed), "--out", str(out),
          "--report", str(tmp_path / "r.md")])

    feature = json.loads(out.read_text(encoding="utf-8"))["features"][0]
    assert feature["properties"]["source"] == "osm-relation"
    assert feature["properties"]["relation"] == 2934380
    # The ids are the whole point of reading OSM JSON rather than a geometry
    # export: a drawn claim has to be re-checkable against OSM.
    assert feature["properties"]["osmWays"] == [101, 102]


def test_a_relation_missing_member_geometry_draws_nothing(tmp_path):
    routes = _routes(tmp_path, [{
        "slug": "gappy", "area": ["Area"], "title": "Gappy",
        "coords": {"lat": -34.0, "lon": 18.400, "zoom": 15}, "sections": {},
    }])
    ways = _ways(tmp_path, [_way_feature(101, [P[0], P[1]])])
    relations = tmp_path / "route-relations.json"
    relations.write_text(json.dumps({"elements": [{
        "type": "relation", "id": 7, "tags": {"type": "route", "route": "hiking", "name": "Gappy"},
        "members": [{"type": "way", "ref": 101, "role": ""}, {"type": "way", "ref": 999, "role": ""}],
    }]}), encoding="utf-8")
    confirmed = tmp_path / "confirmed.json"
    confirmed.write_text(json.dumps({"confirmed": {"area--gappy": {"relation": 7}}}), encoding="utf-8")
    out = tmp_path / "route-lines.geojson"
    report = tmp_path / "r.md"

    main(["--routes", str(routes), "--ways", str(ways), "--relations", str(relations),
          "--relations-map", str(confirmed), "--out", str(out), "--report", str(report)])

    assert json.loads(out.read_text(encoding="utf-8"))["features"] == []
    assert "missing 1 member" in report.read_text(encoding="utf-8")


def test_runs_without_an_extract_and_writes_an_empty_collection(tmp_path):
    # A clone that has never run WSL must not crash the pipeline.
    routes = _routes(tmp_path, [{
        "slug": "x", "area": ["Area"], "title": "X", "coords": None, "sections": {},
    }])
    out = tmp_path / "route-lines.geojson"
    report = tmp_path / "route-lines-report.md"
    assert main(["--routes", str(routes), "--ways", str(tmp_path / "absent.geojsonl"),
                 "--out", str(out), "--report", str(report),
                 "--relations-map", str(tmp_path / "missing.json"),
                 "--relations", str(tmp_path / "no-relations.json")]) == 0
    assert json.loads(out.read_text(encoding="utf-8"))["features"] == []
```

- [ ] **Step 7: Run it to verify it fails**

Run: `cd tools/routelines && python -m pytest tests/test_cli.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'kaap_routelines.cli'`

- [ ] **Step 8: Implement the CLI**

Create `tools/routelines/kaap_routelines/ids.py` — a copy of `tools/geocode/kaap_geocode/ids.py`, with its docstring extended to say the two copies exist because the tools are separate packages and both mirror `app/src/lib/data/ids.ts`.

Create `tools/routelines/kaap_routelines/mentions.py` — the name matcher. It must reproduce `app/src/lib/data/path-mentions.ts`: case-sensitive, apostrophes folded, punctuation collapsed to single spaces, a 3-character minimum, longest match wins, results in the order the prose introduces them.

```python
"""Which mapped trails does a route's prose name, and in what order?

A Python mirror of app/src/lib/data/path-mentions.ts. The rules are identical
and load-bearing: case separates "Ledges" the path from "ledges" the rock, the
3-character floor rejects `B` (an OSM path name here, and also how this archive
writes a grade), and longest-match-wins stops "Twelve Apostles" stealing
characters from "Twelve Apostles Path".

Order is the point for this tool, not a nicety: the walk uses it as the
waypoint sequence.
"""

from __future__ import annotations

import re

MIN_NAME_LENGTH = 3
_APOSTROPHES = re.compile(r"['’]")
_NON_ALNUM = re.compile(r"[^A-Za-z0-9]+")


def normalise_for_match(s: str) -> str:
    return _NON_ALNUM.sub(" ", _APOSTROPHES.sub("", s)).strip()


def _occurrences(haystack: str, needle: str) -> list[int]:
    hits: list[int] = []
    if not needle:
        return hits
    start = 0
    while True:
        at = haystack.find(needle, start)
        if at == -1:
            return hits
        starts_word = at == 0 or haystack[at - 1] == " "
        ends = at + len(needle)
        ends_word = ends == len(haystack) or haystack[ends] == " "
        if starts_word and ends_word:
            hits.append(at)
        start = at + 1


def mentioned_trails(prose: str, names: list[str]) -> list[str]:
    text = normalise_for_match(prose)
    claimed = [False] * len(text)
    by_key: dict[str, str] = {}
    for name in names:
        key = normalise_for_match(name)
        if len(key) < MIN_NAME_LENGTH:
            continue
        held = by_key.get(key)
        if held is None or name < held:
            by_key[key] = name

    found: list[tuple[int, str]] = []
    for key, name in sorted(by_key.items(), key=lambda kv: (-len(kv[0]), kv[0])):
        first = -1
        for at in _occurrences(text, key):
            if any(claimed[at : at + len(key)]):
                continue
            for i in range(at, at + len(key)):
                claimed[i] = True
            if first == -1:
                first = at
        if first != -1:
            found.append((first, name))
    return [name for _, name in sorted(found)]
```

`tools/routelines/kaap_routelines/cli.py`:

```python
"""Entry point: read routes + ways + relations, write route-lines.geojson.

Degrades rather than fails when the extract is absent — a clone that has never
run WSL still builds, exactly as tools/geocode does.
"""

from __future__ import annotations

import argparse
import json
from datetime import date
from pathlib import Path

from .graph import build_graph
from .ids import route_id
from .mentions import mentioned_trails
from .relations import read_relations, stitch
from .report import Outcome, Proposal, build_report
from .trails import build_trails
from .walk import Rejected, WalkResult, walk_route
from .ways import read_ways

HERE = Path(__file__).resolve().parent.parent
DATA = HERE.parent.parent / "data"


def _normalise(s: str) -> str:
    from .mentions import normalise_for_match

    return normalise_for_match(s)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Derive KaapSpoor route lines.")
    parser.add_argument("--routes", type=Path, default=DATA / "routes.json")
    parser.add_argument(
        "--ways",
        type=Path,
        default=HERE.parent / "geocode" / "work" / "walkable-ways.geojsonl",
    )
    parser.add_argument(
        "--relations",
        type=Path,
        default=HERE.parent / "geocode" / "work" / "route-relations.json",
    )
    parser.add_argument("--relations-map", type=Path, default=DATA / "route-relations.json")
    parser.add_argument("--out", type=Path, default=DATA / "route-lines.geojson")
    parser.add_argument("--report", type=Path, default=DATA / "route-lines-report.md")
    args = parser.parse_args(argv)

    dataset = json.loads(args.routes.read_text(encoding="utf-8"))
    routes = dataset["routes"]

    if args.ways.exists():
        ways = read_ways(args.ways)
        extract_date = date.fromtimestamp(args.ways.stat().st_mtime).isoformat()
    else:
        print(f"warning: {args.ways} missing — run extract-osm-features.sh in WSL")
        ways, extract_date = [], "none"

    # Member geometry is joined on by id, so the way index has to exist first.
    ways_by_id = {way.osm_id: way for way in ways}
    relations = read_relations(args.relations, ways_by_id) if args.relations.exists() else []
    confirmed: dict[str, dict] = {}
    if args.relations_map.exists():
        confirmed = json.loads(args.relations_map.read_text(encoding="utf-8")).get("confirmed", {})

    trails = build_trails(ways, relations)
    graph = build_graph(ways)
    by_relation_id = {relation.osm_id: relation for relation in relations}

    outcome = Outcome()
    features: list[dict] = []

    for raw in routes:
        rid = route_id(raw["area"], raw["slug"])
        title = raw.get("title") or ""

        # Tier 1: a hand-confirmed relation. Its extent was decided by a mapper.
        entry = confirmed.get(rid)
        if entry:
            relation = by_relation_id.get(entry["relation"])
            if relation is None:
                outcome.rejected.append(
                    {"routeId": rid, "reason": f"relation {entry['relation']} not in the extract"}
                )
                continue
            if relation.missing:
                outcome.rejected.append({
                    "routeId": rid,
                    "reason": f"relation {relation.osm_id} is missing {relation.missing} "
                              "member ways from the extract",
                })
                continue
            stitched = stitch(relation)
            # A relation whose plain members join into nothing is reported and
            # skipped rather than guessed at: one part per member is not a
            # route, it is a pile of ways that happen to share a relation.
            if len(stitched.parts) == len(relation.members) and len(relation.members) > 1:
                outcome.rejected.append({
                    "routeId": rid,
                    "reason": f"relation {relation.osm_id} members do not join at all",
                })
                continue
            geometry = (
                {"type": "LineString", "coordinates": [list(p) for p in stitched.parts[0]]}
                if stitched.joined
                else {
                    "type": "MultiLineString",
                    "coordinates": [[list(p) for p in part] for part in stitched.parts],
                }
            )
            from .geo import length_m as measure

            total = sum(measure(part) for part in stitched.parts)
            features.append({
                "type": "Feature",
                "geometry": geometry,
                "properties": {
                    "routeId": rid, "source": "osm-relation",
                    "osmWays": list(stitched.way_ids), "relation": relation.osm_id,
                    "lengthM": round(total, 1), "connectorM": 0.0,
                },
            })
            outcome.accepted.append({
                "routeId": rid, "source": "osm-relation", "lengthM": total,
                "connectorM": 0.0, "ways": len(stitched.way_ids), "relation": relation.osm_id,
            })
            continue

        # Propose, never promote: a title overlapping a relation name is a question.
        normalised_title = _normalise(title)
        for relation in relations:
            normalised_name = _normalise(relation.name)
            if not normalised_name:
                continue
            if normalised_name in normalised_title or normalised_title in normalised_name:
                outcome.proposals.append(
                    Proposal(rid, title, relation.osm_id, relation.name)
                )

        # Tier 2: the ordered corridor walk.
        coords = raw.get("coords")
        if not coords:
            outcome.rejected.append({"routeId": rid, "reason": "no recorded position"})
            continue
        prose = " ".join((raw.get("sections") or {}).values())
        names = mentioned_trails(prose, list(trails))
        result = walk_route((coords["lon"], coords["lat"]), names, trails, graph)
        if isinstance(result, Rejected):
            outcome.rejected.append({"routeId": rid, "reason": result.reason})
            continue
        assert isinstance(result, WalkResult)
        features.append({
            "type": "Feature",
            "geometry": {"type": "LineString", "coordinates": [list(p) for p in result.coords]},
            "properties": {
                "routeId": rid, "source": "osm-stitch",
                "osmWays": list(result.way_ids), "relation": None,
                "lengthM": round(result.length_m, 1),
                "connectorM": round(result.connector_m, 1),
            },
        })
        outcome.accepted.append({
            "routeId": rid, "source": "osm-stitch", "lengthM": result.length_m,
            "connectorM": result.connector_m, "ways": len(result.way_ids), "relation": None,
        })

    args.out.write_text(
        json.dumps({"type": "FeatureCollection", "features": features}, indent=1) + "\n",
        encoding="utf-8",
    )
    args.report.write_text(build_report(outcome, extract_date), encoding="utf-8")

    by_tier: dict[str, int] = {}
    for row in outcome.accepted:
        by_tier[row["source"]] = by_tier.get(row["source"], 0) + 1
    print(
        f"routelines: {len(outcome.accepted)}/{len(routes)} lines "
        f"({', '.join(f'{k}={v}' for k, v in sorted(by_tier.items())) or 'none'}), "
        f"{len(outcome.rejected)} rejected, {len(outcome.proposals)} relation candidates"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 9: Run the whole suite**

Run: `cd tools/routelines && python -m pytest -v`
Expected: PASS, all tests

- [ ] **Step 10: Write the README**

`tools/routelines/README.md` — covering: what it emits, that `extract-osm-features.sh` must run in WSL first, the exact command, the two tiers, that `data/route-relations.json` is hand-written and the report's proposals are questions, and the gate constants with their reasons.

- [ ] **Step 11: Commit**

```bash
git add tools/routelines data/route-relations.json
git commit -m "feat(routelines): emit the lines, and report every one it declined"
```

---

## Task 7: Run it for real — the yield checkpoint

**Files:**
- Create: `data/route-lines.geojson`, `data/route-lines-report.md`
- Modify: `data/route-relations.json`

**Interfaces:**
- Consumes: the CLI from Task 6.
- Produces: the committed artifacts every app task below reads.

> **STOP HERE AND READ THE NUMBER.** The spec records this as the phase's main
> risk: 67 routes is the stitch tier's *candidate ceiling*, not its yield. If
> the stitch tier accepts very few, the relation tier still stands alone and is
> worth shipping — a dozen routes drawn correctly is a better map than 67 drawn
> hopefully. Report the counts before writing any app code.

- [ ] **Step 1: Run the extract in WSL**

```bash
# In WSL Ubuntu, from the repo root:
bash tools/geocode/extract-osm-features.sh
```

Expected: three `wrote …` lines, including `walkable-ways.geojsonl` and `route-relations.geojsonl`. If the PBF is missing, run `tools/tiles/build-trails.sh` first — it downloads it.

- [ ] **Step 2: Run the tool with no confirmed relations**

Run: `cd tools/routelines && python -m kaap_routelines.cli`
Expected: a `routelines: N/184 lines …` summary, and `data/route-lines-report.md` written.

- [ ] **Step 3: Confirm the relation matches by hand**

Read the "Relation candidates awaiting confirmation" table. For each row, decide whether the relation *is* the route the guide describes. Add the true ones to `data/route-relations.json` under `confirmed`, each with a `note` saying why.

Known from design-time research — confirm each against the report rather than pasting blind:
- *Platteklip Gorge - Table Mountain Hiking Guide* → relation 2934380 — the same ascent.
- *Devil's Peak contour paths* → relation 2934370 (Contour Path) — **not a match**; the route walks along a trail the relation describes end to end.
- *Diagonal Route on 3rd Ridge* → relation 6198096 (Diagonal Route) — **not a match**; a different route sharing a word.

- [ ] **Step 4: Rerun and record the yield**

Run: `cd tools/routelines && python -m kaap_routelines.cli`
Expected: the summary now counts `osm-relation` lines.

Write down: total lines, split by tier, and the three most common rejection reasons. **Report these to the user before continuing.**

- [ ] **Step 5: Look at the lines**

Open the report. For every accepted line, check its length against the route's `time` field for plausibility. Then spot-check the geometry: paste a few features into [geojson.io](https://geojson.io) and confirm the line runs where the description says it does. A line up the wrong ravine passes every assertion in this plan.

- [ ] **Step 6: Commit the artifacts**

```bash
git add data/route-lines.geojson data/route-lines-report.md data/route-relations.json
git commit -m "data: the routes whose line the mountain can actually defend"
```

---

## Task 8: Fragmentation is not ambiguity

**Files:**
- Modify: `tools/geocode/kaap_geocode/features.py`, `tools/geocode/kaap_geocode/match.py:55-67`
- Test: `tools/geocode/tests/test_match.py`, `tools/geocode/tests/test_features.py`

**Interfaces:**
- Consumes: nothing from earlier tasks — this is a self-contained correction inside `tools/geocode`.
- Produces: more `osm-match` positions and fewer `area-approx` ones in `data/route-locations.json`.

- [ ] **Step 1: Write the failing test**

Add to `tools/geocode/tests/test_match.py`:

```python
from kaap_geocode.features import Feature
from kaap_geocode.match import AmbiguousMatch, find_match, index_features
from kaap_geocode.areas import BBox

BOX = BBox(west=18.0, south=-35.0, east=19.0, north=-33.0)


def _way(osm_id: int, name: str, coords: list[tuple[float, float]]) -> Feature:
    lons = [c[0] for c in coords]
    lats = [c[1] for c in coords]
    return Feature(
        name=name,
        lat=(min(lats) + max(lats)) / 2,
        lon=(min(lons) + max(lons)) / 2,
        osm_type="way",
        osm_id=osm_id,
        kind="highway=path",
        endpoints=((coords[0][0], coords[0][1]), (coords[-1][0], coords[-1][1])),
    )


def test_connected_same_named_ways_are_one_trail_not_an_ambiguity():
    # 27 segments called Contour Path are one trail cut at every junction.
    # Reading that as ambiguity is what held the geocoder to 11 matches while
    # 45 route titles are exactly an OSM path name.
    ways = [
        _way(1, "Muizenberg Buttress", [(18.45, -34.10), (18.46, -34.10)]),
        _way(2, "Muizenberg Buttress", [(18.46, -34.10), (18.47, -34.10)]),
    ]
    match = find_match(["Muizenberg Buttress"], index_features(ways), BOX)
    assert match is not None
    # The midpoint of the whole run, not of whichever segment came first.
    assert match.feature.lon == 18.46


def test_disconnected_same_named_ways_stay_ambiguous():
    ways = [
        _way(1, "Ledges", [(18.40, -34.00), (18.41, -34.00)]),
        _way(2, "Ledges", [(18.80, -34.00), (18.81, -34.00)]),
    ]
    try:
        find_match(["Ledges"], index_features(ways), BOX)
    except AmbiguousMatch as err:
        assert err.count == 2
    else:
        raise AssertionError("expected AmbiguousMatch")


def test_two_nodes_sharing_a_name_remain_ambiguous():
    # The peak rule is untouched: two summits called Klipspringer are two places.
    peaks = [
        Feature("Klipspringer", -34.0, 18.40, "node", 1, "natural=peak", endpoints=None),
        Feature("Klipspringer", -34.1, 18.50, "node", 2, "natural=peak", endpoints=None),
    ]
    try:
        find_match(["Klipspringer"], index_features(peaks), BOX)
    except AmbiguousMatch:
        pass
    else:
        raise AssertionError("expected AmbiguousMatch")
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd tools/geocode && python -m pytest tests/test_match.py -v`
Expected: FAIL — `Feature.__init__() got an unexpected keyword argument 'endpoints'`

- [ ] **Step 3: Carry endpoints on a Feature**

In `tools/geocode/kaap_geocode/features.py`, add a field to `Feature`:

```python
@dataclass(frozen=True)
class Feature:
    name: str
    lat: float
    lon: float
    osm_type: str
    osm_id: int
    kind: str
    #: A way's first and last (lon, lat), or None for anything else. Phase 4d
    #: uses this to tell a fragmented trail from a genuine ambiguity: 27
    #: segments called Contour Path are one trail cut at every junction, and
    #: connectedness — not count — is what separates that from two summits
    #: sharing a name.
    endpoints: tuple[tuple[float, float], tuple[float, float]] | None = None
```

And in `read_features`, populate it for LineString geometries:

```python
            geometry = raw.get("geometry") or {}
            endpoints = None
            if geometry.get("type") == "LineString":
                line = geometry.get("coordinates") or []
                if len(line) >= 2:
                    endpoints = (
                        (float(line[0][0]), float(line[0][1])),
                        (float(line[-1][0]), float(line[-1][1])),
                    )
```

Pass `endpoints=endpoints` into the `Feature(...)` construction.

Add to `tools/geocode/tests/test_features.py`:

```python
def test_a_way_carries_its_endpoints(tmp_path):
    path = tmp_path / "f.geojsonl"
    path.write_text(json.dumps({
        "type": "Feature",
        "properties": {"@id": "w1", "highway": "path", "name": "Contour Path"},
        "geometry": {"type": "LineString", "coordinates": [[18.4, -34.0], [18.41, -34.0]]},
    }) + "\n", encoding="utf-8")
    assert read_features(path)[0].endpoints == ((18.4, -34.0), (18.41, -34.0))


def test_a_node_has_no_endpoints(tmp_path):
    path = tmp_path / "f.geojsonl"
    path.write_text(json.dumps({
        "type": "Feature",
        "properties": {"@id": "n1", "natural": "peak", "name": "Devil's Peak"},
        "geometry": {"type": "Point", "coordinates": [18.4, -34.0]},
    }) + "\n", encoding="utf-8")
    assert read_features(path)[0].endpoints is None
```

- [ ] **Step 4: Teach `find_match` that a connected run is one trail**

Replace the body of `find_match` in `tools/geocode/kaap_geocode/match.py`:

```python
_PLACES = 7


def _node(point: tuple[float, float]) -> tuple[float, float]:
    return (round(point[0], _PLACES), round(point[1], _PLACES))


def _one_connected_run(hits: list[Feature]) -> bool:
    """True when every hit is a way and they all join into a single run.

    OSM cuts a trail at every junction, so a name matching many features is
    usually fragmentation, not ambiguity. Connectedness is the test — count is
    not, and using count is what held this tier to 11 matches while 45 route
    titles are exactly an OSM path name.
    """
    if any(feature.endpoints is None for feature in hits):
        return False
    adjacency: dict[tuple[float, float], list[int]] = {}
    for index, feature in enumerate(hits):
        for point in feature.endpoints:  # type: ignore[union-attr]
            adjacency.setdefault(_node(point), []).append(index)
    seen: set[int] = set()
    stack = [0]
    while stack:
        current = stack.pop()
        if current in seen:
            continue
        seen.add(current)
        for point in hits[current].endpoints:  # type: ignore[union-attr]
            stack.extend(adjacency.get(_node(point), ()))
    return len(seen) == len(hits)


def _merged(hits: list[Feature]) -> Feature:
    """The run as one feature, positioned at the midpoint of the whole thing."""
    lats = [f.lat for f in hits]
    lons = [f.lon for f in hits]
    first = hits[0]
    return Feature(
        name=first.name,
        lat=(min(lats) + max(lats)) / 2,
        lon=(min(lons) + max(lons)) / 2,
        osm_type=first.osm_type,
        osm_id=first.osm_id,
        kind=first.kind,
        endpoints=first.endpoints,
    )


def find_match(
    candidate_names: list[str], index: FeatureIndex, bbox: BBox
) -> Match | None:
    for candidate in candidate_names:
        # Filter after the name lookup, not before: the index is shared across
        # routes but the bbox is not. Ambiguity is still judged on what is
        # inside the bbox alone, so a namesake elsewhere cannot block a match.
        hits = [f for f in index.get(comparison_key(candidate), ()) if bbox.contains(f.lat, f.lon)]
        if len(hits) > 1:
            if _one_connected_run(hits):
                return Match(feature=_merged(hits), candidate=candidate)
            raise AmbiguousMatch(candidate, len(hits))
        if hits:
            return Match(feature=hits[0], candidate=candidate)
    return None
```

Update the module docstring's rule 2 to state the correction: two features sharing a name are an ambiguity **unless they are ways forming one connected run**, which is fragmentation.

- [ ] **Step 5: Run the geocode suite**

Run: `cd tools/geocode && python -m pytest -v`
Expected: PASS, including the new tests

- [ ] **Step 6: Rerun the geocoder and review what changed**

Run: `cd tools/geocode && python -m kaap_geocode.cli`

Read `data/geocode-report.md`. **Every newly-matched route is a new claim about where a hike is** — check each one before committing. The tier's whole value is that its claims were checked.

- [ ] **Step 7: Commit**

```bash
git add tools/geocode data/route-locations.json data/geocode-report.md
git commit -m "fix(geocode): read a trail cut at every junction as one trail"
```

---

## Task 9: The data reaches the app

**Files:**
- Modify: `app/src/lib/data/types.ts:39-63`, `app/scripts/transform.ts`
- Test: `app/scripts/transform.test.ts` (or the existing transform test file — check `app/scripts/` and `app/src/` for it first)

**Interfaces:**
- Consumes: `data/route-lines.geojson` from Task 7.
- Produces: `RouteIndexEntry.hasLine: boolean` and `RouteIndexEntry.lineSource: 'osm-relation' | 'osm-stitch' | null`; `app/static/data/route-lines.geojson`.

- [ ] **Step 1: Write the failing test**

Find the existing transform test (`rg "from '.*transform'" app/`) and add:

```ts
it('marks a route that has a line, and says which tier drew it', () => {
  const lines = {
    type: 'FeatureCollection' as const,
    features: [
      {
        type: 'Feature' as const,
        geometry: { type: 'LineString' as const, coordinates: [[18.4, -34], [18.41, -34]] },
        properties: { routeId: 'area--with-line', source: 'osm-relation' }
      }
    ]
  };
  const { index } = transform(rawWith(['with-line', 'without-line']), {}, [], lines);
  const withLine = index.find((e) => e.id === 'area--with-line')!;
  const without = index.find((e) => e.id === 'area--without-line')!;
  expect(withLine.hasLine).toBe(true);
  expect(withLine.lineSource).toBe('osm-relation');
  // Never absent: the panel and the map both branch on these, and `undefined`
  // would read as "not loaded yet" rather than "this route has no line".
  expect(without.hasLine).toBe(false);
  expect(without.lineSource).toBe(null);
});

it('defaults to no lines when the file has never been generated', () => {
  const { index } = transform(rawWith(['x']), {}, []);
  expect(index[0].hasLine).toBe(false);
  expect(index[0].lineSource).toBe(null);
});
```

with this local helper:

```ts
function rawWith(slugs: string[]): RawDataset {
  return {
    routes: slugs.map((slug) => ({
      slug, title: slug, url: `https://example.test/${slug}`, area: ['Area'],
      coords: { lat: -34, lon: 18.4, zoom: 15 },
      grade: null, grade_source: null, stats: {}, sections: {}, description: '',
      related: [], attachments: [], photos: { deck_ids: [], inline_urls: [] }
    }))
  };
}
```

Check it against the fixtures already in that file and reuse theirs if one fits.

- [ ] **Step 2: Run it to verify it fails**

Run: `cd app && npx vitest run scripts` (adjust the path to the test file found in Step 1)
Expected: FAIL — `transform` takes three arguments; `hasLine` is undefined

- [ ] **Step 3: Extend the types**

In `app/src/lib/data/types.ts`, add to `RouteIndexEntry` after `mentionedPaths`:

```ts
  /**
   * How this route's own line was derived, or null when it has none.
   *
   * `osm-relation` is a mapper-authored hiking relation; `osm-stitch` is the
   * ordered corridor walk through the paths the description names. A route
   * that passed neither gate has NO line and draws nothing — see
   * docs/superpowers/specs/2026-08-16-phase4d-route-geometry-design.md.
   */
  lineSource: 'osm-relation' | 'osm-stitch' | null;
  /** Never true when `lineSource` is null, and vice versa. */
  hasLine: boolean;
```

- [ ] **Step 4: Merge and copy in transform.ts**

Add the parameter and the merge:

```ts
export interface RouteLineFeature {
  properties: { routeId: string; source: 'osm-relation' | 'osm-stitch' };
}
export interface RouteLines {
  features: RouteLineFeature[];
}

export function transform(
  raw: RawDataset,
  locations: Record<string, RouteLocation> = {},
  pathNames: OsmPathName[] = [],
  lines: RouteLines = { features: [] }
): { index: RouteIndexEntry[]; content: RouteContent[] } {
  const lineSources = new Map(
    lines.features.map((f) => [f.properties.routeId, f.properties.source])
  );
```

and inside the entry literal, after `mentionedPaths`:

```ts
      // A flag rather than the geometry: the line itself is fetched once,
      // lazily, from a single static file the first time a selection needs it
      // — so 184 index entries do not each carry a few hundred coordinates.
      lineSource: lineSources.get(id) ?? null,
      hasLine: lineSources.has(id),
```

In `main()`, read the file and copy it into `static/data/`:

```ts
  // Absent on a clone that has not run tools/routelines; every route then has
  // no line, which is the pre-Phase-4d behaviour and builds fine.
  const linesPath = resolve(here, '../../data/route-lines.geojson');
  const lines = existsSync(linesPath)
    ? (JSON.parse(readFileSync(linesPath, 'utf-8')) as RouteLines)
    : { features: [] };
  const { index, content } = transform(raw, locations, pathNames, lines);
```

and after the index is written:

```ts
  // Copied rather than imported by the app: it is one static asset the map
  // fetches at runtime, and copying keeps data/ the single source of truth.
  await writeFile(resolve(out, 'route-lines.geojson'), JSON.stringify(lines));
```

Extend the closing `console.log` with `` `${index.filter((e) => e.hasLine).length} have a line; ` ``.

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd app && npx vitest run scripts`
Expected: PASS

- [ ] **Step 6: Write the anti-drift test**

In the same test file:

```ts
it('every line in the committed file belongs to a real route', async () => {
  // Mirrors the check tying region.ts to regions.json. A renamed route slug
  // would otherwise leave an orphaned line that silently never draws.
  const { readFileSync, existsSync } = await import('node:fs');
  const path = new URL('../../data/route-lines.geojson', import.meta.url).pathname;
  if (!existsSync(path)) return; // a clone that has not run tools/routelines
  const lines = JSON.parse(readFileSync(path, 'utf-8')) as RouteLines;
  const ids = new Set(
    JSON.parse(readFileSync(new URL('../static/data/routes-index.json', import.meta.url).pathname, 'utf-8'))
      .map((e: { id: string }) => e.id)
  );
  for (const f of lines.features) expect(ids.has(f.properties.routeId)).toBe(true);
});
```

Adjust the two relative URLs to the test file's actual location before running.

Add this comment above the test, and do not weaken it later:

```ts
// Deliberately NOT a staleness check against the OSM extract. CI has no PBF
// when unit tests run, so such a check could only ever take the degraded path
// and fail for being right — the same reasoning tools/geocode and
// tools/pathnames each record for their own artifacts.
```

- [ ] **Step 7: Run the full app suite**

Run: `cd app && npm test && npm run check`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add app/src/lib/data/types.ts app/scripts
git commit -m "feat(app): tell each route whether the map can draw its line"
```

---

## Task 10: The layers — one removal, one addition

**Files:**
- Create: `app/src/lib/map/route-lines.ts`, `app/src/lib/map/route-lines.test.ts`
- Modify: `app/src/lib/map/style.ts:21-30,271-342,483-514`, `app/src/lib/map/style.test.ts`

**Interfaces:**
- Consumes: `PIN_COLOR_DONE`, `PIN_COLOR_TODO` from `app/src/lib/map/pins.ts`.
- Produces: `ROUTE_LINE_LAYERS: readonly ['route-line-casing', 'route-line']`; `ROUTE_LINE_SOURCE = 'route-lines'`; `routeLineFilter(routeId: string | null): FilterSpecification`; `routeLinePaint(): LineLayerSpecification['paint']`; `routeLineCasingPaint()`; `lineBounds(geometry): [[number, number], [number, number]] | null`.
- Removes: `REFERENCED_PATH_LAYERS` (all three layers). `NAMED_PATH_LAYER` and `pathNameFilter` STAY.

- [ ] **Step 1: Write the failing test**

`app/src/lib/map/route-lines.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  ROUTE_LINE_LAYERS, ROUTE_LINE_SOURCE, routeLineFilter, routeLinePaint, lineBounds
} from './route-lines';
import { PIN_COLOR_DONE, PIN_COLOR_TODO } from './pins';

describe('route lines', () => {
  it('matches nothing when nothing is selected', () => {
    // The unselected state is a filter, not an absent layer: the layers exist
    // from style load so nothing is added or removed at runtime.
    expect(routeLineFilter(null)).toEqual(['in', ['get', 'routeId'], ['literal', []]]);
  });

  it('matches exactly the selected route', () => {
    expect(routeLineFilter('a--b--c')).toEqual(['in', ['get', 'routeId'], ['literal', ['a--b--c']]]);
  });

  it('draws the line in the pin colours, because this IS the route', () => {
    const paint = routeLinePaint();
    expect(JSON.stringify(paint)).toContain(PIN_COLOR_DONE);
    expect(JSON.stringify(paint)).toContain(PIN_COLOR_TODO);
  });

  it('never draws a hairline', () => {
    const width = routeLinePaint()['line-width'] as unknown[];
    // ['interpolate', ['linear'], ['zoom'], z0, w0, ...] — the first width.
    expect(width[4]).toBeGreaterThanOrEqual(0.8);
  });

  it('bounds a LineString', () => {
    expect(lineBounds({ type: 'LineString', coordinates: [[18.4, -34.0], [18.5, -33.9]] }))
      .toEqual([[18.4, -34.0], [18.5, -33.9]]);
  });

  it('bounds a MultiLineString across all its parts', () => {
    expect(lineBounds({
      type: 'MultiLineString',
      coordinates: [[[18.4, -34.0], [18.45, -33.95]], [[18.3, -34.1], [18.5, -33.9]]]
    })).toEqual([[18.3, -34.1], [18.5, -33.9]]);
  });

  it('returns null for empty geometry rather than an inverted box', () => {
    expect(lineBounds({ type: 'LineString', coordinates: [] })).toBe(null);
  });

  it('names both layers, casing first so it draws underneath', () => {
    expect(ROUTE_LINE_LAYERS).toEqual(['route-line-casing', 'route-line']);
    expect(ROUTE_LINE_SOURCE).toBe('route-lines');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd app && npx vitest run src/lib/map/route-lines.test.ts`
Expected: FAIL — cannot resolve `./route-lines`

- [ ] **Step 3: Implement the module**

`app/src/lib/map/route-lines.ts`:

```ts
import type { FilterSpecification, LineLayerSpecification } from 'maplibre-gl';
import type { LineString, MultiLineString } from 'geojson';
import { PIN_COLOR_DONE, PIN_COLOR_TODO } from './pins';

/**
 * The route's own line — from an OSM hiking relation, or stitched by walking
 * the paths its description names in order. See
 * docs/superpowers/specs/2026-08-16-phase4d-route-geometry-design.md.
 *
 * Drawn in the PIN COLOURS, unlike Phase 4e's mentioned paths: this is the
 * route, and colouring it as the pin says so without needing a legend.
 */
export const ROUTE_LINE_SOURCE = 'route-lines';

/** Casing first: it must draw underneath the line it lifts off the contours. */
export const ROUTE_LINE_LAYERS = ['route-line-casing', 'route-line'] as const;

/**
 * Match one route's line. An empty list matches nothing, which is how the
 * unselected state is expressed — the layers exist from style load and only
 * their filter changes, exactly as the named-path tiers do.
 */
export function routeLineFilter(routeId: string | null): FilterSpecification {
  return ['in', ['get', 'routeId'], ['literal', routeId ? [routeId] : []]];
}

export function routeLinePaint(): NonNullable<LineLayerSpecification['paint']> {
  return {
    // feature-state 'done' is set by MapView from the journal, the same signal
    // that colours the pin.
    'line-color': [
      'case',
      ['boolean', ['feature-state', 'done'], false],
      PIN_COLOR_DONE,
      PIN_COLOR_TODO
    ],
    'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2.5, 16, 5],
    'line-opacity': 0.9
  };
}

export function routeLineCasingPaint(): NonNullable<LineLayerSpecification['paint']> {
  return {
    'line-color': '#f4f1ea',
    'line-width': ['interpolate', ['linear'], ['zoom'], 10, 5, 16, 9],
    'line-opacity': 0.85
  };
}

/** The camera box for a drawn line, or null if there is nothing to frame. */
export function lineBounds(
  geometry: LineString | MultiLineString
): [[number, number], [number, number]] | null {
  const parts =
    geometry.type === 'LineString' ? [geometry.coordinates] : geometry.coordinates;
  const points = parts.flat();
  if (points.length === 0) return null;
  const lons = points.map((p) => p[0]);
  const lats = points.map((p) => p[1]);
  return [
    [Math.min(...lons), Math.min(...lats)],
    [Math.max(...lons), Math.max(...lats)]
  ];
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd app && npx vitest run src/lib/map/route-lines.test.ts`
Expected: PASS, 7 tests

- [ ] **Step 5: Write the failing style tests**

Add to `app/src/lib/map/style.test.ts`:

```ts
it('no longer highlights whole named paths', () => {
  // Removed in Phase 4d, deliberately. Name-matching has no extent: the
  // highlight ran the length of the peninsula, broke over unnamed connectors
  // and drew escape routes as equals. Asserted so the removal reads as a
  // decision rather than a regression to the next person in style.ts.
  const ids = buildStyle('selfhosted', '').layers.map((l) => l.id);
  expect(ids).not.toContain('paths-referenced');
  expect(ids).not.toContain('paths-referenced-casing');
  expect(ids).not.toContain('paths-referenced-label');
});

it('keeps the quiet named-path label tier, which states a fact', () => {
  const ids = buildStyle('selfhosted', '').layers.map((l) => l.id);
  expect(ids).toContain('paths-named');
});

it('carries an empty route-lines source, filled at runtime', () => {
  const style = buildStyle('selfhosted', '');
  const source = style.sources['route-lines'];
  expect(source).toBeDefined();
  expect(source).toMatchObject({ type: 'geojson', promoteId: 'routeId' });
});

it('draws the route line over the paths and under every label', () => {
  const ids = buildStyle('selfhosted', '').layers.map((l) => l.id);
  expect(ids.indexOf('route-line-casing')).toBeGreaterThan(ids.indexOf('paths'));
  expect(ids.indexOf('route-line')).toBeGreaterThan(ids.indexOf('route-line-casing'));
  expect(ids.indexOf('route-line')).toBeLessThan(ids.indexOf('paths-named'));
  // region-mask paints over anything below it, and that bug class has hit
  // this map before.
  expect(ids.indexOf('route-line')).toBeLessThan(ids.indexOf('region-mask'));
});

it('starts with no route line drawn', () => {
  const style = buildStyle('selfhosted', '');
  for (const id of ['route-line', 'route-line-casing']) {
    const layer = style.layers.find((l) => l.id === id)!;
    expect(layer.filter).toEqual(['in', ['get', 'routeId'], ['literal', []]]);
  }
});
```

Also **delete** every existing assertion in `style.test.ts` about `paths-referenced*`.

- [ ] **Step 6: Run to verify it fails**

Run: `cd app && npx vitest run src/lib/map/style.test.ts`
Expected: FAIL — the removed layers are still present; `route-lines` source undefined

- [ ] **Step 7: Change the style**

In `app/src/lib/map/style.ts`:

1. Delete the `REFERENCED_PATH_LAYERS` export (lines 21–30) and its three layer objects (`paths-referenced-casing`, `paths-referenced` around lines 271–312, and `paths-referenced-label` around lines 483–514). Keep `NAMED_PATH_LAYER`, `pathNameFilter` and `NO_PATHS` — `paths-named` still uses them.
2. Add the source inside `selfHosted`'s `sources` block:

```ts
      // Filled by MapView the first time a selection has a line: the file is
      // one static asset, fetched once, and until then this draws nothing.
      // promoteId lets feature-state carry the journal's done colour onto the
      // line, the same way it does for pins — MapLibre parseInt()s string
      // feature ids otherwise, so slug ids become NaN and nothing matches.
      'route-lines': {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
        promoteId: 'routeId'
      },
```

3. Add the two layers immediately after the `paths` layer (which ends around line 270) and before `paths-named`:

```ts
      {
        // A pale casing under the route line, for the same reason the 4e
        // highlight had one: a coloured line over brown contours reads as more
        // contour unless something separates it from them.
        id: 'route-line-casing',
        type: 'line',
        source: 'route-lines',
        filter: routeLineFilter(null),
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: routeLineCasingPaint()
      },
      {
        // No minzoom. Unlike every path layer here, this comes from a GeoJSON
        // source rather than the tiles, so the archive's z11 floor does not
        // apply — the line draws the moment a route is selected, at any zoom,
        // including the opening view where 4e's highlight was invisible.
        id: 'route-line',
        type: 'line',
        source: 'route-lines',
        filter: routeLineFilter(null),
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: routeLinePaint()
      },
```

4. Import at the top: `import { routeLineFilter, routeLinePaint, routeLineCasingPaint } from './route-lines';`

- [ ] **Step 8: Run to verify it passes**

Run: `cd app && npx vitest run src/lib/map && npm run check`
Expected: PASS. `npm run check` will now flag `MapView.svelte` and `LocatorMap.svelte` importing the deleted `REFERENCED_PATH_LAYERS` — that is Task 11.

- [ ] **Step 9: Commit**

```bash
git add app/src/lib/map
git commit -m "feat(map): give the route its own line, and take back the claim name-matching could not keep"
```

---

## Task 11: The map draws it

**Files:**
- Modify: `app/src/lib/components/MapView.svelte:17-25,96-165,335-395`
- Test: `app/e2e/map.spec.ts`

**Interfaces:**
- Consumes: `ROUTE_LINE_LAYERS`, `ROUTE_LINE_SOURCE`, `routeLineFilter`, `lineBounds` (Task 10); `hasLine` on the index entry (Task 9).
- Produces: a map that fills `route-lines` on first need, filters it to the selection, and frames the camera on the line.

- [ ] **Step 1: Remove the referenced-path wiring**

In `app/src/lib/components/MapView.svelte`:

- change the style import to drop `REFERENCED_PATH_LAYERS`:

```ts
  import {
    buildStyle, SHIPPED_BASEMAP, pathNameFilter, NAMED_PATH_LAYER, type Basemap
  } from '$lib/map/style';
```

- delete these three lines from the selection effect (around line 350):

```ts
    const referenced = target?.mentionedPaths ?? [];
    for (const id of REFERENCED_PATH_LAYERS) {
      map.setFilter(id, pathNameFilter(referenced));
    }
```

- [ ] **Step 2: Add the lazy fetch**

Add the imports:

```ts
  import { ROUTE_LINE_LAYERS, ROUTE_LINE_SOURCE, routeLineFilter, lineBounds } from '$lib/map/route-lines';
  import type { FeatureCollection, LineString, MultiLineString } from 'geojson';
```

Add module-level state next to `cameraFollowedId`:

```ts
  // The lines for every route, fetched ONCE the first time a selection needs
  // them. Deliberately not part of routes-index.json: 184 entries would each
  // carry a few hundred coordinates for a shape only the selected route draws.
  let routeLines: FeatureCollection<LineString | MultiLineString, { routeId: string }> | null = null;
  let routeLinesRequested = false;

  async function ensureRouteLines(): Promise<void> {
    if (routeLinesRequested) return;
    routeLinesRequested = true;
    try {
      const res = await fetch(`${base}/data/route-lines.geojson`);
      if (!res.ok) throw new Error(`HTTP ${res.status} for route lines`);
      routeLines = await res.json();
      const source = map?.getSource(ROUTE_LINE_SOURCE) as GeoJSONSource | undefined;
      if (source && routeLines) source.setData(routeLines);
    } catch (err) {
      // A failed fetch means no line draws, which is the same as a route that
      // has none — the map stays usable and the pin still carries the route.
      console.warn('MapView: could not load route lines', err);
    }
  }
```

- [ ] **Step 3: Filter and frame on selection**

Inside the existing selection `$effect`, where the referenced-path block was, add:

```ts
    // The route's own line. Selection only — hovering fires constantly while
    // panning, and this both re-filters layers and moves the camera.
    if (target?.hasLine) {
      void ensureRouteLines().then(() => {
        if (!map) return;
        for (const id of ROUTE_LINE_LAYERS) map.setFilter(id, routeLineFilter(selectedId));
      });
    } else {
      for (const id of ROUTE_LINE_LAYERS) map.setFilter(id, routeLineFilter(null));
    }
```

Then, in the camera branch that currently runs `map.flyTo(...)` for a precise route, prefer the line's own bounds:

```ts
        } else if (target.hasLine && routeLines) {
          const feature = routeLines.features.find((f) => f.properties.routeId === target.id);
          const bounds = feature ? lineBounds(feature.geometry) : null;
          // Framing the line rather than flying to the pin is the point of
          // having a line: you see the whole walk, not its trailhead.
          if (bounds) map.fitBounds(bounds, { padding: 64, maxZoom: 15 });
          else map.flyTo({ center: [target.coords.lon, target.coords.lat], zoom: 14, speed: 1.4 });
        } else {
          map.flyTo({ center: [target.coords.lon, target.coords.lat], zoom: 14, speed: 1.4 });
        }
```

Note the ordering problem this creates: on the *first* selection of a route with a line, `routeLines` is still null when the camera branch runs, so it flies to the pin and the line appears a moment later. That is the same beat `RoutePreview` already has, and it is acceptable — but re-frame once the data lands, inside `ensureRouteLines`'s `.then()`, only if the selection has not changed since:

```ts
      void ensureRouteLines().then(() => {
        if (!map || $selection.selectedId !== selectedId) return;
        for (const id of ROUTE_LINE_LAYERS) map.setFilter(id, routeLineFilter(selectedId));
        const feature = routeLines?.features.find((f) => f.properties.routeId === selectedId);
        const bounds = feature ? lineBounds(feature.geometry) : null;
        if (bounds) map.fitBounds(bounds, { padding: 64, maxZoom: 15 });
      });
```

- [ ] **Step 4: Paint the done state onto the line**

In the journal `$effect` that calls `setFeatureState` for pins, add the same call for the line source:

```ts
      // The line reads done/to-do exactly as the pin does. promoteId on the
      // route-lines source (style.ts) is what makes a slug id match here.
      for (const id of doneIds) {
        map.setFeatureState({ source: ROUTE_LINE_SOURCE, id }, { done: true });
      }
```

Match the surrounding code's existing pattern for clearing state as well as setting it — read the effect before editing and mirror it exactly.

- [ ] **Step 5: Type-check and run the unit suite**

Run: `cd app && npm run check && npm test`
Expected: PASS

- [ ] **Step 6: Write the e2e tests**

Add to `app/e2e/map.spec.ts`, inside the existing `test.describe('map', …)`:

```ts
  test('selecting a route with a line draws it', async ({ page }) => {
    // Reads the committed data rather than hard-coding a title: which routes
    // have lines depends on the OSM extract, and pinning one here would make
    // this spec fail on a re-extract for a reason that is not a regression.
    await page.goto('./');
    await expect(page.getByTestId('map')).toHaveAttribute('data-map-ready', 'true');
    const titled = await page.evaluate(async () => {
      const routes = (await (await fetch('data/routes-index.json')).json()) as Array<{
        title: string; hasLine: boolean;
      }>;
      return routes.find((r) => r.hasLine)?.title ?? null;
    });
    test.skip(!titled, 'no route in this build has a line yet');

    await selectFromPanel(page, titled!);
    expect(await renderedCount(page, 'route-line')).toBeGreaterThan(0);
  });

  test('deselecting clears the line', async ({ page }) => {
    await page.goto('./');
    await expect(page.getByTestId('map')).toHaveAttribute('data-map-ready', 'true');
    const titled = await page.evaluate(async () => {
      const routes = (await (await fetch('data/routes-index.json')).json()) as Array<{
        title: string; hasLine: boolean;
      }>;
      return routes.find((r) => r.hasLine)?.title ?? null;
    });
    test.skip(!titled, 'no route in this build has a line yet');

    await selectFromPanel(page, titled!);
    await page.getByRole('button', { name: 'Close preview' }).click();
    expect(await renderedCount(page, 'route-line')).toBe(0);
  });

  test('a route with no line draws none, and still previews', async ({ page }) => {
    await page.goto('./');
    await expect(page.getByTestId('map')).toHaveAttribute('data-map-ready', 'true');
    const titled = await page.evaluate(async () => {
      const routes = (await (await fetch('data/routes-index.json')).json()) as Array<{
        title: string; hasLine: boolean; coords: unknown;
      }>;
      return routes.find((r) => !r.hasLine && r.coords)?.title ?? null;
    });
    await selectFromPanel(page, titled!);
    expect(await renderedCount(page, 'route-line')).toBe(0);
    await expect(page.getByTestId('preview-body')).toBeVisible();
  });

  test('the whole-name path highlight is gone', async ({ page }) => {
    // renderedCount returns -1 for a layer the style does not have, which is
    // exactly the assertion here: removed, not merely empty.
    await page.goto('./');
    await expect(page.getByTestId('map')).toHaveAttribute('data-map-ready', 'true');
    expect(await renderedCount(page, 'paths-referenced')).toBe(-1);
  });
```

Delete the existing e2e assertions about `paths-referenced*` from this file.

- [ ] **Step 7: Run the e2e suite**

Run: `cd app && npm run build && npm run test:e2e`
Expected: PASS. If the map tests fail on a missing tile, confirm the tiles release is downloaded into `app/static/tiles/`.

- [ ] **Step 8: Commit**

```bash
git add app/src/lib/components/MapView.svelte app/e2e/map.spec.ts
git commit -m "feat(map): frame the walk, not the trailhead"
```

---

## Task 12: The route page, and saying how the line is known

**Files:**
- Modify: `app/src/lib/components/LocatorMap.svelte:15-17,26-33,61-73`, `app/src/lib/components/ProvenanceNote.svelte`, `app/src/routes/route/[id]/+page.svelte:24-32`
- Test: `app/src/lib/components/ProvenanceNote.test.ts`, `app/src/lib/components/LocatorMap.test.ts`

**Interfaces:**
- Consumes: `ROUTE_LINE_LAYERS`, `ROUTE_LINE_SOURCE`, `routeLineFilter`, `lineBounds` (Task 10); `hasLine`, `lineSource` (Task 9).
- Produces: a route page whose locator map draws the line and whose provenance note says where it came from.

- [ ] **Step 1: Write the failing provenance test**

Add to `app/src/lib/components/ProvenanceNote.test.ts`:

```ts
it('says when a line came from a mapper-authored hiking route', () => {
  render(ProvenanceNote, { route: entry({ hasLine: true, lineSource: 'osm-relation' }) });
  expect(screen.getByTestId('line-provenance')).toHaveTextContent(
    /hiking route in OpenStreetMap/i
  );
});

it('says when a line was stitched from the order the description names paths', () => {
  render(ProvenanceNote, { route: entry({ hasLine: true, lineSource: 'osm-stitch' }) });
  expect(screen.getByTestId('line-provenance')).toHaveTextContent(
    /order this description names them/i
  );
});

it('says nothing at all when there is no line', () => {
  // The absence of a line is not an error to explain on every page — 76 routes
  // name no mapped path, and a sentence on each would be noise.
  render(ProvenanceNote, { route: entry({ hasLine: false, lineSource: null }) });
  expect(screen.queryByTestId('line-provenance')).toBeNull();
});
```

with this local helper:

```ts
function entry(overrides: Partial<RouteIndexEntry>): RouteIndexEntry {
  return {
    id: 'area--x', title: 'X', area: ['Area'],
    coords: { lat: -34, lon: 18.4, zoom: 15 }, coordsSource: 'crawl',
    coordsAccuracyM: null, coordsOsm: null, mentionedPaths: [],
    lineSource: null, hasLine: false,
    grade: null, gradeSource: null, time: null, heightGain: null, isFullEntry: true,
    ...overrides
  };
}
```

Check it against the fixtures already in that file and reuse theirs if one fits.

**A deliberate deviation from the spec's wording.** The spec illustrates the relation sentence as *"Drawn from the OpenStreetMap hiking route 'Platteklip Gorge'."* — with the relation's name. The name is not on the route index (only `lineSource` is), and putting it there to fill one sentence would grow all 184 entries for a string the map never reads. The sentence therefore omits the name. If it turns out to be worth it, the relation id is already in the GeoJSON the page fetches, and the name can be read from there.

- [ ] **Step 2: Run it to verify it fails**

Run: `cd app && npx vitest run src/lib/components/ProvenanceNote.test.ts`
Expected: FAIL — no element with testid `line-provenance`

- [ ] **Step 3: Extend ProvenanceNote**

In `app/src/lib/components/ProvenanceNote.svelte`, add below the existing `text` derivation:

```ts
  // How the LINE is known, which is a separate claim from how the position is.
  // One component owns both sentences so no two surfaces can word the same
  // relationship differently — the reason this component exists at all.
  let lineText = $derived.by(() => {
    if (!route.hasLine) return null;
    switch (route.lineSource) {
      case 'osm-relation':
        return 'Line drawn from a hiking route in OpenStreetMap.';
      case 'osm-stitch':
        return 'Line stitched from OpenStreetMap paths, following the order this description names them.';
      default:
        return null;
    }
  });
```

and after the existing `<p class="note">`:

```svelte
{#if lineText}
  <p class="note" data-testid="line-provenance">{lineText}</p>
{/if}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd app && npx vitest run src/lib/components/ProvenanceNote.test.ts`
Expected: PASS

- [ ] **Step 5: Draw the line on the locator map**

In `app/src/lib/components/LocatorMap.svelte`:

- change the style import to drop `REFERENCED_PATH_LAYERS` and `pathNameFilter`:

```ts
  import { buildStyle, SHIPPED_BASEMAP } from '$lib/map/style';
  import { ROUTE_LINE_LAYERS, ROUTE_LINE_SOURCE, routeLineFilter, lineBounds } from '$lib/map/route-lines';
```

- replace the `referencedPaths` prop with `routeId` and `hasLine`:

```ts
  let {
    coords,
    title,
    /** Metres. Set for an `area-approx` position only; see pins.ts. */
    accuracyM = null,
    /** The route this map is for, and whether Phase 4d could draw its line. */
    routeId,
    hasLine = false
  }: {
    coords: Coords;
    title: string;
    accuracyM?: number | null;
    routeId: string;
    hasLine?: boolean;
  } = $props();
```

- replace the referenced-paths `map.on('load')` block with:

```ts
    // The route's own line, on the page where the description that produced it
    // is actually read. Same source, same layers, same style as the main map,
    // so the two cannot disagree about what a route line looks like.
    if (hasLine) {
      map.on('load', async () => {
        if (!map) return;
        try {
          const res = await fetch(`${base}/data/route-lines.geojson`);
          if (!res.ok) throw new Error(`HTTP ${res.status} for route lines`);
          const collection = await res.json();
          const source = map.getSource(ROUTE_LINE_SOURCE) as
            | import('maplibre-gl').GeoJSONSource
            | undefined;
          source?.setData(collection);
          for (const id of ROUTE_LINE_LAYERS) map.setFilter(id, routeLineFilter(routeId));
          const feature = collection.features.find(
            (f: { properties: { routeId: string } }) => f.properties.routeId === routeId
          );
          const bounds = feature ? lineBounds(feature.geometry) : null;
          // Framing the line rather than the clamped centre: a locator map's
          // one job is showing where the hike goes, and now it can show all of it.
          if (bounds) map.fitBounds(bounds, { padding: 24, maxZoom: 15 });
        } catch (err) {
          console.warn('LocatorMap: could not load route lines', err);
        }
      });
    }
```

- [ ] **Step 6: Update the route page**

In `app/src/routes/route/[id]/+page.svelte`:

```svelte
  {#if r.coords}
    <LocatorMap
      coords={r.coords}
      title={r.title}
      accuracyM={r.coordsAccuracyM}
      routeId={r.id}
      hasLine={r.hasLine}
    />
  {/if}
```

- [ ] **Step 7: Update the LocatorMap unit test**

In `app/src/lib/components/LocatorMap.test.ts`, replace every `referencedPaths` prop with `routeId` and `hasLine`. Add:

```ts
it('does not fetch route lines for a route that has none', async () => {
  const fetchSpy = vi.spyOn(globalThis, 'fetch');
  render(LocatorMap, { coords: { lat: -34, lon: 18.4, zoom: 15 }, title: 'X', routeId: 'a--b--c' });
  expect(fetchSpy).not.toHaveBeenCalledWith(expect.stringContaining('route-lines.geojson'));
});
```

- [ ] **Step 8: Run the full unit suite and the type check**

Run: `cd app && npm test && npm run check`
Expected: PASS, with no remaining reference to `REFERENCED_PATH_LAYERS` anywhere.

Verify: `rg "referencedPaths|REFERENCED_PATH_LAYERS|paths-referenced" app/ docs/superpowers/plans` returns nothing outside this plan and the 4e spec.

- [ ] **Step 9: Add the route-page e2e**

Add to `app/e2e/map.spec.ts`:

```ts
  test('a route page with a line shows it on the locator map', async ({ page }) => {
    const target = await page.evaluate(async () => {
      const routes = (await (await fetch('data/routes-index.json')).json()) as Array<{
        id: string; hasLine: boolean;
      }>;
      return routes.find((r) => r.hasLine)?.id ?? null;
    });
    test.skip(!target, 'no route in this build has a line yet');
    await page.goto(`./route/${target}`);
    await expect(page.getByTestId('locator-map')).toBeVisible();
    // The locator map is a different container from the main map, so it needs
    // its own instance lookup rather than renderedCount's [data-testid="map"].
    const drawn = await page.evaluate(async () => {
      const el = document.querySelector('[data-testid="locator-map"]') as HTMLElement & {
        __maplibreMap?: import('maplibre-gl').Map;
      };
      const map = el.__maplibreMap!;
      if (!map.loaded() || map.isMoving()) {
        await new Promise<void>((resolve) => map.once('idle', () => resolve()));
      }
      return map.queryRenderedFeatures(undefined, { layers: ['route-line'] }).length;
    });
    expect(drawn).toBeGreaterThan(0);
  });
```

This needs `LocatorMap` to expose its instance the way `MapView` does. Add to `LocatorMap.svelte`, immediately after the map is constructed:

```ts
    // Test-only hook, mirroring MapView's: WebGL pixels are not queryable from
    // Playwright, so an e2e asserting the line renders has no other way in.
    (container as HTMLDivElement & { __maplibreMap?: MapLibreMap }).__maplibreMap = map;
```

- [ ] **Step 10: Run the e2e suite**

Run: `cd app && npm run build && npm run test:e2e`
Expected: PASS

- [ ] **Step 11: Commit**

```bash
git add app/src app/e2e
git commit -m "feat(app): show the line beside the description that drew it"
```

---

## Task 13: Look at it, then record what shipped

**Files:**
- Modify: `docs/superpowers/specs/2026-08-06-phase4e-named-paths-design.md`, `README.md` (if it describes the map)

- [ ] **Step 1: Look at the map in a browser**

Run: `cd app && npm run dev`, then open the app.

This project has twice shipped bugs that passed every check except a browser. Check, at overview, mid and close-in zoom:

- a relation-tier route: does the line follow the ravine the description describes?
- a stitch-tier route: does it start and end where the prose does — or does it double back?
- a route with no line: is the map quieter but still useful, with the named-path labels and the panel list carrying the information?
- does the line read as the route against the contours, and is the casing enough to separate it?
- a route marked done: is the line green?

**A line up the wrong ravine passes every assertion in this plan.** This step is the only thing that catches it. If one is wrong, remove that route from `data/route-relations.json` or tighten the gate — do not adjust it by hand.

- [ ] **Step 2: Close the loop in the 4e spec**

Add a short section to `docs/superpowers/specs/2026-08-06-phase4e-named-paths-design.md` under "Relationship to Phase 4d", stating what actually happened: the referenced-path highlight was removed in 4d because name-matching has no extent, the quiet label tier and the `MentionedPaths` panel survive, and the `match.py` finding this spec recorded was fixed in Task 8.

- [ ] **Step 3: Commit**

```bash
git add docs
git commit -m "docs: record what 4d took back from 4e, and why"
```

- [ ] **Step 4: Report the final numbers**

State: lines shipped by tier, routes left with a pin only, and the published output size (`du -sh app/build`) against the 1 GB Pages limit.
