"""Turn a route title into candidate OSM feature names.

Two separate jobs, deliberately not conflated:

* `comparison_key` is how two names are judged equal. It is lossy on purpose
  (case, punctuation, abbreviations, a small Afrikaans/English variant table).
* `candidates` peels route vocabulary off a title in stages, most specific
  first, because a match on the whole title is far stronger evidence than a
  match on what is left after stripping words away. Task 4 records which
  candidate matched so a human can audit the weaker ones.

Feature-type words (Buttress, Ravine, Kloof, Gully, Gorge, Ledge, Arete) are
NOT stripped: they are part of the OSM name. Only route vocabulary is.
"""

from __future__ import annotations

import re

# Expanded inside comparison_key, so both sides of a comparison get the same
# treatment. Keys are whole lowercase tokens.
ABBREVIATIONS = {
    "pk": "peak",
    "pks": "peaks",
    "rte": "route",
    "mt": "mount",
    "mtn": "mountain",
    "st": "saint",
    "ne": "north east",
    "nw": "north west",
    "se": "south east",
    "sw": "south west",
}

# Whole-string equivalences for names the wiki and OSM spell differently.
# Applied after tokenisation, so the left side is already a comparison key.
# Possessive apostrophes need no entry here — they are deleted, not split, so
# "Devil's Peak" and "Devils Peak" already collapse to the same key.
VARIANTS = {
    "long kloof": "lang kloof",
}

# Route vocabulary stripped from the *end* of a title, one layer at a time.
# "Trail" is deliberately absent: "Otter Trail" and "Robberg Trail" are the OSM
# names, so stripping it would destroy the match rather than enable it.
TRAILING_ROUTE_WORDS = {
    "route",
    "routes",
    "rte",
    "traverse",
    "hike",
    "hikes",
    "walk",
    "circular",
    "circumnavigation",
    "circuit",
}

# Also peeled from the end, because a route is often a named feature approached
# from a particular side: "Constantiaberg North West route" is Constantiaberg.
# Feature-type words (Buttress, Ridge, Arete, Face) stay — they are part of the
# name, so peeling them would over-generalise.
TRAILING_DIRECTION_WORDS = {
    "north",
    "south",
    "east",
    "west",
    "northern",
    "southern",
    "eastern",
    "western",
    "upper",
    "lower",
    "ne",
    "nw",
    "se",
    "sw",
}

PEELABLE = TRAILING_ROUTE_WORDS | TRAILING_DIRECTION_WORDS

# Words that join a feature name to how a route approaches it: everything from
# here rightward describes the route, not the place.
CONNECTIVES = {"via", "to", "from"}

_PARENTHETICAL = re.compile(r"\s*\([^)]*\)")
_QUOTED_PREFIX = re.compile(r"^\s*['\"][^'\"]+['\"]\s*[-–]\s*")
# Apostrophes are deleted before punctuation becomes whitespace, so "Lion's"
# collapses to "lions" rather than splitting into "lion s".
_APOSTROPHE = re.compile(r"[''`]")
_PUNCTUATION = re.compile(r"[^a-z0-9]+")
_SINGLE_LETTER_SUFFIX = re.compile(r"\s+['\"]?[A-Z]['\"]?$")


def comparison_key(name: str) -> str:
    """The string used to decide whether two names are the same place."""
    cleaned = _PUNCTUATION.sub(" ", _APOSTROPHE.sub("", name.lower()))
    tokens = [t for t in cleaned.split() if t]
    expanded: list[str] = []
    for token in tokens:
        expanded.extend(ABBREVIATIONS.get(token, token).split())
    key = " ".join(expanded)
    return VARIANTS.get(key, key)


def candidates(title: str) -> list[str]:
    """Candidate feature names for a route title, most specific first."""
    out: list[str] = []

    def add(value: str) -> None:
        value = value.strip().strip("-–").strip()
        if value and value not in out:
            out.append(value)

    add(title)

    # A leading quoted nickname ("'Skywalk' - Right Face...") is a route name,
    # never a place name; what follows it may be a place.
    without_nickname = _QUOTED_PREFIX.sub("", title)
    add(without_nickname)

    # Parentheticals are annotations, not part of any OSM name.
    base = _PARENTHETICAL.sub("", without_nickname)
    add(base)

    # Peel trailing route vocabulary and direction words one at a time, adding
    # each layer, so the caller can try the most specific form first.
    words = base.split()
    while len(words) > 1 and words[-1].lower().strip("'\".,") in PEELABLE:
        words = words[:-1]
        add(" ".join(words))

    # "Steenberg 'B'", "Lion's Head B" — a single-letter variant marker.
    stripped_letter = _SINGLE_LETTER_SUFFIX.sub("", " ".join(words))
    add(stripped_letter)

    # Truncate at the first direction word or connective: "Devils Peak Eastern
    # Buttress" → "Devils Peak" (even though "Buttress" is not peelable).
    final_words = stripped_letter.split()
    for i, token in enumerate(final_words):
        clean_token = token.lower().strip("'\".,")
        if clean_token in TRAILING_DIRECTION_WORDS or clean_token in CONNECTIVES:
            if i > 0:
                add(" ".join(final_words[:i]))
            break

    return out
