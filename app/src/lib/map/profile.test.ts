import { describe, it, expect } from 'vitest';
import {
  cumulativeDistanceM, totalDistanceM, totalAscentM, profilePoints, pointAtDistance,
  totalDescentM, reverseCoords,
  nearestOnLine, locateOnLine, formatDistance, ASCENT_THRESHOLD_M, type Point3
} from './profile';
import { haversineM } from './snap';

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

  it('computes ascent from only the points that carry elevation', () => {
    // A line that leaves the DEM's extent samples nothing for the points
    // past the edge — that is not the same as the whole line lacking height.
    const partial: Point3[] = [
      [18.400, -34.0, 100],
      [18.401, -34.0, 150],
      [18.402, -34.0]
    ];
    expect(totalAscentM(partial)).toBe(50);
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

  it('keeps true cumulative distance when a trailing point lacks elevation', () => {
    const partial: Point3[] = [
      [18.400, -34.0, 100],
      [18.401, -34.0, 150],
      [18.402, -34.0]
    ];
    const points = profilePoints(partial);
    const full = cumulativeDistanceM(partial);
    expect(points).toHaveLength(2);
    expect(points[1].distanceM).toBe(full[1]);
    expect(points[1].elevationM).toBe(150);
  });

  it('keeps the real gap in distance when a middle point lacks elevation', () => {
    const gap: Point3[] = [
      [18.400, -34.0, 100],
      [18.401, -34.0],
      [18.402, -34.0, 150]
    ];
    const points = profilePoints(gap);
    const full = cumulativeDistanceM(gap);
    expect(points).toHaveLength(2);
    // The second entry's distance must reflect the full distance to the
    // third coordinate, not the distance skipping the unelevated middle one.
    expect(points[1].distanceM).toBe(full[2]);
    expect(points[1].elevationM).toBe(150);
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

const at = (heights: number[]): Point3[] =>
  heights.map((h, i) => [18.4 + i * 0.001, -33.96, h] as Point3);

describe('totalDescentM', () => {
  it('is the ascent of the same line walked backwards', () => {
    const coords = at([0, 100]);
    expect(totalDescentM(coords)).toBe(0);
    expect(totalDescentM(reverseCoords(coords))).toBe(100);
  });

  it('reports null when no point carries a height', () => {
    expect(totalDescentM([[18.4, -33.96], [18.41, -33.96]])).toBeNull();
  });

  it('reads a reversed line as the mirror of the forward one', () => {
    // The case that rules out a hand-mirrored descent loop: such a loop reports
    // 52 here, while walking the line backwards ascends 54. The reverse toggle
    // shows the reader THIS line walked the other way, so 54 is the honest
    // number and the mirrored loop would contradict the ascent shown after the
    // flip. See the spec's "Derived numbers".
    const coords = at([44, 22, 17, 22, 55, 52, 25]);
    expect(totalDescentM(coords)).toBe(totalAscentM(reverseCoords(coords)));
    expect(totalDescentM(coords)).toBe(54);
  });

  it('reads the forward line as the mirror of the reversed one, the other direction', () => {
    // The identity above checked forward-descent against reversed-ascent; this
    // checks it the other way round -- reversed-descent against forward-ascent
    // -- which `reverseCoords(reverseCoords(c)) === c` cannot exercise, since
    // that round trip never actually walks the line backwards.
    const coords = at([44, 22, 17, 22, 55, 52, 25]);
    expect(totalDescentM(reverseCoords(coords))).toBe(totalAscentM(coords));
  });
});

describe('nearestOnLine', () => {
  it('projects onto a segment interior', () => {
    // Due-east line; a point 0.0005 deg north of the middle of the first segment.
    const hit = nearestOnLine(flat, [18.4005, -33.9995]);
    expect(hit).not.toBeNull();
    expect(hit!.point[0]).toBeCloseTo(18.4005, 5);
    expect(hit!.point[1]).toBeCloseTo(-34.0, 5);
    expect(hit!.distanceM).toBeGreaterThan(50);
    expect(hit!.distanceM).toBeLessThan(60);
  });

  it('returns null for one point', () => {
    expect(nearestOnLine([[18.4, -34.0]], [18.4, -34.0])).toBeNull();
    expect(nearestOnLine([], [18.4, -34.0])).toBeNull();
  });

  it('distanceM is metres', () => {
    const p: [number, number] = [18.4012, -33.9991];
    const hit = nearestOnLine(flat, p)!;
    expect(Math.abs(hit.distanceM - haversineM(p, hit.point))).toBeLessThan(1);
  });

  it('clamps to the end of the line', () => {
    const hit = nearestOnLine(flat, [18.41, -34.0])!;
    expect(hit.point).toEqual([18.402, -34.0]);
  });
});

// Metres to degrees at latitude -34, so the fixtures can be written in metres.
const LAT = -34;
const eastDeg = (m: number) => m / (111_320 * Math.cos((LAT * Math.PI) / 180));
const northDeg = (m: number) => m / 111_320;
const atM = (eastM: number, northM = 0): [number, number] => [18.4 + eastDeg(eastM), LAT + northDeg(northM)];

describe('locateOnLine', () => {
  const km: Point3[] = [atM(0), atM(1000)];

  it('reports distance along and off the line', () => {
    const hit = locateOnLine(km, atM(300, 20))!;
    expect(hit.alongM).toBeGreaterThan(298);
    expect(hit.alongM).toBeLessThan(302);
    expect(hit.offM).toBeGreaterThan(19);
    expect(hit.offM).toBeLessThan(21);
  });

  it('clamps beyond the end to the total', () => {
    expect(locateOnLine(km, atM(1500))!.alongM).toBe(totalDistanceM(km));
  });

  it('is null for fewer than two points', () => {
    expect(locateOnLine([atM(0)], atM(0))).toBeNull();
    expect(locateOnLine([], atM(0))).toBeNull();
  });

  describe('out and back', () => {
    const line: Point3[] = [atM(0), atM(500), atM(500, 10), atM(0, 10)];
    const p = atM(200, 10);

    it('stays on the walked leg given the previous position', () => {
      const hit = locateOnLine(line, p, 750)!;
      expect(hit.alongM).toBeGreaterThan(790);
      expect(hit.alongM).toBeLessThan(810);
    });

    it('takes the nearest leg with no previous position', () => {
      const hit = locateOnLine(line, p)!;
      expect(hit.alongM).toBeGreaterThan(790);
      const out = locateOnLine(line, atM(200, 1))!;
      expect(out.alongM).toBeGreaterThan(198);
      expect(out.alongM).toBeLessThan(202);
    });

    it('still jumps when the other leg is clearly nearer', () => {
      const wide: Point3[] = [atM(0), atM(500), atM(500, 100), atM(0, 100)];
      const hit = locateOnLine(wide, atM(200, 1), 800)!;
      expect(hit.alongM).toBeLessThan(210);
    });
  });

  it('agrees exactly with totalDistanceM at the last vertex', () => {
    const line: Point3[] = [atM(0), atM(300, 40), atM(900, -30), atM(1200, 10)];
    const last = line[line.length - 1];
    expect(locateOnLine(line, [last[0], last[1]])!.alongM).toBe(totalDistanceM(line));
  });

  it('mirrors on a reversed line', () => {
    const line: Point3[] = [atM(0), atM(300, 40), atM(900, -30), atM(1200, 10)];
    const q = atM(600, 5);
    const fwd = locateOnLine(line, q)!;
    const back = locateOnLine(reverseCoords(line), q)!;
    expect(Math.abs(back.alongM - (totalDistanceM(line) - fwd.alongM))).toBeLessThan(1);
  });
});

describe('formatDistance', () => {
  it('reads metres under a kilometre and kilometres above', () => {
    expect(formatDistance(0)).toBe('0 m');
    expect(formatDistance(999.4)).toBe('999 m');
    expect(formatDistance(1000)).toBe('1.0 km');
    expect(formatDistance(12345)).toBe('12.3 km');
  });
});
