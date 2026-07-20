"""Whole-page parsing into route records."""

from mm_scraper.parse import parse_page


def test_extracts_coordinates_from_the_osm_url_fragment(
    kasteelspoort_html, kasteelspoort_ref
):
    coords = parse_page(kasteelspoort_html, kasteelspoort_ref)["coords"]
    assert coords == {"zoom": 16, "lat": -33.9691, "lon": 18.3920}


def test_coords_are_read_from_the_marker_form_of_the_osm_url(kasteelspoort_ref):
    # One page links ?mlat=..&mlon=.. before the #map fragment.
    html = (
        '<a href="http://www.openstreetmap.org/?mlat=-33.96507&amp;mlon=18.95933'
        '#map=17/-33.96507/18.95933">map</a>'
    )
    coords = parse_page(html, kasteelspoort_ref)["coords"]
    assert coords == {"zoom": 17, "lat": -33.96507, "lon": 18.95933}


def test_coords_are_none_rather_than_missing_when_there_is_no_osm_link(
    kasteelspoort_ref,
):
    record = parse_page("<html><body>no map here</body></html>", kasteelspoort_ref)
    assert record["coords"] is None


def test_record_carries_the_url_derived_hierarchy(
    kasteelspoort_html, kasteelspoort_ref
):
    record = parse_page(kasteelspoort_html, kasteelspoort_ref)
    assert record["slug"] == "kasteelspoort"
    assert record["area"] == ["table-mountain", "atlantic-west"]
    assert record["title"] == "Kasteelspoort path (KP)"
    assert record["is_reference"] is False


def test_a_page_without_an_h1_still_gets_a_title(blind_gully_html, blind_gully_ref):
    assert parse_page(blind_gully_html, blind_gully_ref)["title"] == "Blind Gully"


def test_description_holds_prose_not_site_chrome(kasteelspoort_html, kasteelspoort_ref):
    description = parse_page(kasteelspoort_html, kasteelspoort_ref)["description"]
    assert description.startswith("Location:")
    assert "Rontree Estate" in description
    assert "Report abuse" not in description


def test_embedded_slides_deck_is_recorded_as_a_reference(
    blind_gully_html, blind_gully_ref
):
    photos = parse_page(blind_gully_html, blind_gully_ref)["photos"]
    # Referenced once per record even though the deck id repeats in the markup.
    assert photos["deck_ids"] == ["1PVaAV6xUdsOfW4okaXNTM0QQNZlZg8vBfL2HPQwZeiQ"]


def test_inline_images_are_recorded_without_the_repeated_site_logo(
    kasteelspoort_html, kasteelspoort_ref
):
    urls = parse_page(kasteelspoort_html, kasteelspoort_ref)["photos"]["inline_urls"]
    assert len(urls) == 4
    assert all("sitesv-images-rt" in u for u in urls)
    assert not any("=w16383" in u for u in urls)


def test_no_image_bytes_are_fetched_only_urls(kasteelspoort_html, kasteelspoort_ref):
    photos = parse_page(kasteelspoort_html, kasteelspoort_ref)["photos"]
    assert set(photos) == {"deck_ids", "inline_urls"}


def test_related_links_exclude_the_page_itself(kasteelspoort_html, kasteelspoort_ref):
    related = parse_page(kasteelspoort_html, kasteelspoort_ref)["related"]
    assert kasteelspoort_ref.path not in related
    assert all(r.startswith("/site/mountainmeanderswiki/Home") for r in related)
    assert len(related) == len(set(related))


def test_grade_is_read_from_a_labelled_section_verbatim(kasteelspoort_ref):
    html = "<html><body><h1>T</h1><p>Grade: B/C</p></body></html>"
    assert parse_page(html, kasteelspoort_ref)["grade"] == "B/C"


GADGET = (
    '<div jscontroller="szRU7e" data-code="'
    "&lt;table&gt;&lt;tbody&gt;"
    "&lt;tr&gt;&lt;td colspan=&quot;2&quot;&gt;Key Statistics&lt;/td&gt;&lt;/tr&gt;"
    "&lt;tr&gt;&lt;td&gt;Grade:&lt;/td&gt;&lt;td&gt;2 &lt;a&gt;***&lt;/a&gt;&lt;/td&gt;&lt;/tr&gt;"
    "&lt;tr&gt;&lt;td&gt;Height gain:&lt;/td&gt;&lt;td&gt;530m&lt;/td&gt;&lt;/tr&gt;"
    "&lt;tr&gt;&lt;td&gt;Time:&lt;/td&gt;&lt;td&gt;2-3 hrs up&lt;/td&gt;&lt;/tr&gt;"
    "&lt;/tbody&gt;&lt;/table&gt;"
    '"></div>'
)


