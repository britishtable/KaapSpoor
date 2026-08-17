import { describe, it, expect } from 'vitest';
import { saveRouteLines, elevate } from './vite-plugin-route-lines';
import type { RouteLineFeature } from './src/lib/draw/state';

const feature = (routeId: string, variant?: string): RouteLineFeature => ({
  type: 'Feature',
  geometry: { type: 'LineString', coordinates: [[18.4, -34.0], [18.41, -34.0]] },
  properties: { routeId, drawn: '2026-08-17', ...(variant ? { variant } : {}) }
});

describe('saveRouteLines', () => {
  it('adds a route that had no line', () => {
    const out = saveRouteLines([], [feature('area--x')], 'area--x');
    expect(out).toHaveLength(1);
  });

  it('replaces every variant of the route being saved', () => {
    // Saving is "this is the route now", not "add another line to it" —
    // otherwise redrawing leaves the old shape behind for ever.
    const existing = [feature('area--x', 'Old A'), feature('area--x', 'Old B')];
    const out = saveRouteLines(existing, [feature('area--x', 'New')], 'area--x');
    expect(out.map((f) => f.properties.variant)).toEqual(['New']);
  });

  it('leaves other routes untouched', () => {
    const existing = [feature('area--other')];
    const out = saveRouteLines(existing, [feature('area--x')], 'area--x');
    expect(out.map((f) => f.properties.routeId).sort()).toEqual(['area--other', 'area--x']);
  });

  it('removes a route whose variants were all cleared', () => {
    const existing = [feature('area--x')];
    expect(saveRouteLines(existing, [], 'area--x')).toEqual([]);
  });

  it('keeps the features sorted by route id, so the committed diff is stable', () => {
    const out = saveRouteLines([feature('area--b')], [feature('area--a')], 'area--a');
    expect(out.map((f) => f.properties.routeId)).toEqual(['area--a', 'area--b']);
  });
});

describe('elevate', () => {
  const flat = (): RouteLineFeature => ({
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: [[18.4, -34.0], [18.41, -34.0]] },
    properties: { routeId: 'area--x', drawn: '2026-08-17' }
  });

  const dem = { sample: (lon: number) => (lon < 18.405 ? 100 : 250) };

  it('writes the height as the third ordinate', () => {
    // GeoJSON positions are [lon, lat, elevation] by spec, so this invents no
    // schema and nothing downstream needs to learn a new shape.
    const [out] = elevate([flat()], dem);
    expect(out.geometry.coordinates).toEqual([[18.4, -34.0, 100], [18.41, -34.0, 250]]);
  });

  it('replaces heights already there, so --elevate can be re-run', () => {
    const stale: RouteLineFeature = {
      ...flat(),
      geometry: { type: 'LineString', coordinates: [[18.4, -34.0, 9999], [18.41, -34.0, 9999]] }
    };
    const [out] = elevate([stale], dem);
    expect(out.geometry.coordinates[0][2]).toBe(100);
  });

  it('leaves the line untouched when there is no DEM', () => {
    // Drawing must work on a clone that has never built the tiles.
    const [out] = elevate([flat()], null);
    expect(out.geometry.coordinates).toEqual([[18.4, -34.0], [18.41, -34.0]]);
  });

  it('drops the height for a point outside the model rather than inventing one', () => {
    const edge = { sample: (lon: number) => (lon < 18.405 ? 100 : null) };
    const [out] = elevate([flat()], edge);
    expect(out.geometry.coordinates).toEqual([[18.4, -34.0, 100], [18.41, -34.0]]);
  });
});
