/**
 * What a drawn route is, before it reaches the map or the disk.
 *
 * A LEG is one click plus the trail coordinates that reaching it added. Storing
 * the drawing that way is what lets undo mean "take back that click" instead of
 * "take back one bend of the path", which is the only undo an author wants.
 *
 * Pure data — no map, no Svelte — so the editor's behaviour is testable without
 * WebGL, which jsdom does not have.
 */

import type { Point } from '../map/snap';
import type { Point3 } from '../map/profile';

export interface Leg {
  /** Where the author clicked (already snapped to a trail node). */
  at: Point;
  /** The trail walked to get here, starting at the previous leg's `at`. */
  coords: Point[];
}

export interface Variant {
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
    variant?: string;
    note?: string;
    drawn: string;
  };
}

/** Ground position, elevation dropped — the editor draws and edits in 2D. */
const ground = (p: Point3): Point => [p[0], p[1]];

export function newVariant(name = ''): Variant {
  return { name, note: '', legs: [] };
}

export function variantCoords(variant: Variant): Point[] {
  const out: Point[] = [];
  for (const leg of variant.legs) {
    out.push(...(out.length ? leg.coords.slice(1) : leg.coords));
  }
  return out;
}

export function undoLeg(variant: Variant): Variant {
  return { ...variant, legs: variant.legs.slice(0, -1) };
}

export function toFeatures(
  routeId: string,
  variants: Variant[],
  drawn: string
): RouteLineFeature[] {
  // A single line is the route, and needs no label: an entry with one drawn
  // line shows no variant list, so a name written here would never be read.
  const named = variants.length > 1;
  const features: RouteLineFeature[] = [];
  for (const variant of variants) {
    const coordinates = variantCoords(variant);
    // One point is a click, not a line. Dropping it here keeps half-drawn work
    // out of the committed file rather than shipping a degenerate geometry.
    if (coordinates.length < 2) continue;
    const properties: RouteLineFeature['properties'] = { routeId, drawn };
    if (named && variant.name) properties.variant = variant.name;
    if (named && variant.note) properties.note = variant.note;
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates },
      properties
    });
  }
  return features;
}

export function fromFeatures(routeId: string, features: RouteLineFeature[]): Variant[] {
  return features
    .filter((f) => f.properties.routeId === routeId)
    .map((f) => ({
      name: f.properties.variant ?? '',
      note: f.properties.note ?? '',
      // Read back as one leg: the trail it followed is already in the file, and
      // an author re-editing an old line redraws it rather than un-clicking it.
      // Elevation is dropped here — it is resampled from the DEM at the next
      // Save, not carried through the edit.
      legs: [{ at: ground(f.geometry.coordinates[0]), coords: f.geometry.coordinates.map(ground) }]
    }));
}
