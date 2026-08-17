import { describe, it, expect } from 'vitest';
import {
  newVariant, variantCoords, undoLeg, toFeatures, fromFeatures,
  type Variant
} from './state';
import type { Point } from '../map/snap';

const A: Point = [18.400, -34.000];
const B: Point = [18.410, -34.000];
const C: Point = [18.420, -34.000];

const drawnVariant = (): Variant => ({
  name: 'Right Hand',
  note: 'The 1952 line.',
  legs: [
    { at: A, coords: [A] },
    { at: B, coords: [A, B] },
    { at: C, coords: [B, C] }
  ]
});

describe('variantCoords', () => {
  it('joins the legs into one line without repeating the shared point', () => {
    expect(variantCoords(drawnVariant())).toEqual([A, B, C]);
  });

  it('is empty for a variant nothing has been clicked into yet', () => {
    expect(variantCoords(newVariant())).toEqual([]);
  });
});

describe('undoLeg', () => {
  it('takes back the last click and the trail it added', () => {
    expect(variantCoords(undoLeg(drawnVariant()))).toEqual([A, B]);
  });

  it('does nothing to an empty variant, rather than throwing', () => {
    expect(undoLeg(newVariant()).legs).toEqual([]);
  });
});

describe('toFeatures', () => {
  it('writes one feature per variant, carrying its name and note', () => {
    const second = { ...drawnVariant(), name: 'Left Hand' };
    const [feature] = toFeatures('area--x', [drawnVariant(), second], '2026-08-17');
    expect(feature.geometry.coordinates).toEqual([A, B, C]);
    expect(feature.properties).toEqual({
      routeId: 'area--x', variant: 'Right Hand', note: 'The 1952 line.', drawn: '2026-08-17'
    });
  });

  it('omits a variant with fewer than two points, which is not a line', () => {
    const barely = { ...newVariant(), legs: [{ at: A, coords: [A] }] };
    expect(toFeatures('area--x', [barely], '2026-08-17')).toEqual([]);
  });

  it('leaves name and note off a single unnamed variant', () => {
    // One line needs no label, and an empty string in the file would render as
    // a blank chip in the panel.
    const only = { ...newVariant(), legs: drawnVariant().legs };
    const [feature] = toFeatures('area--x', [only], '2026-08-17');
    expect(feature.properties.variant).toBeUndefined();
    expect(feature.properties.note).toBeUndefined();
  });
});

describe('fromFeatures', () => {
  it('reads a saved route back for editing, keeping its variants', () => {
    const second = { ...drawnVariant(), name: 'Left Hand' };
    const features = toFeatures('area--x', [drawnVariant(), second], '2026-08-17');
    const [variant] = fromFeatures('area--x', features);
    expect(variant.name).toBe('Right Hand');
    expect(variant.note).toBe('The 1952 line.');
    expect(variantCoords(variant)).toEqual([A, B, C]);
  });

  it('ignores features belonging to other routes', () => {
    const features = toFeatures('area--other', [drawnVariant()], '2026-08-17');
    expect(fromFeatures('area--x', features)).toEqual([]);
  });
});
