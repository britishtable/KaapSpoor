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
