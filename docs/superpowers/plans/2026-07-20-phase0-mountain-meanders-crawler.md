# Phase 0 — Mountain Meanders Crawler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Crawl the Mountain Meanders wiki into `data/routes.json` plus a coverage report, so the coordinate-coverage number can decide the Phase 2 map design.

**Architecture:** A polite cached fetcher, a nav enumerator that derives hierarchy from URL paths, a parser that turns one page's HTML into a route record, and a report builder. Each is a separate module with no network access except the fetcher, so every parser test runs offline against saved fixtures.

**Tech Stack:** Python 3.13, `requests`, `beautifulsoup4`, `lxml`, `pytest`.

## Global Constraints

- Base URL: `https://sites.google.com`; site root path `/site/mountainmeanderswiki/Home`
- Request delay: **2.5 s** between live requests; retry with exponential backoff
- Identifying User-Agent, verbatim: `MountainMeandersArchiver/1.0 (personal hiking journal; contact keeganjoubert22@gmail.com)`
- The fetcher **must** load a site page first to acquire Google's `NID` cookie before any image/asset request — bare requests return `403`
- Signed image URLs are used **verbatim**; never strip or alter the `=w1280` suffix (stripping → `403`, altering → `400`)
- **Phase 0 downloads no image bytes** — photo references only
- Grades stored as **raw strings**, never normalized
- Raw HTML cached to `tools/scraper/cache/` keyed by URL; re-runs must not refetch
- All parser tests run offline against fixtures in `tools/scraper/tests/fixtures/`
- Extracted content is CC BY-SA 2.5 ZA and lands under `data/`; scraper code is MIT

## File Structure

```
tools/scraper/
  requirements.txt          pinned deps
  README.md                 how to run, licensing split
  mm_scraper/
    __init__.py
    fetch.py                PoliteFetcher: cookie warm-up, disk cache, backoff
    nav.py                  enumerate pages, derive hierarchy, classify route vs area
    parse.py                one page HTML -> route record
    report.py               records -> coverage-report.md
    cli.py                  orchestration entrypoint
  tests/
    fixtures/               real saved HTML (already committed)
      home.html
      kasteelspoort.html    typical route: h1, coords, 4 inline images
      blind-gully.html      edge case: NO h1, Slides deck, no inline images
    test_nav.py
    test_parse.py
    test_report.py
    test_fetch.py
data/
  routes.json               generated
  coverage-report.md        generated
  LICENSE                   CC BY-SA 2.5 ZA
  README.md                 credits Mountain Meanders
```

**Responsibility split:** `fetch.py` is the only module that touches the network. `nav.py` and `parse.py` are pure functions over HTML strings. `report.py` is a pure function over records. `cli.py` wires them together.

---
