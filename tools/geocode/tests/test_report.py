from __future__ import annotations

from kaap_geocode.pipeline import Location, Outcome
from kaap_geocode.report import build_report


def location(rid, source, **kw):
    return Location(route_id=rid, lat=-33.9, lon=18.4, zoom=15, source=source, **kw)


OUTCOME = Outcome(
    locations={
        "a--crawled": location("a--crawled", "crawl"),
        "a--matched": location(
            "a--matched",
            "osm-match",
            osm={"type": "node", "id": 7, "name": "Newlands Ravine"},
            matched_candidate="Newlands Ravine",
        ),
        "a--rough": location("a--rough", "area-approx", accuracy_m=4200),
        "a--curated": location("a--curated", "curated"),
    },
    unlocated=["b--nowhere"],
    ambiguous=[("a--rough", "Window Gorge", 2)],
    orphaned_overrides=["a--typo-d"],
)
ROUTES = [{"area": ["a"], "slug": "crawled", "title": "Crawled"}]


def test_report_counts_each_tier():
    text = build_report(OUTCOME, ROUTES, extract_date="2026-07-28")
    assert "| `crawl` | 1 |" in text
    assert "| `osm-match` | 1 |" in text
    assert "| `area-approx` | 1 |" in text
    assert "| `curated` | 1 |" in text


def test_report_records_the_extract_date_for_reproducibility():
    assert "2026-07-28" in build_report(OUTCOME, ROUTES, extract_date="2026-07-28")


def test_report_lists_matches_with_the_candidate_that_matched():
    text = build_report(OUTCOME, ROUTES, extract_date="2026-07-28")
    assert "a--matched" in text
    assert "Newlands Ravine" in text
    assert "node/7" in text


def test_report_lists_the_ambiguity_queue():
    text = build_report(OUTCOME, ROUTES, extract_date="2026-07-28")
    assert "Ambiguous" in text
    assert "Window Gorge" in text


def test_report_lists_still_unlocated_routes():
    assert "b--nowhere" in build_report(OUTCOME, ROUTES, extract_date="2026-07-28")


def test_report_lists_orphaned_overrides():
    text = build_report(OUTCOME, ROUTES, extract_date="2026-07-28")
    assert "Orphaned overrides" in text
    assert "a--typo-d" in text


def test_report_renders_none_for_empty_orphaned_overrides():
    outcome = Outcome(
        locations=OUTCOME.locations,
        unlocated=OUTCOME.unlocated,
        ambiguous=OUTCOME.ambiguous,
        orphaned_overrides=[],
    )
    text = build_report(outcome, ROUTES, extract_date="2026-07-28")
    section = text.split("## Orphaned overrides")[1].split("## Still unlocated")[0]
    assert "None." in section
    assert "a--typo-d" not in section
