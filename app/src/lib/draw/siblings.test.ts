import { describe, it, expect } from 'vitest';
import { siblingEndpoints, snapToSiblings, unmetJunctions } from './siblings';
import { newSegment, type Segment } from './state';
import type { Point } from '../map/snap';

const withCoords = (role: 'approach' | 'main' | 'exit', name: string, pts: Point[]): Segment => ({
  ...newSegment(role, name),
  legs: [{ at: pts[0], coords: pts }]
});

const A: Point = [18.40, -33.96];
const B: Point = [18.41, -33.96];
const C: Point = [18.43, -33.96];

describe('siblingEndpoints', () => {
  it('offers both ends of every other segment', () => {
    const segments = [withCoords('approach', 'k', [A, B]), withCoords('main', 'm', [B, C])];
    expect(siblingEndpoints(segments, 1)).toEqual([A, B]);
  });

  it('skips the segment being drawn, so it cannot snap to itself', () => {
    const segments = [withCoords('main', 'm', [B, C])];
    expect(siblingEndpoints(segments, 0)).toEqual([]);
  });
});

describe('snapToSiblings', () => {
  it('returns the sibling endpoint exactly, not an approximation of it', () => {
    const segments = [withCoords('approach', 'k', [A, B]), withCoords('main', 'm', [B, C])];
    const near: Point = [18.410002, -33.960001];
    expect(snapToSiblings(segments, 1, near, 100)).toEqual(B);
  });

  it('returns null when nothing is within reach', () => {
    const segments = [withCoords('approach', 'k', [A, B])];
    expect(snapToSiblings(segments, 1, [18.9, -33.96], 100)).toBeNull();
  });
});

describe('unmetJunctions', () => {
  it('is empty when everything meets exactly', () => {
    const segments = [
      withCoords('approach', 'k', [A, B]),
      withCoords('main', 'm', [B, C])
    ];
    expect(unmetJunctions(segments)).toEqual([]);
  });

  it('names both segments and the distance across the break', () => {
    const off: Point = [18.4101, -33.96];
    const segments = [
      withCoords('approach', 'k', [A, B]),
      withCoords('main', 'm', [off, C])
    ];
    const [gap] = unmetJunctions(segments);
    expect(gap.from).toBe('k');
    expect(gap.to).toBe('m');
    expect(gap.gapM).toBeGreaterThan(5);
  });

  it('says nothing about a segment that is still being drawn', () => {
    const segments = [withCoords('approach', 'k', [A, B]), newSegment('main', 'm')];
    expect(unmetJunctions(segments)).toEqual([]);
  });

  it('reports a main with no approach at all as nothing to fix', () => {
    expect(unmetJunctions([withCoords('main', 'm', [B, C])])).toEqual([]);
  });

  it('is silent when an approach joins the SECOND of two mains exactly', () => {
    const D: Point = [18.50, -33.9];
    const E: Point = [18.51, -33.9];
    const segments = [
      withCoords('approach', 'k', [A, B]),
      withCoords('main', 'unrelated', [D, E]),
      withCoords('main', 'm', [B, C])
    ];
    expect(unmetJunctions(segments)).toEqual([]);
  });
});
