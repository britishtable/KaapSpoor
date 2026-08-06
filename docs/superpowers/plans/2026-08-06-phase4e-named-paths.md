# Phase 4e — Named Paths Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** label the paths the Mountain Meanders guides actually name, and highlight a selected route's named paths, so the description and the terrain can be read together.

**Architecture:** A hand-run Node tool decodes the shipped pmtiles archive and commits every named path plus its segment count to `data/osm-path-names.json`. `app/scripts/transform.ts` matches those names against each route's prose at data-build time and writes `mentionedPaths` onto the route index. `style.ts` gains four layers whose filters start empty; `MapView` and `LocatorMap` swap those filters via `setFilter`. No tile rebuild, no new release asset, no WSL.

**Tech Stack:** Node 22 + tsx · TypeScript strict · SvelteKit 2 / Svelte 5 runes · MapLibre GL 6 expressions · pmtiles 4 + `@mapbox/vector-tile` + `pbf` (tool only) · Vitest · Playwright.

## Deviation from the spec — read this first

The spec (`docs/superpowers/specs/2026-08-06-phase4e-named-paths-design.md`) puts `mentionedPaths`
in the **per-route JSON**, on the grounds that `RoutePreview` already fetches it and the index
should not grow. **This plan puts it in `routes-index.json` instead.** The reason is a consequence
the spec did not price:

- The `paths-named` static tier needs the **union of all routes' names** at map-load time. With
  the data only in per-route JSON, that union has to be generated into a committed source file
  under `app/src/lib/map/` — because CI runs `npm test` and `npm run check` (deploy.yml:27-28)
  *before* `build:data` has ever run, so a gitignored generated import would fail type-check and
  unit tests on a clean CI run.
- It also forces a store to carry names from `RoutePreview` (which has the data) to `MapView`
  (which needs it), and leaves the highlight waiting on a fetch.

Putting it on the index removes the generated source file, the store, and the latency in one move.
The cost is roughly **5 KB** on a file already carrying titles, areas, grades and times for 184
routes. Everything else in the spec is implemented as written.

## Global Constraints

- **Honesty about what is claimed is the governing principle.** These are *paths a description
  mentions*, never "the route" — a description names its escape routes too. The panel heading is
  exactly **"Paths this description names."**
- **TypeScript strict, no `any`.** Narrow explicitly rather than casting.
- **Every URL goes through `base` from `$app/paths`.**
- **`paths-referenced*` minzoom is 11 — the archive's own floor.** `tools/tiles/profile/trails-profile.yml`
  sets `min_zoom: 11` on the paths layer. Never lower it to close the opening-view gap; there is no
  data down there.
- **`text-allow-overlap` must stay off on both label layers.** *Contour Path* is 27 features and
  would draw 27 labels.
- **Every `line-width` interpolation's first stop is ≥ 0.8 px** (existing project rule; there is a
  test).
- **MapLibre behaviour is tested in Playwright only.** jsdom has no WebGL.
- **Only the `Open Sans Regular` fontstack exists.** Never reference another font name.
- Attribution obligations are unchanged — names come from the already-attributed `trails` source.

## File structure

```
tools/pathnames/package.json                     # NEW — tool-only deps, not app deps
tools/pathnames/extract.mjs                      # NEW — pmtiles -> data/osm-path-names.json
tools/pathnames/README.md                        # NEW
data/osm-path-names.json                         # NEW, COMMITTED — the artifact
data/path-names-report.md                        # NEW, COMMITTED — what it found

app/src/lib/data/path-mentions.ts                # NEW — the matcher (pure)
app/src/lib/data/path-mentions.test.ts           # NEW
app/src/lib/data/types.ts                        # MODIFY — mentionedPaths on RouteIndexEntry
app/scripts/transform.ts                         # MODIFY — load artifact, run matcher
app/scripts/transform.test.ts                    # MODIFY

app/src/lib/map/style.ts                         # MODIFY — 4 layers + pathNameFilter()
app/src/lib/map/style.test.ts                    # MODIFY
app/src/lib/components/MapView.svelte            # MODIFY — setFilter on selection
app/src/lib/components/LocatorMap.svelte         # MODIFY — referencedPaths prop
app/src/routes/+page.svelte                      # MODIFY — pass the vocabulary
app/src/routes/route/[id]/+page.svelte           # MODIFY — pass the route's names

app/src/lib/components/MentionedPaths.svelte     # NEW — the panel section
app/src/lib/components/MentionedPaths.test.ts    # NEW
app/src/lib/components/RoutePreview.svelte       # MODIFY — render it
app/src/lib/components/RoutePreview.test.ts      # MODIFY
app/src/lib/map/region.test.ts                   # MODIFY — fixture gains the new field
app/e2e/map.spec.ts                              # MODIFY
```

---

### Task 1: The extraction tool

**Files:**
- Create: `tools/pathnames/package.json`, `tools/pathnames/extract.mjs`, `tools/pathnames/README.md`
- Output (committed): `data/osm-path-names.json`, `data/path-names-report.md`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `data/osm-path-names.json` with shape
  `{ region: string, source: string, generated: string, names: { name: string, segments: number }[] }`.
  `names` is sorted by `segments` descending, then `name` ascending, so the file has a stable diff.

**Why a separate npm project:** it needs `@mapbox/vector-tile` and `pbf`, which decode tiles. The
app has no business shipping or dev-installing those. CI never runs this tool — its output is
committed, exactly as `tools/geocode` commits `data/route-locations.json`.

- [ ] **Step 1: Create the tool's package**

`tools/pathnames/package.json`:

```json
{
  "name": "kaapspoor-pathnames",
  "private": true,
  "type": "module",
  "description": "Extracts named paths from the shipped trails PMTiles archive.",
  "scripts": {
    "extract": "node extract.mjs"
  },
  "dependencies": {
    "@mapbox/vector-tile": "^2.0.3",
    "pbf": "^5.1.2",
    "pmtiles": "^4.4.1"
  }
}
```

- [ ] **Step 2: Write the extractor**

`tools/pathnames/extract.mjs`:

