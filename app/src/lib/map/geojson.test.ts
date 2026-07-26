import { describe, it, expect } from 'vitest';
import { routesToGeoJSON, boundsOf } from './geojson';
import type { RouteIndexEntry } from '$lib/data/types';

function entry(id: string, coords: { lat: number; lon: number } | null): RouteIndexEntry {
  return {
    id, title: id.toUpperCase(), area: ['x'],
    coords: coords ? { ...coords, zoom: 16 } : null,
    grade: '3 ***', gradeSource: 'label', time: null, heightGain: null, isFullEntry: true
  };
}

const entries = [
  entry('a', { lat: -33.97, lon: 18.39 }),
  entry('b', null),
  entry('c', { lat: -32.6, lon: 19.2 })
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
});

describe('boundsOf', () => {
  it('returns south-west and north-east corners', () => {
    expect(boundsOf(entries)).toEqual([[18.39, -33.97], [19.2, -32.6]]);
  });
  it('returns null when nothing is located', () => {
    expect(boundsOf([entry('b', null)])).toBeNull();
  });
});
