/**
 * What a drawn route is, before it reaches the map or the disk.
 *
 * A LEG is one click plus the trail coordinates that reaching it added. Storing
 * the drawing that way is what lets undo mean "take back that click" instead of
 * "take back one bend of the path", which is the only undo an author wants.
 *
 * A route is a list of SEGMENTs, each with a ROLE — approach, main or exit —
 * rather than an undifferentiated list of variants. Canonical direction:
 * approach runs car→start, main runs start→end, exit runs end→car.
 *
 * Pure data — no map, no Svelte — so the editor's behaviour is testable without
 * WebGL, which jsdom does not have.
 */

import type { Point } from '../map/snap';
import type { Point3 } from '../map/profile';
import { makeSegmentId, type SegmentRole } from '../data/segments';

export interface Leg {
  /** Where the author clicked (already snapped to a trail node). */
  at: Point;
  /** The trail walked to get here, starting at the previous leg's `at`. */
  coords: Point[];
}

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
  // Point3, not Point: a line already saved once carries elevation as its
  // third ordinate (dem-sample, sampled at Save), and re-reading it must not
  // throw that away.
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

/** Ground position, elevation dropped — the editor draws and edits in 2D. */
const ground = (p: Point3): Point => [p[0], p[1]];

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
    // One point is a click, not a line. Dropping it here keeps half-drawn work
    // out of the committed file rather than shipping a degenerate geometry.
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
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates },
      properties
    });
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
      // Read back as one leg: the trail it followed is already in the file, and
      // an author re-editing an old line redraws it rather than un-clicking it.
      // Elevation is dropped here — it is resampled from the DEM at the next
      // Save, not carried through the edit.
      legs: [{ at: ground(f.geometry.coordinates[0]), coords: f.geometry.coordinates.map(ground) }]
    }));
}
