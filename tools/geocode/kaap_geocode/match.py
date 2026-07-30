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
