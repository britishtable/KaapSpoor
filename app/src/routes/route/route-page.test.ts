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
  segments: [],
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
  const MAIN_ID = `${route.id}/main/main`;
  const located = {
    ...route,
    hasLine: true,
    coords: { lat: -33.95, lon: 18.4, zoom: 15 },
    segments: [{ segmentId: MAIN_ID, role: 'main' as const, name: null, note: null }]
  };

  const mainCoords: Point3[] = [
    [18.4, -33.95, 100],
    [18.5, -33.95, 300]
  ];

  function stubLineFetch(coords: number[][]) {
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: { routeId: located.id, segmentId: MAIN_ID, role: 'main' },
            geometry: { type: 'LineString', coordinates: coords }
          }
        ]
      })
    }));
  }

  it('plots the elevation profile from the route line it fetches', async () => {
    stubLineFetch(mainCoords);
    render(Page, { data: { route: located } });
    await vi.waitFor(() => expect(screen.getByTestId('profile-line')).toBeTruthy());
    const expectedKm = (totalDistanceM(mainCoords) / 1000).toFixed(1);
    // Both the profile's figcaption and the plan's total show this figure
    // when the plan is just the one main segment, so allow either.
    expect(screen.getAllByText(new RegExp(`${expectedKm} km`)).length).toBeGreaterThan(0);
    vi.unstubAllGlobals();
  });

  it('carries the scrub position from the profile down to the locator map', async () => {
    stubLineFetch(mainCoords);
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
    const total = totalDistanceM(mainCoords);
    const expected = pointAtDistance(mainCoords, total / 40);
    expect(feature.geometry.coordinates[0]).toBeCloseTo(expected[0], 5);
    expect(feature.geometry.coordinates[1]).toBeCloseTo(expected[1], 5);
    vi.unstubAllGlobals();
  });
});

const ID = 'tm-aw-blind-gully';
const P = (lon: number, h: number) => [lon, -33.96, h];

const SEGMENT_META = [
  { segmentId: `${ID}/approach/via-kasteelspoort`, role: 'approach' as const,
    name: 'via Kasteelspoort', note: null },
  { segmentId: `${ID}/approach/via-diagonal`, role: 'approach' as const,
    name: 'via Diagonal', note: null },
  { segmentId: `${ID}/main/main`, role: 'main' as const, name: 'Blind Gully', note: null }
];

const GEOJSON = {
  features: [
    { geometry: { coordinates: [P(18.40, 50), P(18.41, 300)] },
      properties: { routeId: ID, segmentId: SEGMENT_META[0].segmentId, role: 'approach' } },
    { geometry: { coordinates: [P(18.39, 60), P(18.41, 300)] },
      properties: { routeId: ID, segmentId: SEGMENT_META[1].segmentId, role: 'approach' } },
    { geometry: { coordinates: [P(18.41, 300), P(18.43, 500)] },
      properties: { routeId: ID, segmentId: SEGMENT_META[2].segmentId, role: 'main' } }
  ]
};

const drawn = { ...route, hasLine: true, segments: SEGMENT_META };

/** Let the page's fetch of route-lines.geojson resolve, then settle Svelte. */
async function settle() {
  await vi.waitFor(() => expect(screen.getByLabelText('Approach')).toBeTruthy());
}

describe('the route page plan', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => GEOJSON })));
    window.history.replaceState({}, '', `/route/${ID}`);
  });

  it('defaults to the first approach that meets the main', async () => {
    render(Page, { data: { route: drawn } });
    await settle();
    const select = screen.getByLabelText('Approach') as HTMLSelectElement;
    expect(select.value).toBe(SEGMENT_META[0].segmentId);
  });

  it('reads its opening choice out of the URL, so a shared plan arrives intact', async () => {
    window.history.replaceState({}, '', `/route/${ID}?a=${encodeURIComponent(SEGMENT_META[1].segmentId)}`);
    render(Page, { data: { route: drawn } });
    await settle();
    const select = screen.getByLabelText('Approach') as HTMLSelectElement;
    expect(select.value).toBe(SEGMENT_META[1].segmentId);
  });

  it('writes the choice back to the URL when the reader changes it', async () => {
    render(Page, { data: { route: drawn } });
    await settle();
    await fireEvent.change(screen.getByLabelText('Approach'), {
      target: { value: SEGMENT_META[1].segmentId }
    });
    expect(decodeURIComponent(window.location.search)).toContain(SEGMENT_META[1].segmentId);
  });

  it('totals the whole plan, not the main alone', async () => {
    render(Page, { data: { route: drawn } });
    await settle();
    // Approach climbs 250 m, main climbs 200 m. The main alone would say 200.
    expect(screen.getByText(/↑ 450 m/)).toBeTruthy();
  });

  it('shows no plan for a route with nothing drawn', () => {
    render(Page, { data: { route } }); // hasLine: false, segments: []
    expect(screen.queryByLabelText('Approach')).toBeNull();
  });
});
