from __future__ import annotations

from kaap_geocode.areas import bbox_of, located_scope


def route(area, slug, lat=None, lon=None):
    coords = None if lat is None else {"lat": lat, "lon": lon, "zoom": 17}
    return {"area": area, "slug": slug, "coords": coords}


ROUTES = [
    route(["Table-Mountain", "atlantic-west"], "kasteelspoort", -33.97, 18.39),
    route(["Table-Mountain", "atlantic-west"], "woody-ravine", -33.98, 18.38),
    route(["Table-Mountain", "atlantic-west"], "corridor-rib"),          # unlocated
    route(["Table-Mountain", "newlands-east"], "newlands-ravine"),       # unlocated
    route(["Table-Mountain", "devils-peak"], "saddle-ravine"),           # unlocated
    route(["Table-Mountain"], "back-table", -33.99, 18.41),
]


def test_located_scope_prefers_the_exact_area():
    path, siblings = located_scope(ROUTES, ["Table-Mountain", "atlantic-west"])
    assert path == ["Table-Mountain", "atlantic-west"]
    assert len(siblings) == 2


def test_located_scope_walks_up_when_the_exact_area_has_no_located_routes():
    # newlands-east has no located routes at all, so the scope widens to the parent.
    path, siblings = located_scope(ROUTES, ["Table-Mountain", "newlands-east"])
    assert path == ["Table-Mountain"]
    assert len(siblings) == 3  # the parent's own located route plus both children's


def test_located_scope_returns_empty_when_nothing_is_located_anywhere_above():
    path, siblings = located_scope([route(["other-areas"], "mt-zebra")], ["other-areas"])
    assert path == []
    assert siblings == []


def test_bbox_of_covers_all_points_with_a_margin():
    box = bbox_of(
        [
            route(["a"], "x", -33.97, 18.39),
            route(["a"], "y", -33.99, 18.41),
        ],
        margin_deg=0.05,
    )
    assert box is not None
    assert box.west == 18.39 - 0.05
    assert box.east == 18.41 + 0.05
    assert box.south == -33.99 - 0.05
    assert box.north == -33.97 + 0.05


def test_bbox_of_returns_none_for_no_located_routes():
    assert bbox_of([route(["a"], "x")]) is None


def test_bbox_contains():
    box = bbox_of([route(["a"], "x", -33.97, 18.39)], margin_deg=0.05)
    assert box.contains(-33.97, 18.39)
    assert box.contains(-33.95, 18.42)
    assert not box.contains(-33.50, 18.39)
