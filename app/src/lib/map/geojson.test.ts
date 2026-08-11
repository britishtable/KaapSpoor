import { describe, it, expect } from 'vitest';
import { routesToGeoJSON, boundsOf, BASEMAP_BOUNDS } from './geojson';
import { SHIPPED_REGION } from './region';
import type { RouteIndexEntry } from '$lib/data/types';

function entry(id: string, coords: { lat: number; lon: number } | null): RouteIndexEntry {
  return {
    id, title: id.toUpperCase(), area: ['x'],
    coords: coords ? { ...coords, zoom: 16 } : null,
    coordsSource: coords ? 'crawl' : null, coordsAccuracyM: null, coordsOsm: null,
    mentionedPaths: [],
    grade: '3 ***', gradeSource: 'label', time: null, heightGain: null, isFullEntry: true
  };
}

const entries = [
  entry('a', { lat: -33.97, lon: 18.39 }),
  entry('b', null),
  entry('c', { lat: -34.3, lon: 18.47 }) // Cape Point-ish, inside the shipped region
];

describe('routesToGeoJSON', () => {
  it('includes only located routes', () => {
    const fc = routesToGeoJSON(entries);
    expect(fc.features.map((f) => f.properties.id)).toEqual(['a', 'c']);
  });
  it('writes coordinates as [lon, lat] per the GeoJSON spec', () => {
    const [first] = routesToGeoJSON(entries).features;
    expect(first.geometry.coordinates).toEqual([18.39, -33.97]);
  });
  it('sets a feature id so MapLibre feature-state can target it', () => {
    expect(routesToGeoJSON(entries).features[0].id).toBe('a');
  });
  it('carries the raw grade string unchanged', () => {
    expect(routesToGeoJSON(entries).features[0].properties.grade).toBe('3 ***');
  });
  it('returns an empty collection when nothing is located', () => {
    expect(routesToGeoJSON([entry('b', null)]).features).toEqual([]);
  });

  // The pins layer draws an area-approx route hollow and sizes its uncertainty
  // circle from the radius, and a paint expression can only read what is in
  // properties -- neither is possible if these do not cross into the GeoJSON.
  it('carries coordsSource so the pin can be drawn as approximate or surveyed', () => {
    const approx: RouteIndexEntry = {
      ...entry('approx', { lat: -33.97, lon: 18.39 }),
      coordsSource: 'area-approx', coordsAccuracyM: 3911
    };
    const [f] = routesToGeoJSON([approx]).features;
    expect(f.properties.coordsSource).toBe('area-approx');
  });

  it('carries coordsAccuracyM so the uncertainty circle can be sized from it', () => {
    const approx: RouteIndexEntry = {
      ...entry('approx', { lat: -33.97, lon: 18.39 }),
      coordsSource: 'area-approx', coordsAccuracyM: 3911
    };
    expect(routesToGeoJSON([approx]).features[0].properties.coordsAccuracyM).toBe(3911);
  });

  it('leaves coordsAccuracyM null for a surveyed route, which has no radius', () => {
    const [f] = routesToGeoJSON(entries).features;
    expect(f.properties.coordsSource).toBe('crawl');
    expect(f.properties.coordsAccuracyM).toBeNull();
  });
});

describe('boundsOf', () => {
  it('returns south-west and north-east corners', () => {
    expect(boundsOf(entries)).toEqual([[18.39, -34.3], [18.47, -33.97]]);
  });
  it('returns null when nothing is located', () => {
    expect(boundsOf([entry('b', null)])).toBeNull();
  });

  it('ignores a route outside the basemap bounds rather than widening the extent', () => {
    // 23.8°E (Otter Trail-ish) is far east of BASEMAP_BOUNDS.east (18.51);
    // including it would zoom the opening view out past where anything but
    // pins renders.
    const outside = entry('otter', { lat: -34.0, lon: 23.8 });
    expect(boundsOf([...entries, outside])).toEqual(boundsOf(entries));
  });

  it('widens the extent for a route inside the basemap bounds', () => {
    const inside = entry('d', { lat: -33.9, lon: 18.3 });
    expect(boundsOf([...entries, inside])).toEqual([[18.3, -34.3], [18.47, -33.9]]);
  });

  it('falls back to all located routes when every one is outside the basemap bounds', () => {
    const allOutside = [
      entry('otter', { lat: -34.0, lon: 23.8 }),
      entry('robberg', { lat: -34.1, lon: 23.4 })
    ];
    expect(boundsOf(allOutside)).toEqual([
      [23.4, -34.1],
      [23.8, -34.0]
    ]);
  });

  it('exposes the basemap bounds used to decide what frames the opening view', () => {
    expect(BASEMAP_BOUNDS).toEqual(SHIPPED_REGION.bbox);
  });

  it('frames on the shipped region rather than a second hand-written box', () => {
    // One region, one source of truth: a divergence here frames the map on
    // terrain the pipeline never built.
    expect(BASEMAP_BOUNDS).toBe(SHIPPED_REGION.bbox);
  });
});
