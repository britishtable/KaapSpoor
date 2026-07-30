"""Entry point: read routes + features + overrides, write locations + report."""

from __future__ import annotations

import argparse
import json
from datetime import date
from pathlib import Path

from .features import read_features
from .overrides import load_overrides
from .pipeline import locate_all
from .report import build_report

HERE = Path(__file__).resolve().parent.parent
DATA = HERE.parent.parent / "data"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Locate KaapSpoor routes.")
    parser.add_argument("--routes", type=Path, default=DATA / "routes.json")
    parser.add_argument("--features", type=Path, default=HERE / "work" / "named-features.geojsonl")
    parser.add_argument("--overrides", type=Path, default=DATA / "geocode-overrides.json")
    parser.add_argument("--out", type=Path, default=DATA / "route-locations.json")
    parser.add_argument("--report", type=Path, default=DATA / "geocode-report.md")
    parser.add_argument(
        "--extract-date",
        default=None,
        help="Date of the OSM extract, recorded for reproducibility "
        "(defaults to the features file's mtime).",
    )
    args = parser.parse_args(argv)

    dataset = json.loads(args.routes.read_text(encoding="utf-8"))
    routes = dataset["routes"]
    # Inherit the crawl's own timestamp rather than stamping today: this output
    # is a pure function of its inputs, and a fresh date on every run would
    # dirty a committed artifact that had not actually changed.
    generated = str(dataset.get("generated") or date.today().isoformat())

    if args.features.exists():
        features = read_features(args.features)
        extract_date = args.extract_date or date.fromtimestamp(
            args.features.stat().st_mtime
        ).isoformat()
    else:
        # Without the extract the osm-match tier simply cannot fire; the other
        # three still can, so this is a degraded run rather than a failure.
        print(f"warning: {args.features} missing — run extract-osm-features.sh in WSL")
        features = []
        extract_date = args.extract_date or "none"

    overrides = load_overrides(args.overrides)
    outcome = locate_all(routes, features, overrides)

    payload = {
        "generated": generated,
        "osm_extract_date": extract_date,
        "locations": {
            rid: {
                "coords": {"lat": loc.lat, "lon": loc.lon, "zoom": loc.zoom},
                "source": loc.source,
                **({"accuracyM": loc.accuracy_m} if loc.accuracy_m is not None else {}),
                **({"osm": loc.osm} if loc.osm else {}),
            }
            for rid, loc in sorted(outcome.locations.items())
        },
    }
    args.out.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    args.report.write_text(build_report(outcome, routes, extract_date), encoding="utf-8")

    counts: dict[str, int] = {}
    for loc in outcome.locations.values():
        counts[loc.source] = counts.get(loc.source, 0) + 1
    print(
        f"geocode: {len(outcome.locations)}/{len(routes)} located "
        f"({', '.join(f'{k}={v}' for k, v in sorted(counts.items()))}), "
        f"{len(outcome.unlocated)} unlocated, {len(outcome.ambiguous)} ambiguous, "
        f"{len(outcome.orphaned_overrides)} orphaned overrides"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
