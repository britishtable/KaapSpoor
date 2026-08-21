import { render } from '@testing-library/svelte';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// LocatorMap constructs a real maplibre-gl Map in onMount. Rather than rely on
// jsdom's absent WebGL2 context (which the component already tolerates for
// Marker/remove(), per its own comments), mock maplibre-gl/pmtiles so this
// test can assert directly on the options the Map constructor received --
// specifically the zoom clamp under test.
const constructed: Array<{ zoom: number }> = [];
/** Calls the component makes on the map after construction. */
const calls: Array<{ name: string; args: unknown[] }> = [];

vi.mock('maplibre-gl', () => {
  class Map {
    constructor(options: { zoom: number }) {
      constructed.push({ zoom: options.zoom });
    }
    addControl() {
      return this;
    }
    // The uncertainty circle is added on 'load'; fire it synchronously so the
    // test sees the layers the component would really have added.
    on(event: string, cb: () => void) {
      calls.push({ name: 'on', args: [event] });
      if (event === 'load') cb();
      return this;
    }
    addSource(...args: unknown[]) {
      calls.push({ name: 'addSource', args });
      return this;
    }
    addLayer(...args: unknown[]) {
      calls.push({ name: 'addLayer', args });
      return this;
    }
    setFilter(...args: unknown[]) {
      calls.push({ name: 'setFilter', args });
      return this;
    }
    hasImage(...args: unknown[]) {
      calls.push({ name: 'hasImage', args });
      return false;
    }
    addImage(...args: unknown[]) {
      calls.push({ name: 'addImage', args });
      return this;
    }
    getSource(id: string) {
      calls.push({ name: 'getSource', args: [id] });
      return { setData: (data: unknown) => calls.push({ name: 'setData', args: [id, data] }) };
    }
    fitBounds(...args: unknown[]) {
      calls.push({ name: 'fitBounds', args });
      return this;
    }
    remove() {}
  }
  class Marker {
    setLngLat() {
      return this;
    }
    addTo() {
      return this;
    }
  }
  class AttributionControl {}
  return {
    Map,
    Marker,
    AttributionControl,
    addProtocol: vi.fn(),
    removeProtocol: vi.fn(),
    setWorkerUrl: vi.fn()
  };
});

vi.mock('pmtiles', () => {
  class Protocol {
    tile = vi.fn();
  }
  return { Protocol };
});

import LocatorMap from './LocatorMap.svelte';
import { pointAtDistance } from '$lib/map/profile';

beforeEach(() => {
  calls.length = 0;
  constructed.length = 0;
});

describe('LocatorMap zoom clamp', () => {
  it('clamps a low coords.zoom up to 13, the paths layer minzoom floor', () => {
    // Two real routes carry coords.zoom: 11 -- below paths' minzoom of 12 --
    // which rendered a route page with pin but no trail before this fix.
    render(LocatorMap, {  coords: { lat: -33.9, lon: 18.4, zoom: 11 }, title: 'Test Route', routeId: 'a--b--c' });
    expect(constructed).toHaveLength(1);
    expect(constructed[0].zoom).toBe(13);
  });

  it('leaves a coords.zoom already at or above 13 unchanged', () => {
    render(LocatorMap, {  coords: { lat: -33.9, lon: 18.4, zoom: 15 }, title: 'Test Route', routeId: 'a--b--c' });
    expect(constructed).toHaveLength(1);
    expect(constructed[0].zoom).toBe(15);
  });

  it('clamps a coords.zoom of exactly 12 (paths minzoom itself) up to 13', () => {
    render(LocatorMap, {  coords: { lat: -33.9, lon: 18.4, zoom: 12 }, title: 'Test Route', routeId: 'a--b--c' });
    expect(constructed[0].zoom).toBe(13);
  });
});