```js
// Extract every named path in the shipped region from the trails PMTiles
// archive, with the number of tile-clipped segments carrying each name.
//
// Run by hand whenever the tiles are rebuilt; the output is committed. CI never
// runs this — it has no tiles when the unit tests execute (see deploy.yml).
//
//   cd tools/pathnames && npm install && npm run extract
//
// The segment count is not decoration: a trail cut at every junction (Contour
// Path is 27 segments) looks very different from a one-segment stub, and Phase
// 4d needs that distinction.
import { PMTiles } from 'pmtiles';
import { VectorTile } from '@mapbox/vector-tile';
// pbf 5 dropped the default export and split reader from writer.
import { PbfReader } from 'pbf';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');

const regions = JSON.parse(readFileSync(resolve(repo, 'tools/tiles/regions.json'), 'utf8'));
// The app ships exactly one region; take it from regions.json rather than a
// literal so this cannot drift from the archive that was actually built.
const region = regions.regions[0];
const archive = resolve(repo, `app/static/tiles/trails-${region.id}.pmtiles`);

const buf = readFileSync(archive);
const tiles = new PMTiles({
  getKey: () => archive,
  getBytes: async (offset, length) => ({
    data: buf.buffer.slice(buf.byteOffset + offset, buf.byteOffset + offset + length)
  })
});

const header = await tiles.getHeader();
const z = header.maxZoom;
const lon2x = (lon) => Math.floor(((lon + 180) / 360) * 2 ** z);
const lat2y = (lat) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
};

const { west, south, east, north } = region.bbox;
const segments = new Map();
let features = 0;
let scanned = 0;

for (let x = lon2x(west); x <= lon2x(east); x++) {
  for (let y = lat2y(north); y <= lat2y(south); y++) {
    const tile = await tiles.getZxy(z, x, y);
    if (!tile) continue;
    scanned++;
    const layer = new VectorTile(new PbfReader(new Uint8Array(tile.data))).layers.paths;
    if (!layer) continue;
    for (let i = 0; i < layer.length; i++) {
      features++;
      const name = layer.feature(i).properties.name;
      if (typeof name === 'string' && name.length) {
        segments.set(name, (segments.get(name) ?? 0) + 1);
      }
    }
  }
}

const names = [...segments]
  .map(([name, count]) => ({ name, segments: count }))
  // Stable order so the committed file diffs cleanly between runs.
  .sort((a, b) => b.segments - a.segments || a.name.localeCompare(b.name));

const generated = new Date().toISOString().slice(0, 10);
writeFileSync(
  resolve(repo, 'data/osm-path-names.json'),
  JSON.stringify({ region: region.id, source: `trails-${region.id}.pmtiles`, generated, names }, null, 2) + '\n'
);

const named = names.reduce((n, e) => n + e.segments, 0);
const report = [
  '# Named paths report',
  '',
  `**Archive:** \`trails-${region.id}.pmtiles\` (z${z}, ${scanned} tiles)`,
  `**Extracted:** ${generated}`,
  '',
  '| | |',
  '|---|---|',
  `| Path features (tile-clipped) | ${features} |`,
  `| Features carrying a name | ${named} (${((named / features) * 100).toFixed(1)}%) |`,
  `| Distinct names | ${names.length} |`,
  '',
  'Segment counts are tile-clipped, so they exceed the number of OSM ways: a way',
  'crossing a tile boundary is counted once per tile. They rank names by extent,',
  'which is what they are for; they are not a way count.',
  '',
  '## Most fragmented names',
  '',
  '| Segments | Name |',
  '|---|---|',
  ...names.slice(0, 25).map((e) => `| ${e.segments} | ${e.name} |`),
  '',
  '## Names that are annotations rather than names',
  '',
  'Kept in the artifact — filtering belongs to the matcher, not the extractor —',
  'but listed here because they would read badly as map labels.',
  '',
  ...names
    .filter((e) => e.name.length > 30 || /[a-z][A-Z]/.test(e.name))
    .map((e) => `- \`${e.name}\``),
  ''
].join('\n');
writeFileSync(resolve(repo, 'data/path-names-report.md'), report);

console.log(`pathnames: ${names.length} distinct names from ${features} features in ${scanned} tiles`);
```

- [ ] **Step 3: Write the README**

`tools/pathnames/README.md`:

```markdown
# tools/pathnames

Extracts every named path in the shipped region from the trails PMTiles archive.

    cd tools/pathnames
    npm install
    npm run extract

Writes `data/osm-path-names.json` and `data/path-names-report.md`, both committed.

**Run it by hand whenever the tiles are rebuilt.** CI never runs it: `npm test` and
`npm run check` execute before the tile download in `.github/workflows/deploy.yml`, so
nothing in the app build may depend on an archive being present.

Needs `app/static/tiles/trails-<region>.pmtiles` locally — download it from the
`TILES_TAG` release named in the deploy workflow, or build it with `tools/tiles/`.

Unlike `tools/tiles` and `tools/geocode`, this runs on Windows as well as WSL: it reads
a PMTiles archive with pure Node and needs neither GDAL nor osmium.
```

- [ ] **Step 4: Run it**

```bash
cd tools/pathnames && npm install && npm run extract
```

Expected: `pathnames: 364 distinct names from 25640 features in 168 tiles` — the exact
numbers may differ if the tiles have been rebuilt since 2026-08-06, but **364 distinct
names is the figure the spec's estimates are based on.** If it is wildly different, stop
and check you are reading the right archive.

- [ ] **Step 5: Sanity-check the artifact**

```bash
node -e "const d=require('./data/osm-path-names.json'); const n=d.names.map(e=>e.name); for (const want of ['Contour Path','Pipe Track','India Venster','Ledges','B']) console.log(want, n.includes(want));"
```

Expected: all five print `true`. `B` **must** be present — the artifact is raw truth, and
rejecting `B` is the matcher's job in Task 2, tested there.

- [ ] **Step 6: Commit**

```bash
git add tools/pathnames data/osm-path-names.json data/path-names-report.md
git commit -m "feat(tools): extract the named paths out of the shipped archive"
```

---

### Task 2: The matcher

**Files:**
- Create: `app/src/lib/data/path-mentions.ts`, `app/src/lib/data/path-mentions.test.ts`

**Interfaces:**
- Consumes: the artifact shape from Task 1.
- Produces:
  - `export interface OsmPathName { name: string; segments: number }`
  - `export function normaliseForMatch(s: string): string`
  - `export function mentionedPaths(prose: string, names: OsmPathName[]): string[]` — returns OSM
    spellings in **order of first appearance in the prose**.

This is a pure module with no Svelte, no fetch and no filesystem, so it is fully unit-testable.

- [ ] **Step 1: Write the failing tests**

`app/src/lib/data/path-mentions.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mentionedPaths, normaliseForMatch, type OsmPathName } from './path-mentions';

const names = (...entries: [string, number][]): OsmPathName[] =>
  entries.map(([name, segments]) => ({ name, segments }));

describe('normaliseForMatch', () => {
  it('folds apostrophes away and collapses punctuation, preserving case', () => {
    expect(normaliseForMatch("Smuts' Track")).toBe('Smuts Track');
    expect(normaliseForMatch('Myburgh’s  Waterfall-Ravine')).toBe('Myburghs Waterfall Ravine');
    expect(normaliseForMatch('Ledges')).toBe('Ledges');
  });
});

