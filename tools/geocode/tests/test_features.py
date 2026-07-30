from __future__ import annotations

from pathlib import Path

from kaap_geocode.features import read_features

FIXTURE = Path(__file__).parent / "fixtures" / "named-features.geojsonl"


def test_reads_named_features_and_drops_unnamed_ones():
    features = read_features(FIXTURE)
    names = sorted(f.name for f in features)
    # n4 has no name and must be dropped: an unnamed feature can never match.
    assert names == [
        "Ar\xeate Ridge",
        "Devil's Peak",
        "Elsies Peak",
        "Lot’s Wife",
        "Myburgh’s Kloof",
        "Newlands Ravine",
        "Newlands Ravine",
        "Robberg Nature Reserve",
    ]


def test_parses_osm_type_and_id_from_the_unique_id():
    devils = next(f for f in read_features(FIXTURE) if f.name == "Devil's Peak")
    assert devils.osm_type == "node"
    assert devils.osm_id == 1
    assert devils.kind == "natural=peak"


def test_point_geometry_keeps_its_own_coordinates():
    devils = next(f for f in read_features(FIXTURE) if f.name == "Devil's Peak")
    assert (round(devils.lat, 4), round(devils.lon, 4)) == (-33.9525, 18.4575)


def test_linestring_collapses_to_the_midpoint_of_its_bounding_box():
    ravine = next(
        f for f in read_features(FIXTURE) if f.name == "Newlands Ravine" and f.osm_type == "way"
    )
    assert (round(ravine.lat, 4), round(ravine.lon, 4)) == (-33.965, 18.435)


def test_polygon_collapses_to_the_midpoint_of_its_bounding_box():
    robberg = next(f for f in read_features(FIXTURE) if f.name == "Robberg Nature Reserve")
    assert (round(robberg.lat, 4), round(robberg.lon, 4)) == (-34.1, 23.39)


def test_a_three_element_position_is_read_rather_than_dropped():
    # [lon, lat, ele] is valid GeoJSON and osmium emits it wherever the source
    # carries an elevation. Requiring exactly two numbers dropped the feature
    # silently, which is the worst way to lose a match.
    lots_wife = next(f for f in read_features(FIXTURE) if f.name == "Lot’s Wife")
    assert (round(lots_wife.lat, 4), round(lots_wife.lon, 4)) == (-34.05, 18.42)


def test_typographic_and_accented_names_survive_reading_unchanged():
    names = {f.name for f in read_features(FIXTURE)}
    assert "Myburgh’s Kloof" in names
    assert "Ar\xeate Ridge" in names
