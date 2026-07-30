import { render, screen, fireEvent } from '@testing-library/svelte';
import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import RouteRow from './RouteRow.svelte';
import type { RouteIndexEntry } from '../data/types';
import { selection, clearSelection } from '../map/selection';

const located: RouteIndexEntry = { id: 'a', title: 'Blind Gully', area: ['x'],
  coords: { lat: 0, lon: 0, zoom: 1 }, coordsSource: 'crawl', coordsAccuracyM: null, coordsOsm: null,
  grade: '3 ***', gradeSource: 'label', time: null, heightGain: null, isFullEntry: true };

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

beforeEach(() => clearSelection());

describe('RouteRow selection wiring', () => {
  it('reports a hover to the selection store', async () => {
    render(RouteRow, { route: located, done: false });
    await fireEvent.mouseEnter(screen.getByTestId('route-link'));
    expect(get(selection).hoveredId).toBe('a');
  });

  it('clears the hover on mouse leave', async () => {
    render(RouteRow, { route: located, done: false });
    const row = screen.getByTestId('route-link');
    await fireEvent.mouseEnter(row);
    await fireEvent.mouseLeave(row);
    expect(get(selection).hoveredId).toBeNull();
  });

  it('reports a click as a selection', async () => {
    render(RouteRow, { route: located, done: false });
    await fireEvent.click(screen.getByTestId('route-link'));
    expect(get(selection).selectedId).toBe('a');
  });

  it('marks itself current when it is the selected row', async () => {
    render(RouteRow, { route: located, done: false });
    await fireEvent.click(screen.getByTestId('route-link'));
    expect(screen.getByTestId('route-link').getAttribute('aria-current')).toBe('true');
  });

  it('does not claim to be current merely because it is hovered', async () => {
    // aria-current marks a single current item; a transient hover is not that.
    render(RouteRow, { route: located, done: false });
    const row = screen.getByTestId('route-link');
    await fireEvent.mouseEnter(row);
    expect(row.getAttribute('aria-current')).toBeNull();
    expect(row.className).toContain('hovered');
  });

  it('shows hover and selection as different states', async () => {
    render(RouteRow, { route: located, done: false });
    const row = screen.getByTestId('route-link');
    await fireEvent.click(row);
    // Selecting clears the hover, so only the selected class remains.
    expect(row.className).toContain('selected');
    expect(row.className).not.toContain('hovered');
  });

  it('still links to the route page', () => {
    render(RouteRow, { route: located, done: false });
    expect(screen.getByTestId('route-link').getAttribute('href')).toContain('/route/a');
  });
});
