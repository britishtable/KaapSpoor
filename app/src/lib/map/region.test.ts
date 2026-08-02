import { describe, it, expect } from 'vitest';
import { SHIPPED_REGION } from './region';
import regions from '../../../../tools/tiles/regions.json';

describe('SHIPPED_REGION', () => {
  it('is the Cape Town region', () => {
    expect(SHIPPED_REGION.id).toBe('cape-town');
  });

  it('matches the bbox tools/tiles/regions.json builds', () => {
    // Reads the actual regions.json entry rather than a hard-coded literal,
    // so the two cannot silently drift apart: the map would then frame
    // terrain that was never built.
    const capeTown = regions.regions.find((r) => r.id === 'cape-town');
    expect(capeTown).toBeDefined();
    expect(SHIPPED_REGION.bbox).toEqual({
      west: capeTown!.bbox.west,
      south: capeTown!.bbox.south,
      east: capeTown!.bbox.east,
      north: capeTown!.bbox.north
    });
  });

  it('contains Table Mountain and excludes the West Coast', () => {
    const { west, south, east, north } = SHIPPED_REGION.bbox;
    const inside = (lon: number, lat: number) =>
      lon >= west && lon <= east && lat >= south && lat <= north;
    expect(inside(18.4028, -33.9575)).toBe(true); // Maclear's Beacon
    expect(inside(18.4302, -33.4915)).toBe(false); // Koeberg, 26 km north
  });
});
