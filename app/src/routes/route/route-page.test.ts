import { render, screen } from '@testing-library/svelte';
import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import Page from './[id]/+page.svelte';
import { replaceAll } from '$lib/journal/store';
import type { RouteContent } from '$lib/data/types';

const route: RouteContent = {
  id: 'tm-aw-blind-gully', title: 'Blind Gully', area: ['Table-Mountain', 'atlantic-west'],
  coords: null, grade: 'B', gradeSource: 'prose', time: null, heightGain: null, isFullEntry: false,
  sections: { Overview: 'A scramble.' }, description: 'A scramble.',
  related: [], attachments: [], photoCount: 2, sourceUrl: 'https://example.invalid'
};

beforeEach(async () => { await replaceAll([]); });

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
});
