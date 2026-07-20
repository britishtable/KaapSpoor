"""Measure photo payload without downloading it all.

Phase 0 deferred the repo-tier decision until it could be made against measured
totals rather than projections. Deck sizes come from Content-Length, which costs
one header exchange each. Slide counts need the PDF body, so those are sampled.

    python -m mm_scraper.measure_photos --out ../../data/photo-inventory.json
"""

from __future__ import annotations

import re

import requests

from .fetch import USER_AGENT

PDF_URL = "https://docs.google.com/presentation/d/{}/export/pdf"
DELAY = 2.5

# Google's export writes "/Type/Page" with no space, and "/Type/Pages" is the
# page-tree node rather than a slide.
PAGE_RE = re.compile(rb"/Type\s*/Page(?![sC])")


def count_pdf_pages(body: bytes) -> int:
    """Slide count for an exported deck."""
    return len(PAGE_RE.findall(body))


def project(total_bytes: int, photo_count: int) -> dict:
    """Projected repo cost per compression tier.

    Per-photo figures are the spec's measured samples; scaling by the real photo
    count is what turns them from a guess into an estimate.
    """
    tiers = {"webp_1000_q75": 157, "webp_800_q72": 102, "webp_640_q70": 66}
    out = {"originals_mb": round(total_bytes / 1024 / 1024, 1)}
    for name, kb in tiers.items():
        out[name + "_mb"] = round(photo_count * kb / 1024, 1)
    return out


def _session() -> requests.Session:
    s = requests.Session()
    s.headers.update({"User-Agent": USER_AGENT})
    return s


def deck_size(session, deck_id: str) -> tuple[int, int | None]:
    """(bytes, page_count). Page count is None unless the body was read."""
    resp = session.get(PDF_URL.format(deck_id), stream=True, timeout=90)
    if resp.status_code != 200:
        resp.close()
        return 0, None
    size = int(resp.headers.get("Content-Length") or 0)
    if size:
        resp.close()
        return size, None
    body = resp.content  # no Content-Length; we must read to measure
    return len(body), count_pdf_pages(body) or None


def deck_pages(session, deck_id: str) -> int | None:
    """Slide count, which requires the PDF body — used on a sample only."""
    resp = session.get(PDF_URL.format(deck_id), timeout=120)
    if resp.status_code != 200:
        return None
    return count_pdf_pages(resp.content) or None
