import { describe, it, expect } from 'vitest';
import { SHIPPED_REGION, entriesInRegion } from './region';
import type { RouteIndexEntry } from '$lib/data/types';
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

describe('entriesInRegion', () => {
  const entry = (
    id: string,
    area: string[],
    coords: { lat: number; lon: number } | null
  ): RouteIndexEntry => ({
    id, title: id, area,
    coords: coords ? { ...coords, zoom: 15 } : null,
    coordsSource: coords ? 'crawl' : null, coordsAccuracyM: null, coordsOsm: null,
    mentionedPaths: [],
    grade: null, gradeSource: null, time: null, heightGain: null, isFullEntry: true
  });

  const tableMountain = entry('kasteelspoort', ['Table-Mountain', 'atlantic-west'], {
    lat: -33.97, lon: 18.39
  });
  const peninsula = entry('cape-point', ['peninsula', 'south'], { lat: -34.3, lon: 18.47 });
  // Ladismith, ~250 km east: real data has 50 such routes, and the camera is
  // clamped to the region, so they can never be reached on the map.
  const capeCountry = entry('elandsberg', ['cape-country', 'cape-karoo'], {
    lat: -33.49, lon: 21.27
  });

  it('keeps the routes the shipped region actually covers', () => {
    const kept = entriesInRegion([tableMountain, peninsula, capeCountry]).map((e) => e.id);
    expect(kept).toEqual(['kasteelspoort', 'cape-point']);
  });

  it('drops an area whose routes all lie outside the region', () => {
    const kept = entriesInRegion([tableMountain, capeCountry]);
    expect(kept.map((e) => e.area[0])).not.toContain('cape-country');
  });

  it('keeps an unlocated route whose area is in the region', () => {
    // The panel is the only place an unlocated route can be found at all -- the
    // map cannot show it -- so a bbox test alone would quietly lose it. Its
    // area's membership is what decides, not its own missing coordinate.
    const unlocated = entry('corridor-rib', ['Table-Mountain', 'atlantic-west'], null);
    const kept = entriesInRegion([tableMountain, unlocated, capeCountry]).map((e) => e.id);
    expect(kept).toContain('corridor-rib');
  });

  it('drops an unlocated route whose area is outside the region', () => {
    const unlocated = entry('swartberg', ['cape-country', 'cape-karoo'], null);
    const kept = entriesInRegion([tableMountain, capeCountry, unlocated]).map((e) => e.id);
    expect(kept).not.toContain('swartberg');
  });

  it('is derived from the region, not from a hard-coded list of area names', () => {
    // A route in a brand-new area inside the bbox must come through without
    // anyone editing this file -- that is the difference between deriving the
    // set and pinning it.
    const invented = entry('new-thing', ['somewhere-new'], { lat: -34.0, lon: 18.4 });
    expect(entriesInRegion([invented]).map((e) => e.id)).toEqual(['new-thing']);
  });
});
