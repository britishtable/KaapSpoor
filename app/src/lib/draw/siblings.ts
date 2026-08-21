/**
 * Making junctions the path of least resistance while drawing.
 *
 * The reader's picker only offers segments that meet EXACTLY, so a junction
 * the author aimed at by eye is a junction that does not exist. These helpers
 * put the neighbouring endpoints under the cursor instead.
 */

import { haversineM, type Point } from '../map/snap';
import { joins, type PlanSegment } from '../data/plan';
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

/** The shape `joins` needs, built from a segment's drawn coordinates. */
const asPlan = (coords: Point[]): PlanSegment => ({
  segmentId: '',
  role: 'main',
  name: null,
  note: null,
  coords
});

/**
 * Junctions the author probably meant to make and did not.
 *
 * A segment is unmet when it fails to meet ANY drawn main, not when it fails
 * to meet ONE main it wasn't aimed at — a route with two mains (Spring
 * Buttress B and C, the case this whole feature exists for) would otherwise
 * flag every approach against every main it isn't attached to, and the panel
 * would be noisiest exactly where the author most needs it quiet. Each unmet
 * segment is reported ONCE, against its nearest main — the junction it most
 * likely intended, and the distance that makes the message actionable.
 *
 * Only approach/exit segments are reported: a main with no approach at all is
 * a route mid-session, not a mistake. Half-drawn segments are skipped
 * entirely so the panel stays quiet while you work.
 *
 * Deliberately no distance cutoff, unlike the build-time warning in
 * transform.ts (which uses JUNCTION_TOLERANCE_M to ask "is this a near-miss
 * the author probably meant to join"). Here the author is looking at their
 * own unfinished work and wants to know what is not joined, at any distance.
 */
export function unmetJunctions(
  segments: Segment[]
): { from: string; to: string; gapM: number }[] {
  const drawn = segments.filter((s) => segmentCoords(s).length >= 2);
  const mains = drawn.filter((s) => s.role === 'main');
  const label = (s: Segment) => s.name || s.role;
  const out: { from: string; to: string; gapM: number }[] = [];
  if (!mains.length) return out;

  for (const s of drawn) {
    if (s.role !== 'approach' && s.role !== 'exit') continue;
    const coords = segmentCoords(s);
    const plan = asPlan(coords);

    const meetsAny = mains.some((main) =>
      s.role === 'approach' ? joins(plan, asPlan(segmentCoords(main))) : joins(asPlan(segmentCoords(main)), plan)
    );
    if (meetsAny) continue;

    let nearest = mains[0];
    let nearestGap = Infinity;
    for (const main of mains) {
      const mainCoords = segmentCoords(main);
      const gap =
        s.role === 'approach'
          ? haversineM(coords[coords.length - 1], mainCoords[0])
          : haversineM(mainCoords[mainCoords.length - 1], coords[0]);
      if (gap < nearestGap) {
        nearestGap = gap;
        nearest = main;
      }
    }

    out.push(
      s.role === 'approach'
        ? { from: label(s), to: label(nearest), gapM: nearestGap }
        : { from: label(nearest), to: label(s), gapM: nearestGap }
    );
  }
  return out;
}
