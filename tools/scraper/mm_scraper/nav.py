"""Enumerate wiki pages and derive hierarchy from URL paths.

Every page embeds the full navigation tree, so one fetch yields every page.
Hierarchy is encoded in the path itself, which is more reliable than parsing
the obfuscated Google Sites nav markup:

    /site/mountainmeanderswiki/Home/Table-Mountain/atlantic-west/kasteelspoort
                                    ^^^^^^^^^^^^^^ ^^^^^^^^^^^^ ^^^^^^^^^^^^^
                                    area           sub-area      slug
"""

from __future__ import annotations

import re
from dataclasses import dataclass

SITE_ROOT = "/site/mountainmeanderswiki/Home"
LINK_RE = re.compile(r'href="(/site/mountainmeanderswiki/Home[^"?#]*)"')

# Reference pages live under /introduction and are not routes, but two of them
# are worth archiving as plain text.
KEEP_REFERENCE = ("grading", "change-record")


@dataclass(frozen=True)
class PageRef:
    path: str
    segments: tuple[str, ...]  # path parts below Home

    @property
    def slug(self) -> str:
        return self.segments[-1] if self.segments else "home"

    @property
    def depth(self) -> int:
        return len(self.segments)

    @property
    def area(self) -> tuple[str, ...]:
        """Ancestor segments, i.e. everything above the page itself."""
        return self.segments[:-1]

    @property
    def url(self) -> str:
        return "https://sites.google.com" + self.path

    @property
    def is_reference(self) -> bool:
        return bool(self.segments) and self.segments[0].lower() == "introduction"


def enumerate_pages(home_html: str) -> list[PageRef]:
    """All unique wiki pages linked from the embedded nav, sorted by path."""
    paths = sorted(set(LINK_RE.findall(home_html)))
    refs = []
    for path in paths:
        tail = path[len(SITE_ROOT):].strip("/")
        segments = tuple(s for s in tail.split("/") if s)
        refs.append(PageRef(path=path, segments=segments))
    return refs


def should_archive(ref: PageRef) -> bool:
    """Reference pages are skipped except the grading and change-record pages."""
    if not ref.is_reference:
        return True
    return any(k in ref.slug.lower() for k in KEEP_REFERENCE)
