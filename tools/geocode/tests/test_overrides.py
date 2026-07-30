from __future__ import annotations

import json

import pytest

from kaap_geocode.overrides import OverrideError, load_overrides


def write(tmp_path, payload):
    path = tmp_path / "geocode-overrides.json"
    path.write_text(json.dumps(payload), encoding="utf-8")
    return path


VALID = {
    "overrides": [
        {
            "routeId": "other-areas--mt-zebra-park-idwala-hiking-trail",
            "lat": -32.2296,
            "lon": 25.5289,
            "source": "https://www.sanparks.org/parks/mountain_zebra/",
            "note": "Park rest camp; the trail head is signposted from there.",
        }
    ]
}


def test_loads_a_valid_override_keyed_by_route_id(tmp_path):
    got = load_overrides(write(tmp_path, VALID))
    entry = got["other-areas--mt-zebra-park-idwala-hiking-trail"]
    assert entry.lat == -32.2296
    assert entry.source.startswith("https://")
    assert entry.zoom == 15  # default when unspecified


def test_respects_an_explicit_zoom(tmp_path):
    payload = {"overrides": [{**VALID["overrides"][0], "zoom": 12}]}
    got = load_overrides(write(tmp_path, payload))
    assert got["other-areas--mt-zebra-park-idwala-hiking-trail"].zoom == 12


def test_a_missing_file_is_an_empty_override_set(tmp_path):
    assert load_overrides(tmp_path / "absent.json") == {}


def test_rejects_an_override_with_no_source(tmp_path):
    payload = {"overrides": [{"routeId": "a--b", "lat": -33.0, "lon": 18.0}]}
    with pytest.raises(OverrideError, match="source"):
        load_overrides(write(tmp_path, payload))


def test_rejects_an_override_with_an_empty_source(tmp_path):
    payload = {"overrides": [{"routeId": "a--b", "lat": -33.0, "lon": 18.0, "source": "  "}]}
    with pytest.raises(OverrideError, match="source"):
        load_overrides(write(tmp_path, payload))


def test_rejects_out_of_range_coordinates(tmp_path):
    payload = {"overrides": [{"routeId": "a--b", "lat": -100.0, "lon": 18.0, "source": "x"}]}
    with pytest.raises(OverrideError, match="lat"):
        load_overrides(write(tmp_path, payload))


def test_rejects_a_duplicate_route_id(tmp_path):
    entry = {"routeId": "a--b", "lat": -33.0, "lon": 18.0, "source": "x"}
    with pytest.raises(OverrideError, match="duplicate"):
        load_overrides(write(tmp_path, {"overrides": [entry, entry]}))


def test_an_explicit_zoom_of_zero_is_preserved(tmp_path):
    # 0 is a legitimate zoom level; `or` would silently replace it with 15.
    payload = {"overrides": [{**VALID["overrides"][0], "zoom": 0}]}
    got = load_overrides(write(tmp_path, payload))
    assert got["other-areas--mt-zebra-park-idwala-hiking-trail"].zoom == 0


def test_rejects_a_non_numeric_zoom(tmp_path):
    payload = {"overrides": [{**VALID["overrides"][0], "zoom": "close"}]}
    with pytest.raises(OverrideError, match="zoom"):
        load_overrides(write(tmp_path, payload))


def test_rejects_a_boolean_coordinate(tmp_path):
    # bool subclasses int, so float(True) == 1.0 would pass a range check.
    payload = {"overrides": [{"routeId": "a--b", "lat": True, "lon": 18.0, "source": "x"}]}
    with pytest.raises(OverrideError, match="boolean"):
        load_overrides(write(tmp_path, payload))


def test_rejects_a_missing_coordinate(tmp_path):
    payload = {"overrides": [{"routeId": "a--b", "lon": 18.0, "source": "x"}]}
    with pytest.raises(OverrideError, match="lat"):
        load_overrides(write(tmp_path, payload))


def test_rejects_malformed_json(tmp_path):
    path = tmp_path / "geocode-overrides.json"
    path.write_text("{ not json", encoding="utf-8")
    with pytest.raises(OverrideError, match="valid JSON"):
        load_overrides(path)
