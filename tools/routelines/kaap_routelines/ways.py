"""Read osmium's GeoJSON-seq export into walkable ways.

Unlike tools/geocode/kaap_geocode/features.py this KEEPS unnamed ways. A trail
in OSM is named on some segments and not on others, and the unnamed ones are
precisely the connectors that make it continuous — dropping them is what makes
a name-matched highlight look broken.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from .geo import Point, length_m

#: Ways a walker can use. `steps` and `track` matter for connectivity even
#: where a route would not be described as following them.
WALKABLE_HIGHWAYS = frozenset({"path", "footway", "track", "steps"})


@dataclass(frozen=True)
class Way:
    osm_id: int
    name: str | None
    coords: tuple[Point, ...]

    @property
    def start(self) -> Point:
        return self.coords[0]

    @property
    def end(self) -> Point:
        return self.coords[-1]

    @property
    def length_m(self) -> float:
        return length_m(self.coords)


def _osm_id(raw: dict) -> int:
    unique_id = str((raw.get("properties") or {}).get("@id") or raw.get("id") or "")
    digits = unique_id[1:]
    return int(digits) if digits.isdigit() else 0


def read_ways(path: Path) -> list[Way]:
    ways: list[Way] = []
    with open(path, encoding="utf-8") as handle:
        for line in handle:
            line = line.strip().lstrip("\x1e")  # geojsonseq may use RS separators
            if not line:
                continue
            raw = json.loads(line)
            properties = raw.get("properties") or {}
            if properties.get("highway") not in WALKABLE_HIGHWAYS:
                continue
            geometry = raw.get("geometry") or {}
            if geometry.get("type") != "LineString":
                continue
            coords = tuple((float(c[0]), float(c[1])) for c in geometry.get("coordinates") or [])
            if len(coords) < 2:
                continue
            name = (properties.get("name") or "").strip() or None
            ways.append(Way(osm_id=_osm_id(raw), name=name, coords=coords))
    return ways
