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

import { resolvePlan, planStats } from './plan';

// A little network: two approaches meet main M1 at B; main M2 starts elsewhere.
const P = (lon: number, h: number): Point3 => [lon, -33.96, h];
const K = seg('k', 'approach', [P(18.40, 50), P(18.41, 300)]);   // ends at 18.41
const D = seg('d', 'approach', [P(18.39, 60), P(18.41, 300)]);   // ends at 18.41
const M1 = seg('m1', 'main', [P(18.41, 300), P(18.43, 500)]);    // starts at 18.41
const M2 = seg('m2', 'main', [P(18.50, 300), P(18.52, 400)]);    // starts elsewhere
const X = seg('x', 'exit', [P(18.43, 500), P(18.45, 100)]);      // starts at M1's end
const ALL = [K, D, M1, M2, X];

describe('resolvePlan', () => {
  it('defaults to the first main in file order', () => {
    expect(resolvePlan(ALL).choice.main).toBe('m1');
  });

  it('defaults the approach and exit to the first CONNECTED to that main', () => {
    expect(resolvePlan(ALL).choice).toEqual(
      { approach: 'k', main: 'm1', exit: 'x', reversed: false }
    );
  });

  it('offers only the approaches that meet the chosen main', () => {
    expect(resolvePlan(ALL, { main: 'm2' }).approaches.map((s) => s.segmentId)).toEqual([]);
    expect(resolvePlan(ALL, { main: 'm1' }).approaches.map((s) => s.segmentId)).toEqual(['k', 'd']);
  });

  it('drops a chosen approach that does not meet a newly chosen main', () => {
    const plan = resolvePlan(ALL, { approach: 'k', main: 'm2' });
    expect(plan.choice.approach).toBeNull();
    expect(plan.choice.main).toBe('m2');
  });

  it('honours an explicit choice that is legal', () => {
    expect(resolvePlan(ALL, { approach: 'd', main: 'm1' }).choice.approach).toBe('d');
  });

  it('ignores an id that is not in this route at all', () => {
    expect(resolvePlan(ALL, { main: 'nonsense' }).choice.main).toBe('m1');
  });

  it('yields the chosen segments in walking order', () => {
    expect(resolvePlan(ALL).chosen.map((s) => s.segmentId)).toEqual(['k', 'm1', 'x']);
  });

  it('has no plan at all when the route has no main', () => {
    const plan = resolvePlan([K, X]);
    expect(plan.choice.main).toBeNull();
    expect(plan.chosen).toEqual([]);
  });

  it('carries the reversed flag through untouched', () => {
    expect(resolvePlan(ALL, { reversed: true }).choice.reversed).toBe(true);
  });
});

describe('planStats', () => {
  it('measures the assembled line', () => {
    const stats = planStats(assemble(resolvePlan(ALL).chosen));
    expect(stats.distanceM).toBeGreaterThan(0);
    expect(stats.ascentM).toBe(450);
    expect(stats.descentM).toBe(400);
  });

  it('swaps up and down when the walk is reversed', () => {
    const forward = planStats(assemble(resolvePlan(ALL).chosen));
    const back = planStats(assemble(resolvePlan(ALL).chosen, true));
    expect(back.ascentM).toBe(forward.descentM);
    expect(back.descentM).toBe(forward.ascentM);
    expect(back.distanceM).toBe(forward.distanceM);
  });

  it('is all zeroes and nulls for an empty plan', () => {
    expect(planStats([])).toEqual({ distanceM: 0, ascentM: null, descentM: null });
  });
});
