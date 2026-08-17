"""Distances and node keys.

The node key is the load-bearing piece. OSM ways that meet genuinely share a
node, and osmium's GeoJSON export writes the same rounded coordinate on both
sides of it — so rounding to the export's own precision and comparing exactly
is a sound join, where a floating-point equality on raw values would not be.
Seven places is ~1 cm; two distinct OSM nodes are never that close in practice.
"""

from __future__ import annotations

from math import asin, cos, radians, sin, sqrt
from typing import Sequence

Point = tuple[float, float]  # (lon, lat), as GeoJSON and osmium write it
NodeKey = tuple[float, float]

_PLACES = 7
_EARTH_RADIUS_M = 6_371_008.8  # mean radius; the region spans ~40 km


def node_key(point: Point) -> NodeKey:
    return (round(point[0], _PLACES), round(point[1], _PLACES))


def haversine_m(a: Point, b: Point) -> float:
    lon1, lat1 = radians(a[0]), radians(a[1])
    lon2, lat2 = radians(b[0]), radians(b[1])
    h = sin((lat2 - lat1) / 2) ** 2 + cos(lat1) * cos(lat2) * sin((lon2 - lon1) / 2) ** 2
    return 2 * _EARTH_RADIUS_M * asin(sqrt(h))


def length_m(coords: Sequence[Point]) -> float:
    # Rounded so that a length computed two different ways (summed once, or
    # summed per-segment and added) compares equal — lengths are reported and
    # compared against the gate thresholds, and float noise there is noise in
    # the report.
    return round(sum(haversine_m(a, b) for a, b in zip(coords, coords[1:])), 6)