describe('mentionedPaths', () => {
  it('finds a name the prose uses', () => {
    const found = mentionedPaths('Follow the Contour Path north.', names(['Contour Path', 27]));
    expect(found).toEqual(['Contour Path']);
  });

  it("folds apostrophe variants onto one entry, keeping the better-attested spelling", () => {
    // OSM carries both "Smuts' Track" and "Smuts Track" for the same path.
    // Two labels on one path is the defect this prevents.
    const found = mentionedPaths(
      'Take Smuts Track to the top.',
      names(["Smuts' Track", 7], ['Smuts Track', 3])
    );
    expect(found).toEqual(["Smuts' Track"]);
  });

  it('matches a single-word name — Ledges is a real path', () => {
    expect(mentionedPaths('Traverse into Ledges.', names(['Ledges', 2]))).toEqual(['Ledges']);
  });

  it('does not match a common noun in lower case', () => {
    // "ledges" the rock feature is not "Ledges" the path. Case is the only
    // signal separating them.
    expect(mentionedPaths('Scramble over broken ledges.', names(['Ledges', 2]))).toEqual([]);
  });

  it("rejects a one-letter name — 'B' is an OSM path AND a grade in this archive", () => {
    // Without the length floor this matches 98 times across 40 routes.
    expect(mentionedPaths("A fun 'B' grade scramble.", names(['B', 1]))).toEqual([]);
  });

  it('lets the longest name win over one contained in it', () => {
    const found = mentionedPaths(
      'Follow the Twelve Apostles Path.',
      names(['Twelve Apostles Path', 18], ['Twelve Apostles', 11])
    );
    expect(found).toEqual(['Twelve Apostles Path']);
  });

  it('does not let a short name steal characters from a longer one elsewhere', () => {
    // "Fountain Ledges" must claim its own text; "Ledges" may still match its
    // own separate mention.
    const found = mentionedPaths(
      'Up Fountain Ledges, then traverse into Ledges.',
      names(['Fountain Ledges', 4], ['Ledges', 2])
    );
    expect(found).toEqual(['Fountain Ledges', 'Ledges']);
  });

  it('requires whole words, not substrings', () => {
    expect(mentionedPaths('The Ledgesmith path.', names(['Ledges', 2]))).toEqual([]);
  });

  it('returns names in the order the prose first mentions them', () => {
    // The panel is read alongside the description, so reading order is the
    // useful order.
    const found = mentionedPaths(
      'Start on the Pipe Track, join the Contour Path, finish up India Venster.',
      names(['Contour Path', 27], ['India Venster', 6], ['Pipe Track', 18])
    );
    expect(found).toEqual(['Pipe Track', 'Contour Path', 'India Venster']);
  });

  it('yields an empty array, not null, for a route naming nothing', () => {
    expect(mentionedPaths('A pleasant walk.', names(['Contour Path', 27]))).toEqual([]);
  });

  it('names each path once however often the prose repeats it', () => {
    const found = mentionedPaths(
      'The Contour Path is long. Leave the Contour Path at the cairn.',
      names(['Contour Path', 27])
    );
    expect(found).toEqual(['Contour Path']);
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `cd app && npx vitest run src/lib/data/path-mentions.test.ts`
Expected: FAIL — `Failed to resolve import "./path-mentions"`.

- [ ] **Step 3: Write the matcher**

`app/src/lib/data/path-mentions.ts`:

```ts
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
```

- [ ] **Step 4: Run the tests**

Run: `cd app && npx vitest run src/lib/data/path-mentions.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/data/path-mentions.ts app/src/lib/data/path-mentions.test.ts
git commit -m "feat(app): match a route's prose against the mapped path names"
```

---

### Task 3: Wire the matcher into the data build, and recompute the spec's figures

**Files:**
- Modify: `app/src/lib/data/types.ts`, `app/scripts/transform.ts`, `app/scripts/transform.test.ts`
- Modify (fixtures gain the new field): `app/src/lib/map/region.test.ts`, `app/src/lib/components/RoutePreview.test.ts`

**Interfaces:**
- Consumes: `mentionedPaths` / `OsmPathName` from Task 2; `data/osm-path-names.json` from Task 1.
- Produces: `RouteIndexEntry.mentionedPaths: string[]`, present on every entry (empty array, never
  null or absent). `transform(raw, locations, pathNames)` — third parameter defaults to `[]`.

**The spec's headline numbers were measured under rules it then rejects** (case-insensitive, with a
two-word minimum). Step 7 recomputes them under the real rules. Treat the recomputed figures as
the true ones.

- [ ] **Step 1: Add the field to the type**

In `app/src/lib/data/types.ts`, inside `RouteIndexEntry`, after `coordsOsm`:

```ts
  /**
   * OSM names of paths this route's description mentions, in the order the
   * prose introduces them. Empty when it names none — 24 of the 133 in-region
   * routes do. These are paths the description REFERS TO, which includes
   * escape routes and paths merely crossed; they are not the route's own line.
   * See docs/superpowers/specs/2026-08-06-phase4e-named-paths-design.md.
   */
  mentionedPaths: string[];
```

- [ ] **Step 2: Write the failing transform tests**

Append to `app/scripts/transform.test.ts`:

```ts
describe('mentionedPaths', () => {
  const pathNames = [
    { name: 'Contour Path', segments: 27 },
    { name: 'India Venster', segments: 6 },
    { name: 'B', segments: 1 }
  ];

  const raw = (sections: Record<string, string>): RawDataset => ({
    routes: [
      {
        slug: 'a-route', title: 'A Route', url: 'https://example.invalid/a',
        area: ['Table-Mountain', 'atlantic-west'], coords: { lat: -33.95, lon: 18.4, zoom: 15 },
        grade: null, grade_source: null, stats: {}, sections,
        description: Object.values(sections).join('\n'), related: [], attachments: [],
        photos: { deck_ids: [], inline_urls: [] }
      }
    ]
  });

  it('records the paths a description names', () => {
    const { index } = transform(raw({ '': 'Join the Contour Path, then up India Venster.' }), {}, pathNames);
    expect(index[0].mentionedPaths).toEqual(['Contour Path', 'India Venster']);
  });

  it('is an empty array when a description names none', () => {
    const { index } = transform(raw({ '': 'A pleasant stroll.' }), {}, pathNames);
    expect(index[0].mentionedPaths).toEqual([]);
  });

  it("does not treat the grade 'B' as a path name", () => {
    const { index } = transform(raw({ '': "A fun 'B' grade scramble." }), {}, pathNames);
    expect(index[0].mentionedPaths).toEqual([]);
  });

  it('searches every section, not only the first', () => {
    const { index } = transform(
      raw({ '': 'Preamble.', 'Route Description': 'Follow the Contour Path.' }),
      {}, pathNames
    );
    expect(index[0].mentionedPaths).toEqual(['Contour Path']);
  });

  it('emits only names that were supplied — never an invented one', () => {
    // The anti-drift guarantee: whatever ends up on the map came from the
    // committed artifact, so the style and the data cannot disagree.
    const { index } = transform(raw({ '': 'Join the Contour Path.' }), {}, pathNames);
    const supplied = new Set(pathNames.map((p) => p.name));
    for (const name of index[0].mentionedPaths) expect(supplied.has(name)).toBe(true);
  });

  it('defaults to empty when no path names are supplied at all', () => {
    // A clean clone that has not run tools/pathnames must still build.
    const { index } = transform(raw({ '': 'Join the Contour Path.' }), {});
    expect(index[0].mentionedPaths).toEqual([]);
  });

  it('carries the same names onto the route content', () => {
    const { content } = transform(raw({ '': 'Up India Venster.' }), {}, pathNames);
    expect(content[0].mentionedPaths).toEqual(['India Venster']);
  });
});
```

- [ ] **Step 3: Run and confirm it fails**

Run: `cd app && npx vitest run scripts/transform.test.ts`
Expected: FAIL — `transform` takes two arguments, and `mentionedPaths` is not on the entry.

- [ ] **Step 4: Implement in transform.ts**

Add the import beside the existing ones:

```ts
import { mentionedPaths, type OsmPathName } from '../src/lib/data/path-mentions';
```

Change the signature:

```ts
export function transform(
  raw: RawDataset,
  locations: Record<string, RouteLocation> = {},
  pathNames: OsmPathName[] = []
): { index: RouteIndexEntry[]; content: RouteContent[] } {
```

Add to the `entry` object literal, after `coordsOsm`:

```ts
      // Matched against the prose, not the title: this is what the description
      // TALKS ABOUT, which is what makes the map readable beside it. Lives on
      // the index rather than the per-route content because the map needs the
      // union of all of them at load time to label the static tier, and
      // `npm test` runs before `build:data` has ever produced anything.
      mentionedPaths: mentionedPaths(Object.values(r.sections).join(' '), pathNames),
```

In `main()`, after the `locations` block:

```ts
  // Absent on a clone that has not run tools/pathnames; every route then names
  // no paths, which is the pre-Phase-4e behaviour and builds fine.
  const pathNamesPath = resolve(here, '../../data/osm-path-names.json');
  const pathNames = existsSync(pathNamesPath)
    ? (JSON.parse(readFileSync(pathNamesPath, 'utf-8')).names as OsmPathName[])
    : [];
```

Pass it through:

```ts
  const { index, content } = transform(raw, locations, pathNames);
```

And extend the closing log so a build states what it matched:

```ts
  const withPaths = index.filter((e) => e.mentionedPaths.length).length;
  const vocabulary = new Set(index.flatMap((e) => e.mentionedPaths));
  console.log(
    `transform: ${index.length} routes, ${index.filter((e) => e.coords).length} located ` +
      `(${[...bySource].map(([k, v]) => `${k}=${v}`).join(', ')}); ` +
      `${withPaths} name a mapped path, ${vocabulary.size} distinct names used ` +
      `of ${pathNames.length} available`
  );
```

- [ ] **Step 5: Fix the fixtures the new required field breaks**

TypeScript will now reject every hand-built `RouteIndexEntry`/`RouteContent`.

In `app/src/lib/map/region.test.ts`, in the `entry()` helper, add to the returned object:

```ts
    mentionedPaths: [],
```

In `app/src/lib/components/RoutePreview.test.ts`, in the `content()` helper, add before `...over`:

```ts
    mentionedPaths: [],
```

- [ ] **Step 6: Run the full unit suite and the type check**

```bash
cd app && npm test && npm run check
```
Expected: PASS. If `npm run check` reports another `RouteIndexEntry` literal missing
`mentionedPaths`, add `mentionedPaths: []` there too — the compiler is enumerating them for you.

- [ ] **Step 7: Rebuild the data and record the real figures**

```bash
cd app && npm run build:data
```

Expected output shape:

```
transform: 184 routes, 181 located (crawl=..., osm-match=..., curated=..., area-approx=...); N name a mapped path, M distinct names used of 364 available
```

Then capture the per-route distribution:

```bash
cd app && node -e "const i=require('./static/data/routes-index.json'); const r=i.filter(e=>e.area[0]==='Table-Mountain'||e.area[0]==='peninsula'); const c=r.map(e=>e.mentionedPaths.length).sort((a,b)=>a-b); const p=q=>c[Math.floor((c.length-1)*q)]; console.log('in-region',r.length,'| naming >=1:',c.filter(n=>n>0).length,'| median',p(0.5),'| p90',p(0.9),'| max',c[c.length-1]);"
```

**Write both results into the spec**, replacing the estimate note under the measurements table
in `docs/superpowers/specs/2026-08-06-phase4e-named-paths-design.md` with the recomputed figures.
The spec says these are the starting estimate and that this task replaces them; do not skip it.

- [ ] **Step 8: Commit**

```bash
git add app/src/lib/data/types.ts app/scripts/transform.ts app/scripts/transform.test.ts \
        app/src/lib/map/region.test.ts app/src/lib/components/RoutePreview.test.ts \
        docs/superpowers/specs/2026-08-06-phase4e-named-paths-design.md
git commit -m "feat(app): record which mapped paths each description names"
```

---

### Task 4: The map layers

**Files:**
- Modify: `app/src/lib/map/style.ts`, `app/src/lib/map/style.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks (the filters start empty).
- Produces:
  - `export function pathNameFilter(names: string[]): FilterSpecification`
  - `export const REFERENCED_PATH_LAYERS: readonly ['paths-referenced-casing', 'paths-referenced', 'paths-referenced-label']`
  - `export const NAMED_PATH_LAYER = 'paths-named'`
  - four new layers in the self-hosted style.

- [ ] **Step 1: Write the failing style tests**

Append to `app/src/lib/map/style.test.ts`:

```ts
describe('named and referenced paths', () => {
  const style = buildStyle('selfhosted', '');
  const ids = style.layers.map((l) => l.id);
  const layer = (id: string) =>
    style.layers.find((l) => l.id === id) as {
      minzoom?: number;
      filter?: unknown;
      layout?: Record<string, unknown>;
      paint?: Record<string, unknown>;
      'source-layer'?: string;
    };

  it('adds all four layers, reading the paths source-layer', () => {
    for (const id of [
      'paths-referenced-casing', 'paths-referenced', 'paths-referenced-label', 'paths-named'
    ]) {
      expect(ids).toContain(id);
      expect(layer(id)['source-layer']).toBe('paths');
    }
  });

  it('draws referenced lines above ordinary paths and below the mask', () => {
    // Ordering is not cosmetic: region-mask paints over everything below it,
    // and a highlight drawn under `paths` would sit beneath the dashes it is
    // meant to emphasise.
    for (const id of ['paths-referenced-casing', 'paths-referenced', 'paths-named']) {
      expect(ids.indexOf(id)).toBeGreaterThan(ids.indexOf('paths'));
      expect(ids.indexOf(id)).toBeLessThan(ids.indexOf('region-mask'));
    }
    expect(ids.indexOf('paths-referenced-casing')).toBeLessThan(ids.indexOf('paths-referenced'));
  });

  it('places the referenced label last, so it outranks peak and place labels', () => {
    // MapLibre places LATER symbol layers first, so being late is what wins a
    // collision. A selected route's own path names must beat a suburb name.
    expect(ids.indexOf('paths-referenced-label')).toBeGreaterThan(ids.indexOf('places-suburb'));
    expect(ids.indexOf('paths-referenced-label')).toBeGreaterThan(ids.indexOf('peaks-minor'));
    expect(ids.indexOf('paths-referenced-label')).toBeLessThan(ids.indexOf('region-mask'));
  });

  it("floors referenced paths at the archive's own minimum zoom", () => {
    // trails-profile.yml builds the paths layer from z11. Lowering this would
    // filter a layer that has no features down there — a highlight that
    // silently never appears.
    expect(layer('paths-referenced-casing').minzoom).toBe(11);
    expect(layer('paths-referenced').minzoom).toBe(11);
  });

  it('holds path labels back until they are legible', () => {
    expect(layer('paths-referenced-label').minzoom).toBe(12);
    expect(layer('paths-named').minzoom).toBe(13);
  });

  it('starts every path filter matching nothing', () => {
    // The layers exist from style load and only their filter changes, so
    // MapView never adds or removes layers at runtime.
    for (const id of [
      'paths-referenced-casing', 'paths-referenced', 'paths-referenced-label', 'paths-named'
    ]) {
      expect(layer(id).filter).toEqual(['in', ['get', 'name'], ['literal', []]]);
    }
  });

  it('builds a filter that matches exactly the names given', () => {
    expect(pathNameFilter(['Contour Path', 'Ledges'])).toEqual([
      'in', ['get', 'name'], ['literal', ['Contour Path', 'Ledges']]
    ]);
  });

  it('names the referenced layers so callers cannot filter only some of them', () => {
    // Filtering the line but not its casing leaves a halo round nothing.
    expect([...REFERENCED_PATH_LAYERS]).toEqual([
      'paths-referenced-casing', 'paths-referenced', 'paths-referenced-label'
    ]);
    expect(NAMED_PATH_LAYER).toBe('paths-named');
  });

  it('draws the referenced line solid, and wider than the ordinary dashes', () => {
    // Solid-vs-dashed IS the signal that this path is the one being talked
    // about; a dasharray here would erase the distinction.
    expect(layer('paths-referenced').paint?.['line-dasharray']).toBeUndefined();
    const firstStop = (id: string) =>
      ((layer(id).paint?.['line-width'] as unknown[])[4]) as number;
    expect(firstStop('paths-referenced')).toBeGreaterThan(firstStop('paths'));
    expect(firstStop('paths-referenced-casing')).toBeGreaterThan(firstStop('paths-referenced'));
  });

  it('makes the referenced layers visibly on at their own minzoom', () => {
    const firstStop = (id: string) =>
      ((layer(id).paint?.['line-width'] as unknown[])[4]) as number;
    expect(firstStop('paths-referenced')).toBeGreaterThanOrEqual(0.8);
    expect(firstStop('paths-referenced-casing')).toBeGreaterThanOrEqual(0.8);
  });

  it('never forces path labels to overlap', () => {
    // Contour Path is 27 features; allow-overlap would draw 27 labels.
    for (const id of ['paths-referenced-label', 'paths-named']) {
      expect(layer(id).layout?.['text-allow-overlap']).toBeFalsy();
      expect(layer(id).layout?.['text-ignore-placement']).toBeFalsy();
    }
  });

  it('sets both label layers along the line, in the only fontstack that ships', () => {
    for (const id of ['paths-referenced-label', 'paths-named']) {
      expect(layer(id).layout?.['symbol-placement']).toBe('line');
      expect(layer(id).layout?.['text-font']).toEqual(['Open Sans Regular']);
      expect(layer(id).layout?.['text-field']).toEqual(['get', 'name']);
    }
  });

  it('ranks a referenced label above a merely-named one in a collision', () => {
    // Lower sort key wins.
    const referenced = layer('paths-referenced-label').layout?.['symbol-sort-key'] as number;
    const named = layer('paths-named').layout?.['symbol-sort-key'] as number;
    expect(referenced).toBeLessThan(named);
  });
});
```

Add the new exports to the existing import at the top of the file:

```ts
import {
  buildStyle, ATTRIBUTION_OSM, SHIPPED_BASEMAP,
  pathNameFilter, REFERENCED_PATH_LAYERS, NAMED_PATH_LAYER
} from './style';
```

- [ ] **Step 2: Run and confirm it fails**

Run: `cd app && npx vitest run src/lib/map/style.test.ts`
Expected: FAIL — `pathNameFilter` is not exported.

- [ ] **Step 3: Add the exports to style.ts**

At the top of `app/src/lib/map/style.ts`, extend the type import and add the helpers:

```ts
import type { FilterSpecification, StyleSpecification } from 'maplibre-gl';
```

Below `const glyphs = ...`:

```ts
/**
 * The layers showing the paths a selected route's description names. Filtered
 * together, always: filtering the line but not its casing leaves a pale halo
 * round nothing.
 */
export const REFERENCED_PATH_LAYERS = [
  'paths-referenced-casing',
  'paths-referenced',
  'paths-referenced-label'
] as const;

/** The quiet tier labelling every path the guides name anywhere. */
export const NAMED_PATH_LAYER = 'paths-named';

/**
 * Match paths by OSM name. An empty list matches nothing, which is how the
 * unselected state is expressed — the layers exist from style load and only
 * their filter changes, so nothing is added or removed at runtime.
 */
export function pathNameFilter(names: string[]): FilterSpecification {
  return ['in', ['get', 'name'], ['literal', names]];
}

const NO_PATHS = pathNameFilter([]);
```

- [ ] **Step 4: Add the three lower layers**

In `selfHosted()`, immediately **after** the `paths` layer object and before `peaks-headline`:

```ts
      {
        // A pale casing under the referenced line. Without it the highlight is
        // hard to separate from the 100 m contours it crosses — they share a
        // hue family by design, and a brown line over brown lines reads as
        // more contour, not as emphasis.
        id: 'paths-referenced-casing',
        type: 'line',
        source: 'trails',
        'source-layer': 'paths',
        // The archive's own floor: trails-profile.yml builds paths from z11.
        // Below this there is nothing to filter, so a lower value would be a
        // highlight that silently never draws.
        minzoom: 11,
        filter: NO_PATHS,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#f4f1ea',
          'line-width': ['interpolate', ['linear'], ['zoom'], 11, 4.5, 14, 7],
          'line-opacity': 0.85
        }
      },
      {
        // The paths the selected route's description names. SOLID, where
        // ordinary paths are dashed — that contrast is the whole signal, and it
        // says "this path, emphasised" rather than "a different kind of thing".
        //
        // Deliberately NOT the pin colours: green means done and nothing else,
        // and terracotta means to-do. These paths are neither. They are what
        // the text refers to, which includes escape routes and paths merely
        // crossed — see the spec on why they are never presented as the route.
        id: 'paths-referenced',
        type: 'line',
        source: 'trails',
        'source-layer': 'paths',
        minzoom: 11,
        filter: NO_PATHS,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#6b3f24',
          'line-width': ['interpolate', ['linear'], ['zoom'], 11, 2, 14, 3.5]
        }
      },
      {
        // The quiet tier: every path the guides name somewhere, labelled once
        // you are close enough to follow one. Held to z13 — a zoom later than
        // the paths themselves — because a label needs more room than a line.
        id: 'paths-named',
        type: 'symbol',
        source: 'trails',
        'source-layer': 'paths',
        minzoom: 13,
        filter: NO_PATHS,
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Open Sans Regular'],
          'symbol-placement': 'line',
          'text-size': ['interpolate', ['linear'], ['zoom'], 13, 10, 16, 12],
          // A name repeats along its trail at this interval. Names here are
          // fragmented (Contour Path is 27 features), so each feature offers a
          // placement and collision thins them — which is ordinary topographic
          // cartography, and why text-allow-overlap must stay off.
          'symbol-spacing': 400,
          'text-max-angle': 30,
          // Lower wins a collision. The referenced tier scores 0.
          'symbol-sort-key': 1
        },
        paint: {
          'text-color': '#7a5a42',
          'text-halo-color': '#f4f1ea',
          'text-halo-width': 1.4
        }
      },
