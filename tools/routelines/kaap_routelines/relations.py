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
