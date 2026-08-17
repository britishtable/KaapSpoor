import { render, screen, fireEvent } from '@testing-library/svelte';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { totalDistanceM, pointAtDistance, type Point3 } from '$lib/map/profile';
import { replaceAll } from '$lib/journal/store';
import type { RouteContent } from '$lib/data/types';
import Page from './[id]/+page.svelte';

// The route page's LocatorMap constructs a real maplibre-gl Map. Mock it the
// same way LocatorMap.test.ts does, so a 'scrub' source/layer and the calls
// the page's scrubDistanceM prop drives are observable without WebGL.
const calls: Array<{ name: string; args: unknown[] }> = [];

vi.mock('maplibre-gl', () => {
  class Map {
    constructor() {}
    addControl() {
      return this;
    }
    on(event: string, cb: () => void) {
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
    hasImage() {
      return false;
    }
    addImage() {
      return this;
    }
    getSource(id: string) {
      return { setData: (data: unknown) => calls.push({ name: 'setData', args: [id, data] }) };
    }
    fitBounds() {
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

const route: RouteContent = {
  id: 'tm-aw-blind-gully', title: 'Blind Gully', area: ['Table-Mountain', 'atlantic-west'],
  coords: null, coordsSource: null, coordsAccuracyM: null, coordsOsm: null,
  mentionedPaths: [],
  hasLine: false,
  grade: 'B', gradeSource: 'prose', time: null, heightGain: null, isFullEntry: false,
  sections: { Overview: 'A scramble.' }, description: 'A scramble.',
  related: [], attachments: [], photoCount: 2, sourceUrl: 'https://example.invalid',
  lines: [],
  lineStats: null
};

beforeEach(async () => {
  await replaceAll([]);
  calls.length = 0;
});

describe('route page', () => {
  it('shows the title, prose-grade caveat, and unmapped note', () => {
    render(Page, { data: { route } });
    expect(screen.getByRole('heading', { name: 'Blind Gully' })).toBeTruthy();
    expect(screen.getByText('Location not recorded.')).toBeTruthy();
    expect(screen.getByText('~')).toBeTruthy();
  });

  it('shows a locator map for a located route', () => {
    const located = { ...route, coords: { lat: -33.97, lon: 18.39, zoom: 16 } };
    render(Page, { data: { route: located } });
    expect(screen.getByTestId('locator-map')).toBeTruthy();
  });

  it('states the coordinates as text, not only as a map', () => {
    // A map conveys position only to sighted users on WebGL-capable devices;
    // the text keeps that information available to everyone.
    const located = { ...route, coords: { lat: -33.97, lon: 18.39, zoom: 16 } };
    render(Page, { data: { route: located } });
    expect(screen.getByText('-33.9700, 18.3900')).toBeTruthy();
  });

  it('shows no locator map when the route has no coordinates', () => {
    render(Page, { data: { route } }); // route fixture has coords: null
    expect(screen.queryByTestId('locator-map')).toBeNull();
    expect(screen.getByText('Location not recorded.')).toBeTruthy();
  });

  it('states how a located route was positioned, not merely where', () => {
    const located = {
      ...route,
      coords: { lat: -33.97, lon: 18.39, zoom: 16 },
      coordsSource: 'crawl' as const
    };
    render(Page, { data: { route: located } });
    expect(screen.getByText('Location from the Mountain Meanders page.')).toBeTruthy();
  });

  it('qualifies an approximate position rather than presenting it as a point', () => {
    // The route page and the map preview say this in the same words, because
    // they render the same component.
    const approx = {
      ...route,
      coords: { lat: -33.97, lon: 18.39, zoom: 11 },
      coordsSource: 'area-approx' as const,
      coordsAccuracyM: 3911
    };
    render(Page, { data: { route: approx } });
    expect(
      screen.getByText(
        'Approximate — somewhere within about 3.9 km of this point, averaged from other routes in this area.'
      )
    ).toBeTruthy();
    // ...and the coordinates are not restated to 11-metre precision beneath it.
    expect(screen.queryByText('-33.9700, 18.3900')).toBeNull();
  });
});

describe('route page elevation profile', () => {
  const located = { ...route, hasLine: true, coords: { lat: -33.95, lon: 18.4, zoom: 15 } };

  // Fewer points, but the greater real-ground distance -- the variant
  // transform.ts's totalDistanceM-based selection would pick.
  const distanceLonger: Point3[] = [
    [18.4, -33.95, 100],
    [18.5, -33.95, 300]
  ];
  // More points, but they sit close together -- a shorter walk that an
  // array-length comparison would wrongly prefer.
  const arrayLonger: Point3[] = [
    [18.41, -33.96, 100],
    [18.4102, -33.96, 105],
    [18.4104, -33.96, 108],
    [18.4106, -33.96, 110],
    [18.4108, -33.96, 112]
  ];

  function stubLineFetch(features: { coordinates: number[][] }[]) {
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        type: 'FeatureCollection',
        features: features.map((f) => ({
          type: 'Feature',
          properties: { routeId: located.id },
          geometry: { type: 'LineString', coordinates: f.coordinates }
        }))
      })
    }));
  }

  it('plots the elevation profile from the route line it fetches', async () => {
    stubLineFetch([{ coordinates: distanceLonger }]);
    render(Page, { data: { route: located } });
    await vi.waitFor(() => expect(screen.getByTestId('profile-line')).toBeTruthy());
    const expectedKm = (totalDistanceM(distanceLonger) / 1000).toFixed(1);
    expect(screen.getByText(new RegExp(`${expectedKm} km`))).toBeTruthy();
    vi.unstubAllGlobals();
  });

  it('picks the variant that goes furthest on the ground, not the one with more points', async () => {
    // Order matters for the array-length bug: arrayLonger sorts first by
    // coordinate count, so this only catches a regression if the page really
    // measures ground distance rather than array length.
    stubLineFetch([{ coordinates: arrayLonger }, { coordinates: distanceLonger }]);
    render(Page, { data: { route: located } });
    await vi.waitFor(() => expect(screen.getByTestId('profile-line')).toBeTruthy());
    const distanceKm = (totalDistanceM(distanceLonger) / 1000).toFixed(1);
    const arrayKm = (totalDistanceM(arrayLonger) / 1000).toFixed(1);
    expect(screen.getByText(new RegExp(`${distanceKm} km`))).toBeTruthy();
    expect(screen.queryByText(new RegExp(`${arrayKm} km`))).toBeNull();
    vi.unstubAllGlobals();
  });

  it('carries the scrub position from the profile down to the locator map', async () => {
    // Both variants stubbed, arrayLonger first: if the locator map ever goes
    // back to selecting its own variant (e.g. by array order or point
    // count), the scrub dot would land on arrayLonger's line instead of the
    // distance-longest one the profile actually plots.
    stubLineFetch([{ coordinates: arrayLonger }, { coordinates: distanceLonger }]);
    render(Page, { data: { route: located } });
    const slider = await screen.findByRole('slider');
    await vi.waitFor(() =>
      expect(calls.some((c) => c.name === 'addSource' && c.args[0] === 'scrub')).toBe(true)
    );
    calls.length = 0;

    await fireEvent.keyDown(slider, { key: 'ArrowRight' });

    await vi.waitFor(() =>
      expect(calls.some((c) => c.name === 'setData' && c.args[0] === 'scrub')).toBe(true)
    );
    const setData = calls.find((c) => c.name === 'setData' && c.args[0] === 'scrub');
    const feature = setData!.args[1] as { geometry: { coordinates: [number, number] } };
    // One fortieth of the total, per RouteProfile's own step size -- the same
    // distance the marker moves to, wherever pointAtDistance projects it.
    const total = totalDistanceM(distanceLonger);
    const expected = pointAtDistance(distanceLonger, total / 40);
    expect(feature.geometry.coordinates[0]).toBeCloseTo(expected[0], 5);
    expect(feature.geometry.coordinates[1]).toBeCloseTo(expected[1], 5);
    vi.unstubAllGlobals();
  });
});
