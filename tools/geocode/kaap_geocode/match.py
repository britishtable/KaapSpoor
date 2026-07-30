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


def find_match(
    candidate_names: list[str], index: FeatureIndex, bbox: BBox
) -> Match | None:
    for candidate in candidate_names:
        # Filter after the name lookup, not before: the index is shared across
        # routes but the bbox is not. Ambiguity is still judged on what is
        # inside the bbox alone, so a namesake elsewhere cannot block a match.
        hits = [f for f in index.get(comparison_key(candidate), ()) if bbox.contains(f.lat, f.lon)]
        if len(hits) > 1:
            raise AmbiguousMatch(candidate, len(hits))
        if hits:
            return Match(feature=hits[0], candidate=candidate)
    return None
