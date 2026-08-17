from kaap_routelines.geo import haversine_m, length_m, node_key


def test_node_key_rounds_to_seven_places():
    # Two ways meeting at a shared OSM node export the same rounded coordinate.
    # This rounding IS the join key for the whole graph; if it drifts, the graph
    # silently falls apart into singletons.
    assert node_key((18.4012345678, -33.9587654321)) == (18.4012346, -33.9587654)


def test_node_key_separates_genuinely_different_nodes():
    assert node_key((18.4012346, -33.9587654)) != (18.4012347, -33.9587654)


def test_haversine_matches_a_known_distance():
    # One degree of latitude is ~111.2 km anywhere on the globe.
    d = haversine_m((18.4, -34.0), (18.4, -33.0))
    assert 110_000 < d < 112_000


def test_length_m_sums_the_segments():
    coords = [(18.4, -34.0), (18.4, -33.99), (18.4, -33.98)]
    assert length_m(coords) == round(2 * haversine_m((18.4, -34.0), (18.4, -33.99)), 6)


def test_length_m_of_a_single_point_is_zero():
    assert length_m([(18.4, -34.0)]) == 0.0
