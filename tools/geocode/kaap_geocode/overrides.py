"""The curated tier: coordinates a human looked up and vouched for.

Highest precedence of all four tiers, including over the crawl's own
coordinates, because it is the only tier somebody personally checked. That
authority is why `source` is mandatory: an unsourced override is indistinguishable
from a guess, and this file is meant to be reviewable in a diff years later.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

DEFAULT_ZOOM = 15


class OverrideError(Exception):
    """A geocode-overrides.json entry is invalid."""


@dataclass(frozen=True)
class Override:
    route_id: str
    lat: float
    lon: float
    source: str
    note: str = ""
    zoom: int = DEFAULT_ZOOM


def load_overrides(path: Path) -> dict[str, Override]:
    if not Path(path).exists():
        return {}

    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    out: dict[str, Override] = {}

    for raw in payload.get("overrides", []):
        route_id = str(raw.get("routeId") or "").strip()
        if not route_id:
            raise OverrideError("override is missing routeId")
        if route_id in out:
            raise OverrideError(f"duplicate routeId {route_id!r} in overrides")

        source = str(raw.get("source") or "").strip()
        if not source:
            raise OverrideError(
                f"override {route_id!r} has no source — every curated coordinate "
                "must say where it came from"
            )

        try:
            lat = float(raw["lat"])
            lon = float(raw["lon"])
        except (KeyError, TypeError, ValueError) as exc:
            raise OverrideError(f"override {route_id!r} has invalid lat/lon") from exc

        if not -90.0 <= lat <= 90.0:
            raise OverrideError(f"override {route_id!r} has out-of-range lat {lat}")
        if not -180.0 <= lon <= 180.0:
            raise OverrideError(f"override {route_id!r} has out-of-range lon {lon}")

        out[route_id] = Override(
            route_id=route_id,
            lat=lat,
            lon=lon,
            source=source,
            note=str(raw.get("note") or ""),
            zoom=int(raw.get("zoom") or DEFAULT_ZOOM),
        )

    return out
