"""The review report — what shipped, what did not, and what needs a human.

Mirrors data/geocode-report.md: every claim this pipeline makes is reviewable,
and a rejection is information rather than a silence.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class Proposal:
    route_id: str
    title: str
    relation_id: int
    relation_name: str


@dataclass
class Outcome:
    accepted: list[dict] = field(default_factory=list)
    rejected: list[dict] = field(default_factory=list)
    proposals: list[Proposal] = field(default_factory=list)


def build_report(outcome: Outcome, extract_date: str) -> str:
    lines = [
        "# Route lines review",
        "",
        f"OSM extract: {extract_date}",
        "",
        f"**{len(outcome.accepted)} routes have a line**; {len(outcome.rejected)} were rejected.",
        "A rejected route keeps its pin and draws nothing, which is the design:",
        "a wrong line is a wrong claim about the mountain.",
        "",
        "## Accepted",
        "",
        "| route | tier | length | connectors | ways | relation |",
        "|---|---|---|---|---|---|",
    ]
    for row in outcome.accepted:
        relation = row.get("relation") or "—"
        lines.append(
            f"| `{row['routeId']}` | {row['source']} | {row['lengthM'] / 1000:.1f} km | "
            f"{row['connectorM'] / 1000:.1f} km | {row['ways']} | {relation} |"
        )

    lines += ["", "## Rejected", "", "| route | reason |", "|---|---|"]
    for row in outcome.rejected:
        lines.append(f"| `{row['routeId']}` | {row['reason']} |")

    lines += [
        "",
        "## Relation candidates awaiting confirmation",
        "",
        "These route titles overlap a relation name. **Each one is a question, not a",
        "match** — add the true ones to `data/route-relations.json` by hand and rerun.",
        "",
        "| route | title | relation | relation name |",
        "|---|---|---|---|",
    ]
    for proposal in outcome.proposals:
        lines.append(
            f"| `{proposal.route_id}` | {proposal.title} | {proposal.relation_id} | "
            f"{proposal.relation_name} |"
        )
    return "\n".join(lines) + "\n"
