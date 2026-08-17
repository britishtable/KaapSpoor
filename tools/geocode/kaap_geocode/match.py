"""Match a route's candidate names against named OSM features in its area.

Two rules carry the honesty of this tier:

1. A match must fall inside the route's own area bbox. A right name in the wrong
   province is the failure that would damage trust most, and this is the defence.
2. Two features sharing a name inside that bbox is an ambiguity, not a match —
   UNLESS they are ways forming one connected run, which is fragmentation
   rather than ambiguity. OSM cuts a trail at every junction, so 27 segments
   called Contour Path are one trail; two summits called Klipspringer are two
   places. Connectedness is what separates the cases, and counting alone is
   what held this tier to 11 matches while 45 route titles are exactly an OSM
   path name. Where the run is one trail, the match is positioned at the
   midpoint of the whole run. Anything genuinely ambiguous still raises and
   lands in the review report for curation.
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


#: Features grouped by `comparison_key(name)`. Built once per run.
FeatureIndex = dict[str, list[Feature]]


def index_features(features: list[Feature]) -> FeatureIndex:
    """Group features by comparison key, so each name is normalised once.

    A real extract holds millions of named features and the ladder asks about
    every unlocated route in turn; keying inside `find_match` re-ran the whole
    normalisation for each one. The index is bbox-free precisely so it can be
    shared — `find_match` applies each route's own bbox to the shortlist.
    """
    by_key: FeatureIndex = defaultdict(list)
    for feature in features:
        by_key[comparison_key(feature.name)].append(feature)
    return dict(by_key)


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
