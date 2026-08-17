from __future__ import annotations

import pytest

from kaap_geocode.areas import BBox
from kaap_geocode.features import Feature
from kaap_geocode.match import AmbiguousMatch, find_match, index_features

CAPE = BBox(west=18.0, south=-34.4, east=19.0, north=-33.5)


def feature(name, lat, lon, osm_id=1, osm_type="node", kind="natural=peak"):
    return Feature(name=name, lat=lat, lon=lon, osm_type=osm_type, osm_id=osm_id, kind=kind)


def test_matches_an_exact_name_inside_the_bbox():
    features = [feature("Newlands Ravine", -33.965, 18.435)]
    got = find_match(["Newlands Ravine"], index_features(features), CAPE)
    assert got is not None
    assert got.feature.osm_id == 1
    assert got.candidate == "Newlands Ravine"


def test_rejects_a_correct_name_outside_the_bbox():
    # The same name exists in the Eastern Cape. Without the bbox constraint this
    # is exactly the false positive that would damage trust most.
    features = [feature("Newlands Ravine", -32.0, 25.0)]
    assert find_match(["Newlands Ravine"], index_features(features), CAPE) is None


def test_matching_ignores_case_punctuation_and_abbreviations():
    features = [feature("Elsies Peak", -34.13, 18.438)]
    got = find_match(["Elsies Pk"], index_features(features), CAPE)
    assert got is not None
    assert got.candidate == "Elsies Pk"


def test_tries_candidates_in_order_and_prefers_the_most_specific():
    features = [
        feature("Lion's Head", -33.935, 18.389, osm_id=10),
        feature("Lion's Head B", -33.936, 18.390, osm_id=11),
    ]
    got = find_match(["Lion's Head B", "Lion's Head"], index_features(features), CAPE)
    assert got is not None
    assert got.feature.osm_id == 11  # the first candidate that matched, not the last


def test_returns_none_when_no_candidate_matches():
    features = [feature("Devil's Peak", -33.9525, 18.4575)]
    assert find_match(["Carrel's Ledge", "Carrel"], index_features(features), CAPE) is None


def test_raises_on_two_features_with_the_same_name_inside_the_bbox():
    features = [
        feature("Window Gorge", -33.98, 18.43, osm_id=20),
        feature("Window Gorge", -33.99, 18.44, osm_id=21),
    ]
    with pytest.raises(AmbiguousMatch) as excinfo:
        find_match(["Window Gorge"], index_features(features), CAPE)
    assert excinfo.value.candidate == "Window Gorge"
    assert excinfo.value.count == 2


def test_ambiguity_outside_the_bbox_does_not_block_a_match_inside_it():
    features = [
        feature("Window Gorge", -33.98, 18.43, osm_id=20),
        feature("Window Gorge", -32.0, 25.0, osm_id=21),
    ]
    got = find_match(["Window Gorge"], index_features(features), CAPE)
    assert got is not None
    assert got.feature.osm_id == 20


def test_a_curly_apostrophe_feature_name_matches_a_straight_quoted_title():
    # OSM stores U+2019; the wiki titles use U+0027. Both must key alike or the
    # whole apostrophe'd share of the corpus falls to area-approx.
    features = [feature("Devil’s Peak", -33.9525, 18.4575, osm_id=30)]
    got = find_match(["Devil's Peak"], index_features(features), CAPE)
    assert got is not None
    assert got.feature.osm_id == 30


def test_one_index_serves_routes_in_different_bboxes():
    # The index is built once for the whole run, so the bbox has to be applied
    # per lookup rather than baked into it.
    index = index_features(
        [
            feature("Newlands Ravine", -33.965, 18.435, osm_id=40),
            feature("Newlands Ravine", -32.0, 25.0, osm_id=41),
        ]
    )
    eastern = BBox(west=24.0, south=-33.0, east=26.0, north=-31.0)
    assert find_match(["Newlands Ravine"], index, CAPE).feature.osm_id == 40
    assert find_match(["Newlands Ravine"], index, eastern).feature.osm_id == 41


BOX = BBox(west=18.0, south=-35.0, east=19.0, north=-33.0)


def _way(osm_id: int, name: str, coords: list[tuple[float, float]]) -> Feature:
    lons = [c[0] for c in coords]
    lats = [c[1] for c in coords]
    return Feature(
        name=name,
        lat=(min(lats) + max(lats)) / 2,
        lon=(min(lons) + max(lons)) / 2,
        osm_type="way",
        osm_id=osm_id,
        kind="highway=path",
        endpoints=((coords[0][0], coords[0][1]), (coords[-1][0], coords[-1][1])),
    )


def test_connected_same_named_ways_are_one_trail_not_an_ambiguity():
    # 27 segments called Contour Path are one trail cut at every junction.
    # Reading that as ambiguity is what held the geocoder to 11 matches while
    # 45 route titles are exactly an OSM path name.
    ways = [
        _way(1, "Muizenberg Buttress", [(18.45, -34.10), (18.46, -34.10)]),
        _way(2, "Muizenberg Buttress", [(18.46, -34.10), (18.47, -34.10)]),
    ]
    match = find_match(["Muizenberg Buttress"], index_features(ways), BOX)
    assert match is not None
    # The midpoint of the whole run, not of whichever segment came first.
    assert match.feature.lon == 18.46


def test_disconnected_same_named_ways_stay_ambiguous():
    ways = [
        _way(1, "Ledges", [(18.40, -34.00), (18.41, -34.00)]),
        _way(2, "Ledges", [(18.80, -34.00), (18.81, -34.00)]),
    ]
    try:
        find_match(["Ledges"], index_features(ways), BOX)
    except AmbiguousMatch as err:
        assert err.count == 2
    else:
        raise AssertionError("expected AmbiguousMatch")


def test_two_nodes_sharing_a_name_remain_ambiguous():
    # The peak rule is untouched: two summits called Klipspringer are two places.
    peaks = [
        Feature("Klipspringer", -34.0, 18.40, "node", 1, "natural=peak", endpoints=None),
        Feature("Klipspringer", -34.1, 18.50, "node", 2, "natural=peak", endpoints=None),
    ]
    try:
        find_match(["Klipspringer"], index_features(peaks), BOX)
    except AmbiguousMatch:
        pass
    else:
        raise AssertionError("expected AmbiguousMatch")
