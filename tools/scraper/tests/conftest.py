"""Shared fixture loading. The HTML files are real captures of live pages."""

from pathlib import Path

import pytest

from mm_scraper.nav import PageRef

FIXTURES = Path(__file__).parent / "fixtures"

KASTEELSPOORT_PATH = (
    "/site/mountainmeanderswiki/Home/table-mountain/atlantic-west/kasteelspoort"
)
BLIND_GULLY_PATH = (
    "/site/mountainmeanderswiki/Home/table-mountain/back-table/blind-gully"
)


def _ref(path: str) -> PageRef:
    tail = path.split("/Home/", 1)[1]
    return PageRef(path=path, segments=tuple(tail.split("/")))


def _html(name: str) -> str:
    return (FIXTURES / name).read_text(encoding="utf-8")


@pytest.fixture
def home_html() -> str:
    return _html("home.html")


@pytest.fixture
def kasteelspoort_html() -> str:
    """Has an <h1> and an OSM coordinate link."""
    return _html("kasteelspoort.html")


@pytest.fixture
def blind_gully_html() -> str:
    """Has NO <h1> and an embedded Google Slides deck."""
    return _html("blind-gully.html")


@pytest.fixture
def kasteelspoort_ref() -> PageRef:
    return _ref(KASTEELSPOORT_PATH)


@pytest.fixture
def blind_gully_ref() -> PageRef:
    return _ref(BLIND_GULLY_PATH)
