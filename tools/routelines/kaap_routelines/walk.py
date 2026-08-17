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
