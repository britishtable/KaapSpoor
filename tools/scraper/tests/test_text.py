"""Title resolution, chrome stripping and section splitting."""

from bs4 import BeautifulSoup

from mm_scraper.text import body_lines, page_title, redact_lines, split_sections


def _soup(html):
    return BeautifulSoup(html, "lxml")


def test_prefers_the_h1_when_a_page_has_one(kasteelspoort_html):
    assert page_title(_soup(kasteelspoort_html)) == "Kasteelspoort path (KP)"


def test_falls_back_to_title_tag_when_there_is_no_h1(blind_gully_html):
    soup = _soup(blind_gully_html)
    assert soup.find("h1") is None
    # The site prefix is stripped so both paths yield a bare route name.
    assert page_title(soup) == "Blind Gully"


def test_title_is_empty_rather_than_raising_when_a_page_has_neither():
    assert page_title(_soup("<html><body><p>hi</p></body></html>")) == ""


def test_document_title_does_not_leak_into_the_body(kasteelspoort_html):
    lines = body_lines(_soup(kasteelspoort_html))
    assert not any(line.startswith("Mountain Meanders - ") for line in lines)


def test_site_chrome_is_dropped(kasteelspoort_html):
    lines = [line.lower() for line in body_lines(_soup(kasteelspoort_html))]
    assert "search this site" not in lines
    assert "report abuse" not in lines


def test_everything_from_the_licence_onward_is_cut(kasteelspoort_html):
    lines = body_lines(_soup(kasteelspoort_html))
    assert not any("licensed under a" in line.lower() for line in lines)


def test_labels_on_their_own_line_capture_the_prose_beneath():
    lines = ["Location:", "At the top of Theresa Avenue.", "It is signposted."]
    sections, _ = split_sections(lines, title="Anything")
    assert sections["Location"] == "At the top of Theresa Avenue.\nIt is signposted."


def test_labels_sharing_a_line_with_their_prose_are_also_captured():
    sections, _ = split_sections(["Grade: B/C"], title="Anything")
    assert sections["Grade"] == "B/C"


def test_prose_before_any_label_collects_under_the_empty_key():
    sections, _ = split_sections(["Loose intro.", "Overview:", "Then this."], "X")
    assert sections[""] == "Loose intro."
    assert sections["Overview"] == "Then this."


def test_a_leading_repeat_of_the_title_is_dropped():
    sections, full = split_sections(["Blind Gully", "Real prose."], "Blind Gully")
    assert full == "Real prose."


def test_real_page_yields_the_expected_labelled_sections(kasteelspoort_html):
    soup = _soup(kasteelspoort_html)
    title = page_title(soup)
    sections, full_text = split_sections(body_lines(soup), title)

    assert set(sections) >= {"Location", "Overview", "Route Description"}
    assert sections["Location"].startswith("Park at the top of Theresa Avenue")
    assert "Pipe Track" in full_text


def test_a_private_individuals_email_is_redacted():
    """The wiki names a private landowner's personal address; the published
    dataset must not carry it, while official contacts stay."""
    lines = redact_lines(["Contact the owner fminicki@gmail.com for access."])
    assert "fminicki@gmail.com" not in lines[0]
    assert "[contact removed]" in lines[0]


def test_official_and_role_contacts_are_kept():
    kept = [
        "Email: zizipho.mfazwe@sanparks.org",
        "steenbras.naturereserve@capetown.gov.za",
        "mountain-meanders@googlegroups.com",
    ]
    assert redact_lines(kept) == kept


def test_redaction_applies_to_real_page_text(kasteelspoort_html):
    lines = body_lines(_soup(kasteelspoort_html))
    assert not any("fminicki" in line for line in lines)
