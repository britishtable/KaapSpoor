from __future__ import annotations

import pytest

from kaap_geocode.areas import BBox
from kaap_geocode.features import Feature
from kaap_geocode.match import AmbiguousMatch, find_match

CAPE = BBox(west=18.0, south=-34.4, east=19.0, north=-33.5)


def feature(name, lat, lon, osm_id=1, osm_type="node", kind="natural=peak"):
    return Feature(name=name, lat=lat, lon=lon, osm_type=osm_type, osm_id=osm_id, kind=kind)


def test_matches_an_exact_name_inside_the_bbox():
    features = [feature("Newlands Ravine", -33.965, 18.435)]
    got = find_match(["Newlands Ravine"], features, CAPE)
    assert got is not None
    assert got.feature.osm_id == 1
    assert got.candidate == "Newlands Ravine"


def test_rejects_a_correct_name_outside_the_bbox():
    # The same name exists in the Eastern Cape. Without the bbox constraint this
    # is exactly the false positive that would damage trust most.
    features = [feature("Newlands Ravine", -32.0, 25.0)]
    assert find_match(["Newlands Ravine"], features, CAPE) is None


def test_matching_ignores_case_punctuation_and_abbreviations():
    features = [feature("Elsies Peak", -34.13, 18.438)]
    got = find_match(["Elsies Pk"], features, CAPE)
    assert got is not None
    assert got.candidate == "Elsies Pk"


def test_tries_candidates_in_order_and_prefers_the_most_specific():
    features = [
        feature("Lion's Head", -33.935, 18.389, osm_id=10),
        feature("Lion's Head B", -33.936, 18.390, osm_id=11),
    ]
    got = find_match(["Lion's Head B", "Lion's Head"], features, CAPE)
    assert got is not None
    assert got.feature.osm_id == 11  # the first candidate that matched, not the last


def test_returns_none_when_no_candidate_matches():
    features = [feature("Devil's Peak", -33.9525, 18.4575)]
    assert find_match(["Carrel's Ledge", "Carrel"], features, CAPE) is None


def test_raises_on_two_features_with_the_same_name_inside_the_bbox():
    features = [
        feature("Window Gorge", -33.98, 18.43, osm_id=20),
        feature("Window Gorge", -33.99, 18.44, osm_id=21),
    ]
    with pytest.raises(AmbiguousMatch) as excinfo:
        find_match(["Window Gorge"], features, CAPE)
    assert excinfo.value.candidate == "Window Gorge"
    assert excinfo.value.count == 2


def test_ambiguity_outside_the_bbox_does_not_block_a_match_inside_it():
    features = [
        feature("Window Gorge", -33.98, 18.43, osm_id=20),
        feature("Window Gorge", -32.0, 25.0, osm_id=21),
    ]
    got = find_match(["Window Gorge"], features, CAPE)
    assert got is not None
    assert got.feature.osm_id == 20
