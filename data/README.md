# Extracted trail data

Everything in this directory is derived from the **Mountain Meanders** route wiki:

<https://sites.google.com/site/mountainmeanderswiki/Home>

Mountain Meanders publishes under **CC BY-SA 2.5 ZA**, so this directory carries that
same licence (see `LICENSE`) — separately from the app and scraper code under `tools/`,
which is MIT.

## Contents

| File | What it is |
|---|---|
| `routes.json` | The dataset: route records plus area hierarchy nodes |
| `coverage-report.md` | Field coverage and extraction failures for the last crawl |
| `reference/` | The wiki's grading and change-record pages, as plain text |

## Notes

- `photos` holds **references only** — deck ids and inline image URLs. Phase 0
  deliberately downloads no image bytes; `photo-inventory.json` has the measured totals.
- **Repo tier decided: WebP 640px q70 (~230 MB projected).** Originals total ~1.14 GB,
  over the 1 GB GitHub Pages limit that must also hold the PMTiles extract. 640px leaves
  the most headroom and photos are secondary for this app. The three WebP projections
  scale the spec's per-photo samples, so confirm against a real compression run before
  the photo pass commits.
- **`photos.inline_urls` go stale.** The `sitesv-images-rt` URLs are signed and expire
  within about an hour, after which they return `403` — the signature cannot be
  reconstructed. A later photo pass must re-crawl each page for fresh URLs rather than
  reading them from `routes.json`. Deck ids do not expire, so decks are safe to defer.
- `grade` is the **raw string** from the page. It is not normalised — the wiki is
  inconsistent and normalising would lose information.
- Regenerate with `python -m mm_scraper.cli` from `tools/scraper/`.

Please preserve the attribution if you reuse any of this.
