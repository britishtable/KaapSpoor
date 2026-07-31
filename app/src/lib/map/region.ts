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

export const SHIPPED_REGION: Region = {
  id: 'cape-town',
  // Must equal the `cape-town` entry in tools/tiles/regions.json. It is the
  // extent of the 133 Table Mountain and peninsula routes plus a ~6 km margin.
  bbox: { west: 18.27, south: -34.33, east: 18.51, north: -33.89 }
};
