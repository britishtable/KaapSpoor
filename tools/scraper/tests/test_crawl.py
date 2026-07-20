"""Crawl orchestration: page classification and failure isolation."""

import pytest

from mm_scraper.crawl import crawl, is_hierarchy_node
from mm_scraper.nav import PageRef, enumerate_pages

from conftest import BLIND_GULLY_PATH, KASTEELSPOORT_PATH, _html


class FakeFetcher:
    """Serves fixture HTML; any URL not in the map raises, as a dead page would."""

    def __init__(self, pages, default=None):
        self.pages = pages
        self.default = default
        self.requested = []

    def get(self, url, **kwargs):
        self.requested.append(url)
        for suffix, html in self.pages.items():
            if url.endswith(suffix):
                return html
        if self.default is not None:
            return self.default
        raise RuntimeError("404 Not Found")


@pytest.fixture
def refs(home_html):
    return enumerate_pages(home_html)


def test_a_page_with_pages_beneath_it_is_a_hierarchy_node(refs):
    area = next(r for r in refs if r.path.endswith("/Home/Table-Mountain"))
    assert is_hierarchy_node(area, refs) is True


def test_a_leaf_page_is_a_route_not_a_node(refs):
    leaf = PageRef(path=KASTEELSPOORT_PATH, segments=("a", "b", "kasteelspoort"))
    assert is_hierarchy_node(leaf, refs) is False


def test_a_sibling_with_a_shared_name_prefix_does_not_make_a_node():
    parent = PageRef(path="/site/mountainmeanderswiki/Home/gully", segments=("gully",))
    sibling = PageRef(
        path="/site/mountainmeanderswiki/Home/gully-north", segments=("gully-north",)
    )
    assert is_hierarchy_node(parent, [parent, sibling]) is False


def test_routes_nodes_and_references_are_separated(home_html):
    fetcher = FakeFetcher(
        {
            "/Home": home_html,
            KASTEELSPOORT_PATH: _html("kasteelspoort.html"),
            BLIND_GULLY_PATH: _html("blind-gully.html"),
        },
        default=_html("blind-gully.html"),
    )
    result = crawl(fetcher)

    assert not result["failures"]
    assert result["routes"], "expected some leaf routes"
    assert result["nodes"], "expected some area index pages"
    assert all(not r["is_reference"] for r in result["routes"])
    # Leaves outnumber indexes on this wiki.
    assert len(result["routes"]) > len(result["nodes"])
    slugs = {r["slug"] for r in result["routes"]}
    assert "kasteelspoort" in slugs
    assert "table-mountain" not in slugs


def test_one_dead_page_does_not_abort_the_crawl(home_html):
    # Only the home page resolves; every other fetch raises.
    result = crawl(FakeFetcher({"/Home": home_html}), limit=5)

    assert len(result["failures"]) >= 1
    url, error = result["failures"][0]
    assert url.startswith("https://sites.google.com/site/")
    assert "404" in error


def test_reference_pages_are_kept_apart_from_routes(home_html):
    fetcher = FakeFetcher({"/Home": home_html, "grading": _html("kasteelspoort.html")})
    result = crawl(fetcher)

    assert [r["slug"] for r in result["reference"]] == ["grading"]


def test_progress_is_reported_per_page(home_html):
    seen = []
    crawl(
        FakeFetcher({"/Home": home_html}),
        limit=3,
        on_page=lambda i, total, ref: seen.append((i, total)),
    )
    assert seen == [(1, 3), (2, 3), (3, 3)]
