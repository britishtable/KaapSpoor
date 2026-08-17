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
    #
    # Members are looked up among the ways passed in rather than taken off the
    # relation, because those ways are the graph's own edges: `split_ways` cuts
    # each OSM way at its junctions, so one member id is several edges and only
    # the edges are walkable.
    if relations:
        by_osm_id: dict[int, list[Way]] = {}
        for way in ways:
            by_osm_id.setdefault(way.osm_id, []).append(way)
        for relation in relations:
            members = tuple(
                piece
                for member in relation.members
                for piece in by_osm_id.get(member.way.osm_id, ())
            )
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
