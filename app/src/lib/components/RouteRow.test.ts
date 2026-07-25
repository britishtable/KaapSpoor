import { render, screen } from '@testing-library/svelte';
import { describe, it, expect } from 'vitest';
import RouteRow from './RouteRow.svelte';
import type { RouteIndexEntry } from '../data/types';

const located: RouteIndexEntry = { id: 'a', title: 'Blind Gully', area: ['x'],
  coords: { lat: 0, lon: 0, zoom: 1 }, grade: '3 ***', gradeSource: 'label',
  time: null, heightGain: null, isFullEntry: true };

describe('RouteRow', () => {
  it('links to the route page and shows the title', () => {
    render(RouteRow, { route: located, done: false });
    const link = screen.getByRole('link', { name: /Blind Gully/ });
    expect(link.getAttribute('href')).toContain('/route/a');
  });
  it('marks done routes', () => {
    render(RouteRow, { route: located, done: true });
    expect(screen.getByLabelText('done')).toBeTruthy();
  });
  it('flags routes with no location', () => {
    render(RouteRow, { route: { ...located, coords: null }, done: false });
    expect(screen.getByLabelText('no location')).toBeTruthy();
  });
});
