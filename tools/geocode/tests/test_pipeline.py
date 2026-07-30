from __future__ import annotations

from kaap_geocode.features import Feature
from kaap_geocode.overrides import Override
from kaap_geocode.pipeline import locate_all


def route(area, slug, lat=None, lon=None, zoom=17):
    coords = None if lat is None else {"lat": lat, "lon": lon, "zoom": zoom}
    return {"area": area, "slug": slug, "title": slug.replace("-", " ").title(), "coords": coords}


def titled(area, slug, title, lat=None, lon=None):
    r = route(area, slug, lat, lon)
    r["title"] = title
    return r


def feature(name, lat, lon, osm_id=1):
    return Feature(name=name, lat=lat, lon=lon, osm_type="node", osm_id=osm_id, kind="natural=peak")


def test_crawl_coordinates_are_kept_and_labelled():
    routes = [route(["Table-Mountain", "atlantic-west"], "kasteelspoort", -33.97, 18.39)]
    out = locate_all(routes, [], {})
    loc = out.locations["table-mountain--atlantic-west--kasteelspoort"]
    assert loc.source == "crawl"
    assert (loc.lat, loc.lon, loc.zoom) == (-33.97, 18.39, 17)
    assert loc.accuracy_m is None


def test_a_curated_override_beats_a_crawl_coordinate():
    routes = [route(["Table-Mountain", "atlantic-west"], "kasteelspoort", -33.97, 18.39)]
    overrides = {
        "table-mountain--atlantic-west--kasteelspoort": Override(
            route_id="table-mountain--atlantic-west--kasteelspoort",
            lat=-33.98,
            lon=18.40,
            source="surveyed on site",
            zoom=16,
        )
    }
    out = locate_all(routes, [], overrides)
    loc = out.locations["table-mountain--atlantic-west--kasteelspoort"]
    assert loc.source == "curated"
    assert (loc.lat, loc.lon, loc.zoom) == (-33.98, 18.40, 16)


def test_an_unlocated_route_matches_a_named_feature_in_its_area():
    routes = [
        route(["Table-Mountain", "newlands-east"], "sibling", -33.97, 18.43),
        titled(["Table-Mountain", "newlands-east"], "newlands-ravine", "Newlands Ravine"),
    ]
    out = locate_all(routes, [feature("Newlands Ravine", -33.965, 18.435, osm_id=7)], {})
    loc = out.locations["table-mountain--newlands-east--newlands-ravine"]
    assert loc.source == "osm-match"
    assert loc.osm == {"type": "node", "id": 7, "name": "Newlands Ravine"}
    assert loc.matched_candidate == "Newlands Ravine"
    assert loc.accuracy_m is None


def test_a_same_named_feature_outside_the_area_falls_through_to_area_approx():
    routes = [
        route(["Table-Mountain", "newlands-east"], "sibling", -33.97, 18.43),
        titled(["Table-Mountain", "newlands-east"], "newlands-ravine", "Newlands Ravine"),
    ]
    # Right name, Eastern Cape coordinates.
    out = locate_all(routes, [feature("Newlands Ravine", -32.0, 25.0)], {})
    loc = out.locations["table-mountain--newlands-east--newlands-ravine"]
    assert loc.source == "area-approx"
    assert loc.accuracy_m is not None and loc.accuracy_m > 0


def test_an_ambiguous_match_is_recorded_and_falls_through_to_area_approx():
    routes = [
        route(["Table-Mountain", "newlands-east"], "sibling", -33.97, 18.43),
        titled(["Table-Mountain", "newlands-east"], "window-gorge", "Window Gorge"),
    ]
    features = [
        feature("Window Gorge", -33.975, 18.432, osm_id=20),
        feature("Window Gorge", -33.976, 18.433, osm_id=21),
    ]
    out = locate_all(routes, features, {})
    loc = out.locations["table-mountain--newlands-east--window-gorge"]
    assert loc.source == "area-approx"
    assert ("table-mountain--newlands-east--window-gorge", "Window Gorge", 2) in out.ambiguous


def test_a_route_whose_area_has_no_located_siblings_stays_unlocated():
    routes = [titled(["other-areas"], "mt-zebra", "Mt Zebra Park")]
    out = locate_all(routes, [], {})
    assert "other-areas--mt-zebra" not in out.locations
    assert "other-areas--mt-zebra" in out.unlocated


def test_every_location_carries_a_source():
    routes = [
        route(["Table-Mountain", "atlantic-west"], "kasteelspoort", -33.97, 18.39),
        titled(["Table-Mountain", "atlantic-west"], "corridor-rib", "Corridor Rib"),
    ]
    out = locate_all(routes, [], {})
    assert out.locations
    for loc in out.locations.values():
        assert loc.source in {"curated", "crawl", "osm-match", "area-approx"}


def test_a_crawl_coordinate_keeps_an_explicit_zoom_of_zero():
    # 0 is a real zoom level; `or` would silently replace it with 15.
    routes = [route(["a"], "x", -33.97, 18.39, zoom=0)]
    out = locate_all(routes, [], {})
    assert out.locations["a--x"].zoom == 0


def test_a_crawl_coordinate_with_no_zoom_falls_back_to_the_default():
    routes = [{"area": ["a"], "slug": "x", "title": "X", "coords": {"lat": -33.97, "lon": 18.39}}]
    out = locate_all(routes, [], {})
    assert out.locations["a--x"].zoom == 15


def test_an_override_matching_no_route_is_reported_rather_than_ignored():
    routes = [route(["a"], "x", -33.97, 18.39)]
    overrides = {
        "a--typo": Override(route_id="a--typo", lat=-33.9, lon=18.4, source="somewhere")
    }
    out = locate_all(routes, [], overrides)
    assert out.orphaned_overrides == ["a--typo"]
    # The real route is unaffected.
    assert out.locations["a--x"].source == "crawl"


def test_no_orphans_when_every_override_matches_a_route():
    routes = [route(["a"], "x", -33.97, 18.39)]
    overrides = {"a--x": Override(route_id="a--x", lat=-33.9, lon=18.4, source="checked")}
    out = locate_all(routes, [], overrides)
    assert out.orphaned_overrides == []
    assert out.locations["a--x"].source == "curated"
