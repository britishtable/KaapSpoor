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
  deliberately downloads no image bytes; see the Phase 0 design spec for the sizing
  measurements behind that decision.
- `grade` is the **raw string** from the page. It is not normalised — the wiki is
  inconsistent and normalising would lose information.
- Regenerate with `python -m mm_scraper.cli` from `tools/scraper/`.

Please preserve the attribution if you reuse any of this.
