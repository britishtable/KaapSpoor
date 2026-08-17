import { describe, it, expect } from 'vitest';
import {
  cumulativeDistanceM, totalDistanceM, totalAscentM, profilePoints, pointAtDistance,
  ASCENT_THRESHOLD_M, type Point3
} from './profile';

// A line running due east at a constant latitude: each step is ~92 m here.
const flat: Point3[] = [
  [18.400, -34.0, 100],
  [18.401, -34.0, 100],
  [18.402, -34.0, 100]
];

describe('cumulativeDistanceM', () => {
  it('starts at zero and grows along the line', () => {
    const cumulative = cumulativeDistanceM(flat);
    expect(cumulative).toHaveLength(3);
    expect(cumulative[0]).toBe(0);
    expect(cumulative[2]).toBeGreaterThan(cumulative[1]);
  });

  it('is a single zero for a one-point line', () => {
    expect(cumulativeDistanceM([[18.4, -34.0]])).toEqual([0]);
  });
});

describe('totalDistanceM', () => {
  it('measures the whole line', () => {
    // ~92 m per 0.001° of longitude at this latitude, twice.
    expect(totalDistanceM(flat)).toBeGreaterThan(170);
    expect(totalDistanceM(flat)).toBeLessThan(200);
  });

  it('ignores the third ordinate, which is height rather than ground covered', () => {
    const climbing: Point3[] = [[18.4, -34.0, 0], [18.401, -34.0, 500]];
    const level: Point3[] = [[18.4, -34.0, 0], [18.401, -34.0, 0]];
    expect(totalDistanceM(climbing)).toBeCloseTo(totalDistanceM(level), 6);
  });
});

describe('totalAscentM', () => {
  it('sums real climbs', () => {
    const up: Point3[] = [[18.4, -34.0, 100], [18.401, -34.0, 200], [18.402, -34.0, 260]];
    expect(totalAscentM(up)).toBe(160);
  });

  it('ignores wobble below the threshold', () => {
    // THE reason the threshold exists. At 30 m sampling consecutive readings
    // move by a few metres on flat ground; summing that noise turns a level
    // contour path into hundreds of metres of imaginary ascent.
    const noisy: Point3[] = [
      [18.400, -34.0, 100], [18.401, -34.0, 104], [18.402, -34.0, 99],
      [18.403, -34.0, 105], [18.404, -34.0, 100]
    ];
    expect(totalAscentM(noisy)).toBe(0);
  });

  it('counts a climb that clears the threshold in one step', () => {
    const step: Point3[] = [[18.4, -34.0, 100], [18.401, -34.0, 100 + ASCENT_THRESHOLD_M + 1]];
    expect(totalAscentM(step)).toBe(ASCENT_THRESHOLD_M + 1);
  });

  it('ignores descent, which is not ascent', () => {
    const down: Point3[] = [[18.4, -34.0, 300], [18.401, -34.0, 100]];
    expect(totalAscentM(down)).toBe(0);
  });

  it('is null when the line carries no elevation at all', () => {
    // A line drawn before sampling existed must degrade quietly rather than
    // claim a zero-metre climb.
    expect(totalAscentM([[18.4, -34.0], [18.401, -34.0]])).toBe(null);
  });
});

describe('profilePoints', () => {
  it('pairs distance along the line with height', () => {
    const up: Point3[] = [[18.4, -34.0, 100], [18.401, -34.0, 150]];
    const points = profilePoints(up);
    expect(points[0]).toEqual({ distanceM: 0, elevationM: 100 });
    expect(points[1].elevationM).toBe(150);
    expect(points[1].distanceM).toBeGreaterThan(80);
  });

  it('is empty without elevation, so the chart simply does not render', () => {
    expect(profilePoints([[18.4, -34.0], [18.401, -34.0]])).toEqual([]);
  });
});

describe('pointAtDistance', () => {
  it('finds the position a given distance along the line', () => {
    const total = totalDistanceM(flat);
    const middle = pointAtDistance(flat, total / 2);
    expect(middle[0]).toBeCloseTo(18.401, 4);
  });

  it('clamps past either end rather than returning undefined', () => {
    expect(pointAtDistance(flat, -50)).toEqual([18.4, -34.0]);
    expect(pointAtDistance(flat, 10_000)).toEqual([18.402, -34.0]);
  });
});
