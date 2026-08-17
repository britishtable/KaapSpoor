/**
 * What a drawn line says about the walk: how far, how much climbing, and the
 * shape of it.
 *
 * Everything here is derived from the geometry at read time. Elevation lives in
 * the third ordinate of each coordinate — GeoJSON positions are
 * [lon, lat, elevation] by spec — sampled once when the author saved the line.
 *
 * Pure arithmetic on purpose: every number a reader sees is asserted in tests
 * that need neither the DEM nor WebGL.
 */

import { haversineM, type Point } from './snap';

/** A drawn coordinate, with or without the elevation sampled at Save. */
export type Point3 = [number, number] | [number, number, number];

/**
 * Consecutive DEM readings wobble by a few metres on ground that is level:
 * the model is 1 arc-second, about 30 m, and the line is sampled far more
 * finely than that. Summing every rise turns a contour path into hundreds of
 * metres of ascent that nobody climbs, so a step has to clear this to count.
 */
export const ASCENT_THRESHOLD_M = 10;

const ground = (p: Point3): Point => [p[0], p[1]];

/** A drawn coordinate that carries the elevation sampled at Save. */
type Elevated = [number, number, number];

const isElevated = (p: Point3): p is Elevated => p.length === 3;

export function cumulativeDistanceM(coords: Point3[]): number[] {
  const out: number[] = [];
  let running = 0;
  for (let i = 0; i < coords.length; i++) {
    if (i > 0) running += haversineM(ground(coords[i - 1]), ground(coords[i]));
    out.push(running);
  }
  return out;
}

export function totalDistanceM(coords: Point3[]): number {
  const cumulative = cumulativeDistanceM(coords);
  return cumulative.length ? cumulative[cumulative.length - 1] : 0;
}

export function totalAscentM(coords: Point3[]): number | null {
  const elevated = coords.filter(isElevated);
  // A line that leaves the DEM's extent samples nothing for those points —
  // it's null only when NONE of them carry a height, not when some do.
  if (elevated.length === 0) return null;
  let ascent = 0;
  let reference = elevated[0][2];
  for (const point of elevated) {
    const here = point[2];
    // Measured against the last height we ACCEPTED, not the previous sample:
    // comparing neighbours would let a long gradual climb slip under the
    // threshold step by step and count as nothing at all.
    if (here - reference >= ASCENT_THRESHOLD_M) {
      ascent += here - reference;
      reference = here;
    } else if (here < reference) {
      reference = here;
    }
  }
  return ascent;
}

export function profilePoints(coords: Point3[]): { distanceM: number; elevationM: number }[] {
  const cumulative = cumulativeDistanceM(coords);
  const out: { distanceM: number; elevationM: number }[] = [];
  coords.forEach((point, i) => {
    if (isElevated(point)) out.push({ distanceM: cumulative[i], elevationM: point[2] });
  });
  return out;
}

export function pointAtDistance(coords: Point3[], distanceM: number): Point {
  if (!coords.length) return [0, 0];
  const cumulative = cumulativeDistanceM(coords);
  if (distanceM <= 0) return ground(coords[0]);
  const last = cumulative[cumulative.length - 1];
  if (distanceM >= last) return ground(coords[coords.length - 1]);

  for (let i = 1; i < cumulative.length; i++) {
    if (cumulative[i] < distanceM) continue;
    const span = cumulative[i] - cumulative[i - 1];
    const t = span === 0 ? 0 : (distanceM - cumulative[i - 1]) / span;
    const a = ground(coords[i - 1]);
    const b = ground(coords[i]);
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  }
  return ground(coords[coords.length - 1]);
}
