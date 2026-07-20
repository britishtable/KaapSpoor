"""Polite, cached HTTP access to the Mountain Meanders wiki."""

from __future__ import annotations

import hashlib
import time
from pathlib import Path

import requests

BASE = "https://sites.google.com"
HOME_PATH = "/site/mountainmeanderswiki/Home"
USER_AGENT = (
    "MountainMeandersArchiver/1.0 "
    "(personal hiking journal; contact keeganjoubert22@gmail.com)"
)
DELAY_SECONDS = 2.5


def cache_key(url: str) -> str:
    """Stable filename for a URL. Readable prefix + hash to avoid collisions."""
    slug = url.rstrip("/").split("/")[-1][:60] or "index"
    slug = "".join(c if c.isalnum() or c in "-_" else "_" for c in slug)
    digest = hashlib.sha256(url.encode()).hexdigest()[:12]
    return f"{slug}.{digest}.html"


class PoliteFetcher:
    """Rate-limited fetcher with a disk cache.

    Google returns 403 for site assets unless the session already holds an NID
    cookie, so the first live request warms the session against the home page.
    """

    def __init__(self, cache_dir: Path, delay: float = DELAY_SECONDS):
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.delay = delay
        self.session = requests.Session()
        self.session.headers.update({"User-Agent": USER_AGENT})
        self._warmed = False
        self._last_request = 0.0
        self.live_requests = 0
        self.cache_hits = 0

    def _sleep_if_needed(self) -> None:
        elapsed = time.monotonic() - self._last_request
        if elapsed < self.delay:
            time.sleep(self.delay - elapsed)
        self._last_request = time.monotonic()

    def _warm(self) -> None:
        """Acquire the NID cookie once per session."""
        if self._warmed:
            return
        self._warmed = True  # set first so the warm-up call doesn't recurse
        self._get_live(BASE + HOME_PATH)

    def _get_live(self, url: str, retries: int = 4) -> str:
        for attempt in range(retries):
            self._sleep_if_needed()
            try:
                resp = self.session.get(url, timeout=45)
                self.live_requests += 1
                if resp.status_code == 200:
                    return resp.text
                # 404 is a real answer; retrying will not change it.
                if resp.status_code == 404:
                    raise FetchError(f"404 Not Found: {url}")
            except requests.RequestException as exc:
                if attempt == retries - 1:
                    raise FetchError(f"{url}: {exc}") from exc
            if attempt < retries - 1:
                time.sleep(2**attempt)
        raise FetchError(f"giving up after {retries} attempts: {url}")

    def get(self, url: str, *, use_cache: bool = True) -> str:
        """Return page HTML, from cache when available."""
        path = self.cache_dir / cache_key(url)
        if use_cache and path.exists():
            self.cache_hits += 1
            return path.read_text(encoding="utf-8")
        self._warm()
        html = self._get_live(url)
        path.write_text(html, encoding="utf-8")
        return html


class FetchError(RuntimeError):
    """A page could not be retrieved."""
