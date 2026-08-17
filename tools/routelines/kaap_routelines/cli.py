"""Entry point: read routes + ways + relations, write route-lines.geojson.

Degrades rather than fails when the extract is absent — a clone that has never
run WSL still builds, exactly as tools/geocode does.
"""

from __future__ import annotations

import argparse
import json
from datetime import date
from pathlib import Path

from .graph import build_graph, split_ways
from .ids import route_id
from .mentions import mentioned_trails
from .relations import read_relations, stitch
from .report import Outcome, Proposal, build_report
from .trails import build_trails
from .walk import Rejected, WalkResult, walk_route
from .ways import read_ways

HERE = Path(__file__).resolve().parent.parent
DATA = HERE.parent.parent / "data"


def _normalise(s: str) -> str:
    from .mentions import normalise_for_match

    return normalise_for_match(s)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Derive KaapSpoor route lines.")
    parser.add_argument("--routes", type=Path, default=DATA / "routes.json")
    parser.add_argument(
        "--ways",
        type=Path,
        default=HERE.parent / "geocode" / "work" / "walkable-ways.geojsonl",
    )
    parser.add_argument(
        "--relations",
        type=Path,
        default=HERE.parent / "geocode" / "work" / "route-relations.osm",
    )
    parser.add_argument("--relations-map", type=Path, default=DATA / "route-relations.json")
    parser.add_argument("--locations", type=Path, default=DATA / "route-locations.json")
    parser.add_argument("--out", type=Path, default=DATA / "route-lines.geojson")
    parser.add_argument("--report", type=Path, default=DATA / "route-lines-report.md")
    args = parser.parse_args(argv)

    dataset = json.loads(args.routes.read_text(encoding="utf-8"))
    routes = dataset["routes"]

    if args.ways.exists():
        ways = read_ways(args.ways)
        extract_date = date.fromtimestamp(args.ways.stat().st_mtime).isoformat()
    else:
        print(f"warning: {args.ways} missing — run extract-osm-features.sh in WSL")
        ways, extract_date = [], "none"

    # Member geometry is joined on by id, so the way index has to exist first.
    ways_by_id = {way.osm_id: way for way in ways}
    relations = read_relations(args.relations, ways_by_id) if args.relations.exists() else []
    confirmed: dict[str, dict] = {}
    if args.relations_map.exists():
        confirmed = json.loads(args.relations_map.read_text(encoding="utf-8")).get("confirmed", {})

    # The anchor has to come off the same ladder the app draws pins from, not
    # off the raw crawl: only 125 of 184 routes carry a crawl coordinate, so
    # reading routes.json alone rejected 59 routes as unpositioned that this
    # project has perfectly good positions for. Mirrors transform.ts.
    locations: dict[str, dict] = {}
    if args.locations.exists():
        locations = json.loads(args.locations.read_text(encoding="utf-8")).get("locations", {})

    # Cut every way at its junctions before anything walks on it. OSM does not
    # split a way where another meets it mid-span, and treating whole ways as
    # graph edges hid ~71 % of this extract's junctions — see graph.split_ways.
    edges = split_ways(ways)
    trails = build_trails(edges, relations)
    graph = build_graph(edges)
    by_relation_id = {relation.osm_id: relation for relation in relations}

    outcome = Outcome()
    features: list[dict] = []

    for raw in routes:
        rid = route_id(raw["area"], raw["slug"])
        title = raw.get("title") or ""

        # Tier 1: a hand-confirmed relation. Its extent was decided by a mapper.
        entry = confirmed.get(rid)
        if entry:
            relation = by_relation_id.get(entry["relation"])
            if relation is None:
                outcome.rejected.append(
                    {"routeId": rid, "reason": f"relation {entry['relation']} not in the extract"}
                )
                continue
            if relation.missing:
                outcome.rejected.append({
                    "routeId": rid,
                    "reason": f"relation {relation.osm_id} is missing {relation.missing} "
                              "member ways from the extract",
                })
                continue
            stitched = stitch(relation)
            # A relation line has to BE a line. Apostles Path stitches into 9
            # disconnected parts out of this extract: whatever that draws, it
            # is not the traverse the guide describes, and a route's own line
            # with holes in it is the one thing this phase exists to avoid.
            # The tier's claim is that a mapper decided the extent — that only
            # holds when the members actually make one continuous run.
            if not stitched.joined:
                outcome.rejected.append({
                    "routeId": rid,
                    "reason": f"relation {relation.osm_id} stitches into "
                              f"{len(stitched.parts)} disconnected parts, not one line",
                })
                continue
            geometry = {
                "type": "LineString",
                "coordinates": [list(p) for p in stitched.parts[0]],
            }
            from .geo import length_m as measure

            total = sum(measure(part) for part in stitched.parts)
            features.append({
                "type": "Feature",
                "geometry": geometry,
                "properties": {
                    "routeId": rid, "source": "osm-relation",
                    "osmWays": list(stitched.way_ids), "relation": relation.osm_id,
                    "lengthM": round(total, 1), "connectorM": 0.0,
                },
            })
            outcome.accepted.append({
                "routeId": rid, "source": "osm-relation", "lengthM": total,
                "connectorM": 0.0, "ways": len(stitched.way_ids), "relation": relation.osm_id,
            })
            continue

        # Propose, never promote: a title overlapping a relation name is a question.
        normalised_title = _normalise(title)
        for relation in relations:
            normalised_name = _normalise(relation.name)
            if not normalised_name:
                continue
            if normalised_name in normalised_title or normalised_title in normalised_name:
                outcome.proposals.append(
                    Proposal(rid, title, relation.osm_id, relation.name)
                )

        # Tier 2: the ordered corridor walk.
        #
        # The anchor follows the app's own ladder (transform.ts): a recorded
        # location wins over the crawl coordinate, except an `area-approx` one
        # where a crawl coordinate exists — an area centroid is strictly less
        # information than a coordinate for the route itself.
        recorded = locations.get(rid)
        if recorded and recorded.get("source") == "area-approx" and raw.get("coords"):
            recorded = None
        # An area centroid is refused as an anchor outright, even when it is
        # all there is. These carry a radius of kilometres; snapping one to
        # whatever path happens to lie within 250 m would start the line
        # somewhere nobody claimed the route goes, which is exactly the wrong
        # trade under a right-or-absent bar.
        if recorded and recorded.get("source") == "area-approx":
            outcome.rejected.append({
                "routeId": rid,
                "reason": "area-approx position: an area centroid cannot anchor a line",
            })
            continue
        coords = (recorded or {}).get("coords") or raw.get("coords")
        if not coords:
            outcome.rejected.append({"routeId": rid, "reason": "no recorded position"})
            continue
        prose = " ".join((raw.get("sections") or {}).values())
        names = mentioned_trails(prose, list(trails))
        result = walk_route((coords["lon"], coords["lat"]), names, trails, graph)
        if isinstance(result, Rejected):
            outcome.rejected.append({"routeId": rid, "reason": result.reason})
            continue
        assert isinstance(result, WalkResult)
        features.append({
            "type": "Feature",
            "geometry": {"type": "LineString", "coordinates": [list(p) for p in result.coords]},
            "properties": {
                "routeId": rid, "source": "osm-stitch",
                "osmWays": list(result.way_ids), "relation": None,
                "lengthM": round(result.length_m, 1),
                "connectorM": round(result.connector_m, 1),
            },
        })
        outcome.accepted.append({
            "routeId": rid, "source": "osm-stitch", "lengthM": result.length_m,
            "connectorM": result.connector_m, "ways": len(result.way_ids), "relation": None,
        })

    args.out.write_text(
        json.dumps({"type": "FeatureCollection", "features": features}, indent=1) + "\n",
        encoding="utf-8",
    )
    args.report.write_text(build_report(outcome, extract_date), encoding="utf-8")

    by_tier: dict[str, int] = {}
    for row in outcome.accepted:
        by_tier[row["source"]] = by_tier.get(row["source"], 0) + 1
    print(
        f"routelines: {len(outcome.accepted)}/{len(routes)} lines "
        f"({', '.join(f'{k}={v}' for k, v in sorted(by_tier.items())) or 'none'}), "
        f"{len(outcome.rejected)} rejected, {len(outcome.proposals)} relation candidates"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
