import { describe, it, expect } from 'vitest';
import { saveRouteLines, elevate } from './vite-plugin-route-lines';
import { fromFeatures, toFeatures, type RouteLineFeature } from './src/lib/draw/state';

const feature = (routeId: string, variant?: string): RouteLineFeature => ({
  type: 'Feature',
  geometry: { type: 'LineString', coordinates: [[18.4, -34.0], [18.41, -34.0]] },
  properties: {
    routeId, segmentId: `${routeId}/main/${variant ?? 'x'}`, role: 'main', drawn: '2026-08-17',
    ...(variant ? { name: variant } : {})
  }
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
    expect(out.map((f) => f.properties.name)).toEqual(['New']);
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
    properties: { routeId: 'area--x', segmentId: 'area--x/main/x', role: 'main', drawn: '2026-08-17' }
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

  it('leaves an already-2D line untouched when there is no DEM and nothing to recover', () => {
    // Drawing must work on a clone that has never built the tiles.
    const [out] = elevate([flat()], null);
    expect(out.geometry.coordinates).toEqual([[18.4, -34.0], [18.41, -34.0]]);
  });

  it('drops the height for a point outside the model rather than inventing one', () => {
    const edge = { sample: (lon: number) => (lon < 18.405 ? 100 : null) };
    const [out] = elevate([flat()], edge);
    expect(out.geometry.coordinates).toEqual([[18.4, -34.0, 100], [18.41, -34.0]]);
  });

  it('recovers heights from the existing file when there is no DEM, by ground position', () => {
    // The exact bug: a save on a machine with no DEM must not destroy heights
    // a previous save (elsewhere, with the DEM) already committed.
    const existing: RouteLineFeature = {
      ...flat(),
      geometry: { type: 'LineString', coordinates: [[18.4, -34.0, 100], [18.41, -34.0, 250]] }
    };
    const [out] = elevate([flat()], null, [existing]);
    expect(out.geometry.coordinates).toEqual([[18.4, -34.0, 100], [18.41, -34.0, 250]]);
  });

  it('leaves a point two-dimensional when no existing point sits at its ground position', () => {
    // A genuinely new point the author drew has nothing to recover from --
    // it stays 2D, same as an unsampled point, rather than inventing a height.
    const existing: RouteLineFeature = {
      ...flat(),
      geometry: { type: 'LineString', coordinates: [[18.4, -34.0, 100], [18.41, -34.0, 250]] }
    };
    const moved: RouteLineFeature = {
      ...flat(),
      geometry: { type: 'LineString', coordinates: [[18.4, -34.0], [18.42, -34.0]] }
    };
    const [out] = elevate([moved], null, [existing]);
    expect(out.geometry.coordinates).toEqual([[18.4, -34.0, 100], [18.42, -34.0]]);
  });

  it('round-trips heights through the editor when there is no DEM: load, edit, save', () => {
    // The regression this whole fix targets: fromFeatures strips heights on
    // load (state.ts's own promise is that Save resamples them), and the old
    // elevate() was a no-op with no DEM -- so load -> save on a DEM-less
    // machine silently wrote 2D coordinates over a committed 3D line.
    const routeId = 'area--x';
    const saved: RouteLineFeature = {
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [
          [18.4, -34.0, 100],
          [18.41, -34.0, 150],
          [18.42, -34.0, 200]
        ]
      },
      properties: { routeId, segmentId: `${routeId}/main/x`, role: 'main', drawn: '2026-08-01' }
    };
    const existing = [saved];

    // Load into the editor -- heights dropped, per fromFeatures's contract.
    const variants = fromFeatures(routeId, existing);
    expect(variants[0].legs[0].coords.every((p) => p.length === 2)).toBe(true);

    // An edit that touches none of the ground points (e.g. renaming the
    // variant) re-derives the same 2D coordinates.
    const incoming = toFeatures(routeId, variants, '2026-08-17');

    // Save on a machine with no DEM.
    const out = elevate(incoming, null, existing.filter((f) => f.properties.routeId === routeId));
    expect(out[0].geometry.coordinates).toEqual(saved.geometry.coordinates);
  });
});
