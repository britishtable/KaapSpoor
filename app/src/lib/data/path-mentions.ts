/**
 * Which mapped paths does a route's prose name?
 *
 * The guides and OpenStreetMap turn out to speak the same language about this
 * mountain — 109 of 133 in-region routes name a path that exists in the tiles.
 * This is what turns that overlap into something the map can draw.
 *
 * Each rule below answers an observed failure, not a hypothetical one.
 */

export interface OsmPathName {
  /** The OSM `name` tag, in its own spelling. */
  name: string;
  /** Tile-clipped segments carrying this name. Ranks variants; see below. */
  segments: number;
}

/**
 * A one-letter name carries no evidence — and `B` really is an OSM path name
 * here, while `B` is also how this archive writes a grade ("a 'B' grade
 * scramble"). Unfiltered it matches 98 times across 40 routes.
 */
const MIN_NAME_LENGTH = 3;

/**
 * Fold apostrophes away and collapse every other punctuation run to a single
 * space — but PRESERVE CASE. Case is the only thing separating "Ledges" the
 * path from "ledges" the rock feature, so lower-casing here would reintroduce
 * exactly the false positives the case rule exists to stop.
 */
export function normaliseForMatch(s: string): string {
  return s
    .replace(/['’]/g, '')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim();
}

/** Whole-word occurrences of `needle` in normalised `haystack`. */
function occurrences(haystack: string, needle: string): number[] {
  const hits: number[] = [];
  if (!needle) return hits;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return hits;
    // Normalised text is alphanumerics separated by single spaces, so a word
    // boundary is simply "start/end of string, or a space".
    const startsWord = at === 0 || haystack[at - 1] === ' ';
    const endsWord =
      at + needle.length === haystack.length || haystack[at + needle.length] === ' ';
    if (startsWord && endsWord) hits.push(at);
    from = at + 1;
  }
}

export function mentionedPaths(prose: string, names: OsmPathName[]): string[] {
  const text = normaliseForMatch(prose);
  // Characters already claimed by a longer name, so a shorter one cannot take
  // them: without this, "Twelve Apostles" also matches inside "Twelve Apostles
  // Path" and one path gets two labels.
  const claimed: boolean[] = new Array(text.length).fill(false);

  // Fold spellings that differ only in punctuation ("Smuts' Track" and "Smuts
  // Track" are one path in OSM's data and one path on the ground) onto a single
  // key, keeping the better-attested spelling — most segments, then
  // alphabetical so the choice is deterministic rather than input-order luck.
  const byKey = new Map<string, OsmPathName>();
  for (const entry of names) {
    const key = normaliseForMatch(entry.name);
    if (key.length < MIN_NAME_LENGTH) continue;
    const held = byKey.get(key);
    const better =
      !held ||
      entry.segments > held.segments ||
      (entry.segments === held.segments && entry.name < held.name);
    if (better) byKey.set(key, entry);
  }

  // Longest first, so a containing name claims its characters before a
  // contained one is considered. Length ties are broken alphabetically to keep
  // the result independent of Map iteration order.
  const candidates = [...byKey.entries()].sort(
    (a, b) => b[0].length - a[0].length || a[0].localeCompare(b[0])
  );

  const found: { name: string; at: number }[] = [];
  for (const [key, entry] of candidates) {
    let first = -1;
    for (const at of occurrences(text, key)) {
      let free = true;
      for (let i = at; i < at + key.length; i++) {
        if (claimed[i]) { free = false; break; }
      }
      if (!free) continue;
      for (let i = at; i < at + key.length; i++) claimed[i] = true;
      if (first === -1) first = at;
    }
    if (first !== -1) found.push({ name: entry.name, at: first });
  }

  // Reading order: the panel sits beside the description, so the order the
  // prose introduces each path is the order that is useful.
  return found.sort((a, b) => a.at - b.at).map((f) => f.name);
}
