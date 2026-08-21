import { describe, it, expect } from 'vitest';
import { joins, gapM, assemble, JUNCTION_TOLERANCE_M, type PlanSegment } from './plan';
import type { Point3 } from '../map/profile';
import type { SegmentRole } from './segments';

const seg = (id: string, role: SegmentRole, coords: Point3[]): PlanSegment => ({
  segmentId: id, role, name: null, note: null, coords
});

const A: Point3 = [18.400, -33.960, 100];
const B: Point3 = [18.410, -33.960, 300];
const C: Point3 = [18.420, -33.960, 200];

describe('joins', () => {
  it('is true when one segment ends exactly where the next begins', () => {
    expect(joins(seg('a', 'approach', [A, B]), seg('m', 'main', [B, C]))).toBe(true);
  });

  it('is false for a near miss, because a junction is exact', () => {
    const nudged: Point3 = [18.410001, -33.960, 300];
    expect(joins(seg('a', 'approach', [A, B]), seg('m', 'main', [nudged, C]))).toBe(false);
  });

  it('ignores elevation, which is resampled and may differ', () => {
    const sameGround: Point3 = [18.410, -33.960, 999];
    expect(joins(seg('a', 'approach', [A, B]), seg('m', 'main', [sameGround, C]))).toBe(true);
  });

  it('is false when either segment is too short to have ends', () => {
    expect(joins(seg('a', 'approach', [A]), seg('m', 'main', [A, C]))).toBe(false);
  });
});

describe('gapM', () => {
  it('is zero for an exact junction', () => {
    expect(gapM(seg('a', 'approach', [A, B]), seg('m', 'main', [B, C]))).toBe(0);
  });

  it('measures the ground distance across a break', () => {
    const far: Point3 = [18.415, -33.960, 300];
    expect(gapM(seg('a', 'approach', [A, B]), seg('m', 'main', [far, C]))).toBeGreaterThan(400);
  });

  it('warns at 25 m', () => {
    expect(JUNCTION_TOLERANCE_M).toBe(25);
  });
});

describe('assemble', () => {
  it('drops exactly one coordinate at each junction', () => {
    const out = assemble([seg('a', 'approach', [A, B]), seg('m', 'main', [B, C])]);
    expect(out).toEqual([A, B, C]);
  });

  it('keeps both endpoints across a gap, so the break is visible', () => {
    const far: Point3 = [18.415, -33.960, 300];
    const out = assemble([seg('a', 'approach', [A, B]), seg('m', 'main', [far, C])]);
    expect(out).toEqual([A, B, far, C]);
  });

  it('reverses the whole walk, not the segments in place', () => {
    const out = assemble([seg('a', 'approach', [A, B]), seg('m', 'main', [B, C])], true);
    expect(out).toEqual([C, B, A]);
  });

  it('is empty for no segments', () => {
    expect(assemble([])).toEqual([]);
  });
});
