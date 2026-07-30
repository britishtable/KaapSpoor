import { render } from '@testing-library/svelte';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// LocatorMap constructs a real maplibre-gl Map in onMount. Rather than rely on
// jsdom's absent WebGL2 context (which the component already tolerates for
// Marker/remove(), per its own comments), mock maplibre-gl/pmtiles so this
// test can assert directly on the options the Map constructor received --
// specifically the zoom clamp under test.
const constructed: Array<{ zoom: number }> = [];

vi.mock('maplibre-gl', () => {
  class Map {
    constructor(options: { zoom: number }) {
      constructed.push({ zoom: options.zoom });
    }
    addControl() {
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
  constructed.length = 0;
});

describe('LocatorMap zoom clamp', () => {
  it('clamps a low coords.zoom up to 13, the paths layer minzoom floor', () => {
    // Two real routes carry coords.zoom: 11 -- below paths' minzoom of 12 --
    // which rendered a route page with pin but no trail before this fix.
    render(LocatorMap, { coords: { lat: -33.9, lon: 18.4, zoom: 11 }, title: 'Test Route' });
    expect(constructed).toHaveLength(1);
    expect(constructed[0].zoom).toBe(13);
  });

  it('leaves a coords.zoom already at or above 13 unchanged', () => {
    render(LocatorMap, { coords: { lat: -33.9, lon: 18.4, zoom: 15 }, title: 'Test Route' });
    expect(constructed).toHaveLength(1);
    expect(constructed[0].zoom).toBe(15);
  });

  it('clamps a coords.zoom of exactly 12 (paths minzoom itself) up to 13', () => {
    render(LocatorMap, { coords: { lat: -33.9, lon: 18.4, zoom: 12 }, title: 'Test Route' });
    expect(constructed[0].zoom).toBe(13);
  });
});
