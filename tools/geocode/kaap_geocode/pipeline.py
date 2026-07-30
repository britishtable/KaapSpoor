"""The tier ladder: curated, then crawl, then OSM match, then area-approximate.

Every located route gets an entry, including the 125 the crawl already had, so
provenance has exactly one source of truth instead of the app having to infer
"no entry means crawl". Routes that reach the bottom of the ladder without a
position stay unlocated and keep the honest unmapped path the app already has.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

from .approx import area_approx
from .areas import bbox_of, located_scope
from .features import Feature
from .ids import route_id
from .match import AmbiguousMatch, find_match, index_features
from .normalise import candidates
from .overrides import Override

Source = Literal["curated", "crawl", "osm-match", "area-approx"]

# An OSM feature is a real place, so the locator map can sit in close. An
# area-level guess must not: opening at trail zoom would imply a precision the
# coordinate does not have.
ZOOM_OSM_MATCH = 15
ZOOM_AREA_APPROX = 11


@dataclass(frozen=True)
class Location:
    route_id: str
    lat: float
    lon: float
    zoom: int
    source: Source
    accuracy_m: int | None = None
    osm: dict[str, Any] | None = None
    matched_candidate: str | None = None


@dataclass
class Outcome:
    locations: dict[str, Location]
    unlocated: list[str]
    # (route_id, candidate, feature_count) — the curation queue.
    ambiguous: list[tuple[str, str, int]]
    # Override entries whose routeId matches no route in this crawl — a typo, or
    # a route since renamed or removed. Silently ignoring them would quietly
    # weaken the one tier a human personally vouched for.
    orphaned_overrides: list[str]


def locate_all(
    routes: list[dict[str, Any]],
    features: list[Feature],
    overrides: dict[str, Override],
) -> Outcome:
    locations: dict[str, Location] = {}
    unlocated: list[str] = []
    ambiguous: list[tuple[str, str, int]] = []
    # Normalise every feature name once, not once per unlocated route.
    feature_index = index_features(features)

    for raw in routes:
        rid = route_id(raw.get("area") or [], raw.get("slug") or "")

        override = overrides.get(rid)
        if override is not None:
            locations[rid] = Location(
                route_id=rid,
                lat=override.lat,
                lon=override.lon,
                zoom=override.zoom,
                source="curated",
            )
            continue

        coords = raw.get("coords")
        if coords and coords.get("lat") is not None and coords.get("lon") is not None:
            raw_zoom = coords.get("zoom")
            locations[rid] = Location(
                route_id=rid,
                lat=float(coords["lat"]),
                lon=float(coords["lon"]),
                zoom=ZOOM_OSM_MATCH if raw_zoom is None else int(raw_zoom),
                source="crawl",
            )
            continue

        # Unlocated: what does its area know?
        _scope, siblings = located_scope(routes, raw.get("area") or [])
        if not siblings:
            unlocated.append(rid)
            continue

        bbox = bbox_of(siblings)
        assert bbox is not None  # siblings are located by construction

        match = None
        try:
            match = find_match(candidates(raw.get("title") or ""), feature_index, bbox)
        except AmbiguousMatch as exc:
            ambiguous.append((rid, exc.candidate, exc.count))

        if match is not None:
            locations[rid] = Location(
                route_id=rid,
                lat=match.feature.lat,
                lon=match.feature.lon,
                zoom=ZOOM_OSM_MATCH,
                source="osm-match",
                osm={
                    "type": match.feature.osm_type,
                    "id": match.feature.osm_id,
                    "name": match.feature.name,
                },
                matched_candidate=match.candidate,
            )
            continue

        approx = area_approx(siblings)
        if approx is None:
            unlocated.append(rid)
            continue

        locations[rid] = Location(
            route_id=rid,
            lat=approx.lat,
            lon=approx.lon,
            zoom=ZOOM_AREA_APPROX,
            source="area-approx",
            accuracy_m=approx.accuracy_m,
        )

    seen = {route_id(raw.get("area") or [], raw.get("slug") or "") for raw in routes}
    orphaned_overrides = sorted(rid for rid in overrides if rid not in seen)

    return Outcome(
        locations=locations,
        unlocated=unlocated,
        ambiguous=ambiguous,
        orphaned_overrides=orphaned_overrides,
    )