def test_key_statistics_hidden_in_an_embedded_gadget_are_recovered(kasteelspoort_ref):
    # The table lives HTML-escaped in a data-code attribute, so it is invisible
    # to a plain get_text() walk of the page.
    record = parse_page(f"<html><body><h1>T</h1>{GADGET}</body></html>", kasteelspoort_ref)
    assert record["stats"]["Grade"] == "2 ***"
    assert record["stats"]["Height gain"] == "530m"
    assert record["stats"]["Time"] == "2-3 hrs up"


def test_a_gadget_grade_counts_as_a_labelled_grade(kasteelspoort_ref):
    record = parse_page(f"<html><body><h1>T</h1>{GADGET}</body></html>", kasteelspoort_ref)
    assert record["grade"] == "2 ***"
    assert record["grade_source"] == "label"


def test_pages_with_no_gadget_get_empty_stats(kasteelspoort_ref):
    assert parse_page("<html><body><h1>T</h1></body></html>", kasteelspoort_ref)["stats"] == {}


def test_grade_reads_the_grade_and_stars_label_the_wiki_actually_uses(
    kasteelspoort_ref,
):
    # The site's own field is "Grade & stars", e.g. "3 ***" — its cleanest grade data.
    html = "<html><body><h1>T</h1><p>Grade &amp; stars: 3 ***</p></body></html>"
    assert parse_page(html, kasteelspoort_ref)["grade"] == "3 ***"


def test_grade_never_returns_its_own_label_as_the_value(kasteelspoort_ref):
    html = "<html><body><h1>T</h1><p>Grade: 1</p></body></html>"
    assert parse_page(html, kasteelspoort_ref)["grade"] == "1"


def test_the_word_graded_is_not_mistaken_for_a_grade(kasteelspoort_ref):
    # "grade" + "d" matched [A-F] case-insensitively and yielded "graded".
    html = "<html><body><h1>T</h1><p>This route is not formally graded.</p></body></html>"
    assert parse_page(html, kasteelspoort_ref)["grade"] is None


def test_a_grade_written_before_the_word_grade_is_found(kasteelspoort_ref):
    html = "<html><body><h1>T</h1><p>A popular B grade scramble.</p></body></html>"
    assert parse_page(html, kasteelspoort_ref)["grade"] == "B"


def test_the_tail_of_an_ordinary_word_is_not_read_as_a_grade(kasteelspoort_ref):
    # "the grade" matched as "e" + " grade" for want of a word boundary.
    for prose in ("Opinions differ on the grade.", "Nothing of grade here.",
                  "It was later downgraded."):
        html = f"<html><body><h1>T</h1><p>{prose}</p></body></html>"
        assert parse_page(html, kasteelspoort_ref)["grade"] is None, prose


def test_the_indefinite_article_is_not_read_as_grade_a(kasteelspoort_ref):
    # "a Grade 3 scramble" must yield 3 — "a Grade" matched the article first.
    html = "<html><body><h1>T</h1><p>It's a Grade 3 or 4 scramble.</p></body></html>"
    assert parse_page(html, kasteelspoort_ref)["grade"] == "3"


def test_a_labelled_grade_is_marked_as_trustworthy(kasteelspoort_ref):
    html = "<html><body><h1>T</h1><p>Grade &amp; stars: 3 ***</p></body></html>"
    assert parse_page(html, kasteelspoort_ref)["grade_source"] == "label"


def test_a_prose_grade_is_marked_so_the_app_can_treat_it_with_caution(
    kasteelspoort_ref,
):
    # Prose grades often describe one pitch, not the route; the app must know.
    html = "<html><body><h1>T</h1><p>A popular B grade scramble.</p></body></html>"
    assert parse_page(html, kasteelspoort_ref)["grade_source"] == "prose"


def test_grade_source_is_none_when_there_is_no_grade(kasteelspoort_ref):
    html = "<html><body><h1>T</h1><p>Just prose.</p></body></html>"
    assert parse_page(html, kasteelspoort_ref)["grade_source"] is None


def test_the_real_kasteelspoort_page_grade_comes_from_its_gadget(
    kasteelspoort_html, kasteelspoort_ref
):
    record = parse_page(kasteelspoort_html, kasteelspoort_ref)
    # Kept raw, trailing note and all — the spec forbids normalising grades.
    assert record["grade"].startswith("1 ****")
    assert record["grade_source"] == "label"
    assert record["stats"]["Height gain"]


def test_grade_is_none_when_the_page_never_states_one(kasteelspoort_ref):
    html = "<html><body><h1>T</h1><p>A pleasant walk with no rating.</p></body></html>"
    assert parse_page(html, kasteelspoort_ref)["grade"] is None


def test_parsing_an_empty_page_yields_a_record_rather_than_raising(kasteelspoort_ref):
    record = parse_page("", kasteelspoort_ref)
    assert record["title"] == ""
    assert record["coords"] is None
    assert record["related"] == []
    assert record["attachments"] == []
