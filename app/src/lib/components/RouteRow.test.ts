import { render, screen, fireEvent } from '@testing-library/svelte';
import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import RouteRow from './RouteRow.svelte';
import type { RouteIndexEntry } from '../data/types';
import { selection, clearSelection } from '../map/selection';

const located: RouteIndexEntry = { id: 'a', title: 'Blind Gully', area: ['x'],
  coords: { lat: 0, lon: 0, zoom: 1 }, coordsSource: 'crawl', coordsAccuracyM: null, coordsOsm: null,
  mentionedPaths: [],
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
    render(RouteRow, { route: { ...located, coords: null, coordsSource: null }, done: false });
    expect(screen.getByLabelText('no location')).toBeTruthy();
  });

  it('flags an approximate location distinctly from an absent one', () => {
    // Three states, three appearances: approximate is not the same as absent,
    // and both differ from a surveyed position. Before Phase 4c an area-approx
    // route was gated out of the data entirely and so wore the "no location"
    // glyph, which is now the wrong claim -- it has a location, just a loose one.
    render(RouteRow, {
      route: { ...located, coordsSource: 'area-approx', coordsAccuracyM: 3911 },
      done: false
    });
    expect(screen.getByLabelText('approximate location')).toBeTruthy();
    expect(screen.queryByLabelText('no location')).toBeNull();
  });

  it('gives a surveyed route no location glyph at all', () => {
    render(RouteRow, { route: located, done: false });
    expect(screen.queryByLabelText('no location')).toBeNull();
    expect(screen.queryByLabelText('approximate location')).toBeNull();
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

describe('RouteRow click behaviour with a preview panel', () => {
  function clickWith(init: MouseEventInit): MouseEvent {
    render(RouteRow, { route: located, done: false });
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true, ...init });
    screen.getByTestId('route-link').dispatchEvent(ev);
    return ev;
  }

  it('suppresses navigation on a plain click, so the preview can open in place', () => {
    // The panel now previews the route without leaving the map; navigating on
    // every click would replace that preview before it could be read.
    const ev = clickWith({});
    expect(ev.defaultPrevented).toBe(true);
    expect(get(selection).selectedId).toBe('a');
  });

  it.each([
    ['ctrlKey', { ctrlKey: true }],
    ['metaKey', { metaKey: true }],
    ['shiftKey', { shiftKey: true }],
    ['altKey', { altKey: true }]
  ])('lets a %s click navigate as an ordinary link', (_name, init) => {
    // This is why the row stays an <a href> rather than becoming a <button>:
    // open-in-new-tab/window and "copy link address" keep working.
    const ev = clickWith(init);
    expect(ev.defaultPrevented).toBe(false);
  });
});
