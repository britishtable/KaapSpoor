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

  it('filters both line layers to the route it is drawing', async () => {
    // Filtering the line but not its casing leaves a pale halo round nothing,
    // so both move together or neither does.
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      status: 200,
      json: async () => ({ type: 'FeatureCollection', features: [] })
    }));
    render(LocatorMap, { coords, title: 'Kasteelspoort', routeId: 'a--b--c', hasLine: true });
    await vi.waitFor(() => expect(calls.some((c) => c.name === 'setFilter')).toBe(true));
    const filtered = calls.filter((c) => c.name === 'setFilter');
    expect(filtered.map((c) => c.args[0])).toEqual(['route-line-casing', 'route-line']);
    for (const call of filtered) {
      expect(call.args[1]).toEqual(['in', ['get', 'routeId'], ['literal', ['a--b--c']]]);
    }
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
