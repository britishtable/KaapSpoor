# Route Segments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split a route's drawn line into approach / main / exit segments the reader picks between, so distance, ascent, descent and the elevation profile describe the day they have actually planned.

**Architecture:** Every feature in `data/route-lines.geojson` gains `role`, `segmentId` and `name` (replacing `variant`). Two new pure modules — `data/segments.ts` (identity) and `data/plan.ts` (connectivity, assembly, stats) — hold all the logic; `transform.ts`, the route page, the map filters, the journal and the /draw editor all become thin consumers of them. Junctions are exactly shared coordinates produced by editor snapping, so "which approach can I take" is derived from geometry rather than declared.

**Tech Stack:** SvelteKit 2 + Svelte 5 runes, TypeScript, MapLibre GL, vitest (jsdom), Playwright, `idb`, tsx.

**Spec:** `docs/superpowers/specs/2026-08-21-route-segments-design.md`

## Global Constraints

- **Roles are exactly** `approach` | `main` | `exit`.
- **Canonical direction:** approach runs car→start, main runs start→end, exit runs end→car. Geometry is stored one way only; reversal is always computed.
- **`JUNCTION_TOLERANCE_M = 25`** — the gap-*warning* threshold only. Connectivity itself is exact coordinate equality of ground ordinates (lon and lat), never within-tolerance.
- **`ASCENT_THRESHOLD_M = 10`** stays as it is in `app/src/lib/map/profile.ts`.
- **`totalDescentM(coords)` is defined as `totalAscentM(reversed coords)`.** Never write a mirrored descent loop — it disagrees on ~1 profile in 3.
- **A route with no `main` segment has no plan:** `hasLine` false, `lineStats` null, no picker. Orphan approach/exit segments are not rendered.
- **Segment ids are stable forever** once written, and are qualified by the full `routeId` (the source has two distinct routes both slugged `klipspringer`, so a bare slug is not unique).
- **`done` stays keyed on `routeId`.** The journal's `plan` field is optional and absent means a legacy or unrecorded tick.
- Working directory for every command is `app/`. Tests run with `npm test` (vitest), e2e with `npm run test:e2e`.
- No `Co-Authored-By: Claude` trailer on any commit.

---

### Task 1: Segment identity

**Files:**
- Create: `app/src/lib/data/segments.ts`
- Test: `app/src/lib/data/segments.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `type SegmentRole = 'approach' | 'main' | 'exit'`; `const ROLES: readonly SegmentRole[]`; `isRole(x: unknown): x is SegmentRole`; `slugPart(text: string): string`; `makeSegmentId(routeId: string, role: SegmentRole, name: string, taken: ReadonlySet<string>): string`.

- [ ] **Step 1: Write the failing test**

```ts
// app/src/lib/data/segments.test.ts
import { describe, it, expect } from 'vitest';
import { ROLES, isRole, slugPart, makeSegmentId } from './segments';

const ROUTE = 'table-mountain--atlantic-west--pimple-traverse';

describe('roles', () => {
  it('lists the three roles in walking order', () => {
    expect(ROLES).toEqual(['approach', 'main', 'exit']);
  });

  it('rejects anything that is not a role', () => {
    expect(isRole('main')).toBe(true);
    expect(isRole('descent')).toBe(false);
    expect(isRole(undefined)).toBe(false);
  });
});

describe('slugPart', () => {
  it('lowercases and hyphenates', () => {
    expect(slugPart('via Kasteelspoort')).toBe('via-kasteelspoort');
  });

  it('collapses runs of punctuation rather than leaving empty pieces', () => {
    expect(slugPart("Spring Buttress 'B' — direct")).toBe('spring-buttress-b-direct');
  });

  it('is empty for a name with nothing sluggable in it', () => {
    expect(slugPart('  —  ')).toBe('');
  });
});