describe('LocatorMap for an approximate position', () => {
  const coords = { lat: -33.9, lon: 18.4, zoom: 11 };

  it('frames the uncertainty circle instead of zooming to the clamped zoom', () => {
    // A locator map centred at z13 on a position known to +/-3.9 km asserts a
    // precision the coordinate does not have -- the pin would sit in the middle
    // of a view narrower than the error. Frame the circle, and the reader sees
    // the actual claim: somewhere in here.
    render(LocatorMap, {  coords, title: 'Test Route', accuracyM: 3911, routeId: 'a--b--c' });
    const fit = calls.find((c) => c.name === 'fitBounds');
    expect(fit).toBeTruthy();
    const [[[west, south], [east, north]]] = fit!.args as [[[number, number], [number, number]]];
    expect(west).toBeLessThan(coords.lon);
    expect(east).toBeGreaterThan(coords.lon);
    expect(south).toBeLessThan(coords.lat);
    expect(north).toBeGreaterThan(coords.lat);
  });

  it('draws the same uncertainty circle the main map does', () => {
    render(LocatorMap, {  coords, title: 'Test Route', accuracyM: 3911, routeId: 'a--b--c' });
    const layer = calls.find((c) => c.name === 'addLayer');
    expect(layer).toBeTruthy();
    expect(JSON.stringify(layer!.args)).toContain('coordsAccuracyM');
  });

  it('reports the position to a precision the coordinate actually has', () => {
    // Four decimal places is ~11 m. Printing that for a coordinate good to
    // 3.9 km is the most precise-looking claim on the page.
    const { container } = render(LocatorMap, {  coords, title: 'Test Route', accuracyM: 3911, routeId: 'a--b--c' });
    const caption = container.querySelector('figcaption')!.textContent ?? '';
    expect(caption).not.toContain('-33.9000');
    expect(caption).toContain('3.9 km');
  });

  it('leaves a surveyed position at full precision and adds no circle', () => {
    const { container } = render(LocatorMap, {  coords: { ...coords, zoom: 15 }, title: 'Test Route', routeId: 'a--b--c' });
    expect(container.querySelector('figcaption')!.textContent).toContain('-33.9000');
    expect(calls.find((c) => c.name === 'addLayer')).toBeUndefined();
    expect(calls.find((c) => c.name === 'fitBounds')).toBeUndefined();
  });
});

describe('LocatorMap route line', () => {
  const coords = { lat: -33.95, lon: 18.4, zoom: 15 };

  it('filters all three line layers, the route on two and nothing on the active one', async () => {
    // Filtering the line but not its casing leaves a pale halo round nothing,
    // so they move together or not at all.
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      status: 200,
      json: async () => ({ type: 'FeatureCollection', features: [] })
    }));
    render(LocatorMap, { coords, title: 'Kasteelspoort', routeId: 'a--b--c', hasLine: true });
    await vi.waitFor(() => expect(calls.some((c) => c.name === 'setFilter')).toBe(true));
    const filtered = calls.filter((c) => c.name === 'setFilter');
    expect(filtered.map((c) => c.args[0])).toEqual([
      'route-line-arrows',
      'route-line-casing',
      'route-line',
      'route-line-active'
    ]);
    for (const call of filtered.slice(0, 3)) {
      expect(call.args[1]).toEqual(['in', ['get', 'routeId'], ['literal', ['a--b--c']]]);
    }
    // The active layer stays empty here: the route page shows every variant
    // equally beside the text that explains them, with no pointer emphasis.
    expect(filtered[3].args[1]).toEqual(['in', ['get', 'segmentId'], ['literal', []]]);
    vi.unstubAllGlobals();
  });

  it('does not fetch route lines for a route that has none', () => {
    // 160 of 184 routes have no line. Fetching the file on every one of their
    // pages would spend a request to draw nothing.
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    render(LocatorMap, { coords, title: 'X', routeId: 'a--b--c' });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(calls.filter((c) => c.name === 'setFilter')).toEqual([]);
    vi.unstubAllGlobals();
  });
});

