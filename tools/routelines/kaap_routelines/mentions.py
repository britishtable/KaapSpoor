"""Which mapped trails does a route's prose name, and in what order?

A Python mirror of app/src/lib/data/path-mentions.ts. The rules are identical
and load-bearing: case separates "Ledges" the path from "ledges" the rock, the
3-character floor rejects `B` (an OSM path name here, and also how this archive
writes a grade), and longest-match-wins stops "Twelve Apostles" stealing
characters from "Twelve Apostles Path".

Order is the point for this tool, not a nicety: the walk uses it as the
waypoint sequence.
"""

from __future__ import annotations

import re

MIN_NAME_LENGTH = 3
_APOSTROPHES = re.compile(r"['’]")
_NON_ALNUM = re.compile(r"[^A-Za-z0-9]+")


def normalise_for_match(s: str) -> str:
    return _NON_ALNUM.sub(" ", _APOSTROPHES.sub("", s)).strip()


def _occurrences(haystack: str, needle: str) -> list[int]:
    hits: list[int] = []
    if not needle:
        return hits
    start = 0
    while True:
        at = haystack.find(needle, start)
        if at == -1:
            return hits
        starts_word = at == 0 or haystack[at - 1] == " "
        ends = at + len(needle)
        ends_word = ends == len(haystack) or haystack[ends] == " "
        if starts_word and ends_word:
            hits.append(at)
        start = at + 1


def mentioned_trails(prose: str, names: list[str]) -> list[str]:
    text = normalise_for_match(prose)
    claimed = [False] * len(text)
    by_key: dict[str, str] = {}
    for name in names:
        key = normalise_for_match(name)
        if len(key) < MIN_NAME_LENGTH:
            continue
        held = by_key.get(key)
        if held is None or name < held:
            by_key[key] = name

    found: list[tuple[int, str]] = []
    for key, name in sorted(by_key.items(), key=lambda kv: (-len(kv[0]), kv[0])):
        first = -1
        for at in _occurrences(text, key):
            if any(claimed[at : at + len(key)]):
                continue
            for i in range(at, at + len(key)):
                claimed[i] = True
            if first == -1:
                first = at
        if first != -1:
            found.append((first, name))
    return [name for _, name in sorted(found)]
