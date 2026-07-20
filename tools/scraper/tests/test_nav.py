"""Nav enumeration and URL-derived hierarchy."""

from mm_scraper.nav import PageRef, enumerate_pages, should_archive


def test_enumerates_every_page_from_a_single_embedded_nav(home_html):
    pages = enumerate_pages(home_html)
    # The site is small and static; the count is a canary for nav-shape changes.
    assert len(pages) == 227
    assert len({p.path for p in pages}) == len(pages)


def test_home_itself_is_the_only_zero_depth_page(home_html):
    roots = [p for p in enumerate_pages(home_html) if p.depth == 0]
    assert [p.slug for p in roots] == ["home"]


def test_most_pages_are_area_slash_subarea_slash_route(home_html):
    depths = [p.depth for p in enumerate_pages(home_html)]
    assert depths.count(3) > depths.count(2) > depths.count(4)


def test_hierarchy_comes_from_the_url_path():
    ref = PageRef(
        path="/site/mountainmeanderswiki/Home/table-mountain/atlantic-west/kasteelspoort",
        segments=("table-mountain", "atlantic-west", "kasteelspoort"),
    )
    assert ref.slug == "kasteelspoort"
    assert ref.area == ("table-mountain", "atlantic-west")
    assert ref.depth == 3
    assert ref.url.startswith("https://sites.google.com/site/")


def test_query_strings_and_anchors_never_become_separate_pages():
    html = (
        '<a href="/site/mountainmeanderswiki/Home/x">a</a>'
        '<a href="/site/mountainmeanderswiki/Home/x?foo=1">b</a>'
        '<a href="/site/mountainmeanderswiki/Home/x#frag">c</a>'
    )
    assert len(enumerate_pages(html)) == 1


def test_reference_pages_are_skipped_except_grading_and_change_record(home_html):
    pages = enumerate_pages(home_html)
    refs = [p for p in pages if p.is_reference]
    kept = {p.slug for p in refs if should_archive(p)}

    assert refs, "fixture should contain /introduction pages"
    assert kept == {"grading", "change-record"}


def test_route_pages_are_always_archived(home_html):
    routes = [p for p in enumerate_pages(home_html) if not p.is_reference]
    assert all(should_archive(p) for p in routes)
