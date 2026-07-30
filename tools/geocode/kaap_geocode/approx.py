"""The last tier: the area, not the route.

When a route cannot be tied to any named feature, the honest fallback is where
its area is — with a radius saying how loosely that is meant. The radius is not
decoration: Plan 3 draws it as an uncertainty circle, which is what stops an
area-level guess from looking like a surveyed position.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

EARTH_RADIUS_M = 6_371_000

# A lone located sibling would give a radius of zero, which would render as a
# precise dot — precisely the impression this tier must not create. Floor it at
# a value that reads as "somewhere around here" at trail scale.
MIN_ACCURACY_M = 2_000


@dataclass(frozen=True)
class Approx:
    lat: float
    lon: float
    accuracy_m: int


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    d_phi = phi2 - phi1
    d_lambda = math.radians(lon2 - lon1)
    a = (
        math.sin(d_phi / 2) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
    )
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(a))


def area_approx(siblings: list[dict[str, Any]]) -> Approx | None:
    points = [
        (s["coords"]["lat"], s["coords"]["lon"])
        for s in siblings
        if s.get("coords") and s["coords"].get("lat") is not None
    ]
    if not points:
        return None

    lat = sum(p[0] for p in points) / len(points)
    lon = sum(p[1] for p in points) / len(points)
    furthest = max(haversine_m(lat, lon, p[0], p[1]) for p in points)
    return Approx(lat=lat, lon=lon, accuracy_m=max(MIN_ACCURACY_M, round(furthest)))
