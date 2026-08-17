"""Route ids, mirroring app/src/lib/data/ids.ts exactly.

This must stay byte-identical in behaviour to the TypeScript version: the id is
the journal's IndexedDB key, so a divergence here would silently orphan a user's
recorded hikes.

A deliberate copy of tools/geocode/kaap_geocode/ids.py rather than an import.
The two tools are separate Python packages with their own pytest roots, and
neither is installed; both mirror the same TypeScript source, which is the one
definition all three answer to.
"""

from __future__ import annotations

import re

_NON_ALNUM = re.compile(r"[^a-z0-9]+")
_EDGE_HYPHENS = re.compile(r"^-+|-+$")


def slugify(s: str) -> str:
    return _EDGE_HYPHENS.sub("", _NON_ALNUM.sub("-", s.lower()))


def route_id(area: list[str], slug: str) -> str:
    return "--".join(slugify(part) for part in [*area, slug])