```

- [ ] **Step 5: Add the label layer at the end of the symbol stack**

In `selfHosted()`, immediately **after** the `places-suburb` layer and **before** `region-mask`:

```ts
      {
        // Placed after every other label on purpose. MapLibre places LATER
        // symbol layers FIRST, so lateness is what wins a collision: the paths
        // a selected route names must outrank a suburb or a minor peak. It
        // still loses to the route pins, which MapView appends at runtime after
        // the whole style — which is why the line beneath, and the panel text,
        // carry the information this label only decorates.
        id: 'paths-referenced-label',
        type: 'symbol',
        source: 'trails',
        'source-layer': 'paths',
        minzoom: 12,
        filter: NO_PATHS,
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Open Sans Regular'],
          'symbol-placement': 'line',
          'text-size': ['interpolate', ['linear'], ['zoom'], 12, 11, 16, 14],
          'symbol-spacing': 250,
          'text-max-angle': 30,
          'symbol-sort-key': 0
        },
        paint: {
          // Darker than the quiet tier, with a heavier halo. Only Open Sans
          // Regular ships (tools/tiles/fetch-fonts.sh fetches one stack), so
          // weight is not available to separate these — size, darkness and
          // halo do that work.
          'text-color': '#4a2c18',
          'text-halo-color': '#f4f1ea',
          'text-halo-width': 1.8
        }
      },
