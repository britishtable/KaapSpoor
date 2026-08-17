import json

from kaap_routelines.cli import main


def _routes(tmp_path, routes):
    path = tmp_path / "routes.json"
    path.write_text(json.dumps({"generated": "2026-08-16", "routes": routes}), encoding="utf-8")
    return path


def _ways(tmp_path, features):
    path = tmp_path / "walkable-ways.geojsonl"
    path.write_text("\n".join(json.dumps(f) for f in features) + "\n", encoding="utf-8")
    return path


def _way_feature(way_id, coords, name=None):
    props = {"@id": f"w{way_id}", "highway": "path"}
    if name:
        props["name"] = name
    return {"type": "Feature", "properties": props,
            "geometry": {"type": "LineString", "coordinates": coords}}


P = [[18.400 + 0.001 * i, -34.000] for i in range(6)]


def test_writes_a_line_for_a_walkable_route(tmp_path):
    routes = _routes(tmp_path, [{
        "slug": "test-route", "area": ["Area"], "title": "Test Route",
        "coords": {"lat": -34.0, "lon": 18.400, "zoom": 15},
        "sections": {"Route": "Go up First Path then along Second Path."},
    }])
    ways = _ways(tmp_path, [
        _way_feature(1, [P[0], P[1]], "First Path"),
        _way_feature(2, [P[1], P[2]], "Second Path"),
    ])
    out = tmp_path / "route-lines.geojson"
    report = tmp_path / "route-lines-report.md"

    # --relations is pointed at a path that does not exist ON PURPOSE. Left to
    # its default it would read whatever extract the developer's own machine
    # happens to have, and the test would pass or fail on that rather than on
    # the code.
    assert main([
        "--routes", str(routes), "--ways", str(ways), "--out", str(out),
        "--report", str(report), "--relations-map", str(tmp_path / "missing.json"),
        "--relations", str(tmp_path / "no-relations.json"),
    ]) == 0

    payload = json.loads(out.read_text(encoding="utf-8"))
    assert payload["type"] == "FeatureCollection"
    assert len(payload["features"]) == 1
    feature = payload["features"][0]
    assert feature["properties"]["routeId"] == "area--test-route"
    assert feature["properties"]["source"] == "osm-stitch"
    assert feature["geometry"]["type"] == "LineString"


def test_writes_no_feature_for_a_route_that_names_nothing(tmp_path):
    routes = _routes(tmp_path, [{
        "slug": "quiet", "area": ["Area"], "title": "Quiet Route",
        "coords": {"lat": -34.0, "lon": 18.400, "zoom": 15},
        "sections": {"Route": "Wander about a bit."},
    }])
    ways = _ways(tmp_path, [_way_feature(1, [P[0], P[1]], "First Path")])
    out = tmp_path / "route-lines.geojson"
    report = tmp_path / "route-lines-report.md"

    main(["--routes", str(routes), "--ways", str(ways), "--out", str(out),
          "--report", str(report), "--relations-map", str(tmp_path / "missing.json"),
          "--relations", str(tmp_path / "no-relations.json")])

    assert json.loads(out.read_text(encoding="utf-8"))["features"] == []
    assert "Quiet Route" in report.read_text(encoding="utf-8") or "quiet" in report.read_text(encoding="utf-8")


def test_a_confirmed_relation_becomes_the_route_line(tmp_path):
    routes = _routes(tmp_path, [{
        "slug": "platteklip", "area": ["Area"], "title": "Platteklip Gorge",
        "coords": {"lat": -34.0, "lon": 18.400, "zoom": 15},
        "sections": {"Route": "Straight up."},
    }])
    ways = _ways(tmp_path, [_way_feature(101, [P[0], P[1]]), _way_feature(102, [P[1], P[2]])])
    relations = tmp_path / "route-relations.json"
    relations.write_text(json.dumps({"elements": [{
        "type": "relation", "id": 2934380,
        "tags": {"type": "route", "route": "hiking", "name": "Platteklip Gorge"},
        "members": [{"type": "way", "ref": 101, "role": ""}, {"type": "way", "ref": 102, "role": ""}],
    }]}), encoding="utf-8")
    confirmed = tmp_path / "confirmed.json"
    confirmed.write_text(json.dumps({"confirmed": {
        "area--platteklip": {"relation": 2934380, "note": "same ascent"}
    }}), encoding="utf-8")
    out = tmp_path / "route-lines.geojson"

    main(["--routes", str(routes), "--ways", str(ways), "--relations", str(relations),
          "--relations-map", str(confirmed), "--out", str(out),
          "--report", str(tmp_path / "r.md")])

    feature = json.loads(out.read_text(encoding="utf-8"))["features"][0]
    assert feature["properties"]["source"] == "osm-relation"
    assert feature["properties"]["relation"] == 2934380
    # The ids are the whole point of reading OSM JSON rather than a geometry
    # export: a drawn claim has to be re-checkable against OSM.
    assert feature["properties"]["osmWays"] == [101, 102]


