"""Command line entry point: crawl the wiki, write the dataset and the report.

    python -m mm_scraper.cli --data-dir ../../data

A full crawl takes ~10 minutes at the polite 2.5s delay. Raw HTML is cached, so
re-runs are near-instant and never refetch.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from .crawl import crawl
from .fetch import BASE, HOME_PATH, PoliteFetcher
from .report import build_report

SOURCE = BASE + HOME_PATH
LICENSE = "CC BY-SA 2.5 ZA"
ATTRIBUTION = "Content from the Mountain Meanders wiki, used under CC BY-SA 2.5 ZA."


def _progress(index: int, total: int, ref) -> None:
    print(f"[{index:>3}/{total}] {ref.path}", file=sys.stderr, flush=True)


def _write_reference_pages(records: list[dict], data_dir: Path) -> None:
    """The grading and change-record pages are archived as plain text."""
    out_dir = data_dir / "reference"
    out_dir.mkdir(parents=True, exist_ok=True)
    for record in records:
        body = f"# {record['title']}\n\nSource: {record['url']}\n\n{record['description']}\n"
        (out_dir / f"{record['slug']}.md").write_text(body, encoding="utf-8")


def _build_dataset(result: dict) -> dict:
    return {
        "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": SOURCE,
        "license": LICENSE,
        "attribution": ATTRIBUTION,
        "areas": result["nodes"],
        "routes": result["routes"],
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Crawl the Mountain Meanders wiki.")
    parser.add_argument("--data-dir", type=Path, default=Path("data"))
    parser.add_argument("--cache-dir", type=Path, default=Path("cache"))
    parser.add_argument("--delay", type=float, default=2.5)
    parser.add_argument("--limit", type=int, default=None, help="crawl N pages only")
    args = parser.parse_args(argv)

    fetcher = PoliteFetcher(args.cache_dir, delay=args.delay)
    result = crawl(fetcher, limit=args.limit, on_page=_progress)

    args.data_dir.mkdir(parents=True, exist_ok=True)
    routes_path = args.data_dir / "routes.json"
    routes_path.write_text(
        json.dumps(_build_dataset(result), indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )

    _write_reference_pages(result["reference"], args.data_dir)

    report = build_report(
        result["routes"],
        nodes=result["nodes"],
        reference=result["reference"],
        failures=result["failures"],
    )
    report_path = args.data_dir / "coverage-report.md"
    report_path.write_text(report + "\n", encoding="utf-8")

    print(
        f"\n{len(result['routes'])} routes, {len(result['nodes'])} areas, "
        f"{len(result['failures'])} failures "
        f"({fetcher.live_requests} live, {fetcher.cache_hits} cached)\n"
        f"wrote {routes_path} and {report_path}",
        file=sys.stderr,
    )
    return 1 if result["failures"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
