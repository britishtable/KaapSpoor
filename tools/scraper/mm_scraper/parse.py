"""Parse one wiki page into a route record."""

from __future__ import annotations

import re

from bs4 import BeautifulSoup

from .nav import PageRef
from .text import body_lines, page_title, split_sections

# Usually openstreetmap.org/#map=z/lat/lon, but one page puts a ?mlat=&mlon=
# marker query ahead of the fragment.
OSM_RE = re.compile(
    r"openstreetmap\.org/(?:\?[^\"'\s#]*)?#map=(\d+)/(-?\d+\.?\d*)/(-?\d+\.?\d*)"
)
DECK_RE = re.compile(r"presentation/d/([\w-]{20,})")
ATTACH_RE = re.compile(r'https?://[^"\'<>\s]+\.(?:gpx|kml|pdf)', re.I)
DRIVE_FILE_RE = re.compile(r'https://drive\.google\.com/file/d/[\w-]{20,}[^"\'<>\s]*')
# A grade value: letter (B, B+, C/D) or number (3, 1/2).
_VALUE = r"[A-F][+-]?(?:\s*/\s*[A-F][+-]?)?|\d{1,2}(?:\s*/\s*\d{1,2})?"
# The wiki writes grades on either side of the word: "Grade 3" but also "'B' grade".
# `grade\b` matters — without it "graded" matches as "grade" + "d".
# Two forms, searched in this order. "Grade 3" is unambiguous, so it wins over
# the trailing form, which would otherwise read the article in "a Grade 3" as A.
# `grade\b` stops "graded" matching; the value's own \b stops "the grade" -> "e".
GRADE_AFTER_RE = re.compile(rf"grade\b[:\s-]*['\"]?\b({_VALUE})\b", re.I)
GRADE_BEFORE_RE = re.compile(
    rf"(?<![\w'])['\"]?\b({_VALUE})\b['\"]?[\s-]+grade\b", re.I
)
# The site's own field is "Grade & stars"; also seen as "Grade"/"Grading"/"Difficulty".
GRADE_LABEL_RE = re.compile(r"^(grade|grading|difficulty)\b", re.I)
SITE_IMG = "sitesv-images-rt"


def _clean_cell(node) -> str:
    """Cell text with the site's stray nbsp/replacement characters removed."""
    text = node.get_text(" ", strip=True)
    for junk in ("\xa0", "�", "​"):
        text = text.replace(junk, " ")
    return " ".join(text.split())


def _stats(soup: BeautifulSoup) -> dict[str, str]:
    """Key/value rows from the "Key Statistics" gadget.

    Google Sites stores these embedded tables HTML-escaped inside a `data-code`
    attribute, so they never appear in the rendered DOM and a plain text walk of
    the page cannot see them. ~145 pages carry Grade, Height gain and Time here.
    """
    stats: dict[str, str] = {}
    for div in soup.find_all(attrs={"data-code": True}):
        inner = BeautifulSoup(div["data-code"], "lxml")
        for row in inner.find_all("tr"):
            cells = row.find_all("td")
            if len(cells) != 2:
                continue  # header rows span both columns
            key = _clean_cell(cells[0]).rstrip(":").strip()
            value = _clean_cell(cells[1])
            if key and value:
                stats.setdefault(key, value)
    return stats


def _coords(html: str) -> dict | None:
    m = OSM_RE.search(html)
    if not m:
        return None
    return {"zoom": int(m.group(1)), "lat": float(m.group(2)), "lon": float(m.group(3))}


def _grade(
    sections: dict[str, str], full_text: str, stats: dict[str, str]
) -> tuple[str | None, str | None]:
    """Raw grade string, never normalised.

    A labelled field is trusted; prose is a fallback. Prose grades are noisy —
    roughly a third of "... grade ..." mentions describe one pitch rather than
    the route — so `grade_source` records which path produced the value.
    """
    for key, value in {**stats, **sections}.items():
        if GRADE_LABEL_RE.match(key):
            # "Grade & stars" values read "3 ***"; keep the whole raw string.
            cleaned = " ".join(value.split())
            if cleaned:
                return cleaned, "label"
    for pattern in (GRADE_AFTER_RE, GRADE_BEFORE_RE):
        m = pattern.search(full_text)
        if m:
            return m.group(1).strip(), "prose"
    return None, None


def _related(soup: BeautifulSoup, own_path: str) -> list[str]:
    """Internal links to other wiki pages, as site-relative paths."""
    out = []
    for a in soup.find_all("a", href=True):
        href = a["href"].split("?")[0].split("#")[0]
        if href.startswith("/site/mountainmeanderswiki/Home") and href != own_path:
            out.append(href)
    return sorted(set(out))


def _photos(soup: BeautifulSoup, html: str) -> dict:
    """Photo *references* only — Phase 0 downloads no image bytes."""
    inline = []
    for img in soup.find_all("img", src=True):
        src = img["src"]
        # w16383 is the site logo, repeated on every page.
        if SITE_IMG in src and "=w16383" not in src:
            inline.append(src)
    decks = sorted(set(DECK_RE.findall(html)))
    return {
        "deck_ids": decks,
        "inline_urls": list(dict.fromkeys(inline)),
    }


def _attachments(html: str) -> list[str]:
    found = ATTACH_RE.findall(html) + DRIVE_FILE_RE.findall(html)
    return sorted(set(found))


def parse_page(html: str, ref: PageRef) -> dict:
    """Build a route record. Raises nothing; missing fields become None/[]."""
    soup = BeautifulSoup(html, "lxml")
    title = page_title(soup)
    related = _related(soup, ref.path)
    photos = _photos(soup, html)
    stats = _stats(soup)

    # body_lines() mutates the tree, so extract link/image data before it runs.
    lines = body_lines(soup)
    sections, full_text = split_sections(lines, title)
    grade, grade_source = _grade(sections, full_text, stats)

    return {
        "slug": ref.slug,
        "title": title,
        "url": ref.url,
        "area": list(ref.area),
        "depth": ref.depth,
        "coords": _coords(html),
        "grade": grade,
        "grade_source": grade_source,
        "sections": sections,
        "stats": stats,
        "description": full_text,
        "related": related,
        "attachments": _attachments(html),
        "photos": photos,
        "is_reference": ref.is_reference,
    }