```

- [ ] **Step 6: Run the tests**

```bash
cd app && npx vitest run src/lib/map/style.test.ts && npm run check
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/src/lib/map/style.ts app/src/lib/map/style.test.ts
git commit -m "feat(map): give named paths a quiet tier and a referenced tier"
```

---

### Task 5: Drive the filters from selection

**Files:**
- Modify: `app/src/lib/components/MapView.svelte`, `app/src/routes/+page.svelte`
- Modify: `app/e2e/map.spec.ts`

**Interfaces:**
- Consumes: `pathNameFilter`, `REFERENCED_PATH_LAYERS`, `NAMED_PATH_LAYER` (Task 4);
  `RouteIndexEntry.mentionedPaths` (Task 3).
- Produces: `MapView` prop `pathVocabulary: string[]` (default `[]`).

- [ ] **Step 1: Add the vocabulary prop and the static tier filter**

In `app/src/lib/components/MapView.svelte`, extend the style import:

```ts
  import {
    buildStyle, SHIPPED_BASEMAP, pathNameFilter,
    REFERENCED_PATH_LAYERS, NAMED_PATH_LAYER, type Basemap
  } from '$lib/map/style';
```

Change the props line to:

```ts
  let {
    entries,
    pathVocabulary = [],
    basemap = SHIPPED_BASEMAP
  }: { entries: RouteIndexEntry[]; pathVocabulary?: string[]; basemap?: Basemap } = $props();
