"""Coverage report generation.

The coordinate-coverage number is the deliverable that decides the Phase 2 map
design, so it must be exact and unmissable.
"""

from mm_scraper.report import build_report

ROUTE = {
    "slug": "kasteelspoort",
    "title": "Kasteelspoort path (KP)",
    "url": "https://example.invalid/kasteelspoort",
    "coords": {"zoom": 16, "lat": -33.9691, "lon": 18.3920},
    "grade": "B",
    "photos": {"deck_ids": ["deck1"], "inline_urls": ["a.jpg", "b.jpg"]},
    "attachments": [],
    "is_reference": False,
}
UNMAPPED = {
    **ROUTE,
    "slug": "blind-gully",
    "title": "Blind Gully",
    "url": "https://example.invalid/blind-gully",
    "coords": None,
    "grade": None,
    "photos": {"deck_ids": [], "inline_urls": []},
}


def test_reports_coordinate_coverage_as_a_count_and_a_percentage():
    md = build_report([ROUTE, UNMAPPED], nodes=[], failures=[])
    assert "1 / 2" in md
    assert "50.0%" in md


def test_coordinate_coverage_counts_only_routes_not_hierarchy_nodes():
    node = {**UNMAPPED, "slug": "table-mountain"}
    md = build_report([ROUTE], nodes=[node], failures=[])
    assert "1 / 1" in md
    assert "100.0%" in md


def test_lists_every_unmapped_route_so_they_can_be_chased_by_hand():
    md = build_report([ROUTE, UNMAPPED], nodes=[], failures=[])
    assert "Blind Gully" in md
    assert "Kasteelspoort path (KP)" not in md.split("Routes without coordinates")[1]


def test_reports_grade_and_photo_coverage():
    md = build_report([ROUTE, UNMAPPED], nodes=[], failures=[])
    assert "| Grade (all) | 1 / 2 |" in md
    assert "Slides decks referenced: **1**" in md
    assert "Inline images referenced: **2**" in md


def test_extraction_failures_are_listed_by_url():
    failures = [("https://example.invalid/broken", "404 Not Found")]
    md = build_report([ROUTE], nodes=[], failures=failures)
    assert "https://example.invalid/broken" in md
    assert "404 Not Found" in md


def test_says_so_explicitly_when_nothing_failed():
    md = build_report([ROUTE], nodes=[], failures=[])
    assert "None" in md.split("Failures")[1]


def test_reports_time_and_height_gain_from_the_key_statistics_table():
    route = {**ROUTE, "stats": {"Time": "2-3 hrs", "Height gain": "530m"}}
    md = build_report([route, UNMAPPED], nodes=[], failures=[])
    assert "| Time | 1 / 2 |" in md
    assert "| Height gain | 1 / 2 |" in md


def test_stat_keys_differing_only_in_case_are_counted_together():
    # The wiki writes both "Height gain" and "Height Gain".
    a = {**ROUTE, "stats": {"Height gain": "530m"}}
    b = {**ROUTE, "stats": {"Height Gain": "410m"}}
    md = build_report([a, b], nodes=[], failures=[])
    assert "| Height gain | 2 / 2 |" in md


def test_full_route_entries_are_reported_separately_from_stubs():
    """A page with no Key Statistics table is a traverse note, not a hike."""
    entry = {**ROUTE, "stats": {"Time": "2 hrs"}}
    stub = {**UNMAPPED, "stats": {}, "grade_source": None}
    md = build_report([entry, stub], nodes=[], failures=[])

    # Coordinate coverage is the decision input, so it must be given for the
    # real routes as well as for everything crawled.
    assert "| **Full route entries** | 1 | 1 / 1 (100.0%) |" in md
    assert "| Traverse notes / sections | 1 | 0 / 1 (0.0%) |" in md


def test_pages_crawled_counts_reference_pages_too():
    md = build_report([ROUTE], nodes=[UNMAPPED], reference=[UNMAPPED], failures=[])
    assert "Pages crawled: **3**" in md


def test_handles_a_crawl_that_produced_no_routes_at_all():
    md = build_report([], nodes=[], failures=[])
    assert "0 / 0" in md
    assert "0.0%" in md
