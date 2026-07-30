from __future__ import annotations

from pathlib import Path

from kaap_geocode.features import read_features

FIXTURE = Path(__file__).parent / "fixtures" / "named-features.geojsonl"


def test_reads_named_features_and_drops_unnamed_ones():
    features = read_features(FIXTURE)
    names = sorted(f.name for f in features)
    # n4 has no name and must be dropped: an unnamed feature can never match.
    assert names == [
        "Devil's Peak",
        "Elsies Peak",
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
