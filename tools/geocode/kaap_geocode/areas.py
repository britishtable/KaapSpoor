"""Where an area is, according to the routes already located inside it.

A name match is only believable if it lands in the right part of the world. The
route's own area supplies that constraint, and the area's extent is not
hard-coded anywhere — it is derived from the coordinates the crawl already has.
Areas with no located routes of their own widen to their parent rather than
being given up on.
"""

from __future__ import annotations

from typing import Any, NamedTuple


class BBox(NamedTuple):
    west: float
    south: float
    east: float
    north: float

    def contains(self, lat: float, lon: float) -> bool:
        return self.west <= lon <= self.east and self.south <= lat <= self.north


def _is_located(route: dict[str, Any]) -> bool:
    coords = route.get("coords")
    return bool(coords) and coords.get("lat") is not None and coords.get("lon") is not None


def _under(route: dict[str, Any], path: list[str]) -> bool:
    area = route.get("area") or []
    return area[: len(path)] == path


def located_scope(
    routes: list[dict[str, Any]], area: list[str]
) -> tuple[list[str], list[dict[str, Any]]]:
    """Narrowest prefix of `area` containing located routes, and those routes."""
    for depth in range(len(area), 0, -1):
        path = area[:depth]
        siblings = [r for r in routes if _is_located(r) and _under(r, path)]
        if siblings:
            return path, siblings
    return [], []


def bbox_of(routes: list[dict[str, Any]], margin_deg: float = 0.05) -> BBox | None:
    located = [r for r in routes if _is_located(r)]
    if not located:
        return None
    lats = [r["coords"]["lat"] for r in located]
    lons = [r["coords"]["lon"] for r in located]
    return BBox(
        west=min(lons) - margin_deg,
        south=min(lats) - margin_deg,
        east=max(lons) + margin_deg,
        north=max(lats) + margin_deg,
    )
