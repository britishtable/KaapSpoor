"""A walking graph over OSM ways.

Nodes are rounded coordinates (see geo.node_key), not OSM node ids: osmium's
GeoJSON export does not carry node ids, and ways that meet genuinely share the
coordinate.

Edges are ways CUT AT THEIR JUNCTIONS (see `split_ways`). An earlier version of
this module took whole ways as edges, on the assumption that OSM already cuts a
way wherever another meets it. That is true of the vector tiles and false of a
raw way export: measured on this extract, 156,643 junctions are interior
vertices of some way against 63,353 that are way endpoints, so an endpoint-only
graph missed ~71 % of them and shattered into 127,109 components whose largest
held 1,889 of 325,799 nodes. Nothing could reach anything.
"""

from __future__ import annotations

import heapq
from collections import Counter
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


def split_ways(ways: Iterable[Way]) -> list[Way]:
    """Cut every way at the vertices it shares with another way.

    A junction is a coordinate carried by two DIFFERENT ways — counting
    appearances instead would cut a way wherever it touches itself, which a
    lollipop does for no useful reason. Each piece keeps its way's id and name,
    so provenance and name-matching are unaffected; only connectivity changes.
    """
    ways = list(ways)
    carrying = Counter()
    for way in ways:
        # set(): one vote per way, so self-touches do not make a junction.
        carrying.update({node_key(point) for point in way.coords})

    pieces: list[Way] = []
    for way in ways:
        keys = [node_key(point) for point in way.coords]
        cuts = [0]
        cuts += [
            index
            for index in range(1, len(keys) - 1)
            if carrying[keys[index]] > 1
        ]
        cuts.append(len(keys) - 1)
        for start, end in zip(cuts, cuts[1:]):
            if end - start >= 1:
                pieces.append(
                    Way(osm_id=way.osm_id, name=way.name, coords=way.coords[start : end + 1])
                )
    return pieces


def build_graph(ways: Iterable[Way]) -> Graph:
    adjacency: dict[NodeKey, list[Way]] = {}
    for way in ways:
        start, end = node_key(way.start), node_key(way.end)
        adjacency.setdefault(start, []).append(way)
        # A closed loop would otherwise list itself twice from one node.
        if end != start:
            adjacency.setdefault(end, []).append(way)
    return Graph(adjacency)
