"""Route ids, mirroring app/src/lib/data/ids.ts exactly.

This must stay byte-identical in behaviour to the TypeScript version: the id is
the journal's IndexedDB key, so a divergence here would silently orphan a user's
recorded hikes.
"""

from __future__ import annotations

import re

_NON_ALNUM = re.compile(r"[^a-z0-9]+")
_EDGE_HYPHENS = re.compile(r"^-+|-+$")


def slugify(s: str) -> str:
    return _EDGE_HYPHENS.sub("", _NON_ALNUM.sub("-", s.lower()))


def route_id(area: list[str], slug: str) -> str:
    return "--".join(slugify(part) for part in [*area, slug])
