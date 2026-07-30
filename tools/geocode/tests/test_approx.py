from __future__ import annotations

from kaap_geocode.approx import area_approx, haversine_m


def sibling(lat, lon):
    return {"coords": {"lat": lat, "lon": lon, "zoom": 17}}


def test_haversine_is_zero_for_the_same_point():
    assert haversine_m(-33.97, 18.39, -33.97, 18.39) == 0


def test_haversine_matches_a_known_distance():
    # One degree of latitude is ~111.2 km.
    got = haversine_m(-33.0, 18.0, -34.0, 18.0)
    assert 110_000 < got < 112_000


def test_area_approx_centroid_is_the_mean_of_the_siblings():
    got = area_approx([sibling(-33.90, 18.30), sibling(-34.10, 18.50)])
    assert got is not None
    assert round(got.lat, 4) == -34.0
    assert round(got.lon, 4) == 18.4


def test_accuracy_is_the_distance_to_the_furthest_sibling():
    got = area_approx([sibling(-33.90, 18.40), sibling(-34.10, 18.40)])
    assert got is not None
    # Centroid sits midway, so the furthest sibling is ~0.1 deg ~ 11 km away.
    assert 10_000 < got.accuracy_m < 12_000


def test_a_single_sibling_still_gets_a_non_zero_accuracy():
    # One sibling would give a radius of 0, which would render as a precise dot
    # and defeat the whole point of this tier.
    got = area_approx([sibling(-33.97, 18.39)])
    assert got is not None
    assert got.accuracy_m > 0


def test_no_siblings_gives_no_approximation():
    assert area_approx([]) is None


def test_a_sibling_missing_its_longitude_is_excluded_rather_than_crashing():
    # This module takes any sibling list, so it cannot rely on the caller
    # having paired lat and lon for it.
    got = area_approx([sibling(-33.90, 18.40), {"coords": {"lat": -34.10, "lon": None}}])
    assert got is not None
    assert round(got.lat, 4) == -33.90
    assert round(got.lon, 4) == 18.40


def test_a_sibling_with_no_longitude_key_at_all_is_excluded():
    got = area_approx([sibling(-33.90, 18.40), {"coords": {"lat": -34.10}}])
    assert got is not None
    assert round(got.lat, 4) == -33.90


def test_siblings_with_only_partial_coordinates_give_no_approximation():
    assert area_approx([{"coords": {"lat": -33.9}}, {"coords": {"lon": 18.4}}]) is None
