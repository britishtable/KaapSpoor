"""data/geocode-report.md — the tier mix and the three work queues.

Written so the weak links are visible rather than buried: every osm-match names
the candidate string that matched, so a reviewer can spot a match that came from
an over-stripped title and correct it with an override.
"""

from __future__ import annotations

from typing import Any

from .pipeline import Outcome

TIERS = ("curated", "crawl", "osm-match", "area-approx")


def build_report(outcome: Outcome, routes: list[dict[str, Any]], extract_date: str) -> str:
    counts = {tier: 0 for tier in TIERS}
    for location in outcome.locations.values():
        counts[location.source] += 1

    total = len(routes)
    located = len(outcome.locations)

    lines = [
        "# Geocoding report",
        "",
        f"**OSM extract date:** {extract_date}",
        "",
        f"Located **{located} / {total}** routes; **{len(outcome.unlocated)}** remain unlocated.",
        "",
        "## Tier mix",
        "",
        "| Source | Routes |",
        "|---|---|",
    ]
    for tier in TIERS:
        lines.append(f"| `{tier}` | {counts[tier]} |")

    matches = sorted(
        (loc for loc in outcome.locations.values() if loc.source == "osm-match"),
        key=lambda loc: loc.route_id,
    )
    lines += [
        "",
        "## OSM matches",
        "",
        "Each row names the candidate string that matched. A match on a heavily",
        "stripped candidate is weaker evidence than one on a full title — review",
        "those and override where wrong.",
        "",
        "| Route | Matched candidate | OSM feature |",
        "|---|---|---|",
    ]
    for loc in matches:
        osm = loc.osm or {}
        ref = f"{osm.get('type', '?')}/{osm.get('id', '?')}"
        lines.append(
            f"| `{loc.route_id}` | {loc.matched_candidate} | {osm.get('name', '?')} ({ref}) |"
        )

    lines += [
        "",
        "## Ambiguous — needs a curated override",
        "",
        "More than one feature of this name sits inside the route's area, so no",
        "match was claimed. These fell through to `area-approx`.",
        "",
    ]
    if outcome.ambiguous:
        lines += ["| Route | Candidate | Features |", "|---|---|---|"]
        for rid, candidate, count in sorted(outcome.ambiguous):
            lines.append(f"| `{rid}` | {candidate} | {count} |")
    else:
        lines.append("None.")

    lines += [
        "",
        "## Orphaned overrides — routeId matches nothing in this crawl",
        "",
        "These entries in `data/geocode-overrides.json` did nothing this run: no",
        "route with this id exists in the current crawl, likely a typo or a route",
        "since renamed or removed. Fix or remove the entry.",
        "",
    ]
    if outcome.orphaned_overrides:
        lines += [f"- `{rid}`" for rid in sorted(outcome.orphaned_overrides)]
    else:
        lines.append("None.")

    lines += ["", "## Still unlocated", ""]
    if outcome.unlocated:
        lines += [f"- `{rid}`" for rid in sorted(outcome.unlocated)]
    else:
        lines.append("None.")

    approx = sorted(
        (loc for loc in outcome.locations.values() if loc.source == "area-approx"),
        key=lambda loc: loc.route_id,
    )
    lines += ["", "## Area-approximate", "", "| Route | Accuracy (m) |", "|---|---|"]
    for loc in approx:
        lines.append(f"| `{loc.route_id}` | {loc.accuracy_m} |")

    return "\n".join(lines) + "\n"
