"""Coverage report for a crawl.

Coordinate coverage is the number Phase 2 hangs on: high coverage allows a pin
per route, partial coverage forces a graceful unmapped-route path. It is
reported first and the unmapped routes are listed by name.
"""

from __future__ import annotations


def stat(route: dict, name: str) -> str | None:
    """A Key Statistics value, matched case-insensitively.

    The wiki writes both "Height gain" and "Height Gain".
    """
    for key, value in (route.get("stats") or {}).items():
        if key.lower() == name.lower():
            return value
    return None


def is_full_entry(route: dict) -> bool:
    """True for pages the wiki treats as a proper route entry.

    A Key Statistics table or a labelled grade is the site's own marker. Pages
    without either are traverse notes and connecting sections rather than
    hikes — they have no time, no height gain, and rarely a route description.
    """
    return bool(route.get("stats")) or route.get("grade_source") == "label"


def _pct(n: int, total: int) -> str:
    return f"{(100.0 * n / total if total else 0.0):.1f}%"


def _coverage_row(label: str, n: int, total: int) -> str:
    return f"| {label} | {n} / {total} | {_pct(n, total)} |"


def build_report(
    routes: list[dict],
    *,
    nodes: list[dict],
    failures: list,
    reference: list[dict] | None = None,
) -> str:
    """Markdown coverage report. `routes` excludes hierarchy and reference pages."""
    reference = reference or []
    total = len(routes)
    with_coords = [r for r in routes if r.get("coords")]
    with_grade = [r for r in routes if r.get("grade")]
    with_photos = [r for r in routes if _photo_count(r)]
    with_attach = [r for r in routes if r.get("attachments")]

    decks = sum(len(r.get("photos", {}).get("deck_ids", [])) for r in routes)
    inline = sum(len(r.get("photos", {}).get("inline_urls", [])) for r in routes)

    out = [
        "# Mountain Meanders — Coverage Report",
        "",
        f"- Pages crawled: **{total + len(nodes) + len(reference) + len(failures)}**",
        f"- Routes extracted: **{total}**",
        f"- Hierarchy nodes (area/index pages): **{len(nodes)}**",
        f"- Reference pages archived: **{len(reference)}**",
        f"- Extraction failures: **{len(failures)}**",
        "",
        "## Coverage",
        "",
        "| Field | Routes | Coverage |",
        "|---|---|---|",
        _coverage_row("**Coordinates**", len(with_coords), total),
        _coverage_row("Grade (all)", len(with_grade), total),
        _coverage_row(
            "&nbsp;&nbsp;· from a labelled field",
            sum(1 for r in routes if r.get("grade_source") == "label"),
            total,
        ),
        _coverage_row(
            "&nbsp;&nbsp;· inferred from prose",
            sum(1 for r in routes if r.get("grade_source") == "prose"),
            total,
        ),
        _coverage_row("Time", sum(1 for r in routes if stat(r, "Time")), total),
        _coverage_row(
            "Height gain", sum(1 for r in routes if stat(r, "Height gain")), total
        ),
        _coverage_row("Photos (any)", len(with_photos), total),
        _coverage_row("Attachments", len(with_attach), total),
        "",
    ]
    out += _segment_section(routes)
    out += [
        "## Photos",
        "",
        f"- Slides decks referenced: **{decks}**",
        f"- Inline images referenced: **{inline}**",
        "",
    ]
    out += _unmapped_section(routes, with_coords)
    out += _failure_section(failures)
    return "\n".join(out)


def _segment_section(routes: list[dict]) -> list[str]:
    """Coverage split into real hikes and traverse notes.

    Phase 2 should be sized against the routes a hiker would actually pick, so
    coordinate coverage is given for both populations.
    """
    entries = [r for r in routes if is_full_entry(r)]
    stubs = [r for r in routes if not is_full_entry(r)]
    ec = sum(1 for r in entries if r.get("coords"))
    sc = sum(1 for r in stubs if r.get("coords"))
    return [
        "## Full route entries vs traverse notes",
        "",
        "Pages carrying a Key Statistics table or a labelled grade are proper route",
        "entries. The rest are connecting traverses and notes — no time, no height",
        "gain, rarely a route description, and about half the prose.",
        "",
        "| Population | Routes | With coordinates |",
        "|---|---|---|",
        f"| **Full route entries** | {len(entries)} | {ec} / {len(entries)} "
        f"({_pct(ec, len(entries))}) |",
        f"| Traverse notes / sections | {len(stubs)} | {sc} / {len(stubs)} "
        f"({_pct(sc, len(stubs))}) |",
        "",
    ]


def _photo_count(route: dict) -> int:
    photos = route.get("photos") or {}
    return len(photos.get("deck_ids", [])) + len(photos.get("inline_urls", []))


def _unmapped_section(routes: list[dict], with_coords: list[dict]) -> list[str]:
    unmapped = [r for r in routes if r not in with_coords]
    out = ["## Routes without coordinates", ""]
    if not unmapped:
        out += ["None — every route is mappable.", ""]
        return out
    out.append(f"{len(unmapped)} route(s) would need a graceful unmapped path:")
    out.append("")
    for route in sorted(unmapped, key=lambda r: r.get("title") or r["slug"]):
        out.append(f"- {route.get('title') or route['slug']} — {route['url']}")
    out.append("")
    return out


def _failure_section(failures: list) -> list[str]:
    out = ["## Failures", ""]
    if not failures:
        out += ["None.", ""]
        return out
    for url, error in failures:
        out.append(f"- `{url}` — {error}")
    out.append("")
    return out
