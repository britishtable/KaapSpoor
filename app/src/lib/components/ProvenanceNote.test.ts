import { render, screen } from '@testing-library/svelte';
import { describe, it, expect } from 'vitest';
import ProvenanceNote from './ProvenanceNote.svelte';
import type { RouteIndexEntry } from '../data/types';

const base: RouteIndexEntry = { id: 'a', title: 'Blind Gully', area: ['x'],
  coords: { lat: 0, lon: 0, zoom: 1 }, coordsSource: 'crawl', coordsAccuracyM: null, coordsOsm: null,
  mentionedPaths: [],
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
