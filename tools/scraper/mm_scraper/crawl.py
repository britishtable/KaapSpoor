"""Crawl orchestration, kept free of argparse so it can be tested directly."""

from __future__ import annotations

from .fetch import BASE, HOME_PATH
from .nav import PageRef, enumerate_pages, should_archive
from .parse import parse_page


def is_hierarchy_node(ref: PageRef, all_refs: list[PageRef]) -> bool:
    """True when other pages live below this one.

    Area and sub-area pages (`overberg`, `cape-karoo`) are indexes, not routes.
    Derived from the nav tree rather than from depth, because route pages appear
    at depths 2 through 4.
    """
    prefix = ref.path.rstrip("/") + "/"
    return any(other.path.startswith(prefix) for other in all_refs)


def crawl(fetcher, *, limit: int | None = None, on_page=None) -> dict:
    """Fetch and parse every archivable page.

    Returns routes, hierarchy nodes, reference pages and failures. Never raises
    for a single bad page — a failure is recorded and the crawl continues.
    """
    home = fetcher.get(BASE + HOME_PATH)
    all_refs = enumerate_pages(home)
    targets = [r for r in all_refs if should_archive(r)][:limit]

    result = {"routes": [], "nodes": [], "reference": [], "failures": []}
    for index, ref in enumerate(targets, 1):
        if on_page:
            on_page(index, len(targets), ref)
        try:
            record = parse_page(fetcher.get(ref.url), ref)
        except Exception as exc:  # noqa: BLE001 - one bad page must not stop the crawl
            result["failures"].append((ref.url, f"{type(exc).__name__}: {exc}"))
            continue

        if ref.is_reference:
            result["reference"].append(record)
        elif is_hierarchy_node(ref, all_refs):
            result["nodes"].append(record)
        else:
            result["routes"].append(record)
    return result
