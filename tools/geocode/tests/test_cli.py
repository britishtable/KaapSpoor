"""The producer half of the wire contract with app/scripts/transform.ts.

cli.py is the only place the JSON key names are chosen — `coords`, `source`,
`accuracyM`, `osm`. The app asserts against hand-written literals of the same
assumed shape, so nothing else would notice a rename: every Python test and
every app test would still pass while the app read `undefined`. These tests
assert on the emitted bytes, so the key names are pinned on this side too.
"""

from __future__ import annotations

import json
from datetime import date

from kaap_geocode.cli import main

# One located route to anchor the area, one whose title matches nothing and
# whose siblings are tight enough to approximate, and one curated by hand.
ROUTES = {
    "generated": "2026-07-26T08:02:40+00:00",
    "routes": [
        {
            "area": ["Table-Mountain", "atlantic-west"],
            "slug": "kasteelspoort",
            "title": "Kasteelspoort",
            "coords": {"lat": -33.97, "lon": 18.39, "zoom": 17},
        },
        {
            "area": ["Table-Mountain", "atlantic-west"],
            "slug": "corridor-rib",
            "title": "Corridor Rib",
            "coords": None,
        },
        {
            "area": ["Table-Mountain", "atlantic-west"],
            "slug": "platteklip",
            "title": "Platteklip Gorge",
            "coords": None,
        },
    ],
}

OVERRIDES = {
    "overrides": [
        {
            "routeId": "table-mountain--atlantic-west--platteklip",
            "lat": -33.9563,
            "lon": 18.4054,
            "source": "checked against the 1:50000 sheet",
        }
    ]
}


def run(tmp_path, routes=None, overrides=None):
    routes_path = tmp_path / "routes.json"
    overrides_path = tmp_path / "geocode-overrides.json"
    out_path = tmp_path / "route-locations.json"
    report_path = tmp_path / "geocode-report.md"
    routes_path.write_text(json.dumps(routes or ROUTES), encoding="utf-8")
    overrides_path.write_text(json.dumps(overrides or OVERRIDES), encoding="utf-8")

    code = main(
        [
            "--routes", str(routes_path),
            "--overrides", str(overrides_path),
            "--features", str(tmp_path / "absent.geojsonl"),
            "--out", str(out_path),
            "--report", str(report_path),
        ]
    )
    assert code == 0
    return json.loads(out_path.read_text(encoding="utf-8")), report_path


def test_emits_the_coords_object_the_app_reads(tmp_path):
    payload, _ = run(tmp_path)
    entry = payload["locations"]["table-mountain--atlantic-west--kasteelspoort"]
    assert entry["coords"] == {"lat": -33.97, "lon": 18.39, "zoom": 17}
    assert entry["source"] == "crawl"


def test_a_crawl_entry_carries_no_accuracy_or_osm_keys(tmp_path):
    payload, _ = run(tmp_path)
    entry = payload["locations"]["table-mountain--atlantic-west--kasteelspoort"]
    assert "accuracyM" not in entry
    assert "osm" not in entry


def test_an_area_approx_entry_carries_camel_case_accuracy_m(tmp_path):
    # `accuracyM`, not `accuracy_m`: renaming it here would silently drop every
    # uncertainty radius on the app side without failing a single other test.
    payload, _ = run(tmp_path)
    entry = payload["locations"]["table-mountain--atlantic-west--corridor-rib"]
    assert entry["source"] == "area-approx"
    assert isinstance(entry["accuracyM"], int)
    assert entry["accuracyM"] > 0
    assert set(entry["coords"]) == {"lat", "lon", "zoom"}


def test_a_curated_override_reaches_the_wire_as_curated(tmp_path):
    payload, _ = run(tmp_path)
    entry = payload["locations"]["table-mountain--atlantic-west--platteklip"]
    assert entry["source"] == "curated"
    assert entry["coords"]["lat"] == -33.9563


def test_the_envelope_inherits_the_crawl_date_rather_than_today(tmp_path):
    payload, _ = run(tmp_path)
    assert payload["generated"] == "2026-07-26T08:02:40+00:00"
    assert payload["osm_extract_date"] == "none"  # no features file in tmp_path


def test_the_generated_date_falls_back_to_today_when_the_crawl_has_none(tmp_path):
    routes = {k: v for k, v in ROUTES.items() if k != "generated"}
    payload, _ = run(tmp_path, routes=routes)
    assert payload["generated"] == date.today().isoformat()


def test_the_report_is_written_too(tmp_path):
    _, report_path = run(tmp_path)
    text = report_path.read_text(encoding="utf-8")
    assert text.startswith("# Geocoding report")
    assert "table-mountain--atlantic-west--corridor-rib" in text


def test_locations_are_written_in_sorted_order_for_a_stable_diff(tmp_path):
    payload, _ = run(tmp_path)
    ids = list(payload["locations"])
    assert ids == sorted(ids)
