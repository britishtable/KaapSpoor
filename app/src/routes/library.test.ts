import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Page from './+page.svelte';
import { clearSelection } from '$lib/map/selection';
import type { RouteContent, RouteIndexEntry } from '$lib/data/types';

// Real Table Mountain coordinates, not 0,0: the page only offers routes the
// shipped region covers (see entriesInRegion), and 0,0 is in the Gulf of Guinea.
const entries: RouteIndexEntry[] = [
  { id: 'tm-aw-blind-gully', title: 'Blind Gully', area: ['Table-Mountain', 'atlantic-west'],
    coords: { lat: -33.97, lon: 18.39, zoom: 15 }, coordsSource: 'crawl', coordsAccuracyM: null, coordsOsm: null,
    mentionedPaths: [],
    hasLine: false,
    grade: '3 ***', gradeSource: 'label', time: null, heightGain: null, isFullEntry: true }
];

describe('library page', () => {
  it('renders the area tree from loaded entries', () => {
    render(Page, { data: { entries } });
    expect(screen.getByRole('heading', { name: /KaapSpoor/i })).toBeTruthy();
    expect(screen.getByText('Table Mountain')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Blind Gully/ })).toBeTruthy();
  });

  it('offers only areas the shipped region covers', () => {
    // The camera is clamped to the region and no basemap exists beyond it, so
    // listing Cape Country offered 51 routes that could never be reached.
    const capeCountry: RouteIndexEntry = {
      ...entries[0], id: 'cc-swartberg', title: 'Swartberg', area: ['cape-country', 'cape-karoo'],
      coords: { lat: -33.35, lon: 22.05, zoom: 15 }
    };
    render(Page, { data: { entries: [...entries, capeCountry] } });
    expect(screen.getByRole('link', { name: /Blind Gully/ })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Swartberg/ })).toBeNull();
    expect(screen.queryByText('Cape Country')).toBeNull();
  });

  it('lists unlocated routes alongside located ones, since the map cannot show them', () => {
    const unlocated = { ...entries[0], id: 'nowhere', title: 'Nowhere', coords: null };
    render(Page, { data: { entries: [...entries, unlocated] } });
    expect(screen.getByRole('link', { name: /Nowhere/ })).toBeTruthy();
    expect(screen.getAllByLabelText('no location').length).toBe(1);
  });
});

describe('library page selection', () => {
  const content: RouteContent = {
    ...entries[0],
    sections: { Overview: 'A long walk up a big hill.' },
    description: 'Overview:\nA long walk up a big hill.',
    related: [], attachments: [], photoCount: 0,
    sourceUrl: 'https://example.invalid/route',
    segments: [],
    lineStats: null
  };

  beforeEach(() => {
    clearSelection();
    vi.stubGlobal('fetch', async () => ({
      ok: true, status: 200, json: async () => content
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearSelection();
  });

  it('shows the route tree and no preview when nothing is selected', () => {
    render(Page, { data: { entries } });
    expect(screen.getByTestId('route-link')).toBeTruthy();
    expect(screen.queryByLabelText('Route preview')).toBeNull();
  });

  it('swaps the panel to the preview when a route is selected', async () => {
    render(Page, { data: { entries } });
    await fireEvent.click(screen.getByTestId('route-link'));

    await waitFor(() => expect(screen.getByTestId('preview-body')).toBeTruthy());
    expect(screen.getByRole('heading', { name: 'Blind Gully' })).toBeTruthy();
    // The tree and the filters give way to the preview: leaving the search box
    // up would let the user filter the very route they are reading out of the list.
    expect(screen.queryByTestId('route-link')).toBeNull();
    expect(screen.queryByLabelText('Search routes')).toBeNull();
  });

  it('returns to the tree when the preview is closed', async () => {
    render(Page, { data: { entries } });
    await fireEvent.click(screen.getByTestId('route-link'));
    await waitFor(() => expect(screen.getByTestId('preview-body')).toBeTruthy());

    await fireEvent.click(screen.getByRole('button', { name: /close/i }));

    await waitFor(() => expect(screen.getByTestId('route-link')).toBeTruthy());
    expect(screen.queryByLabelText('Route preview')).toBeNull();
    expect(screen.getByLabelText('Search routes')).toBeTruthy();
  });
});
