"""Turn page HTML into clean body text and labelled sections."""

from __future__ import annotations

import re

from bs4 import BeautifulSoup

BOILERPLATE = {
    "search this site",
    "embedded files",
    "skip to main content",
    "skip to navigation",
    "mountain meanders",
    "google sites",
    "report abuse",
    "page details",
    "page updated",
    "osm map",
}
BOILERPLATE_PREFIX = ("see the google group on the home page",)

# Everything from the licence assertion onward is footer.
FOOTER_MARKER = "licensed under a"

LABEL_RE = re.compile(r"^([A-Z][A-Za-z '&/-]{2,28}):\s*(.*)$")

# The wiki publishes a private landowner's personal address alongside the
# official permit contacts. Republishing it in a bulk machine-readable dataset
# is a different exposure from one line on one page, so it is stripped here.
# Official and role addresses (sanparks.org, capetown.gov.za, the public
# googlegroup) are deliberately kept — they are trip-planning information.
REDACTED_CONTACTS = ("fminicki@gmail.com",)
REDACTION_MARKER = "[contact removed]"


def redact_lines(lines: list[str]) -> list[str]:
    """Remove personal contact details that should not be republished."""
    out = []
    for line in lines:
        for contact in REDACTED_CONTACTS:
            line = re.sub(re.escape(contact), REDACTION_MARKER, line, flags=re.I)
        out.append(line)
    return out


def page_title(soup: BeautifulSoup) -> str:
    """Prefer <h1>; some pages have none, so fall back to <title>."""
    h1 = soup.find("h1")
    if h1 and h1.get_text(strip=True):
        return h1.get_text(strip=True)
    title = soup.find("title")
    if not title:
        return ""
    raw = title.get_text(strip=True)
    return re.sub(r"^Mountain Meanders\s*[-–]\s*", "", raw).strip()


def body_lines(soup: BeautifulSoup) -> list[str]:
    """Visible content lines with chrome and footer removed."""
    # <head>/<title> included, or the document title becomes the first body line.
    for tag in soup(
        ["head", "title", "script", "style", "noscript", "nav", "header", "footer"]
    ):
        tag.decompose()

    lines = []
    for raw in soup.get_text("\n", strip=True).split("\n"):
        line = raw.strip()
        if not line:
            continue
        low = line.lower()
        if low.startswith(FOOTER_MARKER):
            break
        if low in BOILERPLATE or low.startswith(BOILERPLATE_PREFIX):
            continue
        lines.append(line)
    return redact_lines(lines)


def split_sections(lines: list[str], title: str) -> tuple[dict[str, str], str]:
    """Split body lines into labelled sections plus the full plain text.

    Pages are inconsistent: a label may sit on its own line with the prose
    following, or lead the same line. Unlabelled prose collects under "".
    """
    # Drop a leading repeat of the title.
    if lines and lines[0].strip() == title.strip():
        lines = lines[1:]

    sections: dict[str, list[str]] = {}
    current = ""
    for line in lines:
        match = LABEL_RE.match(line)
        if match:
            current = match.group(1).strip()
            sections.setdefault(current, [])
            rest = match.group(2).strip()
            if rest:
                sections[current].append(rest)
        else:
            sections.setdefault(current, []).append(line)

    merged = {k: "\n".join(v).strip() for k, v in sections.items() if "".join(v).strip()}
    full_text = "\n".join(lines).strip()
    return merged, full_text
