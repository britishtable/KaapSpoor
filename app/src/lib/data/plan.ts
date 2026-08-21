/**
 * A day out, assembled from the segments the reader chose.
 *
 * Pure arithmetic over coordinates — no map, no Svelte — so every number the
 * route page shows is asserted without WebGL.
 */

import { haversineM, type Point } from '../map/snap';
import { reverseCoords, totalDistanceM, totalAscentM, totalDescentM, type Point3 } from '../map/profile';
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