def test_a_relation_missing_member_geometry_draws_nothing(tmp_path):
    routes = _routes(tmp_path, [{
        "slug": "gappy", "area": ["Area"], "title": "Gappy",
        "coords": {"lat": -34.0, "lon": 18.400, "zoom": 15}, "sections": {},
    }])
    ways = _ways(tmp_path, [_way_feature(101, [P[0], P[1]])])
    relations = tmp_path / "route-relations.json"
    relations.write_text(json.dumps({"elements": [{
        "type": "relation", "id": 7, "tags": {"type": "route", "route": "hiking", "name": "Gappy"},
        "members": [{"type": "way", "ref": 101, "role": ""}, {"type": "way", "ref": 999, "role": ""}],
    }]}), encoding="utf-8")
    confirmed = tmp_path / "confirmed.json"
    confirmed.write_text(json.dumps({"confirmed": {"area--gappy": {"relation": 7}}}), encoding="utf-8")
    out = tmp_path / "route-lines.geojson"
    report = tmp_path / "r.md"

    main(["--routes", str(routes), "--ways", str(ways), "--relations", str(relations),
          "--relations-map", str(confirmed), "--out", str(out), "--report", str(report)])

    assert json.loads(out.read_text(encoding="utf-8"))["features"] == []
    assert "missing 1 member" in report.read_text(encoding="utf-8")


def _locations(tmp_path, locations):
    path = tmp_path / "route-locations.json"
    path.write_text(json.dumps({"locations": locations}), encoding="utf-8")
    return path


def test_anchors_on_a_recorded_location_when_the_crawl_has_none(tmp_path):
    # Only 125 of 184 routes carry a crawl coordinate; the rest are located by
    # tools/geocode. Reading routes.json alone rejected 59 routes as having no
    # position at all, which is not true of this project's data.
    routes = _routes(tmp_path, [{
        "slug": "geocoded", "area": ["Area"], "title": "Geocoded Route", "coords": None,
        "sections": {"Route": "Go up First Path then along Second Path."},
    }])
    ways = _ways(tmp_path, [
        _way_feature(1, [P[0], P[1]], "First Path"),
        _way_feature(2, [P[1], P[2]], "Second Path"),
    ])
    locations = _locations(tmp_path, {
        "area--geocoded": {"coords": {"lat": -34.0, "lon": 18.400}, "source": "osm-match"}
    })
    out = tmp_path / "route-lines.geojson"

    main(["--routes", str(routes), "--ways", str(ways), "--locations", str(locations),
          "--out", str(out), "--report", str(tmp_path / "r.md"),
          "--relations-map", str(tmp_path / "missing.json"),
          "--relations", str(tmp_path / "none.json")])

    features = json.loads(out.read_text(encoding="utf-8"))["features"]
    assert [f["properties"]["routeId"] for f in features] == ["area--geocoded"]


def test_refuses_to_anchor_a_line_on_an_area_centroid(tmp_path):
    # An area-approx position carries a radius of kilometres. Snapping it to
    # whatever path lies within 250 m would start the line somewhere nobody
    # claimed the route goes.
    routes = _routes(tmp_path, [{
        "slug": "vague", "area": ["Area"], "title": "Vague Route", "coords": None,
        "sections": {"Route": "Go up First Path then along Second Path."},
    }])
    ways = _ways(tmp_path, [
        _way_feature(1, [P[0], P[1]], "First Path"),
        _way_feature(2, [P[1], P[2]], "Second Path"),
    ])
    locations = _locations(tmp_path, {
        "area--vague": {"coords": {"lat": -34.0, "lon": 18.400},
                        "source": "area-approx", "accuracyM": 5543}
    })
    out = tmp_path / "route-lines.geojson"
    report = tmp_path / "r.md"

    main(["--routes", str(routes), "--ways", str(ways), "--locations", str(locations),
          "--out", str(out), "--report", str(report),
          "--relations-map", str(tmp_path / "missing.json"),
          "--relations", str(tmp_path / "none.json")])

    assert json.loads(out.read_text(encoding="utf-8"))["features"] == []
    assert "area centroid cannot anchor" in report.read_text(encoding="utf-8")


def test_runs_without_an_extract_and_writes_an_empty_collection(tmp_path):
    # A clone that has never run WSL must not crash the pipeline.
    routes = _routes(tmp_path, [{
        "slug": "x", "area": ["Area"], "title": "X", "coords": None, "sections": {},
    }])
    out = tmp_path / "route-lines.geojson"
    report = tmp_path / "route-lines-report.md"
    assert main(["--routes", str(routes), "--ways", str(tmp_path / "absent.geojsonl"),
                 "--out", str(out), "--report", str(report),
                 "--relations-map", str(tmp_path / "missing.json"),
                 "--relations", str(tmp_path / "no-relations.json")]) == 0
    assert json.loads(out.read_text(encoding="utf-8"))["features"] == []