describe('makeSegmentId', () => {
  it('qualifies by the full routeId, because route slugs repeat', () => {
    // data/routes.json carries two distinct routes both slugged `klipspringer`.
    const a = makeSegmentId('table-mountain--x--klipspringer', 'main', '', new Set());
    const b = makeSegmentId('hottentots--y--klipspringer', 'main', '', new Set());
    expect(a).not.toBe(b);
  });

  it('falls back to the role when the segment has no name', () => {
    expect(makeSegmentId(ROUTE, 'main', '', new Set())).toBe(`${ROUTE}/main/main`);
  });

  it('uses the slugged name when there is one', () => {
    expect(makeSegmentId(ROUTE, 'approach', 'via Kasteelspoort', new Set()))
      .toBe(`${ROUTE}/approach/via-kasteelspoort`);
  });

  it('suffixes rather than colliding with an id already taken', () => {
    const taken = new Set([`${ROUTE}/approach/via-kasteelspoort`]);
    expect(makeSegmentId(ROUTE, 'approach', 'via Kasteelspoort', taken))
      .toBe(`${ROUTE}/approach/via-kasteelspoort-2`);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/data/segments.test.ts`
Expected: FAIL — `Failed to resolve import "./segments"`.

- [ ] **Step 3: Write minimal implementation**

```ts
// app/src/lib/data/segments.ts
/**
 * What a drawn segment IS, before anything measures or draws it.
 *
 * Identity only — connectivity and arithmetic live in plan.ts. Kept apart so
 * the editor can name a segment without importing the profile machinery.
 */

export type SegmentRole = 'approach' | 'main' | 'exit';

/** Walking order, which is also the order the route page stacks its rows. */
export const ROLES: readonly SegmentRole[] = ['approach', 'main', 'exit'];

export function isRole(x: unknown): x is SegmentRole {
  return typeof x === 'string' && (ROLES as readonly string[]).includes(x);
}

/** Lowercase, hyphenated, with runs of punctuation collapsed to one hyphen. */
export function slugPart(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * A segment's permanent name.
 *
 * Qualified by the FULL routeId rather than the bare route slug: the source
 * data carries two different routes both slugged `klipspringer`, so a bare
 * slug would hand two mountains the same segment id.
 *
 * `taken` is every id already in use in the file. A collision suffixes rather
 * than overwriting, because an id is a promise: once written it must keep
 * pointing at the same line, or a journal entry and a shared URL both go stale.
 */
export function makeSegmentId(
  routeId: string,
  role: SegmentRole,
  name: string,
  taken: ReadonlySet<string>
): string {
  const leaf = slugPart(name) || role;
  const base = `${routeId}/${role}/${leaf}`;
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/data/segments.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/data/segments.ts src/lib/data/segments.test.ts
git commit -m "feat(data): segment roles and stable segment ids"
```

---

### Task 2: Descent

**Files:**
- Modify: `app/src/lib/map/profile.ts` (append after `totalAscentM`, which ends around line 78)
- Test: `app/src/lib/map/profile.test.ts` (append; create if absent)

**Interfaces:**
- Consumes: `totalAscentM(coords: Point3[]): number | null`, `type Point3` from `profile.ts`.
- Produces: `reverseCoords(coords: Point3[]): Point3[]`; `totalDescentM(coords: Point3[]): number | null`.

- [ ] **Step 1: Write the failing test**

```ts
// append to app/src/lib/map/profile.test.ts
import { totalAscentM, totalDescentM, reverseCoords, type Point3 } from './profile';

const at = (heights: number[]): Point3[] =>
  heights.map((h, i) => [18.4 + i * 0.001, -33.96, h] as Point3);

describe('totalDescentM', () => {
  it('is the ascent of the same line walked backwards', () => {
    const coords = at([0, 100]);
    expect(totalDescentM(coords)).toBe(0);
    expect(totalDescentM(reverseCoords(coords))).toBe(100);
  });

  it('reports null when no point carries a height', () => {
    expect(totalDescentM([[18.4, -33.96], [18.41, -33.96]])).toBeNull();
  });

  it('survives the round trip the reverse toggle makes', () => {
    // Flipping twice must return the numbers the reader started with.
    const coords = at([44, 22, 17, 22, 55, 52, 25]);
    const there = { up: totalAscentM(coords), down: totalDescentM(coords) };
    const back = reverseCoords(reverseCoords(coords));
    expect({ up: totalAscentM(back), down: totalDescentM(back) }).toEqual(there);
  });

  it('reads a reversed line as the mirror of the forward one', () => {
    // The case that rules out a hand-mirrored descent loop: such a loop reports
    // 52 here, while walking the line backwards ascends 54. The reverse toggle
    // shows the reader THIS line walked the other way, so 54 is the honest
    // number and the mirrored loop would contradict the ascent shown after the
    // flip. See the spec's "Derived numbers".
    const coords = at([44, 22, 17, 22, 55, 52, 25]);
    expect(totalDescentM(coords)).toBe(totalAscentM(reverseCoords(coords)));
    expect(totalDescentM(coords)).toBe(54);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/map/profile.test.ts`
Expected: FAIL — `totalDescentM is not a function`.

- [ ] **Step 3: Write minimal implementation**

```ts
// append to app/src/lib/map/profile.ts, after totalAscentM

/** The same line, walked the other way. */
export function reverseCoords(coords: Point3[]): Point3[] {
  return [...coords].reverse();
}

/**
 * How much of the walk is downhill.
 *
 * DEFINED as the ascent of the reversed line rather than as a mirrored loop.
 * ASCENT_THRESHOLD_M gives totalAscentM hysteresis — it measures against the
 * last height it ACCEPTED — which makes it direction-dependent: a mirrored
 * loop disagrees with walking the line backwards on roughly a third of
 * profiles (67,743 of 200,000 random sequences when this was measured).
 *
 * The route page's reverse toggle shows the reader this line walked the other
 * way. If descent were anything other than what ascent reports on that walk,
 * flipping the toggle twice would not return the numbers they started with.
 */
export function totalDescentM(coords: Point3[]): number | null {
  return totalAscentM(reverseCoords(coords));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/map/profile.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/map/profile.ts src/lib/map/profile.test.ts
git commit -m "feat(profile): totalDescentM, defined as ascent walked backwards"
```

---

### Task 3: Junctions and assembly

**Files:**
- Create: `app/src/lib/data/plan.ts`
- Test: `app/src/lib/data/plan.test.ts`

**Interfaces:**
- Consumes: `SegmentRole` from `./segments`; `Point3`, `haversineM` (re-exported through `../map/snap`), `reverseCoords` from `../map/profile`.
- Produces: `interface PlanSegment`; `JUNCTION_TOLERANCE_M`; `joins(a, b): boolean`; `gapM(a, b): number`; `assemble(segments: PlanSegment[], reversed?: boolean): Point3[]`.

- [ ] **Step 1: Write the failing test**

```ts
// app/src/lib/data/plan.test.ts
import { describe, it, expect } from 'vitest';
import { joins, gapM, assemble, JUNCTION_TOLERANCE_M, type PlanSegment } from './plan';
import type { Point3 } from '../map/profile';
import type { SegmentRole } from './segments';

const seg = (id: string, role: SegmentRole, coords: Point3[]): PlanSegment => ({
  segmentId: id, role, name: null, note: null, coords
});

const A: Point3 = [18.400, -33.960, 100];
const B: Point3 = [18.410, -33.960, 300];
const C: Point3 = [18.420, -33.960, 200];

describe('joins', () => {
  it('is true when one segment ends exactly where the next begins', () => {
    expect(joins(seg('a', 'approach', [A, B]), seg('m', 'main', [B, C]))).toBe(true);
  });

  it('is false for a near miss, because a junction is exact', () => {
    const nudged: Point3 = [18.410001, -33.960, 300];
    expect(joins(seg('a', 'approach', [A, B]), seg('m', 'main', [nudged, C]))).toBe(false);
  });

  it('ignores elevation, which is resampled and may differ', () => {
    const sameGround: Point3 = [18.410, -33.960, 999];
    expect(joins(seg('a', 'approach', [A, B]), seg('m', 'main', [sameGround, C]))).toBe(true);
  });

  it('is false when either segment is too short to have ends', () => {
    expect(joins(seg('a', 'approach', [A]), seg('m', 'main', [A, C]))).toBe(false);
  });
});

describe('gapM', () => {
  it('is zero for an exact junction', () => {
    expect(gapM(seg('a', 'approach', [A, B]), seg('m', 'main', [B, C]))).toBe(0);
  });

  it('measures the ground distance across a break', () => {
    const far: Point3 = [18.415, -33.960, 300];
    expect(gapM(seg('a', 'approach', [A, B]), seg('m', 'main', [far, C]))).toBeGreaterThan(400);
  });

  it('warns at 25 m', () => {
    expect(JUNCTION_TOLERANCE_M).toBe(25);
  });
});

describe('assemble', () => {
  it('drops exactly one coordinate at each junction', () => {
    const out = assemble([seg('a', 'approach', [A, B]), seg('m', 'main', [B, C])]);
    expect(out).toEqual([A, B, C]);
  });

  it('keeps both endpoints across a gap, so the break is visible', () => {
    const far: Point3 = [18.415, -33.960, 300];
    const out = assemble([seg('a', 'approach', [A, B]), seg('m', 'main', [far, C])]);
    expect(out).toEqual([A, B, far, C]);
  });

  it('reverses the whole walk, not the segments in place', () => {
    const out = assemble([seg('a', 'approach', [A, B]), seg('m', 'main', [B, C])], true);
    expect(out).toEqual([C, B, A]);
  });

  it('is empty for no segments', () => {
    expect(assemble([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/data/plan.test.ts`
Expected: FAIL — `Failed to resolve import "./plan"`.

- [ ] **Step 3: Write minimal implementation**

```ts
// app/src/lib/data/plan.ts
/**
 * A day out, assembled from the segments the reader chose.
 *
 * Pure arithmetic over coordinates — no map, no Svelte — so every number the
 * route page shows is asserted without WebGL.
 */

import { haversineM, type Point } from '../map/snap';
import { reverseCoords, type Point3 } from '../map/profile';
import type { SegmentRole } from './segments';

/** One drawn segment, with the geometry the stats need. */
export interface PlanSegment {
  segmentId: string;
  role: SegmentRole;
  name: string | null;
  note: string | null;
  coords: Point3[];
}

/**
 * How far apart two endpoints may be before the build complains.
 *
 * A WARNING threshold, never a connectivity rule: `joins` is exact. A junction
 * is a coordinate the editor snapped onto its neighbour, so a real junction is
 * equal, not close. This number only catches lines drawn before snapping
 * existed, and segments whose neighbour was redrawn underneath them.
 */
export const JUNCTION_TOLERANCE_M = 25;

const ground = (p: Point3): Point => [p[0], p[1]];

const endOf = (s: PlanSegment): Point3 | null =>
  s.coords.length >= 2 ? s.coords[s.coords.length - 1] : null;

const startOf = (s: PlanSegment): Point3 | null =>
  s.coords.length >= 2 ? s.coords[0] : null;

/**
 * Does `a` end exactly where `b` begins?
 *
 * Ground ordinates only. Elevation is resampled from the DEM at every save and
 * two segments meeting at one point can carry different heights for it, which
 * says nothing about whether they meet.
 */
export function joins(a: PlanSegment, b: PlanSegment): boolean {
  const end = endOf(a);
  const start = startOf(b);
  if (!end || !start) return false;
  return end[0] === start[0] && end[1] === start[1];
}

/** The break between two segments, in metres. Infinity when either has no ends. */
export function gapM(a: PlanSegment, b: PlanSegment): number {
  const end = endOf(a);
  const start = startOf(b);
  if (!end || !start) return Infinity;
  return haversineM(ground(end), ground(start));
}

/**
 * The chosen segments as one line, in walking order.
 *
 * The duplicated coordinate at each junction is dropped — keeping it would put
 * a zero-length step in the profile. Across a GAP both endpoints are kept, so
 * the straight bridge shows up in the profile as the jump it is rather than
 * being quietly smoothed away. The route page never offers an unconnected
 * pairing, so that path is defensive rather than routine.
 */
export function assemble(segments: PlanSegment[], reversed = false): Point3[] {
  const out: Point3[] = [];
  segments.forEach((segment, i) => {
    if (segment.coords.length < 2) return;
    const previous = i > 0 ? segments[i - 1] : null;
    const skipFirst = previous !== null && joins(previous, segment);
    out.push(...(skipFirst ? segment.coords.slice(1) : segment.coords));
  });
  return reversed ? reverseCoords(out) : out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/data/plan.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/data/plan.ts src/lib/data/plan.test.ts
git commit -m "feat(data): junction rules and plan assembly"
```

---

### Task 4: Plan resolution and stats

**Files:**
- Modify: `app/src/lib/data/plan.ts` (append)
- Test: `app/src/lib/data/plan.test.ts` (append)

**Interfaces:**
- Consumes: `PlanSegment`, `joins`, `assemble` from Task 3; `totalDistanceM`, `totalAscentM`, `totalDescentM` from `../map/profile`.
- Produces: `interface PlanChoice { approach: string | null; main: string | null; exit: string | null; reversed: boolean }`; `interface ResolvedPlan { choice: PlanChoice; approaches: PlanSegment[]; mains: PlanSegment[]; exits: PlanSegment[]; chosen: PlanSegment[] }`; `interface PlanStats { distanceM: number; ascentM: number | null; descentM: number | null }`; `resolvePlan(segments: PlanSegment[], wanted?: Partial<PlanChoice>): ResolvedPlan`; `planStats(coords: Point3[]): PlanStats`.

- [ ] **Step 1: Write the failing test**

```ts
// append to app/src/lib/data/plan.test.ts
import { resolvePlan, planStats } from './plan';

// A little network: two approaches meet main M1 at B; main M2 starts elsewhere.
const P = (lon: number, h: number): Point3 => [lon, -33.96, h];
const K = seg('k', 'approach', [P(18.40, 50), P(18.41, 300)]);   // ends at 18.41
const D = seg('d', 'approach', [P(18.39, 60), P(18.41, 300)]);   // ends at 18.41
const M1 = seg('m1', 'main', [P(18.41, 300), P(18.43, 500)]);    // starts at 18.41
const M2 = seg('m2', 'main', [P(18.50, 300), P(18.52, 400)]);    // starts elsewhere
const X = seg('x', 'exit', [P(18.43, 500), P(18.45, 100)]);      // starts at M1's end
const ALL = [K, D, M1, M2, X];

describe('resolvePlan', () => {
  it('defaults to the first main in file order', () => {
    expect(resolvePlan(ALL).choice.main).toBe('m1');
  });

  it('defaults the approach and exit to the first CONNECTED to that main', () => {
    expect(resolvePlan(ALL).choice).toEqual(
      { approach: 'k', main: 'm1', exit: 'x', reversed: false }
    );
  });

  it('offers only the approaches that meet the chosen main', () => {
    expect(resolvePlan(ALL, { main: 'm2' }).approaches.map((s) => s.segmentId)).toEqual([]);
    expect(resolvePlan(ALL, { main: 'm1' }).approaches.map((s) => s.segmentId)).toEqual(['k', 'd']);
  });

  it('drops a chosen approach that does not meet a newly chosen main', () => {
    const plan = resolvePlan(ALL, { approach: 'k', main: 'm2' });
    expect(plan.choice.approach).toBeNull();
    expect(plan.choice.main).toBe('m2');
  });

  it('honours an explicit choice that is legal', () => {
    expect(resolvePlan(ALL, { approach: 'd', main: 'm1' }).choice.approach).toBe('d');
  });

  it('ignores an id that is not in this route at all', () => {
    expect(resolvePlan(ALL, { main: 'nonsense' }).choice.main).toBe('m1');
  });

  it('yields the chosen segments in walking order', () => {
    expect(resolvePlan(ALL).chosen.map((s) => s.segmentId)).toEqual(['k', 'm1', 'x']);
  });

  it('has no plan at all when the route has no main', () => {
    const plan = resolvePlan([K, X]);
    expect(plan.choice.main).toBeNull();
    expect(plan.chosen).toEqual([]);
  });

  it('carries the reversed flag through untouched', () => {
    expect(resolvePlan(ALL, { reversed: true }).choice.reversed).toBe(true);
  });
});

describe('planStats', () => {
  it('measures the assembled line', () => {
    const stats = planStats(assemble(resolvePlan(ALL).chosen));
    expect(stats.distanceM).toBeGreaterThan(0);
    expect(stats.ascentM).toBe(450);
    expect(stats.descentM).toBe(400);
  });

  it('swaps up and down when the walk is reversed', () => {
    const forward = planStats(assemble(resolvePlan(ALL).chosen));
    const back = planStats(assemble(resolvePlan(ALL).chosen, true));
    expect(back.ascentM).toBe(forward.descentM);
    expect(back.descentM).toBe(forward.ascentM);
    expect(back.distanceM).toBe(forward.distanceM);
  });

  it('is all zeroes and nulls for an empty plan', () => {
    expect(planStats([])).toEqual({ distanceM: 0, ascentM: null, descentM: null });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/data/plan.test.ts`
Expected: FAIL — `resolvePlan is not a function`.

- [ ] **Step 3: Write minimal implementation**

```ts
// append to app/src/lib/data/plan.ts
import { totalDistanceM, totalAscentM, totalDescentM } from '../map/profile';

/** What the reader picked. Segment ids, or null where nothing is chosen. */
export interface PlanChoice {
  approach: string | null;
  main: string | null;
  exit: string | null;
  reversed: boolean;
}

export interface ResolvedPlan {
  choice: PlanChoice;
  /** Only the approaches that actually meet the chosen main. */
  approaches: PlanSegment[];
  mains: PlanSegment[];
  /** Only the exits that actually leave from the chosen main. */
  exits: PlanSegment[];
  /** The chosen segments, in walking order. Empty when there is no main. */
  chosen: PlanSegment[];
}

export interface PlanStats {
  distanceM: number;
  ascentM: number | null;
  descentM: number | null;
}

const byRole = (segments: PlanSegment[], role: SegmentRole): PlanSegment[] =>
  segments.filter((s) => s.role === role);

/**
 * Turn a partial wish into a legal plan.
 *
 * Resolved MAIN FIRST, then the approach and exit that connect to it. Doing it
 * in any other order lets a default name a combination that does not join up:
 * an approach chosen before the main is only connected by luck. This is also
 * why changing the main can silently drop an approach — the alternative is
 * offering the reader a plan whose numbers describe a walk nobody can take.
 *
 * The default for each role is the FIRST connected option in file order, which
 * is the author's draw order — their control over what a reader sees first.
 */
export function resolvePlan(
  segments: PlanSegment[],
  wanted: Partial<PlanChoice> = {}
): ResolvedPlan {
  const mains = byRole(segments, 'main');
  const main =
    mains.find((s) => s.segmentId === wanted.main) ?? mains[0] ?? null;

  const empty: PlanChoice = { approach: null, main: null, exit: null, reversed: false };
  const reversed = wanted.reversed ?? false;
  if (!main) {
    return { choice: { ...empty, reversed }, approaches: [], mains, exits: [], chosen: [] };
  }

  const approaches = byRole(segments, 'approach').filter((s) => joins(s, main));
  const exits = byRole(segments, 'exit').filter((s) => joins(main, s));
  const approach =
    approaches.find((s) => s.segmentId === wanted.approach) ?? approaches[0] ?? null;
  const exit = exits.find((s) => s.segmentId === wanted.exit) ?? exits[0] ?? null;

  const chosen = [approach, main, exit].filter((s): s is PlanSegment => s !== null);
  return {
    choice: {
      approach: approach?.segmentId ?? null,
      main: main.segmentId,
      exit: exit?.segmentId ?? null,
      reversed
    },
    approaches,
    mains,
    exits,
    chosen
  };
}

/** What the assembled walk measures. Pass `assemble(chosen, reversed)`. */
export function planStats(coords: Point3[]): PlanStats {
  return {
    distanceM: totalDistanceM(coords),
    ascentM: totalAscentM(coords),
    descentM: totalDescentM(coords)
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/data/plan.test.ts`
Expected: PASS, 23 tests total in the file.

- [ ] **Step 5: Commit**

```bash
git add src/lib/data/plan.ts src/lib/data/plan.test.ts
git commit -m "feat(data): resolve a legal plan main-first, and measure it"
```

---

### Task 5: Migrate the seven drawn lines

**Files:**
- Create: `app/scripts/migrate-segments.ts`
- Modify: `data/route-lines.geojson` (by running the script)
- Test: `app/scripts/migrate-segments.test.ts`

**Note:** a `.ts` script run through `tsx`, exactly as `scripts/transform.ts` is — a plain `.mjs` cannot import `src/lib/data/segments.ts` at runtime, and this script must use `makeSegmentId` rather than reimplement it.

**Interfaces:**
- Consumes: `makeSegmentId`, `SegmentRole` from `src/lib/data/segments.ts`.
- Produces: `migrateFeatures(features)` (exported from the script for the test) — adds `role: 'main'` and a `segmentId` to any feature lacking them, and renames `variant` → `name`.

- [ ] **Step 1: Write the failing test**

```ts
// app/scripts/migrate-segments.test.ts
import { describe, it, expect } from 'vitest';
import { migrateFeatures } from './migrate-segments';

const feature = (props: Record<string, unknown>) => ({
  type: 'Feature',
  geometry: { type: 'LineString', coordinates: [[18.4, -33.96], [18.41, -33.96]] },
  properties: props
});

describe('migrateFeatures', () => {
  it('calls an untagged line the main route', () => {
    const [out] = migrateFeatures([feature({ routeId: 'a--b--c', drawn: '2026-08-17' })]);
    expect(out.properties.role).toBe('main');
    expect(out.properties.segmentId).toBe('a--b--c/main/main');
  });

  it('renames variant to name', () => {
    const [out] = migrateFeatures([
      feature({ routeId: 'a--b--c', variant: 'Right Hand', drawn: '2026-08-17' })
    ]);
    expect(out.properties.name).toBe('Right Hand');
    expect(out.properties.variant).toBeUndefined();
    expect(out.properties.segmentId).toBe('a--b--c/main/right-hand');
  });

  it('keeps note and drawn untouched', () => {
    const [out] = migrateFeatures([
      feature({ routeId: 'a--b--c', note: 'wet in winter', drawn: '2026-08-17' })
    ]);
    expect(out.properties.note).toBe('wet in winter');
    expect(out.properties.drawn).toBe('2026-08-17');
  });

  it('leaves an already-migrated feature exactly as it is', () => {
    const already = feature({
      routeId: 'a--b--c', role: 'approach', segmentId: 'a--b--c/approach/via-x', drawn: '2026-08-20'
    });
    expect(migrateFeatures([already])[0].properties).toEqual(already.properties);
  });

  it('does not hand two lines of one route the same id', () => {
    const out = migrateFeatures([
      feature({ routeId: 'a--b--c', drawn: '2026-08-17' }),
      feature({ routeId: 'a--b--c', drawn: '2026-08-17' })
    ]);
    expect(out[0].properties.segmentId).not.toBe(out[1].properties.segmentId);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- scripts/migrate-segments.test.ts`
Expected: FAIL — cannot resolve `./migrate-segments.mjs`.

- [ ] **Step 3: Write minimal implementation**

```ts
// app/scripts/migrate-segments.ts
/**
 * One-shot: bring route-lines.geojson drawn before roles existed up to the
 * segment schema.
 *
 * Every pre-existing line is the WHOLE route as the author drew it, which is a
 * `main` — correct as a single-segment route, and split into approach / main /
 * exit whenever they next open it. Idempotent, so running it twice is safe.
 *
 *   npx tsx scripts/migrate-segments.ts
 *
 * TypeScript run through tsx, like scripts/transform.ts, so it can share
 * makeSegmentId with the editor rather than growing a second slug rule that
 * could drift from it.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeSegmentId, isRole, type SegmentRole } from '../src/lib/data/segments';

interface LegacyFeature {
  type: string;
  geometry: { type: string; coordinates: number[][] };
  properties: {
    routeId: string;
    segmentId?: string;
    role?: string;
    name?: string;
    variant?: string;
    note?: string;
    drawn?: string;
  };
}

export function migrateFeatures(features: LegacyFeature[]): LegacyFeature[] {
  const taken = new Set(
    features.map((f) => f.properties.segmentId).filter((id): id is string => !!id)
  );
  return features.map((feature) => {
    const props = feature.properties;
    if (props.role && props.segmentId) return feature;
    const { variant, ...rest } = props;
    const name = rest.name ?? variant;
    const role: SegmentRole = isRole(rest.role) ? rest.role : 'main';
    const next: LegacyFeature['properties'] = { ...rest, role };
    if (name) next.name = name;
    else delete next.name;
    next.segmentId = rest.segmentId ?? makeSegmentId(rest.routeId, role, name ?? '', taken);
    taken.add(next.segmentId);
    return { ...feature, properties: next };
  });
}

const here = dirname(fileURLToPath(import.meta.url));
const FILE = resolve(here, '../../data/route-lines.geojson');

if (process.argv[1] && process.argv[1].endsWith('migrate-segments.ts')) {
  const collection = JSON.parse(readFileSync(FILE, 'utf-8'));
  const features = migrateFeatures(collection.features);
  writeFileSync(FILE, JSON.stringify({ ...collection, features }));
  console.log(`Migrated ${features.length} features.`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- scripts/migrate-segments.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Run the migration and check the result**

```bash
npx tsx scripts/migrate-segments.ts
node -e "const f=require('fs');const g=JSON.parse(f.readFileSync('../data/route-lines.geojson','utf8'));for(const x of g.features)console.log(x.properties.role, x.properties.segmentId)"
```

Expected: 7 lines, every one `main`, every `segmentId` distinct and ending `/main/main`.

- [ ] **Step 6: Commit**

```bash
git add scripts/migrate-segments.ts scripts/migrate-segments.test.ts ../data/route-lines.geojson
git commit -m "data: tag the seven drawn lines as main segments"
```

---

### Task 6: Transform emits segments and default-plan stats

**Files:**
- Modify: `app/src/lib/data/types.ts`
- Modify: `app/scripts/transform.ts:30-82` (the `RouteLineFeature` interface and the two grouping loops) and `:155-160` (the `content.push` call)
- Test: `app/scripts/transform.test.ts` (append)

**Interfaces:**
- Consumes: `PlanSegment`, `resolvePlan`, `assemble`, `planStats`, `gapM`, `JUNCTION_TOLERANCE_M` from `../src/lib/data/plan`; `isRole` from `../src/lib/data/segments`.
- Produces: `RouteSegmentMeta { segmentId: string; role: SegmentRole; name: string | null; note: string | null }` on `types.ts`; `RouteContent.segments: RouteSegmentMeta[]` replacing `lines`; `RouteLineStats` gains `descentM: number | null`; `RouteIndexEntry.hasLine` now means *has a main*.

- [ ] **Step 1: Write the failing test**

```ts
// append to app/scripts/transform.test.ts
import { transform } from './transform';

const rawRoute = (slug: string) => ({
  slug, title: slug, url: `https://x/${slug}`, area: ['a', 'b'], depth: 3,
  coords: { lat: -33.96, lon: 18.4, zoom: 15 }, grade: null, grade_source: null,
  sections: {}, description: '', related: [], attachments: [],
  photos: { deck_ids: [], inline_urls: [] }, stats: {}
});

// `name` and `note` are OMITTED, not null: transform's RouteLineFeature
// declares them optional strings, matching what the editor writes.
const line = (routeId: string, segmentId: string, role: string, coords: number[][]) => ({
  geometry: { type: 'LineString' as const, coordinates: coords },
  properties: { routeId, segmentId, role }
});

describe('transform with segments', () => {
  const id = 'a--b--pimple';
  const raw = { routes: [rawRoute('pimple')] };
  const lines = {
    features: [
      line(id, `${id}/approach/k`, 'approach', [[18.40, -33.96, 50], [18.41, -33.96, 300]]),
      line(id, `${id}/main/main`, 'main', [[18.41, -33.96, 300], [18.43, -33.96, 500]]),
      line(id, `${id}/exit/d`, 'exit', [[18.43, -33.96, 500], [18.45, -33.96, 100]])
    ]
  };

  it('lists every segment with its role, in file order', () => {
    const { content } = transform(raw, {}, [], lines);
    expect(content[0].segments.map((s) => s.role)).toEqual(['approach', 'main', 'exit']);
  });

  it('measures the DEFAULT PLAN, not the longest segment', () => {
    const { content } = transform(raw, {}, [], lines);
    // approach 450 m up + main 200 m up, then 400 m down on the exit.
    expect(content[0].lineStats).toEqual({ distanceM: 4611, ascentM: 450, descentM: 400 });
  });

  it('has a line only when there is a main', () => {
    const orphan = { features: [lines.features[0]] };
    const { index } = transform(raw, {}, [], orphan);
    expect(index[0].hasLine).toBe(false);
    expect(transform(raw, {}, [], lines).index[0].hasLine).toBe(true);
  });

  it('reports null stats for a route with no main', () => {
    const orphan = { features: [lines.features[0]] };
    expect(transform(raw, {}, [], orphan).content[0].lineStats).toBeNull();
  });

  it('warns about a gap under 25 m but still builds', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const nudged = structuredClone(lines);
    nudged.features[0].geometry.coordinates[1] = [18.410001, -33.96, 300];
    transform(raw, {}, [], nudged);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('does not meet'));
    warn.mockRestore();
  });
});
```

Note: the exact `distanceM` above is whatever `totalDistanceM` returns for that assembled line — run the test once, read the actual value out of the failure, and pin it. Do NOT relax the assertion to `toBeGreaterThan`; the point of this test is that the number is the *plan's*, not a segment's.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- scripts/transform.test.ts`
Expected: FAIL — `content[0].segments` is undefined.

- [ ] **Step 3: Update `types.ts`**

```ts
// app/src/lib/data/types.ts — replace the RouteLine interface
import type { SegmentRole } from './segments';

/**
 * One drawn segment of a route, without its geometry.
 *
 * The coordinates stay in the single static route-lines.geojson the map and
 * the route page each fetch once; carrying them here would put a few hundred
 * positions into every per-route JSON.
 */
export interface RouteSegmentMeta {
  segmentId: string;
  role: SegmentRole;
  /** The picker label. Null when the role holds only one option. */
  name: string | null;
  note: string | null;
}
```

```ts
// same file — RouteLineStats gains descent
export interface RouteLineStats {
  distanceM: number;
  ascentM: number | null;
  /** Null when the line carries no heights, exactly as ascentM is. */
  descentM: number | null;
}
```

```ts
// same file — in RouteContent, replace `lines: RouteLine[]` with:
  /** Empty when nothing is drawn. Every segment, in file order. */
  segments: RouteSegmentMeta[];
  /**
   * The DEFAULT PLAN's numbers — first main, plus the first approach and exit
   * that connect to it. Null when the route has no main. Was "the longest
   * variant"; a reader walks a day, not a line.
   */
  lineStats: RouteLineStats | null;
```

Also update the `hasLine` doc comment on `RouteIndexEntry` to read: *"True when the author has drawn this route's MAIN line. Approach and exit segments without a main are not a route."*

- [ ] **Step 4: Update `transform.ts`**

Replace the `RouteLineFeature` interface (around line 30) and the two grouping loops (lines 43–82) with:

```ts
import { isRole } from '../src/lib/data/segments';
import {
  resolvePlan, assemble, planStats, gapM, JUNCTION_TOLERANCE_M, type PlanSegment
} from '../src/lib/data/plan';
import type { RouteSegmentMeta } from '../src/lib/data/types';

export interface RouteLineFeature {
  geometry?: { type: 'LineString'; coordinates: number[][] };
  properties: {
    routeId: string;
    segmentId?: string;
    role?: string;
    name?: string;
    note?: string;
  };
}
export interface RouteLines { features: RouteLineFeature[] }
```

```ts
// inside transform(), replacing the linesByRoute / statsByRoute loops
const toPoint3 = (coord: number[]): Point3 =>
  coord.length >= 3 ? [coord[0], coord[1], coord[2]] : [coord[0], coord[1]];

// Every drawn segment, grouped by route, geometry included — the plan's stats
// need the coordinates even though only the metadata is written out.
const planByRoute = new Map<string, PlanSegment[]>();
for (const feature of lines.features) {
  const { routeId: rid, segmentId, role, name, note } = feature.properties;
  // A feature with no role predates the segment schema and cannot be placed;
  // scripts/migrate-segments.mjs exists to give it one.
  if (!segmentId || !isRole(role)) continue;
  const list = planByRoute.get(rid) ?? [];
  list.push({
    segmentId, role,
    name: name ?? null,
    note: note ?? null,
    coords: (feature.geometry?.coordinates ?? []).map(toPoint3)
  });
  planByRoute.set(rid, list);
}

const segmentsByRoute = new Map<string, RouteSegmentMeta[]>();
const statsByRoute = new Map<string, RouteLineStats>();
for (const [rid, segments] of planByRoute) {
  segmentsByRoute.set(
    rid,
    segments.map(({ segmentId, role, name, note }) => ({ segmentId, role, name, note }))
  );
  const plan = resolvePlan(segments);
  if (!plan.choice.main) continue;
  const stats = planStats(assemble(plan.chosen));
  statsByRoute.set(rid, {
    distanceM: Math.round(stats.distanceM),
    ascentM: stats.ascentM === null ? null : Math.round(stats.ascentM),
    descentM: stats.descentM === null ? null : Math.round(stats.descentM)
  });
  // A near miss is almost always a segment whose neighbour was redrawn under
  // it. Warned rather than thrown: the build must still produce a site, and
  // the picker already refuses to OFFER an unconnected pairing, so the reader
  // never sees a total that crosses this gap.
  const mains = segments.filter((s) => s.role === 'main');
  for (const main of mains) {
    for (const s of segments) {
      if (s.role === 'approach' && !plan.approaches.includes(s)) {
        const d = gapM(s, main);
        if (d <= JUNCTION_TOLERANCE_M) {
          console.warn(`${s.segmentId} does not meet ${main.segmentId} (${d.toFixed(1)} m)`);
        }
      }
      if (s.role === 'exit' && !plan.exits.includes(s)) {
        const d = gapM(main, s);
        if (d <= JUNCTION_TOLERANCE_M) {
          console.warn(`${s.segmentId} does not meet ${main.segmentId} (${d.toFixed(1)} m)`);
        }
      }
    }
  }
}
```

Then `hasLine: statsByRoute.has(id)` on the index entry, and in `content.push`, replace `lines: linesByRoute.get(id) ?? []` with `segments: segmentsByRoute.get(id) ?? []`.

- [ ] **Step 4b: Retire `RouteVariants`, so the tree stays green**

Removing `RouteContent.lines` and the `RouteLine` type breaks three places that still read them. All of it goes now, in this task, because a task that leaves the build red cannot be reviewed on its own:

```bash
git rm src/lib/components/RouteVariants.svelte src/lib/components/RouteVariants.test.ts
```

- In `src/routes/route/[id]/+page.svelte`: delete the `RouteVariants` import and the `<RouteVariants lines={r.lines} />` line. Task 11 puts the plan picker in its place.
- In `src/lib/components/RoutePreview.svelte:72`: delete the `RouteVariants` import and the `<RouteVariants lines={r.lines} />` line, and nothing else. **The map's preview panel stops listing alternatives permanently** — it keeps its stats and its link, and planning lives on the route page, which is the only surface with room for three rows and a profile. If `RoutePreview.test.ts` asserts on the variants list, delete those cases; do not reinstate the list.
- In `src/routes/route/route-page.test.ts`, change the `route` fixture's `lines: []` to `segments: []`.

Between this task and Task 11 the route page shows no alternatives. That is a deliberate, temporary gap inside this branch.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- scripts/transform.test.ts`
Expected: PASS. Then `npm run build:data` — expected: no warnings (the 7 migrated lines are all mains with no siblings).

- [ ] **Step 6: Commit**

```bash
git add src/lib/data/types.ts scripts/transform.ts scripts/transform.test.ts
git commit -m "feat(data): transform emits segments and default-plan stats"
```

---

### Task 7: Editor state learns roles

**Files:**
- Modify: `app/src/lib/draw/state.ts` (whole file)
- Modify: `app/vite-plugin-route-lines.ts:14` (the `RouteLineFeature` import site needs no change; verify it still typechecks)
- Test: `app/src/lib/draw/state.test.ts`

**Interfaces:**
- Consumes: `SegmentRole`, `makeSegmentId` from `../data/segments`.
- Produces: `interface Segment { id: string; role: SegmentRole; name: string; note: string; legs: Leg[] }`; `newSegment(role: SegmentRole, name?: string): Segment`; `segmentCoords(segment: Segment): Point[]` (renamed from `variantCoords`); `undoLeg(segment: Segment): Segment`; `flipSegment(segment: Segment): Segment`; `toFeatures(routeId: string, segments: Segment[], drawn: string): RouteLineFeature[]`; `fromFeatures(routeId: string, features: RouteLineFeature[]): Segment[]`. `RouteLineFeature['properties']` becomes `{ routeId: string; segmentId: string; role: SegmentRole; name?: string; note?: string; drawn: string }`.

- [ ] **Step 1: Write the failing test**

```ts
// app/src/lib/draw/state.test.ts — replace the variant-era cases with these
import { describe, it, expect } from 'vitest';
import {
  newSegment, segmentCoords, undoLeg, flipSegment, toFeatures, fromFeatures
} from './state';

const ROUTE = 'a--b--pimple';
const legs = (pts: [number, number][]) =>
  pts.map((p, i) => ({ at: p, coords: i === 0 ? [p] : [pts[i - 1], p] }));

describe('newSegment', () => {
  it('carries its role and no id until it is saved', () => {
    const s = newSegment('approach');
    expect(s.role).toBe('approach');
    expect(s.id).toBe('');
    expect(s.legs).toEqual([]);
  });
});

describe('flipSegment', () => {
  it('reverses the drawn line as one leg', () => {
    const s = { ...newSegment('main'), legs: legs([[18.4, -33.96], [18.41, -33.96], [18.42, -33.96]]) };
    expect(segmentCoords(flipSegment(s))).toEqual(
      [...segmentCoords(s)].reverse()
    );
  });

  it('leaves an empty segment alone', () => {
    expect(flipSegment(newSegment('exit')).legs).toEqual([]);
  });

  it('is its own inverse', () => {
    const s = { ...newSegment('main'), legs: legs([[18.4, -33.96], [18.41, -33.96]]) };
    expect(segmentCoords(flipSegment(flipSegment(s)))).toEqual(segmentCoords(s));
  });
});

describe('toFeatures', () => {
  it('writes role and a generated id', () => {
    const s = { ...newSegment('approach', 'via Kasteelspoort'),
                legs: legs([[18.4, -33.96], [18.41, -33.96]]) };
    const [f] = toFeatures(ROUTE, [s], '2026-08-21');
    expect(f.properties.role).toBe('approach');
    expect(f.properties.segmentId).toBe(`${ROUTE}/approach/via-kasteelspoort`);
    expect(f.properties.name).toBe('via Kasteelspoort');
  });

  it('keeps an id a segment already has, so it never moves', () => {
    const s = { ...newSegment('main'), id: `${ROUTE}/main/original`,
                name: 'renamed since',
                legs: legs([[18.4, -33.96], [18.41, -33.96]]) };
    expect(toFeatures(ROUTE, [s], '2026-08-21')[0].properties.segmentId)
      .toBe(`${ROUTE}/main/original`);
  });

  it('drops a segment with fewer than two points', () => {
    expect(toFeatures(ROUTE, [newSegment('main')], '2026-08-21')).toEqual([]);
  });

  it('writes a name even for a lone segment, unlike the old variant rule', () => {
    // A single main still names itself, because the reader's picker shows it
    // and a nameless row cannot be talked about.
    const s = { ...newSegment('main', 'Spring Buttress B'),
                legs: legs([[18.4, -33.96], [18.41, -33.96]]) };
    expect(toFeatures(ROUTE, [s], '2026-08-21')[0].properties.name).toBe('Spring Buttress B');
  });
});

describe('fromFeatures', () => {
  it('round-trips role, id, name and note', () => {
    const s = { ...newSegment('exit', 'via Diagonal'), note: 'shady after 3',
                legs: legs([[18.4, -33.96], [18.41, -33.96]]) };
    const [back] = fromFeatures(ROUTE, toFeatures(ROUTE, [s], '2026-08-21'));
    expect(back.role).toBe('exit');
    expect(back.name).toBe('via Diagonal');
    expect(back.note).toBe('shady after 3');
    expect(back.id).toBe(`${ROUTE}/exit/via-diagonal`);
  });

  it('ignores another route entirely', () => {
    const s = { ...newSegment('main'), legs: legs([[18.4, -33.96], [18.41, -33.96]]) };
    expect(fromFeatures('other--r--x', toFeatures(ROUTE, [s], '2026-08-21'))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/draw/state.test.ts`
Expected: FAIL — `newSegment is not exported`.

- [ ] **Step 3: Write the implementation**

Rewrite `app/src/lib/draw/state.ts`, keeping `Leg`, `variantCoords`'s body (renamed) and `undoLeg` as they are:

```ts
import { makeSegmentId, type SegmentRole } from '../data/segments';

export interface Segment {
  /** Empty until the first save assigns one; permanent afterwards. */
  id: string;
  role: SegmentRole;
  name: string;
  note: string;
  legs: Leg[];
}

export interface RouteLineFeature {
  type: 'Feature';
  geometry: { type: 'LineString'; coordinates: Point3[] };
  properties: {
    routeId: string;
    segmentId: string;
    role: SegmentRole;
    name?: string;
    note?: string;
    drawn: string;
  };
}

export function newSegment(role: SegmentRole, name = ''): Segment {
  return { id: '', role, name, note: '', legs: [] };
}

export function segmentCoords(segment: Segment): Point[] {
  const out: Point[] = [];
  for (const leg of segment.legs) {
    out.push(...(out.length ? leg.coords.slice(1) : leg.coords));
  }
  return out;
}

export function undoLeg(segment: Segment): Segment {
  return { ...segment, legs: segment.legs.slice(0, -1) };
}

/**
 * The same ground, drawn the other way.
 *
 * Collapsed to ONE leg deliberately: after a flip, "undo the last click" has
 * no meaning — the clicks were made from the other end — and pretending
 * otherwise would take back the wrong bend.
 */
export function flipSegment(segment: Segment): Segment {
  const coords = segmentCoords(segment);
  if (coords.length < 2) return segment;
  const reversed = [...coords].reverse();
  return { ...segment, legs: [{ at: reversed[0], coords: reversed }] };
}

export function toFeatures(
  routeId: string,
  segments: Segment[],
  drawn: string
): RouteLineFeature[] {
  const taken = new Set(segments.map((s) => s.id).filter(Boolean));
  const features: RouteLineFeature[] = [];
  for (const segment of segments) {
    const coordinates = segmentCoords(segment);
    // One point is a click, not a line.
    if (coordinates.length < 2) continue;
    // An id, once written, is a promise: a journal entry and a shared URL both
    // point at it. Renaming a segment must not move it.
    const segmentId =
      segment.id || makeSegmentId(routeId, segment.role, segment.name, taken);
    taken.add(segmentId);
    const properties: RouteLineFeature['properties'] = {
      routeId, segmentId, role: segment.role, drawn
    };
    if (segment.name) properties.name = segment.name;
    if (segment.note) properties.note = segment.note;
    features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates }, properties });
  }
  return features;
}

export function fromFeatures(routeId: string, features: RouteLineFeature[]): Segment[] {
  return features
    .filter((f) => f.properties.routeId === routeId)
    .map((f) => ({
      id: f.properties.segmentId,
      role: f.properties.role,
      name: f.properties.name ?? '',
      note: f.properties.note ?? '',
      legs: [{ at: ground(f.geometry.coordinates[0]), coords: f.geometry.coordinates.map(ground) }]
    }));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/lib/draw/state.test.ts vite-plugin-route-lines.test.ts`
Expected: PASS. If `vite-plugin-route-lines.test.ts` fails, its fixtures need `segmentId` and `role` added to their properties — do that, changing nothing else.

- [ ] **Step 5: Commit**

```bash
git add src/lib/draw/state.ts src/lib/draw/state.test.ts vite-plugin-route-lines.test.ts
git commit -m "feat(draw): segments replace variants in editor state"
```

---

### Task 8: Editor UI — roles, sibling snapping, gap warnings, flip

**Files:**
- Modify: `app/src/routes/draw/+page.svelte`
- Create: `app/src/lib/draw/siblings.ts`
- Test: `app/src/lib/draw/siblings.test.ts`

**Interfaces:**
- Consumes: `Segment`, `segmentCoords` from `./state`; `haversineM`, `Point` from `../map/snap`; `JUNCTION_TOLERANCE_M` from `../data/plan`.
- Produces: `siblingEndpoints(segments: Segment[], skipIndex: number): Point[]`; `snapToSiblings(segments: Segment[], skipIndex: number, click: Point, withinM: number): Point | null`; `unmetJunctions(segments: Segment[]): { from: string; to: string; gapM: number }[]`.

- [ ] **Step 1: Write the failing test**

```ts
// app/src/lib/draw/siblings.test.ts
import { describe, it, expect } from 'vitest';
import { siblingEndpoints, snapToSiblings, unmetJunctions } from './siblings';
import { newSegment, type Segment } from './state';
import type { Point } from '../map/snap';

const withCoords = (role: 'approach' | 'main' | 'exit', name: string, pts: Point[]): Segment => ({
  ...newSegment(role, name),
  legs: [{ at: pts[0], coords: pts }]
});

const A: Point = [18.40, -33.96];
const B: Point = [18.41, -33.96];
const C: Point = [18.43, -33.96];

describe('siblingEndpoints', () => {
  it('offers both ends of every other segment', () => {
    const segments = [withCoords('approach', 'k', [A, B]), withCoords('main', 'm', [B, C])];
    expect(siblingEndpoints(segments, 1)).toEqual([A, B]);
  });

  it('skips the segment being drawn, so it cannot snap to itself', () => {
    const segments = [withCoords('main', 'm', [B, C])];
    expect(siblingEndpoints(segments, 0)).toEqual([]);
  });
});

describe('snapToSiblings', () => {
  it('returns the sibling endpoint exactly, not an approximation of it', () => {
    const segments = [withCoords('approach', 'k', [A, B]), withCoords('main', 'm', [B, C])];
    const near: Point = [18.410002, -33.960001];
    expect(snapToSiblings(segments, 1, near, 100)).toEqual(B);
  });

  it('returns null when nothing is within reach', () => {
    const segments = [withCoords('approach', 'k', [A, B])];
    expect(snapToSiblings(segments, 1, [18.9, -33.96], 100)).toBeNull();
  });
});

describe('unmetJunctions', () => {
  it('is empty when everything meets exactly', () => {
    const segments = [
      withCoords('approach', 'k', [A, B]),
      withCoords('main', 'm', [B, C])
    ];
    expect(unmetJunctions(segments)).toEqual([]);
  });

  it('names both segments and the distance across the break', () => {
    const off: Point = [18.4101, -33.96];
    const segments = [
      withCoords('approach', 'k', [A, B]),
      withCoords('main', 'm', [off, C])
    ];
    const [gap] = unmetJunctions(segments);
    expect(gap.from).toBe('k');
    expect(gap.to).toBe('m');
    expect(gap.gapM).toBeGreaterThan(5);
  });

  it('says nothing about a segment that is still being drawn', () => {
    const segments = [withCoords('approach', 'k', [A, B]), newSegment('main', 'm')];
    expect(unmetJunctions(segments)).toEqual([]);
  });

  it('reports a main with no approach at all as nothing to fix', () => {
    expect(unmetJunctions([withCoords('main', 'm', [B, C])])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/draw/siblings.test.ts`
Expected: FAIL — cannot resolve `./siblings`.

- [ ] **Step 3: Write the implementation**

```ts
// app/src/lib/draw/siblings.ts
/**
 * Making junctions the path of least resistance while drawing.
 *
 * The reader's picker only offers segments that meet EXACTLY, so a junction
 * the author aimed at by eye is a junction that does not exist. These helpers
 * put the neighbouring endpoints under the cursor instead.
 */

import { haversineM, type Point } from '../map/snap';
import { segmentCoords, type Segment } from './state';

const ends = (segment: Segment): Point[] => {
  const coords = segmentCoords(segment);
  return coords.length >= 2 ? [coords[0], coords[coords.length - 1]] : [];
};

/** Every endpoint the author could join onto, excluding the one being drawn. */
export function siblingEndpoints(segments: Segment[], skipIndex: number): Point[] {
  return segments.flatMap((s, i) => (i === skipIndex ? [] : ends(s)));
}

/**
 * The nearest sibling endpoint within reach, returned UNCHANGED.
 *
 * Returning the stored coordinate rather than the click is the whole point:
 * `joins` compares floats exactly, so a snapped-to-nearby point is not a
 * junction. This takes priority over the trail graph — a click that could go
 * either way should become the junction.
 */
export function snapToSiblings(
  segments: Segment[],
  skipIndex: number,
  click: Point,
  withinM: number
): Point | null {
  let best: Point | null = null;
  let bestM = withinM;
  for (const point of siblingEndpoints(segments, skipIndex)) {
    const d = haversineM(click, point);
    if (d <= bestM) {
      bestM = d;
      best = point;
    }
  }
  return best;
}

/**
 * Junctions the author probably meant to make and did not.
 *
 * Only reported between a drawn approach/exit and a drawn main: a main with no
 * approach yet is a route mid-session, not a mistake, and half-drawn segments
 * are skipped entirely so the panel stays quiet while you work.
 */
export function unmetJunctions(
  segments: Segment[]
): { from: string; to: string; gapM: number }[] {
  const drawn = segments.filter((s) => segmentCoords(s).length >= 2);
  const mains = drawn.filter((s) => s.role === 'main');
  const label = (s: Segment) => s.name || s.role;
  const out: { from: string; to: string; gapM: number }[] = [];
  for (const main of mains) {
    const mainCoords = segmentCoords(main);
    for (const s of drawn) {
      const coords = segmentCoords(s);
      if (s.role === 'approach') {
        const gap = haversineM(coords[coords.length - 1], mainCoords[0]);
        if (gap > 0) out.push({ from: label(s), to: label(main), gapM: gap });
      }
      if (s.role === 'exit') {
        const gap = haversineM(mainCoords[mainCoords.length - 1], coords[0]);
        if (gap > 0) out.push({ from: label(main), to: label(s), gapM: gap });
      }
    }
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/draw/siblings.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Wire it into the editor page**

In `app/src/routes/draw/+page.svelte`:

- Rename the `variants` state to `segments`, `newVariant()` to `newSegment('main')`, and `variantCoords` to `segmentCoords` throughout (including inside `redraw()` and `pickRoute()`).
- In `onMapClick`, before the graph snap, add:

```ts
    // A sibling endpoint wins over the trail graph: the click that could go
    // either way is the one that should become a junction.
    const sibling = snapToSiblings(segments, active, click, snapRadiusM());
    const hit = sibling
      ? { key: '', point: sibling }
      : snapToGraph(graph, click, snapRadiusM());
```

**Watch for this while testing step 6:** a sibling endpoint is a saved coordinate, not necessarily a node of the currently loaded trail graph, so the existing `walkOrBridge(graph, from.point, point)` call may refuse to route to it and report *"No trail connects those two points yet"*. If that happens when joining a junction, fall back to a direct two-point leg for the sibling case only:

```ts
      const walked = sibling
        ? (walkOrBridge(graph, from.point, point) ?? [from.point, point])
        : walkOrBridge(graph, from.point, point);
```

The straight fallback is safe here and nowhere else: the author has explicitly aimed at an endpoint that already exists, so the two points are within a snap radius of each other, not across a valley.

- Replace the `{#each variants ...}` fieldset block with:

```svelte
      {#each segments as segment, i (i)}
        <fieldset class:active={i === active}>
          <button type="button" onclick={() => (active = i)}>
            {segment.role} {i + 1}
          </button>
          <select bind:value={segment.role}>
            {#each ROLES as role}<option value={role}>{role}</option>{/each}
          </select>
          <input placeholder="Name (e.g. via Kasteelspoort)" bind:value={segment.name} />
          <input placeholder="What is it, and when would you take it?" bind:value={segment.note} />
          <span>{segmentCoords(segment).length} points</span>
          <button
            type="button"
            onclick={() => {
              segments[i] = flipSegment(segments[i]);
              segments = [...segments];
              redraw();
            }}
          >
            Flip direction
          </button>
        </fieldset>
      {/each}

      {#each ROLES as role}
        <button
          type="button"
          onclick={() => {
            segments = [...segments, newSegment(role)];
            active = segments.length - 1;
          }}
        >
          Add {role}
        </button>
      {/each}

      {#if unmet.length}
        <section class="gaps">
          <h3>Not joined up</h3>
          <ul>
            {#each unmet as gap}
              <li>{gap.from} → {gap.to}: {gap.gapM.toFixed(0)} m apart</li>
            {/each}
          </ul>
        </section>
      {/if}
```

- Add `let unmet = $derived(unmetJunctions(segments));` beside the other state, and import `ROLES` from `$lib/data/segments`, `flipSegment`/`newSegment`/`segmentCoords` from `$lib/draw/state`, and `snapToSiblings`/`unmetJunctions` from `$lib/draw/siblings`.
- Add to the `<style>` block: `.gaps { font-size: 0.85rem; color: #b45309; } .gaps ul { margin: 0.2rem 0 0; padding-left: 1rem; }`

- [ ] **Step 6: Verify the editor still typechecks and runs**

Run: `npm run check`
Expected: no errors in `src/routes/draw/+page.svelte`.

Run: `npm test`
Expected: the whole unit suite passes.

- [ ] **Step 7: Commit**

```bash
git add src/lib/draw/siblings.ts src/lib/draw/siblings.test.ts src/routes/draw/+page.svelte
git commit -m "feat(draw): role picker, sibling snapping, flip, and gap warnings"
```

---

### Task 9: Plan URL parameters

**Files:**
- Create: `app/src/lib/data/plan-params.ts`
- Test: `app/src/lib/data/plan-params.test.ts`

**Interfaces:**
- Consumes: `PlanChoice` from `./plan`.
- Produces: `encodePlan(choice: PlanChoice): URLSearchParams`; `decodePlan(params: URLSearchParams): Partial<PlanChoice>`.

- [ ] **Step 1: Write the failing test**

```ts
// app/src/lib/data/plan-params.test.ts
import { describe, it, expect } from 'vitest';
import { encodePlan, decodePlan } from './plan-params';

const CHOICE = {
  approach: 'a--b--c/approach/via-kasteelspoort',
  main: 'a--b--c/main/main',
  exit: 'a--b--c/exit/via-diagonal',
  reversed: false
};

describe('plan params', () => {
  it('round-trips a full choice', () => {
    expect(decodePlan(encodePlan(CHOICE))).toEqual(CHOICE);
  });

  it('round-trips the reversed flag', () => {
    expect(decodePlan(encodePlan({ ...CHOICE, reversed: true })).reversed).toBe(true);
  });

  it('omits empty slots rather than writing blanks into the URL', () => {
    const params = encodePlan({ approach: null, main: 'm', exit: null, reversed: false });
    expect(params.toString()).toBe('m=m');
  });

  it('reads an empty query as no preference, not as an empty plan', () => {
    expect(decodePlan(new URLSearchParams())).toEqual({ reversed: false });
  });

  it('survives the slashes segment ids contain', () => {
    const params = encodePlan(CHOICE);
    expect(new URLSearchParams(params.toString()).get('a')).toBe(CHOICE.approach);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/data/plan-params.test.ts`
Expected: FAIL — cannot resolve `./plan-params`.

- [ ] **Step 3: Write minimal implementation**

```ts
// app/src/lib/data/plan-params.ts
/**
 * A plan in a URL, so it survives a reload and can be sent to whoever is
 * coming along.
 *
 * Short keys because segment ids are already long; URLSearchParams handles the
 * slashes and double hyphens they contain without any escaping of our own.
 */

import type { PlanChoice } from './plan';

export function encodePlan(choice: PlanChoice): URLSearchParams {
  const params = new URLSearchParams();
  // Empty slots are OMITTED, not written blank: an absent key means "no
  // preference", which resolvePlan answers with the default. A blank value
  // would be indistinguishable from asking for nothing at all.
  if (choice.approach) params.set('a', choice.approach);
  if (choice.main) params.set('m', choice.main);
  if (choice.exit) params.set('x', choice.exit);
  if (choice.reversed) params.set('rev', '1');
  return params;
}

export function decodePlan(params: URLSearchParams): Partial<PlanChoice> {
  const out: Partial<PlanChoice> = { reversed: params.get('rev') === '1' };
  const a = params.get('a');
  const m = params.get('m');
  const x = params.get('x');
  if (a) out.approach = a;
  if (m) out.main = m;
  if (x) out.exit = x;
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/data/plan-params.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/data/plan-params.ts src/lib/data/plan-params.test.ts
git commit -m "feat(data): encode a plan in the URL"
```

---

### Task 10: The plan picker component

**Files:**
- Create: `app/src/lib/components/RoutePlan.svelte`
- Create: `app/src/lib/components/RoutePlan.test.ts`

(`RouteVariants.svelte` was already deleted in Task 6, to keep that task's tree green.)

**Interfaces:**
- Consumes: `ResolvedPlan`, `PlanChoice`, `PlanSegment`, `assemble`, `planStats` from `$lib/data/plan`; `ROLES` from `$lib/data/segments`.
- Produces: a component taking `{ plan: ResolvedPlan; onchange: (choice: PlanChoice) => void }`.

- [ ] **Step 1: Write the failing test**

```ts
// app/src/lib/components/RoutePlan.test.ts
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import RoutePlan from './RoutePlan.svelte';
import { resolvePlan, type PlanSegment } from '$lib/data/plan';
import type { Point3 } from '$lib/map/profile';

const P = (lon: number, h: number): Point3 => [lon, -33.96, h];
const seg = (id: string, role: 'approach' | 'main' | 'exit', name: string, coords: Point3[]):
  PlanSegment => ({ segmentId: id, role, name, note: null, coords });

const SEGMENTS = [
  seg('k', 'approach', 'via Kasteelspoort', [P(18.40, 50), P(18.41, 300)]),
  seg('d', 'approach', 'via Diagonal', [P(18.39, 60), P(18.41, 300)]),
  seg('m', 'main', 'Pimple Traverse', [P(18.41, 300), P(18.43, 500)]),
  seg('x', 'exit', 'via Kasteelspoort', [P(18.43, 500), P(18.45, 100)])
];

describe('RoutePlan', () => {
  it('shows the three rows in walking order', () => {
    const { container } = render(RoutePlan, { plan: resolvePlan(SEGMENTS), onchange: vi.fn() });
    // Row LABELS, not comboboxes: a role with one option renders as plain
    // text, so asking for comboboxes here would contradict the next test.
    const roles = [...container.querySelectorAll('.role')].map((el) => el.textContent?.trim());
    expect(roles).toEqual(['Approach', 'Main', 'Exit']);
  });

  it('reverses the row ORDER too, not only the labels', () => {
    // Walking order is the whole reason the rows are stacked this way — it is
    // what lines them up with the profile beneath, which always runs
    // start-to-finish. Reversed, the walk begins at the exit.
    const { container } = render(RoutePlan, {
      plan: resolvePlan(SEGMENTS, { reversed: true }), onchange: vi.fn()
    });
    const roles = [...container.querySelectorAll('.role')].map((el) => el.textContent?.trim());
    expect(roles).toEqual(['Start', 'Main', 'Finish']);
  });

  it('offers a select only where there is a choice to make', () => {
    render(RoutePlan, { plan: resolvePlan(SEGMENTS), onchange: vi.fn() });
    // Two approaches, so a select; one main and one exit, so plain labels.
    expect(screen.getAllByRole('combobox')).toHaveLength(1);
    expect(screen.getByText('Pimple Traverse')).toBeInTheDocument();
  });

  it('reports a new choice upward rather than resolving it itself', async () => {
    const onchange = vi.fn();
    render(RoutePlan, { plan: resolvePlan(SEGMENTS), onchange });
    await fireEvent.change(screen.getByLabelText('Approach'), { target: { value: 'd' } });
    expect(onchange).toHaveBeenCalledWith(expect.objectContaining({ approach: 'd', main: 'm' }));
  });

  it('flips the walk when reverse is pressed', async () => {
    const onchange = vi.fn();
    render(RoutePlan, { plan: resolvePlan(SEGMENTS), onchange });
    await fireEvent.click(screen.getByRole('button', { name: /reverse/i }));
    expect(onchange).toHaveBeenCalledWith(expect.objectContaining({ reversed: true }));
  });

  it('relabels the rows for a reversed walk', () => {
    render(RoutePlan, { plan: resolvePlan(SEGMENTS, { reversed: true }), onchange: vi.fn() });
    expect(screen.getByText('Finish')).toBeInTheDocument();
    expect(screen.queryByText('Approach')).not.toBeInTheDocument();
  });

  it('shows each row its own distance and climb', () => {
    render(RoutePlan, { plan: resolvePlan(SEGMENTS), onchange: vi.fn() });
    expect(screen.getByText(/↑ 250 m/)).toBeInTheDocument();
  });

  it('renders nothing at all for a route with no main', () => {
    const { container } = render(RoutePlan, {
      plan: resolvePlan([SEGMENTS[0]]), onchange: vi.fn()
    });
    expect(container.querySelector('.plan')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/components/RoutePlan.test.ts`
Expected: FAIL — cannot resolve `./RoutePlan.svelte`.

- [ ] **Step 3: Write the component**

```svelte
<!-- app/src/lib/components/RoutePlan.svelte -->
<script lang="ts">
  /**
   * The day the reader is planning: how they get in, what they came for, how
   * they get out — and what that adds up to.
   *
   * This component RESOLVES NOTHING. It reports a wish upward and re-renders
   * from whatever legal plan comes back, so the rule that a main drives its
   * approaches lives in one place (plan.ts) rather than being re-implemented
   * against the DOM.
   */
  import { assemble, planStats, type PlanChoice, type PlanSegment, type ResolvedPlan }
    from '$lib/data/plan';

  let { plan, onchange }: { plan: ResolvedPlan; onchange: (c: PlanChoice) => void } = $props();

  // Reversed, the walk starts where the exit is drawn. The DATA keeps its
  // canonical labels; only these words flip.
  const LABELS = { approach: 'Approach', main: 'Main', exit: 'Exit' };
  const REVERSED_LABELS = { approach: 'Finish', main: 'Main', exit: 'Start' };
  let labels = $derived(plan.choice.reversed ? REVERSED_LABELS : LABELS);

  let rows = $derived.by(() => {
    const built = (
      [
        ['approach', plan.approaches],
        ['main', plan.mains],
        ['exit', plan.exits]
      ] as const
    )
      .map(([role, options]) => ({
        role,
        options,
        chosen: options.find((o) => o.segmentId === plan.choice[role]) ?? null
      }))
      .filter((row) => row.options.length > 0);
    // Reversed, the walk BEGINS at the exit. The rows are stacked in walking
    // order so they line up with the profile beneath — which always runs
    // start to finish — so reversing the labels without reversing the order
    // would break the alignment that put them in this order to begin with.
    return plan.choice.reversed ? [...built].reverse() : built;
  });

  let total = $derived(planStats(assemble(plan.chosen, plan.choice.reversed)));

  const km = (m: number) => `${(m / 1000).toFixed(1)} km`;

  function statsFor(segment: PlanSegment) {
    return planStats(assemble([segment], plan.choice.reversed));
  }

  function pick(role: 'approach' | 'main' | 'exit', segmentId: string) {
    onchange({ ...plan.choice, [role]: segmentId });
  }
</script>

{#if plan.choice.main}
  <section class="plan">
    <header>
      <span class="total">{km(total.distanceM)}</span>
      {#if total.ascentM !== null}<span class="total">↑ {Math.round(total.ascentM)} m</span>{/if}
      {#if total.descentM !== null}<span class="total">↓ {Math.round(total.descentM)} m</span>{/if}
      <button type="button" onclick={() => onchange({ ...plan.choice, reversed: !plan.choice.reversed })}>
        ⇄ reverse
      </button>
    </header>

    <ul>
      {#each rows as row (row.role)}
        <li>
          <span class="role">{labels[row.role]}</span>
          {#if row.options.length > 1}
            <select
              aria-label={labels[row.role]}
              value={plan.choice[row.role]}
              onchange={(e) => pick(row.role, e.currentTarget.value)}
            >
              {#each row.options as option (option.segmentId)}
                <option value={option.segmentId}>{option.name ?? row.role}</option>
              {/each}
            </select>
          {:else}
            <span class="name">{row.chosen?.name ?? labels[row.role]}</span>
          {/if}
          {#if row.chosen}
            {@const s = statsFor(row.chosen)}
            <span class="figures">
              {km(s.distanceM)}
              {#if s.ascentM}↑ {Math.round(s.ascentM)} m{/if}
              {#if s.descentM}↓ {Math.round(s.descentM)} m{/if}
            </span>
          {/if}
          {#if row.chosen?.note}<span class="note">{row.chosen.note}</span>{/if}
        </li>
      {/each}
    </ul>
  </section>
{/if}

<style>
  .plan { margin: 0.75rem 0; }
  header { display: flex; gap: 0.75rem; align-items: baseline; flex-wrap: wrap; }
  .total { font-weight: 600; }
  ul { margin: 0.4rem 0 0; padding: 0; list-style: none; display: grid; gap: 0.35rem; }
  li {
    display: grid; grid-template-columns: 5rem 1fr auto; gap: 0.4rem; align-items: baseline;
    padding: 0.25rem 0.45rem; border-left: 3px solid #c2410c;
  }
  .role { font-size: 0.8em; opacity: 0.7; text-transform: uppercase; letter-spacing: 0.04em; }
  .name { font-weight: 600; }
  .figures { font-size: 0.85em; opacity: 0.8; white-space: nowrap; }
  .note { grid-column: 2 / -1; font-size: 0.82em; opacity: 0.75; }
</style>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/components/RoutePlan.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/RoutePlan.svelte src/lib/components/RoutePlan.test.ts
git commit -m "feat(app): the approach/main/exit plan picker"
```

---

### Task 11: Wire the plan into the route page

**Files:**
- Modify: `app/src/routes/route/[id]/+page.svelte`
- Test: `app/src/routes/route/route-page.test.ts` (append)

**Interfaces:**
- Consumes: `RoutePlan.svelte` (Task 10); `resolvePlan`, `assemble`, `type PlanSegment` (Tasks 3–4); `encodePlan`, `decodePlan` (Task 9); `isRole` (Task 1).
- Produces: nothing new for later tasks; the page now owns `planChoice` state and feeds `assemble(...)` into `RouteProfile` and `LocatorMap`.

- [ ] **Step 1: Write the failing test**

First update the existing `route` fixture in this file (around line 76): replace `lines: []` with `segments: []`. It will not typecheck otherwise, since Task 6 removed `lines` from `RouteContent`.

Then append, using the file's existing `render(Page, { data: { route } })` style — no new mocking harness:

```ts
// append to app/src/routes/route/route-page.test.ts
const ID = 'tm-aw-blind-gully';
const P = (lon: number, h: number) => [lon, -33.96, h];

const SEGMENT_META = [
  { segmentId: `${ID}/approach/via-kasteelspoort`, role: 'approach' as const,
    name: 'via Kasteelspoort', note: null },
  { segmentId: `${ID}/approach/via-diagonal`, role: 'approach' as const,
    name: 'via Diagonal', note: null },
  { segmentId: `${ID}/main/main`, role: 'main' as const, name: 'Blind Gully', note: null }
];

const GEOJSON = {
  features: [
    { geometry: { coordinates: [P(18.40, 50), P(18.41, 300)] },
      properties: { routeId: ID, segmentId: SEGMENT_META[0].segmentId, role: 'approach' } },
    { geometry: { coordinates: [P(18.39, 60), P(18.41, 300)] },
      properties: { routeId: ID, segmentId: SEGMENT_META[1].segmentId, role: 'approach' } },
    { geometry: { coordinates: [P(18.41, 300), P(18.43, 500)] },
      properties: { routeId: ID, segmentId: SEGMENT_META[2].segmentId, role: 'main' } }
  ]
};

const drawn = { ...route, hasLine: true, segments: SEGMENT_META };

/** Let the page's fetch of route-lines.geojson resolve, then settle Svelte. */
async function settle() {
  await vi.waitFor(() => expect(screen.getByLabelText('Approach')).toBeTruthy());
}

describe('the route page plan', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => GEOJSON })));
    window.history.replaceState({}, '', `/route/${ID}`);
  });

  it('defaults to the first approach that meets the main', async () => {
    render(Page, { data: { route: drawn } });
    await settle();
    expect(screen.getByLabelText('Approach')).toHaveValue(SEGMENT_META[0].segmentId);
  });

  it('reads its opening choice out of the URL, so a shared plan arrives intact', async () => {
    window.history.replaceState({}, '', `/route/${ID}?a=${encodeURIComponent(SEGMENT_META[1].segmentId)}`);
    render(Page, { data: { route: drawn } });
    await settle();
    expect(screen.getByLabelText('Approach')).toHaveValue(SEGMENT_META[1].segmentId);
  });

  it('writes the choice back to the URL when the reader changes it', async () => {
    render(Page, { data: { route: drawn } });
    await settle();
    await fireEvent.change(screen.getByLabelText('Approach'), {
      target: { value: SEGMENT_META[1].segmentId }
    });
    expect(decodeURIComponent(window.location.search)).toContain(SEGMENT_META[1].segmentId);
  });

  it('totals the whole plan, not the main alone', async () => {
    render(Page, { data: { route: drawn } });
    await settle();
    // Approach climbs 250 m, main climbs 200 m. The main alone would say 200.
    expect(screen.getByText(/↑ 450 m/)).toBeTruthy();
  });

  it('shows no plan for a route with nothing drawn', () => {
    render(Page, { data: { route } }); // hasLine: false, segments: []
    expect(screen.queryByLabelText('Approach')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/routes/route/route-page.test.ts`
Expected: FAIL — the page renders `RouteVariants`, which no longer exists.

- [ ] **Step 3: Rewrite the page's script and markup**

Replace the `lineCoords` effect and the `RouteVariants` usage:

```svelte
  import RoutePlan from '$lib/components/RoutePlan.svelte';
  import { isRole } from '$lib/data/segments';
  import { resolvePlan, assemble, type PlanChoice, type PlanSegment } from '$lib/data/plan';
  import { encodePlan, decodePlan } from '$lib/data/plan-params';

  let segments = $state<PlanSegment[]>([]);
  let wanted = $state<Partial<PlanChoice>>({});

  // The plan is resolved, never stored: a stale choice from the URL or from
  // the previous route can name a combination that does not join up, and
  // resolvePlan is the one place that decides what a legal plan is.
  let plan = $derived(resolvePlan(segments, wanted));
  let lineCoords = $derived(assemble(plan.chosen, plan.choice.reversed));

  // Read straight from the address bar rather than through $app/state, and
  // written back with history.replaceState below. The page needs no router
  // for this: the plan is a view of the current URL, not a navigation, and
  // going through goto() would push the map and profile through a full
  // re-render on every dropdown change. The trade is that Back does not step
  // through previous plans — reload and sharing, which are what the spec asks
  // for, both work.
  onMount(() => {
    wanted = decodePlan(new URLSearchParams(window.location.search));
  });

  // The route's drawn segments, fetched once per route. Only the geometry
  // comes from here; the metadata is already on r.segments from the build.
  $effect(() => {
    const id = r.id;
    const meta = r.segments;
    if (!r.hasLine) {
      segments = [];
      return;
    }
    let abandoned = false;
    void (async () => {
      try {
        const res = await fetch(`${base}/data/route-lines.geojson`);
        if (!res.ok) return;
        const collection = (await res.json()) as {
          features: {
            geometry: { coordinates: number[][] };
            properties: { routeId: string; segmentId: string; role: string };
          }[];
        };
        const byId = new Map(meta.map((m) => [m.segmentId, m]));
        const mine = collection.features
          .filter((f) => f.properties.routeId === id && isRole(f.properties.role))
          .map((f) => {
            const m = byId.get(f.properties.segmentId);
            return {
              segmentId: f.properties.segmentId,
              role: f.properties.role as PlanSegment['role'],
              name: m?.name ?? null,
              note: m?.note ?? null,
              coords: f.geometry.coordinates.filter(isPoint3)
            };
          });
        if (!abandoned) segments = mine;
      } catch {
        if (!abandoned) segments = [];
      }
    })();
    return () => { abandoned = true; };
  });

  function choose(choice: PlanChoice): void {
    // State AND address bar, together, so the two can never disagree about
    // what is on screen. replaceState rather than pushState: a dropdown is an
    // adjustment, not a place, and stacking one history entry per fiddle would
    // make Back useless for leaving the page.
    wanted = choice;
    const params = encodePlan(choice);
    const query = params.toString();
    window.history.replaceState({}, '', query ? `?${query}` : window.location.pathname);
  }
```

Also add `import { onMount } from 'svelte';` if it is not already imported.

In the markup, replace `<RouteVariants lines={r.lines} />` with `<RoutePlan {plan} onchange={choose} />`, and move it directly above the `{#if r.hasLine}<RouteProfile .../>{/if}` block so the pickers sit above the profile they drive.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/routes/route/route-page.test.ts`
Expected: PASS.

Run: `npm run check`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add "src/routes/route/[id]/+page.svelte" src/routes/route/route-page.test.ts
git commit -m "feat(app): the route page plans a day rather than showing a line"
```

---

### Task 12: The map lights the plan

**Files:**
- Modify: `app/src/lib/map/route-lines.ts` (replace `activeVariantFilter`)
- Modify: `app/src/lib/map/selection.ts`
- Modify: `app/src/lib/map/style.ts:305-306`
- Modify: `app/src/lib/components/MapView.svelte:393-402`
- Modify: `app/src/routes/route/[id]/+page.svelte` (publish the plan's segment ids)
- Test: `app/src/lib/map/route-lines.test.ts`, `app/src/lib/map/style.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `activeSegmentFilter(segmentIds: string[]): FilterSpecification` replacing `activeVariantFilter(routeId, variant)`; `SelectionState.planSegmentIds: string[]` replacing `hoveredVariant`; `setPlanSegments(ids: string[]): void` replacing `setHoveredVariant`.

- [ ] **Step 1: Write the failing test**

```ts
// app/src/lib/map/route-lines.test.ts — replace the activeVariantFilter cases
import { activeSegmentFilter } from './route-lines';

describe('activeSegmentFilter', () => {
  it('matches exactly the segments in the plan', () => {
    expect(activeSegmentFilter(['a', 'b'])).toEqual(
      ['in', ['get', 'segmentId'], ['literal', ['a', 'b']]]
    );
  });

  it('matches nothing for an empty plan, which is how "no selection" is said', () => {
    expect(activeSegmentFilter([])).toEqual(
      ['in', ['get', 'segmentId'], ['literal', []]]
    );
  });

  it('cannot light a line on another route, unlike the variant filter it replaces', () => {
    // The old filter had to pair routeId WITH a variant name, because variant
    // names repeated across entries — several routes had a "Right Hand" — and
    // matching the name alone lit a line on another mountain. A segment id is
    // qualified by its routeId, so one term is enough and cross-route
    // collisions are impossible by construction.
    const filter = activeSegmentFilter(['a--b--c/main/main']);
    expect(filter[1]).toEqual(['get', 'segmentId']);
    expect(JSON.stringify(filter)).not.toContain('routeId');
  });
});
```

```ts
// app/src/lib/map/selection.test.ts — add
import { selection, setPlanSegments, setSelected } from './selection';
import { get } from 'svelte/store';

describe('plan segments', () => {
  it('records the segments the plan lights up', () => {
    setPlanSegments(['a', 'b']);
    expect(get(selection).planSegmentIds).toEqual(['a', 'b']);
  });

  it('clears them when a different route is selected', () => {
    setPlanSegments(['a']);
    setSelected('some--other--route');
    expect(get(selection).planSegmentIds).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/lib/map/route-lines.test.ts src/lib/map/selection.test.ts`
Expected: FAIL — `activeSegmentFilter` / `setPlanSegments` not exported.

- [ ] **Step 3: Write the implementation**

In `route-lines.ts`, replace `activeVariantFilter` with:

```ts
/**
 * Match the segments the reader's plan is made of.
 *
 * A segment id already carries its routeId, so unlike the variant filter this
 * replaced there is nothing to pair it with: variant names repeated across
 * entries — several routes had a "Right Hand" — and matching on the name alone
 * lit a line on another mountain. Ids cannot do that.
 */
export function activeSegmentFilter(segmentIds: string[]): FilterSpecification {
  return ['in', ['get', 'segmentId'], ['literal', segmentIds]];
}
```

In `selection.ts`, replace `hoveredVariant` with:

```ts
  /** The segment ids of the plan the reader is looking at, if any. */
  planSegmentIds: string[];
```

`EMPTY` becomes `{ hoveredId: null, selectedId: null, planSegmentIds: [] }`; `setSelected` sets `planSegmentIds: []` (same reasoning as before — a plan from the previous route must not light lines on this one); and:

```ts
export function setPlanSegments(ids: string[]): void {
  state.update((s) => ({ ...s, planSegmentIds: ids }));
}
```

In `style.ts:305-306`, change the `route-line-active` layer's filter to `activeSegmentFilter([])` and update the import.

In `MapView.svelte:396` and `:402`, change to `map.setFilter('route-line-active', activeSegmentFilter($selection.planSegmentIds))` and `activeSegmentFilter([])` respectively.

In the route page, add `$effect(() => setPlanSegments(plan.chosen.map((s) => s.segmentId)));` and import `setPlanSegments` from `$lib/map/selection`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: the whole unit suite passes. `npm run check` clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/map/route-lines.ts src/lib/map/route-lines.test.ts src/lib/map/selection.ts \
        src/lib/map/selection.test.ts src/lib/map/style.ts src/lib/map/style.test.ts \
        src/lib/components/MapView.svelte "src/routes/route/[id]/+page.svelte"
git commit -m "feat(map): light the plan's segments by id"
```

---

### Task 13: The journal records the plan

**Files:**
- Modify: `app/src/lib/data/types.ts` (`JournalEntry`)
- Modify: `app/src/lib/journal/io.ts:18-45`
- Modify: `app/src/lib/journal/db.ts:16`
- Modify: `app/src/lib/components/JournalControls.svelte`
- Modify: `app/src/routes/route/[id]/+page.svelte` (pass the plan down)
- Test: `app/src/lib/journal/io.test.ts`, `app/src/lib/journal/db.test.ts`

**Interfaces:**
- Consumes: `PlanChoice` from `$lib/data/plan`.
- Produces: `JournalEntry.plan?: JournalPlan`, where `interface JournalPlan { approach?: string; main?: string; exit?: string; reversed: boolean }`.

- [ ] **Step 1: Write the failing test**

```ts
// append to app/src/lib/journal/io.test.ts
import { serialize, parse } from './io';

const withPlan = {
  routeId: 'a--b--c', done: true, date: '2026-07-02', notes: '',
  plan: { approach: 'a--b--c/approach/k', main: 'a--b--c/main/main', reversed: false }
};

describe('journal plans', () => {
  it('round-trips a plan through export and import', () => {
    expect(parse(serialize([withPlan]))[0].plan).toEqual(withPlan.plan);
  });

  it('accepts an entry with no plan, which is every entry written before today', () => {
    const legacy = { routeId: 'a--b--c', done: true, date: null, notes: 'x' };
    const [out] = parse(serialize([legacy]));
    expect(out.plan).toBeUndefined();
    expect(out.done).toBe(true);
  });

  it('rejects a plan that is not shaped like one', () => {
    const bad = JSON.stringify({
      version: 1, exportedAt: '', entries: [{ ...withPlan, plan: { reversed: 'yes' } }]
    });
    expect(() => parse(bad)).toThrow(/malformed/);
  });

  it('strips junk fields from inside the plan', () => {
    const junk = JSON.stringify({
      version: 1, exportedAt: '',
      entries: [{ ...withPlan, plan: { ...withPlan.plan, sneaky: 1 } }]
    });
    expect(parse(junk)[0].plan).toEqual(withPlan.plan);
  });
});
```

```ts
// append to app/src/lib/journal/db.test.ts
it('stores and returns an entry carrying a plan', async () => {
  await putEntry({
    routeId: 'a--b--c', done: true, date: null, notes: '',
    plan: { main: 'a--b--c/main/main', reversed: true }
  });
  const [entry] = await getAllEntries();
  expect(entry.plan?.reversed).toBe(true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/lib/journal`
Expected: FAIL — `plan` is stripped by `parse`'s normalizer.

- [ ] **Step 3: Write the implementation**

In `types.ts`:

```ts
/**
 * The walk actually taken, by segment id.
 *
 * Optional, and absent on every entry written before segments existed — which
 * is why `done` stays keyed on routeId rather than on a plan. A tick with no
 * plan is a legacy or unrecorded one, and stays valid forever.
 */
export interface JournalPlan {
  approach?: string;
  main?: string;
  exit?: string;
  reversed: boolean;
}

export interface JournalEntry {
  routeId: string;
  done: boolean;
  date: string | null;
  notes: string;
  plan?: JournalPlan;
}
```

In `io.ts`, add a plan validator and extend `isEntry` and the normalizer:

```ts
function isPlan(x: unknown): x is JournalPlan {
  if (typeof x !== 'object' || x === null) return false;
  const p = x as Record<string, unknown>;
  const optionalId = (v: unknown) => v === undefined || typeof v === 'string';
  return (
    typeof p.reversed === 'boolean' &&
    optionalId(p.approach) && optionalId(p.main) && optionalId(p.exit)
  );
}
```

In `isEntry`, add `&& (e.plan === undefined || isPlan(e.plan))`. In the normalizer's map, build the entry then attach a cleaned plan:

```ts
  return (obj.entries as JournalEntry[]).map((e) => {
    const entry: JournalEntry = {
      routeId: e.routeId, done: e.done, date: e.date, notes: e.notes
    };
    // Rebuilt field by field for the same reason the entry is: a hand-edited
    // file must not smuggle extra keys into IndexedDB.
    if (e.plan) {
      const plan: JournalPlan = { reversed: e.plan.reversed };
      if (e.plan.approach) plan.approach = e.plan.approach;
      if (e.plan.main) plan.main = e.plan.main;
      if (e.plan.exit) plan.exit = e.plan.exit;
      entry.plan = plan;
    }
    return entry;
  });
```

In `db.ts`, bump the version to `2` with a no-op upgrade body (the store's keyPath is unchanged; `plan` is an optional field on the stored object, so nothing needs migrating):

```ts
    dbPromise = openDB<KaapSpoorDB>(DB_NAME, 2, {
      // v2 added the optional `plan` field. Nothing to migrate: IndexedDB
      // stores whole objects and `journal` is keyed on routeId either way,
      // so a v1 entry is already a valid v2 entry.
      upgrade(database) {
        if (!database.objectStoreNames.contains(STORE)) {
          database.createObjectStore(STORE, { keyPath: 'routeId' });
        }
      }
    });
```

In `JournalControls.svelte`, accept an optional `plan` prop (`let { routeId, plan }: { routeId: string; plan?: JournalPlan } = $props();`) and include it on the entry it writes when it is present. In the route page, pass `plan={{ approach: plan.choice.approach ?? undefined, main: plan.choice.main ?? undefined, exit: plan.choice.exit ?? undefined, reversed: plan.choice.reversed }}` to `<JournalControls />`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/lib/journal src/lib/components/JournalControls.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/data/types.ts src/lib/journal/io.ts src/lib/journal/io.test.ts \
        src/lib/journal/db.ts src/lib/journal/db.test.ts \
        src/lib/components/JournalControls.svelte "src/routes/route/[id]/+page.svelte"
git commit -m "feat(journal): record the plan that was walked"
```

---

### Task 14: Full verification

**Files:**
- Modify: `app/src/routes/library.test.ts`, `app/build-output.test.ts`, `app/e2e/*` as the failures below require.

**Interfaces:**
- Consumes: everything.
- Produces: a green tree.

- [ ] **Step 1: Run the whole unit suite**

Run: `npm test`
Expected: PASS. Any failure here is a test still asserting `lines`, `variant`, or two-field `lineStats` — update the assertion to the segment equivalent; do not weaken it.

- [ ] **Step 2: Typecheck**

Run: `npm run check`
Expected: 0 errors, 0 warnings.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: succeeds. `build:data` prints no junction warnings for the 7 migrated lines.

- [ ] **Step 4: Run the end-to-end suite**

Run: `npm run test:e2e`
Expected: PASS. Two known breakages, plus anything else that surfaces:

- `e2e/map.spec.ts:792-796` reads `f.properties.variant`, which no longer exists. Retarget it at `f.properties.segmentId`.
- Any spec driving the /draw editor's "Add variant" button: retarget at "Add main" / "Add approach" / "Add exit".

- [ ] **Step 5: Draw one real route end to end**

```bash
npm run draw
```

In the editor: pick *Platteklip Gorge*, add an approach, draw it so its last click snaps onto the existing main's first point, save, and reload the route page. Confirm the approach picker appears, the total exceeds the main alone, the profile runs continuously across the junction, and the reverse toggle swaps ↑ and ↓.

This is the only step that exercises snapping, the DEM re-sample and the map filter together; do not skip it.

- [ ] **Step 6: Commit any test updates**

```bash
git add -u
git commit -m "test: follow the segment schema through the remaining suites"
```
