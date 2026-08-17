import { render, screen, fireEvent } from '@testing-library/svelte';
import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import RouteVariants from './RouteVariants.svelte';
import { selection, clearSelection } from '$lib/map/selection';

beforeEach(() => clearSelection());

describe('RouteVariants', () => {
  it('says nothing when the route has no drawn line', () => {
    const { container } = render(RouteVariants, { lines: [] });
    expect(container.textContent?.trim()).toBe('');
  });

  it('says nothing when there is one unnamed line, which needs no list', () => {
    // The map is already showing it; a list of one tells the reader nothing.
    render(RouteVariants, { lines: [{ variant: null, note: null }] });
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('lists each alternative with the caption that explains it', () => {
    render(RouteVariants, {
      lines: [
        { variant: 'Left Hand', note: 'The original line.' },
        { variant: 'Right Hand', note: 'Steeper.' }
      ]
    });
    expect(screen.getByText('Ways up this route')).toBeTruthy();
    expect(screen.getByText('Left Hand')).toBeTruthy();
    expect(screen.getByText('The original line.')).toBeTruthy();
    expect(screen.getByText('Right Hand')).toBeTruthy();
  });

  it('tells the map which alternative is being read', () => {
    render(RouteVariants, {
      lines: [{ variant: 'Left Hand', note: '' }, { variant: 'Right Hand', note: '' }]
    });
    // mouseenter does not bubble, so it must be fired on the row that
    // listens, not on the label inside it.
    fireEvent.mouseEnter(screen.getByText('Right Hand').closest('li')!);
    expect(get(selection).hoveredVariant).toBe('Right Hand');
  });
});
