# Phase 0 — Mountain Meanders Crawler + Coverage Report

**Date:** 2026-07-20
**Status:** Approved for implementation
**Scope:** Standalone Python scraper in `tools/scraper/`. No app code.

## Purpose

Extract the Mountain Meanders route wiki into a structured JSON dataset that becomes
the app's trail library, and produce a coverage report. The report's coordinate-coverage
number determines how Phase 2 (map) is designed, so Phase 0 ends in a hard stop for review.

## Source reconnaissance (verified 2026-07-20)

The source is a **classic** Google Sites wiki that was never migrated and is still live.
The following was established empirically, not assumed:

| Finding | Detail |
|---|---|
| Site reachable | `HTTP 200`, no redirect, ~248 KB/page |
| Nav | Every page embeds the full nav: **226 unique links**, 221 leaf-ish |
| Hierarchy | Encoded in the URL path — no nav-DOM parsing needed |
| Coordinates | OSM links carry `#map=<zoom>/<lat>/<lon>`; ~55–60% of real routes |
| Photos (primary) | Embedded **Google Slides decks** — 10 of 16 sampled pages |
| Photos (inline) | `sites.google.com/sitesv-images-rt/...` — 9 of 16, usually 1–2, small (~400–600px) |
| GPX/KML | **0 of 16 sampled pages.** Spec anticipated these; expect near-zero |

### Gotchas discovered (these cost real debugging time if unknown)

1. **Images require a session cookie.** Direct requests return `403`. The crawler must
   load a site page first to acquire Google's `NID` cookie, then send `Referer`.
2. **Signed image URLs must be used verbatim.** The `=w1280` suffix is part of the
   signature. Stripping it → `403`; altering it (`=w2400`, `=s0`) → `400`.
   The original spec's "strip the sizing suffix for full resolution" does **not** work.
3. **`=w1280` is an upper bound, not the actual size.** Inline images decode to
   ~388×382 … 601×486. There is no higher resolution to recover.
4. **Slides PDF export beats per-slide PNG export.** `/export/pdf` returns one file per
   deck containing the *embedded original JPEGs*; `/export/png?pageid=` returns a
   960×720 **re-render** that letterboxes each photo into the 4:3 slide canvas.
   PDF is also 1 request per deck instead of N.

## Decision: photos deferred

Measured photo volume is prohibitive for this deployment target:

| Tier | Avg/photo | Projected site-wide (~3,200 photos) |
|---|---|---|
| Originals | 753 KB | **~2.5 GB** |
| WebP 1000px q75 | 157 KB | ~520 MB |
| WebP 800px q72 | 102 KB | ~336 MB |
| WebP 640px q70 | 66 KB | ~218 MB |

GitHub Pages enforces a **1 GB hard limit** on the published site, which must also hold
the PMTiles extract. Projections are order-of-magnitude only — deck sizes varied ~4×
between samples.

Source images are **mixed resolution**: some decks hold ~750×1000, others 2500×1875 and
2048×1536. Downsampling is therefore a large lever for the high-res decks and a no-op for
the low-res ones.

**Phase 0 downloads no image bytes.** It records photo *references* (deck ID, slide count,
inline URLs) so a later standalone pass can fetch images by reading `routes.json` without
re-crawling the site. The repo-tier decision is deferred until it can be made against
measured totals.

## Design

### Crawl

- Seed from `Home`; enumerate all route/area pages from the embedded nav tree.
- Derive hierarchy from the URL path (`/Home/<area>/<sub-area>/<slug>`).
- Session pre-warmed for the `NID` cookie; identifying User-Agent.
- 2.5 s inter-request delay; retry with exponential backoff.
- Raw HTML cached to `cache/` keyed by URL — re-runs never refetch.
- Full crawl ≈ 10 minutes; cached re-runs near-instant.

### Extract → `data/routes.json`

Per route:

- `title`, `url`, `area` hierarchy, `slug`
- `description` — paragraph structure preserved; labeled sections
  (`Location:`, `Overview:`, `Route Description:`) captured where present, plain prose
  otherwise. Pages are inconsistent; do not over-engineer.
- `coords` — `{lat, lon, zoom}` parsed from the OSM URL fragment, or `null`
- `grade` — raw string, **not** normalized
- `related` — internal links to other route pages, as relations
- `attachments` — GPX/KML/PDF/Drive links (expected mostly empty)
- `photos` — `{deck_id, slide_count, inline_urls[]}`, references only

Area/index pages (e.g. `overberg`, `cape-karoo`) are captured as **hierarchy nodes**, not
routes. The Grading page and Change record page are saved as plain text alongside.

### Report → `data/coverage-report.md`

Pages crawled · routes extracted · coordinate coverage · grade coverage · deck and photo
counts · attachment counts · **extraction failures listed by URL**.

## Licensing

All extracted content lands in `data/` with its own `LICENSE` (CC BY-SA 2.5 ZA) and a
README crediting Mountain Meanders. Scraper code under `tools/` is MIT, matching the app.

## Out of scope

Image downloading/compression, SQLite export, any app code, grade normalization.

## Exit condition

Stop after the coverage report and present it for review. **Coordinate coverage decides
Phase 2**: high coverage allows a pin per route; partial coverage requires a graceful
unmapped-route path.
