"""End-to-end CLI run with the network stubbed out."""

import json

from conftest import _html

from mm_scraper import cli


class StubFetcher:
    """Stands in for PoliteFetcher; serves fixtures, touches no network."""

    live_requests = 0
    cache_hits = 0

    def __init__(self, cache_dir, delay=2.5):
        self.home = _html("home.html")
        self.page = _html("kasteelspoort.html")

    def get(self, url, **kwargs):
        return self.home if url.endswith("/Home") else self.page


def _run(tmp_path, monkeypatch, limit="30"):
    monkeypatch.setattr(cli, "PoliteFetcher", StubFetcher)
    code = cli.main(
        ["--data-dir", str(tmp_path / "data"), "--cache-dir", str(tmp_path / "cache"),
         "--limit", limit]
    )
    return code, tmp_path / "data"


def test_writes_routes_json_and_the_coverage_report(tmp_path, monkeypatch):
    _, data = _run(tmp_path, monkeypatch)
    assert (data / "routes.json").exists()
    assert (data / "coverage-report.md").exists()


def test_routes_json_carries_licence_and_attribution(tmp_path, monkeypatch):
    _, data = _run(tmp_path, monkeypatch)
    dataset = json.loads((data / "routes.json").read_text(encoding="utf-8"))

    assert dataset["license"] == "CC BY-SA 2.5 ZA"
    assert "Mountain Meanders" in dataset["attribution"]
    assert dataset["source"].startswith("https://sites.google.com/")
    assert dataset["routes"] and dataset["areas"]


def test_every_route_record_has_the_fields_the_app_will_need(tmp_path, monkeypatch):
    _, data = _run(tmp_path, monkeypatch)
    dataset = json.loads((data / "routes.json").read_text(encoding="utf-8"))

    required = {"slug", "title", "url", "area", "coords", "grade", "description",
                "related", "attachments", "photos"}
    for route in dataset["routes"]:
        assert required <= set(route)


def test_the_report_leads_with_coordinate_coverage(tmp_path, monkeypatch):
    _, data = _run(tmp_path, monkeypatch)
    report = (data / "coverage-report.md").read_text(encoding="utf-8")

    assert "# Mountain Meanders" in report
    assert "**Coordinates**" in report


def test_a_clean_crawl_exits_zero(tmp_path, monkeypatch):
    code, _ = _run(tmp_path, monkeypatch)
    assert code == 0


def test_reference_pages_are_archived_as_plain_text(tmp_path, monkeypatch):
    _, data = _run(tmp_path, monkeypatch, limit="200")
    grading = data / "reference" / "grading.md"

    assert grading.exists()
    assert "Source: https://sites.google.com/" in grading.read_text(encoding="utf-8")
