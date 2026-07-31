import { describe, it, expect } from 'vitest';
import { SHIPPED_REGION } from './region';

describe('SHIPPED_REGION', () => {
  it('is the Cape Town region', () => {
    expect(SHIPPED_REGION.id).toBe('cape-town');
  });

  it('matches the bbox tools/tiles/regions.json builds', () => {
    // Derived from the 133 Table Mountain and peninsula routes plus a ~6 km
    // margin. If these drift apart, the map frames terrain that was never built.
    expect(SHIPPED_REGION.bbox).toEqual({
      west: 18.27,
      south: -34.33,
      east: 18.51,
      north: -33.89
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
