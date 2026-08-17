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

from .geo import NodeKey, Point, haversine_m, node_key
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
#: A trail of the right name but this far from the route is not this route's
#: trail. `Traverse` is an OSM path name 111 km away and the matcher sees the
#: word in "7 Buttresses Apostles Traverse"; `Echo Valley` sits 18 km from the
#: route naming it. Distance is the test rather than word count, because the
#: defect is a namesake elsewhere, not a short name.
MAX_TRAIL_DISTANCE_M = 5_000.0


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


def _nearest_run(
    anchor: Point, trail_runs: list[tuple[Way, ...]]
) -> tuple[tuple[Way, ...] | None, float]:
    """The run closest to the route's own position, and how far off it is."""
    best: tuple[Way, ...] | None = None
    best_d = float("inf")
    for run in trail_runs:
        distance = min(
            min(haversine_m(anchor, way.start), haversine_m(anchor, way.end)) for way in run
        )
        if distance < best_d:
            best, best_d = run, distance
    return best, best_d


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

    # The anchor is checked first: if the route's own position is nowhere near
    # the network, that is the honest diagnosis, and every trail would look
    # out of range for the same reason.
    start = graph.nearest_node(anchor, SNAP_RADIUS_M)
    if start is None:
        return Rejected(f"anchor: no path within {SNAP_RADIUS_M:.0f} m of the position")

    chosen: list[tuple[Way, ...]] = []
    kept: list[str] = []
    for name in names:
        trail = trails.get(name)
        if trail is None:
            return Rejected(f"unknown trail: {name!r} is not in the extract")
        trail_runs = runs(trail)
        in_range = [
            run for run in trail_runs
            if _nearest_run(anchor, [run])[1] <= MAX_TRAIL_DISTANCE_M
        ]
        if not in_range:
            # A namesake somewhere else in the province. Skipping it beats
            # rejecting the route: the other names it gives are still good.
            continue
        # A single mention has no ordering to disambiguate WHICH run the route
        # walks, so proximity has to do it alone — and it only can when one run
        # is in range. Two nearby runs of one name is still a guess.
        if len(names) == 1 and len(in_range) > 1:
            return Rejected(
                f"disjoint runs: {name!r} is {len(in_range)} unconnected pieces "
                "near this route and there is no second name to order them by"
            )
        # The run nearest the route, not the longest. A name can carry several
        # unconnected runs (Contour Path is 9 in this extract) and the longest
        # of them is not the one this particular route walks.
        near, _ = _nearest_run(anchor, in_range)
        assert near is not None
        chosen.append(near)
        kept.append(name)

    if not chosen:
        return Rejected(
            f"no names in range: every trail named is over "
            f"{MAX_TRAIL_DISTANCE_M / 1000:.0f} km from the route's position"
        )
    names = kept

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
        # Keyed by the piece itself, not by osm_id: one OSM way is cut into
        # several graph edges at its junctions, and they all carry the same id.
        remaining = set(run)
        while True:
            options = [way for way in graph.adjacency.get(current, ()) if way in remaining]
            if not options:
                break
            way = max(options, key=lambda candidate: candidate.length_m)
            remaining.discard(way)
            current = _append(coords, way, current)
            way_ids.append(way.osm_id)

    if len(coords) < 2:
        return Rejected("empty: the walk covered no ground")

    # A hike does not walk the same ground twice. A trail's run can branch and
    # rejoin, and the follow above walks every piece of it, so a fork comes out
    # as a line that runs up one side and back down the other. Closing a loop —
    # first point equal to last — is the one repeat a real route has.
    keys = [node_key(point) for point in coords]
    closure = 1 if keys[0] == keys[-1] else 0
    retraced = len(keys) - len(set(keys)) - closure
    if retraced > 0:
        return Rejected(
            f"retraces: the walk covers {retraced} point(s) twice, so it runs out "
            "and back rather than along the route"
        )

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
