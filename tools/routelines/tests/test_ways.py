import json
from pathlib import Path

from kaap_routelines.ways import Way, read_ways

WALKABLE = {"path", "footway", "track", "steps"}


def _line(tmp_path: Path, features: list[dict]) -> Path:
    p = tmp_path / "paths.geojsonl"
    p.write_text("\n".join(json.dumps(f) for f in features) + "\n", encoding="utf-8")
    return p


def _feature(way_id: int, coords: list[list[float]], **props) -> dict:
    return {
        "type": "Feature",
        "properties": {"@id": f"w{way_id}", "highway": "path", **props},
        "geometry": {"type": "LineString", "coordinates": coords},
    }


def test_reads_id_name_and_coordinates(tmp_path):
    path = _line(tmp_path, [_feature(1, [[18.4, -34.0], [18.41, -34.0]], name="Pipe Track")])
    ways = read_ways(path)
    assert ways == [Way(osm_id=1, name="Pipe Track", coords=((18.4, -34.0), (18.41, -34.0)))]


def test_keeps_unnamed_ways(tmp_path):
    # The opposite of tools/geocode's reader, which drops them: an unnamed way
    # is exactly the connector that makes a fragmented trail continuous, and
    # dropping them is why name-matching alone leaves the map patchy.
    path = _line(tmp_path, [_feature(2, [[18.4, -34.0], [18.41, -34.0]])])
    assert read_ways(path)[0].name is None


def test_ignores_non_walkable_highways(tmp_path):
    path = _line(tmp_path, [_feature(3, [[18.4, -34.0], [18.41, -34.0]], highway="motorway")])
    assert read_ways(path) == []


def test_ignores_a_way_with_fewer_than_two_points(tmp_path):
    path = _line(tmp_path, [_feature(4, [[18.4, -34.0]])])
    assert read_ways(path) == []


def test_start_end_and_length(tmp_path):
    way = Way(osm_id=5, name=None, coords=((18.4, -34.0), (18.4, -33.99)))
    assert way.start == (18.4, -34.0)
    assert way.end == (18.4, -33.99)
    assert way.length_m > 1000