```

Add this effect immediately after the existing "Keep the pin source in step" effect:

```ts
  // The quiet label tier. Driven from the FULL in-region vocabulary the page
  // passes in, deliberately not from `entries` — `entries` is already narrowed
  // by the panel's search and filters, and narrowing the list must not
  // un-label the mountain underneath it.
  $effect(() => {
    const names = pathVocabulary;
    if (!map || !loaded) return;
    map.setFilter(NAMED_PATH_LAYER, pathNameFilter(names));
  });
```

- [ ] **Step 2: Highlight the selected route's paths**

Inside the existing "Highlight and fly when the panel selects or hovers a route" effect, directly
after the line `const target = selectedId ? entries.find((e) => e.id === selectedId) : undefined;`
insert:

```ts
    // The paths this route's description names. Hover deliberately does NOT
    // trigger this: hovering fires constantly while panning, and re-filtering
    // three layers on every pointer move would thrash the map for a signal the
    // user did not ask for. Selection is the deliberate act.
    const referenced = target?.mentionedPaths ?? [];
    for (const id of REFERENCED_PATH_LAYERS) {
      map.setFilter(id, pathNameFilter(referenced));
    }
```

- [ ] **Step 3: Pass the vocabulary from the page**

`app/src/routes/+page.svelte` already derives `regional` (in-region, unfiltered) and `shown`
(`regional` after the panel's filters). Add after the `tree` declaration:

```ts
  // The union of every in-region route's named paths. Derived from `regional`,
  // NOT `shown`: searching the list must not un-label the mountain underneath
  // it. See the MapView effect that consumes this.
  let pathVocabulary = $derived([...new Set(regional.flatMap((e) => e.mentionedPaths))]);
```

And change the `MapView` usage from `<MapView entries={shown} />` to:

```svelte
    <MapView entries={shown} {pathVocabulary} />
