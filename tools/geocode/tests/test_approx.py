from __future__ import annotations

from kaap_geocode.approx import MAX_ACCURACY_M, MIN_ACCURACY_M, area_approx, haversine_m


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


def test_a_tight_cluster_is_still_approximated():
    # ~2 km apart: well inside the ceiling, so this is a usable approximation.
    got = area_approx([sibling(-33.97, 18.39), sibling(-33.98, 18.40)])
    assert got is not None
    assert got.accuracy_m <= MAX_ACCURACY_M


def test_a_spread_wider_than_the_ceiling_gives_no_approximation():
    # Robberg, the Otter Trail and the Swartberg all sit under `cape-country`;
    # their centroid lands near Worcester with a 160 km radius. That is not a
    # vaguer answer, it is a wrong one, so the route must stay unlocated.
    got = area_approx(
        [sibling(-34.10, 23.39), sibling(-33.98, 23.60), sibling(-33.35, 22.05)]
    )
    assert got is None


def test_the_ceiling_is_applied_to_the_true_radius_not_the_floored_one():
    # Two siblings ~50 km apart give a ~25 km radius from the centroid; nudge
    # them past that and the answer must be refused rather than clamped.
    assert area_approx([sibling(-33.50, 18.40), sibling(-34.50, 18.40)]) is None


def test_the_floor_still_applies_to_a_lone_sibling():
    got = area_approx([sibling(-33.97, 18.39)])
    assert got is not None
    assert got.accuracy_m == MIN_ACCURACY_M


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
