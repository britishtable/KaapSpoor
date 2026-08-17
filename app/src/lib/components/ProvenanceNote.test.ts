import { render, screen } from '@testing-library/svelte';
import { describe, it, expect } from 'vitest';
import ProvenanceNote from './ProvenanceNote.svelte';
import type { RouteIndexEntry } from '../data/types';

const base: RouteIndexEntry = { id: 'a', title: 'Blind Gully', area: ['x'],
  coords: { lat: 0, lon: 0, zoom: 1 }, coordsSource: 'crawl', coordsAccuracyM: null, coordsOsm: null,
  mentionedPaths: [],
  lineSource: null,
  hasLine: false,
  grade: null, gradeSource: null, time: null, heightGain: null, isFullEntry: true };

describe('ProvenanceNote', () => {
  it('states a crawl-sourced location', () => {
    render(ProvenanceNote, { route: { ...base, coordsSource: 'crawl' } });
    expect(screen.getByText('Location from the Mountain Meanders page.')).toBeTruthy();
  });

  it('states a curated location', () => {
    render(ProvenanceNote, { route: { ...base, coordsSource: 'curated' } });
    expect(screen.getByText('Location checked and corrected by hand.')).toBeTruthy();
  });

  it('states an osm-match location and names the matched feature', () => {
    render(ProvenanceNote, {
      route: { ...base, coordsSource: 'osm-match', coordsOsm: { type: 'node', id: 1, name: 'Blind Gully Ravine' } }
    });
    expect(screen.getByText('Location matched to “Blind Gully Ravine” in OpenStreetMap.')).toBeTruthy();
  });

  it('states an area-approx location with the rounded radius in km', () => {
    render(ProvenanceNote, { route: { ...base, coordsSource: 'area-approx', coordsAccuracyM: 3162 } });
    expect(
      screen.getByText('Approximate — somewhere within about 3.2 km of this point, averaged from other routes in this area.')
    ).toBeTruthy();
  });

  it('states that a null-source location was not recorded', () => {
    render(ProvenanceNote, { route: { ...base, coords: null, coordsSource: null } });
    expect(screen.getByText('Location not recorded.')).toBeTruthy();
  });

  it('states an area-approx location without a radius when accuracy is missing', () => {
    render(ProvenanceNote, { route: { ...base, coordsSource: 'area-approx', coordsAccuracyM: null } });
    expect(
      screen.getByText('Approximate — averaged from other routes in this area.')
    ).toBeTruthy();
    expect(screen.queryByText(/0\.0/)).toBeNull();
    expect(screen.queryByText(/within/)).toBeNull();
  });

  it('states an osm-match location without a name when coordsOsm is missing', () => {
    render(ProvenanceNote, { route: { ...base, coordsSource: 'osm-match', coordsOsm: null } });
    expect(screen.getByText('Location matched to a feature in OpenStreetMap.')).toBeTruthy();
    expect(screen.queryByText(/undefined/)).toBeNull();
  });
});

describe('how the line is known', () => {
  const entry = (overrides: Partial<RouteIndexEntry>): RouteIndexEntry => ({ ...base, ...overrides });

  it('says when a line came from a mapper-authored hiking route', () => {
    render(ProvenanceNote, { route: entry({ hasLine: true, lineSource: 'osm-relation' }) });
    expect(screen.getByTestId('line-provenance').textContent).toMatch(
      /hiking route in OpenStreetMap/i
    );
  });

  it('says when a line was stitched from the order the description names paths', () => {
    render(ProvenanceNote, { route: entry({ hasLine: true, lineSource: 'osm-stitch' }) });
    expect(screen.getByTestId('line-provenance').textContent).toMatch(
      /order this description names them/i
    );
  });

  it('says nothing at all when there is no line', () => {
    // The absence of a line is not an error to explain on every page — 160 of
    // 184 routes have none, and a sentence on each would be noise.
    render(ProvenanceNote, { route: entry({ hasLine: false, lineSource: null }) });
    expect(screen.queryByTestId('line-provenance')).toBeNull();
  });
});
