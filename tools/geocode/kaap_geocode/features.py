"""Read osmium's GeoJSON-seq export into flat, named point features.

Routes are single points (the source has no tracks), so a ravine's linestring
or a reserve's polygon collapses to the midpoint of its bounding box. That is
imprecise by construction, which is exactly why the match it produces is
recorded as `osm-match` with the feature named rather than presented as a
surveyed position.

Unnamed features are dropped: matching is by name, so they can never match, and
carrying them would multiply the search space for nothing.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterator

# Tags that make a feature nameable by a route title, in the order they are
# reported as `kind`. Purely descriptive — it appears in the review report so a
# human can see what a route was matched to.
KIND_TAGS = ("natural", "waterway", "leisure", "boundary", "highway")

_OSM_TYPES = {"n": "node", "w": "way", "r": "relation"}


@dataclass(frozen=True)
class Feature:
    name: str
    lat: float
    lon: float
    osm_type: str
    osm_id: int
    kind: str


def _coordinates(geometry: dict[str, Any]) -> Iterator[tuple[float, float]]:
    """Yield (lon, lat) pairs from any GeoJSON geometry, at any nesting depth."""

    def walk(node: Any) -> Iterator[tuple[float, float]]:
        if (
            isinstance(node, list)
            and len(node) == 2
            and all(isinstance(v, (int, float)) for v in node)
        ):
            yield float(node[0]), float(node[1])
        elif isinstance(node, list):
            for child in node:
                yield from walk(child)

    yield from walk(geometry.get("coordinates"))


def _kind(properties: dict[str, Any]) -> str:
    for tag in KIND_TAGS:
        if properties.get(tag):
            return f"{tag}={properties[tag]}"
    return "unknown"


def read_features(path: Path) -> list[Feature]:
    features: list[Feature] = []
    with open(path, encoding="utf-8") as handle:
        for line in handle:
            line = line.strip().lstrip("\x1e")  # geojsonseq may use RS separators
            if not line:
                continue
            raw = json.loads(line)
            properties = raw.get("properties") or {}
            name = (properties.get("name") or "").strip()
            if not name:
                continue

            points = list(_coordinates(raw.get("geometry") or {}))
            if not points:
                continue
            lons = [p[0] for p in points]
            lats = [p[1] for p in points]

            unique_id = str(properties.get("@id") or raw.get("id") or "")
            osm_type = _OSM_TYPES.get(unique_id[:1], "unknown")
            digits = unique_id[1:]
            osm_id = int(digits) if digits.isdigit() else 0

            features.append(
                Feature(
                    name=name,
                    lat=(min(lats) + max(lats)) / 2,
                    lon=(min(lons) + max(lons)) / 2,
                    osm_type=osm_type,
                    osm_id=osm_id,
                    kind=_kind(properties),
                )
            )
    return features