```

- [ ] **Step 4: Write the e2e coverage**

Append to `app/e2e/map.spec.ts`. `renderedCount` and `selectFromPanel` already exist at the top of
that file; reuse them rather than redefining.

```ts
test.describe('named paths', () => {
  // Kasteelspoort's description names mapped paths; this is asserted rather
  // than assumed by the first test below, so a re-crawl that changed the prose
  // fails loudly here instead of quietly weakening every later assertion.
  test('highlights the paths a selected route names, and clears them again', async ({ page }) => {
    await page.goto('.');
    await expect(page.locator('[data-testid="map"][data-map-ready="true"]')).toBeAttached({
      timeout: 30_000
    });

    const namesFor = async (id: string) =>
      page.evaluate(async (routeId) => {
        const routes = (await (await fetch('data/routes-index.json')).json()) as Array<{
          id: string;
          mentionedPaths: string[];
        }>;
        return routes.find((r) => r.id === routeId)?.mentionedPaths ?? [];
      }, KASTEELSPOORT_ID);

    const expected = await namesFor(KASTEELSPOORT_ID);
    expect(expected.length).toBeGreaterThan(0);

    await selectFromPanel(page, KASTEELSPOORT_TITLE);

    const filterNames = async (layer: string) =>
      page.evaluate((id) => {
        const el = document.querySelector('[data-testid="map"]') as HTMLElement & {
          __maplibreMap?: import('maplibre-gl').Map;
        };
        // ['in', ['get','name'], ['literal', [...]]]
        const filter = el.__maplibreMap!.getFilter(id) as unknown[] | undefined;
        const literal = filter?.[2] as unknown[] | undefined;
        return (literal?.[1] as string[]) ?? [];
      }, layer);

    for (const layer of ['paths-referenced', 'paths-referenced-casing', 'paths-referenced-label']) {
      expect(await filterNames(layer)).toEqual(expected);
    }

    // The camera flies to z14 on selection, above the layer's z11 floor, so
    // the highlight must actually be on screen — not merely filtered for.
    expect(await renderedCount(page, 'paths-referenced')).toBeGreaterThan(0);

    await page.getByRole('button', { name: /close preview/i }).click();
    for (const layer of ['paths-referenced', 'paths-referenced-casing', 'paths-referenced-label']) {
      expect(await filterNames(layer)).toEqual([]);
    }
    expect(await renderedCount(page, 'paths-referenced')).toBe(0);
  });

  test('labels named paths once you are close in', async ({ page }) => {
    await page.goto('.');
    await expect(page.locator('[data-testid="map"][data-map-ready="true"]')).toBeAttached({
      timeout: 30_000
    });

    // Deliberately no assertion at the opening view: label placement there
    // turns on viewport luck and route cluster badges win the collision, so
    // such a test would pass or fail on pane size rather than correctness.
    await page.evaluate(async () => {
      const el = document.querySelector('[data-testid="map"]') as HTMLElement & {
        __maplibreMap?: import('maplibre-gl').Map;
      };
      const map = el.__maplibreMap!;
      // Table Mountain's upper contour path network, well inside the region.
      map.jumpTo({ center: [18.4028, -33.9575], zoom: 14 });
      await new Promise<void>((resolve) => map.once('idle', () => resolve()));
    });

    expect(await renderedCount(page, 'paths-named')).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 5: Run everything**

```bash
cd app && npm test && npm run check && npm run test:e2e
```
Expected: PASS. `test:e2e` runs both base paths; both must be green.

- [ ] **Step 6: Commit**

```bash
git add app/src/lib/components/MapView.svelte app/src/routes/+page.svelte app/e2e/map.spec.ts
git commit -m "feat(map): light up the paths a selected route's description names"
```

---

### Task 6: The panel section

**Files:**
- Create: `app/src/lib/components/MentionedPaths.svelte`, `app/src/lib/components/MentionedPaths.test.ts`
- Modify: `app/src/lib/components/RoutePreview.svelte`, `app/src/lib/components/RoutePreview.test.ts`

**Interfaces:**
- Consumes: `RouteContent.mentionedPaths` (Task 3).
- Produces: `<MentionedPaths names={string[]} />`. No map knowledge, no click behaviour.

- [ ] **Step 1: Write the failing component test**

`app/src/lib/components/MentionedPaths.test.ts`:

```ts
import { render, screen } from '@testing-library/svelte';
import { describe, it, expect } from 'vitest';
import MentionedPaths from './MentionedPaths.svelte';

describe('MentionedPaths', () => {
  it('states the relation exactly — mentions, not the route', () => {
    // The map draws these as "paths the text refers to", which includes escape
    // routes and paths merely crossed. Wording that implied "the route" would
    // assert something we cannot know.
    render(MentionedPaths, { names: ['Contour Path'] });
    expect(screen.getByText('Paths this description names')).toBeTruthy();
    expect(screen.queryByText(/the route/i)).toBeNull();
  });

  it('lists every name, in the order given', () => {
    render(MentionedPaths, { names: ['Pipe Track', 'Contour Path', 'India Venster'] });
    const items = screen.getAllByRole('listitem').map((li) => li.textContent?.trim());
    expect(items).toEqual(['Pipe Track', 'Contour Path', 'India Venster']);
  });

  it('says so when a description names none, rather than rendering nothing', () => {
    // 24 of the 133 in-region routes name no mapped path. An empty gap would
    // read as broken to someone who just saw highlights on another route.
    render(MentionedPaths, { names: [] });
    expect(screen.getByText('No mapped paths are named in this description.')).toBeTruthy();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('renders a name that contains markup characters as text', () => {
    // Titles from the crawl already contain raw "&"; OSM names are equally
    // untrusted text.
    render(MentionedPaths, { names: ['<script>x</script> Ravine'] });
    expect(screen.getByText('<script>x</script> Ravine')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `cd app && npx vitest run src/lib/components/MentionedPaths.test.ts`
Expected: FAIL — cannot resolve `./MentionedPaths.svelte`.

- [ ] **Step 3: Write the component**

`app/src/lib/components/MentionedPaths.svelte`:

```svelte
<script lang="ts">
  /**
   * The paths a route's description names, as the map is highlighting them.
   *
   * The heading is the design. These are paths the text REFERS TO — which
   * includes the ravine it tells you to escape down and the track it merely
   * crosses. We cannot tell an ascent from a bail-out, so nothing here may
   * imply we can. Names are the OSM spelling, because that is what is printed
   * on the map beside this list.
   *
   * This is also the guaranteed tier: the highlighted line cannot collide, but
   * its label can lose placement to a peak, a suburb or a route pin. The text
   * here always says what the map is showing.
   */
  let { names }: { names: string[] } = $props();
</script>

{#if names.length}
  <section class="mentions">
    <h3>Paths this description names</h3>
    <ul>
      {#each names as name (name)}
        <li>{name}</li>
      {/each}
    </ul>
  </section>
{:else}
  <p class="none">No mapped paths are named in this description.</p>
{/if}

<style>
  .mentions { margin: 0.75rem 0; }
  h3 { margin: 0 0 0.35rem; font-size: 0.85rem; opacity: 0.7; font-weight: 600; }
  ul { margin: 0; padding: 0; list-style: none; display: flex; flex-wrap: wrap; gap: 0.3rem; }
  /* Set as the map sets them: the referenced line's own brown, so the panel
     and the terrain read as one statement rather than two. */
  li {
    font-size: 0.85em;
    padding: 0.1rem 0.45rem;
    border: 1px solid color-mix(in srgb, #6b3f24 35%, transparent);
    border-radius: 999px;
    color: color-mix(in srgb, #6b3f24 85%, currentColor);
  }
  .none { margin: 0.75rem 0; font-size: 0.85em; opacity: 0.55; }
</style>
```

- [ ] **Step 4: Run the test**

Run: `cd app && npx vitest run src/lib/components/MentionedPaths.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Render it in the preview**

In `app/src/lib/components/RoutePreview.svelte`, add the import beside `ProvenanceNote`:

```ts
  import MentionedPaths from './MentionedPaths.svelte';
```

And place it directly after the `.provenance` div, before the sections loop:

```svelte
      <MentionedPaths names={r.mentionedPaths} />
```

- [ ] **Step 6: Cover it in the preview's own test**

Append inside the `describe('RoutePreview')` block in `app/src/lib/components/RoutePreview.test.ts`:

```ts
  it('lists the paths the description names, beside the provenance note', async () => {
    render(RoutePreview, { routeId: 'a' });
    (await requestFor('a')).ok(
      content('a', 'Blind Gully', { mentionedPaths: ['Contour Path', 'Blinkwater Ravine'] })
    );
    await waitFor(() => expect(screen.getByText('Paths this description names')).toBeTruthy());
    expect(screen.getByText('Contour Path')).toBeTruthy();
    expect(screen.getByText('Blinkwater Ravine')).toBeTruthy();
  });

  it('says a route names no mapped paths rather than leaving a gap', async () => {
    render(RoutePreview, { routeId: 'a' });
    (await requestFor('a')).ok(content('a', 'Blind Gully', { mentionedPaths: [] }));
    await waitFor(() =>
      expect(screen.getByText('No mapped paths are named in this description.')).toBeTruthy()
    );
  });
```

- [ ] **Step 7: Run the suite**

```bash
cd app && npm test && npm run check
```
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add app/src/lib/components/MentionedPaths.svelte app/src/lib/components/MentionedPaths.test.ts \
        app/src/lib/components/RoutePreview.svelte app/src/lib/components/RoutePreview.test.ts
git commit -m "feat(app): say which paths a description names, beside the map that shows them"
```

---

### Task 7: The route page's locator map

**Files:**
- Modify: `app/src/lib/components/LocatorMap.svelte`, `app/src/routes/route/[id]/+page.svelte`
- Modify: `app/src/lib/components/LocatorMap.test.ts`

**Interfaces:**
- Consumes: `pathNameFilter`, `REFERENCED_PATH_LAYERS` (Task 4); `RouteContent.mentionedPaths` (Task 3).
- Produces: `LocatorMap` prop `referencedPaths: string[]` (default `[]`).

This is the surface where the full description is actually read, so it is where naming the paths
matters most. `LocatorMap` clamps to z≥13, at or above every new layer's floor.

- [ ] **Step 1: Add the prop and set the filters on load**

In `app/src/lib/components/LocatorMap.svelte`, extend the style import:

```ts
  import {
    buildStyle, SHIPPED_BASEMAP, pathNameFilter, REFERENCED_PATH_LAYERS
  } from '$lib/map/style';
```

Extend the props:

```ts
  let {
    coords,
    title,
    /** Metres. Set for an `area-approx` position only; see pins.ts. */
    accuracyM = null,
    /** OSM names of paths this route's description mentions; see MentionedPaths.svelte. */
    referencedPaths = []
  }: {
    coords: Coords;
    title: string;
    accuracyM?: number | null;
    referencedPaths?: string[];
  } = $props();
```

Immediately after `map.addControl(new AttributionControl({ compact: true }));` add:

```ts
    // Light the paths this route's description names, exactly as the main map
    // does on selection. The layers ship with an empty filter, so this only
    // ever swaps a filter — it never adds a layer, and a route naming nothing
    // simply leaves them empty. The style is shared, so both maps cannot
    // disagree about what a referenced path looks like.
    if (referencedPaths.length) {
      map.on('load', () => {
        if (!map) return;
        for (const id of REFERENCED_PATH_LAYERS) {
          map.setFilter(id, pathNameFilter(referencedPaths));
        }
      });
    }
```

- [ ] **Step 2: Pass it from the route page**

In `app/src/routes/route/[id]/+page.svelte`, change the `LocatorMap` usage to:

```svelte
    <LocatorMap
      coords={r.coords}
      title={r.title}
      accuracyM={r.coordsAccuracyM}
      referencedPaths={r.mentionedPaths}
    />
```

- [ ] **Step 3: Teach the existing MapLibre mock about setFilter**

`app/src/lib/components/LocatorMap.test.ts` already mocks `maplibre-gl` with a fake `Map` that
records calls into `calls` and fires `'load'` synchronously — so this can be tested properly
rather than merely mounted. The fake has no `setFilter`, so the component would throw
`map.setFilter is not a function` until it is added.

Inside the mocked `class Map`, beside `addLayer`:

```ts
    setFilter(...args: unknown[]) {
      calls.push({ name: 'setFilter', args });
      return this;
    }
```

- [ ] **Step 4: Write the failing test**

Append to `app/src/lib/components/LocatorMap.test.ts`:

```ts
describe('LocatorMap referenced paths', () => {
  const coords = { lat: -33.95, lon: 18.4, zoom: 15 };

  it('filters all three referenced layers to the names it was given', () => {
    // Filtering the line but not its casing leaves a pale halo round nothing,
    // so all three move together or none do.
    render(LocatorMap, { coords, title: 'Kasteelspoort', referencedPaths: ['Contour Path'] });
    const filtered = calls.filter((c) => c.name === 'setFilter');
    expect(filtered.map((c) => c.args[0])).toEqual([
      'paths-referenced-casing',
      'paths-referenced',
      'paths-referenced-label'
    ]);
    for (const call of filtered) {
      expect(call.args[1]).toEqual(['in', ['get', 'name'], ['literal', ['Contour Path']]]);
    }
  });

  it('touches no filter for a route that names nothing', () => {
    // The layers already ship filtering nothing, so there is no work to do —
    // and no way for an empty list to be mistaken for "show everything".
    render(LocatorMap, { coords, title: 'Kasteelspoort', referencedPaths: [] });
    expect(calls.filter((c) => c.name === 'setFilter')).toEqual([]);
  });
});
```

- [ ] **Step 5: Run the LocatorMap tests**

Run: `cd app && npx vitest run src/lib/components/LocatorMap.test.ts`
Expected: PASS, including the existing zoom-clamp tests. If you see
`map.setFilter is not a function`, Step 3 was skipped.

- [ ] **Step 6: Run the full suite**

```bash
cd app && npm test && npm run check
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/src/lib/components/LocatorMap.svelte app/src/lib/components/LocatorMap.test.ts \
        app/src/routes/route/\[id\]/+page.svelte
git commit -m "feat(app): name the paths on the route page's own map"
```

---

### Task 8: Look at it, in a browser, at three zooms

**Files:** none — this task produces a judgement and, if needed, a follow-up commit to `style.ts`.

Assertions cannot answer the one question this design turns on: **does solid-vs-dashed read as
emphasis?** A value tuned at one zoom is wrong at another — the hillshade proved that twice, once
by making the overview a dark mass and once by smearing the close-in view.

- [ ] **Step 1: Serve the built site**

```bash
cd app && npm run build && npm run preview
```

Requires `app/static/tiles/*.pmtiles` and `app/static/fonts/` present. If missing, download them
from the `TILES_TAG` release named in `.github/workflows/deploy.yml`.

- [ ] **Step 2: Check the opening view (z≈10.3)**

Confirm: **no** path labels, **no** highlight. The static tier floors at z13 and referenced paths
at z11, so the overview must be unchanged from today. If anything path-related draws here, a
minzoom is wrong.

- [ ] **Step 3: Select a route and watch the fly-in**

Select *Kasteelspoort path (KP)* from the panel. The camera flies to z14. Confirm the highlight
appears as the camera crosses z11 and that its casing separates it from the contours.

**This is the judgement call:** at z12, against the 20 m contours, does the solid brown line read
as *emphasis of a path* — or as another contour? If it does not, the fix is a **lightness step**
(darken `#6b3f24`, or lift the casing's opacity), **not a hue change**: a different hue would say
"different kind of thing", and these are the same paths the guide is talking about.

- [ ] **Step 4: Check the close-in view (z15–16)**

Confirm labels are legible and not stacked, that the referenced label is visibly stronger than the
quiet tier, and that a long name (`Outer Orange Kloof Ring Road`, 28 characters) does not wrap
absurdly along a tight bend. If it does, lower `text-max-angle`.

- [ ] **Step 5: Check a route that names nothing**

Select any route whose panel shows *"No mapped paths are named in this description."* Confirm no
highlight appears and no stale highlight survives from the previous selection.

- [ ] **Step 6: Check the route page**

Open any route page whose description names paths. Confirm the locator map highlights them at its
clamped z13.

- [ ] **Step 7: Commit any adjustment**

Only if Steps 3–4 required a change:

```bash
git add app/src/lib/map/style.ts app/src/lib/map/style.test.ts
git commit -m "fix(map): make the referenced path read as emphasis at mid zoom"
```

---

## Self-review

**Spec coverage.** Extraction tool → Task 1. Matching rules (case-sensitive, ≥3 chars,
longest-match, apostrophe folding) → Task 2. `transform.ts` integration and the recompute the spec
demands → Task 3. The four layers, z11 floor, solid-vs-dashed, `text-allow-overlap` off,
single fontstack → Task 4. Selection-driven filters and the e2e → Task 5. `MentionedPaths`,
its wording, and the empty-state line → Task 6. `LocatorMap` → Task 7. The manual look at three
zooms → Task 8.

**Two spec items are deliberately not implemented as written**, both recorded above:

1. `mentionedPaths` lives on the index, not the per-route JSON — see the deviation note at the top.
   This also removes the spec's *"anti-drift test tying the vocabulary to `osm-path-names.json`"*,
   because nothing is hand-listed any more: the vocabulary is derived at runtime from data
   `transform.ts` produced. Task 3's *"emits only names that were supplied"* test is what carries
   that guarantee instead.
2. `paths-referenced-label` sits after `places-suburb` rather than "before the peak labels". The
   spec's placement would have made a selected route's own path names lose collisions to every
   suburb. Later placement is what wins in MapLibre, and promotion was the point.

**The spec's "deliberately absent staleness check"** needs no task: with the artifact loaded via
`existsSync` exactly as `route-locations.json` is, there is nothing that could assert freshness,
and Task 3's *"defaults to empty when no path names are supplied"* test pins the clean-clone
behaviour that makes the absence safe. The reasoning is in `tools/pathnames/README.md`.
