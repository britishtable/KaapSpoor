import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { selection, setHovered, setSelected, clearSelection } from './selection';

beforeEach(() => clearSelection());

describe('selection store', () => {
  it('starts with nothing hovered or selected', () => {
    expect(get(selection)).toEqual({ hoveredId: null, selectedId: null });
  });
  it('tracks the hovered route', () => {
    setHovered('a');
    expect(get(selection).hoveredId).toBe('a');
  });
  it('tracks the selected route', () => {
    setSelected('b');
    expect(get(selection).selectedId).toBe('b');
  });
  it('clears hover when a selection is made, so no stale highlight remains', () => {
    setHovered('a');
    setSelected('b');
    expect(get(selection)).toEqual({ hoveredId: null, selectedId: 'b' });
  });
  it('accepts null to clear the hover', () => {
    setHovered('a');
    setHovered(null);
    expect(get(selection).hoveredId).toBeNull();
  });
  it('accepts null to clear the selection', () => {
    setSelected('b');
    setSelected(null);
    expect(get(selection).selectedId).toBeNull();
  });
  it('clearSelection resets populated state, not just empty state', () => {
    setSelected('b');
    setHovered('a');
    clearSelection();
    expect(get(selection)).toEqual({ hoveredId: null, selectedId: null });
  });
  it('exposes no setter, so the setters remain the only way to mutate', () => {
    expect('set' in selection).toBe(false);
    expect('update' in selection).toBe(false);
  });
});
