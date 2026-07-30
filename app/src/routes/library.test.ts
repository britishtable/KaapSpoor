import { render, screen } from '@testing-library/svelte';
import { describe, it, expect } from 'vitest';
import Page from './+page.svelte';
import type { RouteIndexEntry } from '$lib/data/types';

const entries: RouteIndexEntry[] = [
  { id: 'tm-aw-blind-gully', title: 'Blind Gully', area: ['Table-Mountain', 'atlantic-west'],
    coords: { lat: 0, lon: 0, zoom: 1 }, coordsSource: 'crawl', coordsAccuracyM: null, coordsOsm: null,
    grade: '3 ***', gradeSource: 'label', time: null, heightGain: null, isFullEntry: true }
];

describe('library page', () => {
  it('renders the area tree from loaded entries', () => {
    render(Page, { data: { entries } });
    expect(screen.getByRole('heading', { name: /KaapSpoor/i })).toBeTruthy();
    expect(screen.getByText('Table Mountain')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Blind Gully/ })).toBeTruthy();
  });

  it('lists unlocated routes alongside located ones, since the map cannot show them', () => {
    const unlocated = { ...entries[0], id: 'nowhere', title: 'Nowhere', coords: null };
    render(Page, { data: { entries: [...entries, unlocated] } });
    expect(screen.getByRole('link', { name: /Nowhere/ })).toBeTruthy();
    expect(screen.getAllByLabelText('no location').length).toBe(1);
  });
});
