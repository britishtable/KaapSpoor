from __future__ import annotations

from kaap_geocode.ids import route_id, slugify


def test_slugify_lowercases_and_collapses_non_alphanumerics():
    assert slugify("Lion's Head B (Twirly-Whirly route)") == "lion-s-head-b-twirly-whirly-route"


def test_slugify_strips_leading_and_trailing_separators():
    assert slugify("--Devils Peak--") == "devils-peak"


def test_route_id_joins_area_and_slug_with_double_hyphen():
    assert (
        route_id(["Table-Mountain", "atlantic-west"], "kasteelspoort")
        == "table-mountain--atlantic-west--kasteelspoort"
    )


def test_route_id_disambiguates_the_duplicate_klipspringer_slugs():
    # 'slug' is not unique in the source data; the area path is what separates them.
    a = route_id(["cape-country", "overberg"], "klipspringer")
    b = route_id(["peninsula", "silvermine"], "klipspringer")
    assert a != b
