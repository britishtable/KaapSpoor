/**
 * The region this build ships.
 *
 * Each region is a standalone map, not a tile of a continuous surface — see
 * tools/tiles/regions.json, which builds the archives named here. The app has
 * no region picker; adding one is a later phase.
 */
export interface Region {
  id: string;
  bbox: { west: number; south: number; east: number; north: number };
}

import type { RouteIndexEntry } from '$lib/data/types';

export const SHIPPED_REGION: Region = {
  id: 'cape-town',
  // Must equal the `cape-town` entry in tools/tiles/regions.json. It is the
  // extent of the 133 Table Mountain and peninsula routes plus a ~6 km margin.
  bbox: { west: 18.27, south: -34.33, east: 18.51, north: -33.89 }
};

/** Is this coordinate inside the region the build ships tiles for? */
export function isInRegion(
  coords: { lat: number; lon: number },
  region: Region = SHIPPED_REGION
): boolean {
  const { west, south, east, north } = region.bbox;
  return coords.lon >= west && coords.lon <= east && coords.lat >= south && coords.lat <= north;
}

/**
 * The routes this build can actually show, which is the only set worth
 * offering: the camera is clamped to the region (see MapView's maxBounds) and
 * no basemap exists outside it, so a route beyond the bbox is unreachable on
 * the map and its pin, if drawn, sits over blank background.
 *
 * Membership is decided per AREA, not per route. Deciding per route would drop
 * every route with no coordinate at all, and the panel is the only place those
 * can be found -- the map cannot show them by definition. So an area counts as
 * in-region when any of its located routes falls inside the bbox, and then the
 * whole area comes through, unlocated members included.
 *
 * Derived from the region rather than a list of area names on purpose: today
 * this resolves to Table Mountain and the peninsula, but re-cutting the bbox
 * (as Phase 4a did) must not need an edit here to stay true.
 */
export function entriesInRegion(
  entries: RouteIndexEntry[],
  region: Region = SHIPPED_REGION
): RouteIndexEntry[] {
  const areaKey = (e: RouteIndexEntry) => e.area[0] ?? '';
  const covered = new Set(
    entries.filter((e) => e.coords && isInRegion(e.coords, region)).map(areaKey)
  );
  return entries.filter((e) => covered.has(areaKey(e)));
}