describe('LocatorMap scrub marker', () => {
  const coords = { lat: -33.95, lon: 18.4, zoom: 15 };
  // Three points, real spacing, so pointAtDistance has something to interpolate.
  const lineCoords: [number, number, number][] = [
    [18.4, -33.95, 100],
    [18.41, -33.95, 150],
    [18.42, -33.95, 200]
  ];

  function stubLineFetch() {
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: { routeId: 'a--b--c' },
            geometry: { type: 'LineString', coordinates: lineCoords }
          }
        ]
      })
    }));
  }

  it('adds the scrub source and layer once the line has loaded', async () => {
    stubLineFetch();
    render(LocatorMap, { coords, title: 'X', routeId: 'a--b--c', hasLine: true });
    await vi.waitFor(() =>
      expect(calls.some((c) => c.name === 'addSource' && c.args[0] === 'scrub')).toBe(true)
    );
    const layer = calls.find(
      (c) => c.name === 'addLayer' && (c.args[0] as { id: string }).id === 'scrub'
    );
    expect(layer).toBeTruthy();
    vi.unstubAllGlobals();
  });

  it('moves the marker to the point the scrub distance projects onto', async () => {
    stubLineFetch();
    const { rerender } = render(LocatorMap, {
      coords,
      title: 'X',
      routeId: 'a--b--c',
      hasLine: true,
      scrubDistanceM: null,
      lineCoords
    });
    await vi.waitFor(() =>
      expect(calls.some((c) => c.name === 'addSource' && c.args[0] === 'scrub')).toBe(true)
    );
    calls.length = 0; // isolate the setData the prop change below causes

    await rerender({
      coords,
      title: 'X',
      routeId: 'a--b--c',
      hasLine: true,
      scrubDistanceM: 1000,
      lineCoords
    });
    await vi.waitFor(() =>
      expect(calls.some((c) => c.name === 'setData' && c.args[0] === 'scrub')).toBe(true)
    );
    const setData = calls.find((c) => c.name === 'setData' && c.args[0] === 'scrub');
    expect(setData!.args[1]).toEqual({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: pointAtDistance(lineCoords, 1000) },
      properties: {}
    });
    vi.unstubAllGlobals();
  });

  it('frames and rides the line the caller passes, not the first feature in the fetched file', async () => {
    // Two features in the fetched file, in an order that would mislead a
    // component still picking its own variant by `.find()`: the FIRST one
    // here is deliberately NOT the `lineCoords` the caller (the route page)
    // resolved as the ground-distance-longest variant.
    const fileFirst: [number, number, number][] = [
      [18.0, -34.0, 50],
      [18.9, -34.9, 60]
    ];
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: { routeId: 'a--b--c' },
            geometry: { type: 'LineString', coordinates: fileFirst }
          },
          {
            type: 'Feature',
            properties: { routeId: 'a--b--c' },
            geometry: { type: 'LineString', coordinates: lineCoords }
          }
        ]
      })
    }));
    const { rerender } = render(LocatorMap, {
      coords,
      title: 'X',
      routeId: 'a--b--c',
      hasLine: true,
      scrubDistanceM: null,
      lineCoords
    });

    await vi.waitFor(() => expect(calls.some((c) => c.name === 'fitBounds')).toBe(true));
    const fit = calls.find((c) => c.name === 'fitBounds')!;
    const [[[west, south], [east, north]]] = fit.args as [[[number, number], [number, number]]];
    const lons = lineCoords.map((p) => p[0]);
    const lats = lineCoords.map((p) => p[1]);
    expect(west).toBeCloseTo(Math.min(...lons), 6);
    expect(east).toBeCloseTo(Math.max(...lons), 6);
    expect(south).toBeCloseTo(Math.min(...lats), 6);
    expect(north).toBeCloseTo(Math.max(...lats), 6);

    calls.length = 0; // isolate the setData the rerender below causes
    await rerender({
      coords,
      title: 'X',
      routeId: 'a--b--c',
      hasLine: true,
      scrubDistanceM: 1000,
      lineCoords
    });
    await vi.waitFor(() =>
      expect(calls.some((c) => c.name === 'setData' && c.args[0] === 'scrub')).toBe(true)
    );
    const setData = calls.find((c) => c.name === 'setData' && c.args[0] === 'scrub');
    expect(setData!.args[1]).toEqual({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: pointAtDistance(lineCoords, 1000) },
      properties: {}
    });
    vi.unstubAllGlobals();
  });

  it('clears the marker to an empty FeatureCollection when the scrub ends', async () => {
    stubLineFetch();
    const { rerender } = render(LocatorMap, {
      coords,
      title: 'X',
      routeId: 'a--b--c',
      hasLine: true,
      scrubDistanceM: 1000,
      lineCoords
    });
    await vi.waitFor(() =>
      expect(calls.some((c) => c.name === 'addSource' && c.args[0] === 'scrub')).toBe(true)
    );
    calls.length = 0;

    await rerender({
      coords,
      title: 'X',
      routeId: 'a--b--c',
      hasLine: true,
      scrubDistanceM: null,
      lineCoords
    });
    await vi.waitFor(() =>
      expect(calls.some((c) => c.name === 'setData' && c.args[0] === 'scrub')).toBe(true)
    );
    const setData = calls.find((c) => c.name === 'setData' && c.args[0] === 'scrub');
    expect(setData!.args[1]).toEqual({ type: 'FeatureCollection', features: [] });
    vi.unstubAllGlobals();
  });

  it('does not crash setting a scrub distance before the line (and its source) has loaded', () => {
    // No fetch stub: the route has no line, so lineCoords stays empty and the
    // effect's own guard bails before ever asking the map for a 'scrub'
    // source that was never added.
    expect(() =>
      render(LocatorMap, { coords, title: 'X', routeId: 'a--b--c', scrubDistanceM: 500 })
    ).not.toThrow();
  });
});
