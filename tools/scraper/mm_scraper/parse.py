"""Parse one wiki page into a route record."""

from __future__ import annotations

import re

from bs4 import BeautifulSoup

from .nav import PageRef
from .text import body_lines, page_title, split_sections

OSM_RE = re.compile(r"openstreetmap\.org/#map=(\d+)/(-?\d+\.?\d*)/(-?\d+\.?\d*)")
DECK_RE = re.compile(r"presentation/d/([\w-]{20,})")
ATTACH_RE = re.compile(r'https?://[^"\'<>\s]+\.(?:gpx|kml|pdf)', re.I)
DRIVE_FILE_RE = re.compile(r'https://drive\.google\.com/file/d/[\w-]{20,}[^"\'<>\s]*')
GRADE_RE = re.compile(
    r"\b(?:grade\s*[:\-]?\s*)([A-F](?:\s*[/-]\s*[A-F])?|\d{1,2}[a-dA-D]?)\b", re.I
)
SITE_IMG = "sitesv-images-rt"


def _coords(html: str) -> dict | None:
    m = OSM_RE.search(html)
    if not m:
        return None
    return {"zoom": int(m.group(1)), "lat": float(m.group(2)), "lon": float(m.group(3))}


def _grade(sections: dict[str, str], full_text: str) -> str | None:
    """Raw grade string, never normalised."""
    for key in ("Grade", "Grading", "Difficulty"):
        if key in sections:
            return sections[key].split("\n")[0].strip() or None
    m = GRADE_RE.search(full_text)
    return m.group(0).strip() if m else None


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

    # body_lines() mutates the tree, so extract link/image data before it runs.
    lines = body_lines(soup)
    sections, full_text = split_sections(lines, title)

    return {
        "slug": ref.slug,
        "title": title,
        "url": ref.url,
        "area": list(ref.area),
        "depth": ref.depth,
        "coords": _coords(html),
        "grade": _grade(sections, full_text),
        "sections": sections,
        "description": full_text,
        "related": related,
        "attachments": _attachments(html),
        "photos": photos,
        "is_reference": ref.is_reference,
    }
