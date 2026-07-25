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
});
