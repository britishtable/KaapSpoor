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

    it('takes the earliest leg within 25 m with no previous position', () => {
      // The legs are 10 m apart, so the outbound leg (the smaller alongM) wins.
      const hit = locateOnLine(line, p)!;
      expect(hit.alongM).toBeGreaterThan(198);
      expect(hit.alongM).toBeLessThan(202);
    });

    it('takes a clearly nearer leg with no previous position', () => {
      const wide: Point3[] = [atM(0), atM(500), atM(500, 100), atM(0, 100)];
      const hit = locateOnLine(wide, atM(200, 99))!;
      expect(hit.alongM).toBeGreaterThan(500 + 100 + 295);
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

describe('locateOnLine continuity on dense and sparse lines', () => {
  const spaced = (lengthM: number, stepM: number, northM = 0, reverse = false): Point3[] => {
    const out: Point3[] = [];
    for (let m = 0; m <= lengthM; m += stepM) out.push(atM(reverse ? lengthM - m : m, northM));
    return out;
  };
  const dense = spaced(1000, 5);

  it('tracks a walker advancing 10 m per fix on a 5 m vertex line', () => {
    let prev: number | null = null;
    for (let m = 10; m <= 900; m += 10) {
      const hit: { alongM: number } = locateOnLine(dense, atM(m, 3), prev)!;
      expect(Math.abs(hit.alongM - m)).toBeLessThan(2);
      prev = hit.alongM;
    }
  });

  it('does not lag behind a walker standing still', () => {
    let prev: number | null = 190;
    for (let i = 0; i < 5; i++) {
      const hit: { alongM: number } = locateOnLine(dense, atM(200, 3), prev)!;
      expect(Math.abs(hit.alongM - 200)).toBeLessThan(2);
      prev = hit.alongM;
    }
  });

  it('does not snap back to a crossed vertex on a sparse line', () => {
    const sparse = spaced(1000, 100);
    const hit = locateOnLine(sparse, atM(115, 3), 95)!;
    expect(Math.abs(hit.alongM - 115)).toBeLessThan(2);
  });

  it('stays on the return leg of a densely vertexed out-and-back', () => {
    const out = spaced(500, 5);
    const back = spaced(500, 5, 10, true);
    const line: Point3[] = [...out, ...back];
    const hit = locateOnLine(line, atM(200, 10), 800)!;
    expect(hit.alongM).toBeGreaterThan(790);
    expect(hit.alongM).toBeLessThan(810);
  });

  it('projects a walker outside a convex corner to the corner vertex', () => {
    const corner: Point3[] = [atM(0), atM(500), atM(500, 500)];
    const hit = locateOnLine(corner, atM(520, -20), 500)!;
    expect(hit.alongM).toBeCloseTo(totalDistanceM([atM(0), atM(500)]), 3);
    expect(hit.offM).toBeGreaterThan(27);
    expect(hit.offM).toBeLessThan(30);
  });

  it('on a loop, a fix at the start reads as the start or the end by continuity (documented)', () => {
    const loop: Point3[] = [atM(0), atM(300), atM(300, 300), atM(0, 300), atM(0)];
    const total = totalDistanceM(loop);
    expect(locateOnLine(loop, atM(0), total - 5)!.alongM).toBeCloseTo(total, 3);
    expect(locateOnLine(loop, atM(0), 5)!.alongM).toBeCloseTo(0, 3);
  });
});

describe('formatDistance edge cases', () => {
  it('shows a dash for non-finite input and zero for negative', () => {
    expect(formatDistance(NaN)).toBe('—');
    expect(formatDistance(Infinity)).toBe('—');
    expect(formatDistance(-5)).toBe('0 m');
    expect(formatDistance(999.6)).toBe('1.0 km');
  });
});

describe('locateOnLine at a turnaround', () => {
  const mulberry32 = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  // Straight runs and connectors in metres, 5 m between vertices.
  const build = (legs: number, lenM: number, gapM: number): [number, number][] => {
    const out: [number, number][] = [];
    for (let k = 0; k < legs; k++) {
      const east = k % 2 === 0;
      for (let m = 0; m <= lenM; m += 5) out.push([east ? m : lenM - m, k * gapM]);
      if (k < legs - 1) for (let n = 5; n < gapM; n += 5) out.push([east ? lenM : 0, k * gapM + n]);
    }
    return out;
  };
  const toLine = (m: [number, number][]): Point3[] => m.map(([e, n]) => atM(e, n));
  const posAt = (m: [number, number][], s: number): [number, number] => {
    let run = 0;
    for (let i = 1; i < m.length; i++) {
      const seg = Math.hypot(m[i][0] - m[i - 1][0], m[i][1] - m[i - 1][1]);
      if (run + seg >= s) {
        const t = (s - run) / seg;
        return [m[i - 1][0] + t * (m[i][0] - m[i - 1][0]), m[i - 1][1] + t * (m[i][1] - m[i - 1][1])];
      }
      run += seg;
    }
    return m[m.length - 1];
  };

  function walks(legs: number, gapM: number, stepM = 6, jitterM = 8, n = 50) {
    const m = build(legs, 300, gapM);
    const line = toLine(m);
    const total = totalDistanceM(line);
    const turnAt = 300;
    let after = 0, far = 0, worstEnd = 0;
    for (let w = 0; w < n; w++) {
      const rnd = mulberry32(1000 + w);
      let prev: number | null = null;
      let lastErr = 0;
      for (let s = 0; s <= total - 1; s += stepM) {
        const [e, nn] = posAt(m, s);
        const hit: { alongM: number } = locateOnLine(line, atM(e, nn + (rnd() * 2 - 1) * jitterM), prev)!;
        prev = hit.alongM;
        lastErr = Math.abs(hit.alongM - s);
        if (s > turnAt + 10) { after++; if (lastErr > 15) far++; }
      }
      worstEnd = Math.max(worstEnd, lastErr);
    }
    return { farRate: far / after, worstEnd };
  }

  it('keeps an out-and-back walker on the right leg despite GPS jitter', () => {
    const r = walks(2, 10);
    expect(r.worstEnd).toBeLessThan(15);
    expect(r.farRate).toBeLessThan(0.05);
  });

  it('keeps a switchback walker on the right leg despite GPS jitter', () => {
    const r = walks(4, 15);
    expect(r.worstEnd).toBeLessThan(15);
    expect(r.farRate).toBeLessThan(0.05);
  });

  it('reads the shared start/end of an out-and-back as the start with no previous position', () => {
    // Back along the very same path, so the end coincides with the start.
    const out = toLine([...build(1, 300, 10), ...build(1, 300, 10).reverse()]);
    expect(locateOnLine(out, atM(0, 0))!.alongM).toBeLessThan(2);
  });

  it('follows a walker who genuinely turns back mid-route', () => {
    const line = toLine(build(2, 300, 10));
    let prev: number | null = null;
    // Out to 160 m, then back 60 m: the walker turns round.
    const path = [...Array.from({ length: 28 }, (_, i) => i * 6), ...Array.from({ length: 11 }, (_, i) => 162 - i * 6)];
    let err = 0;
    path.forEach((s, i) => {
      const hit: { alongM: number } = locateOnLine(line, atM(s, 3), prev)!;
      prev = hit.alongM;
      if (i >= 28 + 5) err = Math.max(err, Math.abs(hit.alongM - s));
    });
    expect(err).toBeLessThan(15);
  });
});
