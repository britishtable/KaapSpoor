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
