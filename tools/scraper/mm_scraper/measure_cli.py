"""Run the photo measurement and write an inventory."""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

from .measure_photos import DELAY, _session, deck_pages, deck_size, project


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--routes", type=Path, default=Path("../../data/routes.json"))
    p.add_argument("--out", type=Path, default=Path("../../data/photo-inventory.json"))
    p.add_argument("--sample", type=int, default=15, help="decks to page-count")
    args = p.parse_args(argv)

    data = json.loads(args.routes.read_text(encoding="utf-8"))
    decks: list[str] = []
    for route in data["routes"] + data["areas"]:
        decks += route["photos"]["deck_ids"]
    decks = list(dict.fromkeys(decks))
    inline = sum(len(r["photos"]["inline_urls"]) for r in data["routes"])

    session = _session()
    sizes: dict[str, int] = {}
    for i, deck in enumerate(decks, 1):
        size, _ = deck_size(session, deck)
        sizes[deck] = size
        print(f"[{i}/{len(decks)}] {deck[:14]} {size / 1024:>8.0f} KB", file=sys.stderr)
        time.sleep(DELAY)

    pages: dict[str, int] = {}
    step = max(1, len(decks) // args.sample)
    for deck in decks[::step][: args.sample]:
        n = deck_pages(session, deck)
        if n:
            pages[deck] = n
        print(f"sample {deck[:14]} pages={n}", file=sys.stderr)
        time.sleep(DELAY)

    total = sum(sizes.values())
    ok = [d for d, s in sizes.items() if s]
    avg_pages = sum(pages.values()) / len(pages) if pages else 0
    est_photos = round(avg_pages * len(ok)) + inline

    report = {
        "decks_total": len(decks),
        "decks_measured": len(ok),
        "decks_failed": len(decks) - len(ok),
        "deck_bytes_total": total,
        "deck_bytes_mean": round(total / len(ok)) if ok else 0,
        "deck_bytes_max": max(sizes.values()) if sizes else 0,
        "sampled_decks": len(pages),
        "slides_per_deck_mean": round(avg_pages, 1),
        "inline_images": inline,
        "estimated_photos": est_photos,
        "projection": project(total, est_photos),
        "deck_bytes": sizes,
    }
    args.out.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: v for k, v in report.items() if k != "deck_bytes"}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
