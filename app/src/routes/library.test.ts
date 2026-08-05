import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Page from './+page.svelte';
import { clearSelection } from '$lib/map/selection';
import type { RouteContent, RouteIndexEntry } from '$lib/data/types';

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

describe('library page selection', () => {
  const content: RouteContent = {
    ...entries[0],
    sections: { Overview: 'A long walk up a big hill.' },
    description: 'Overview:\nA long walk up a big hill.',
    related: [], attachments: [], photoCount: 0,
    sourceUrl: 'https://example.invalid/route'
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
