import { describe, it, expect } from 'vitest';
import {
  newSegment, segmentCoords, undoLeg, flipSegment, toFeatures, fromFeatures
} from './state';

const ROUTE = 'a--b--pimple';
const legs = (pts: [number, number][]) =>
  pts.map((p, i) => ({ at: p, coords: i === 0 ? [p] : [pts[i - 1], p] }));

describe('newSegment', () => {
  it('carries its role and no id until it is saved', () => {
    const s = newSegment('approach');
    expect(s.role).toBe('approach');
    expect(s.id).toBe('');
    expect(s.legs).toEqual([]);
  });
});

describe('flipSegment', () => {
  it('reverses the drawn line as one leg', () => {
    const s = { ...newSegment('main'), legs: legs([[18.4, -33.96], [18.41, -33.96], [18.42, -33.96]]) };
    expect(segmentCoords(flipSegment(s))).toEqual(
      [...segmentCoords(s)].reverse()
    );
  });

  it('leaves an empty segment alone', () => {
    expect(flipSegment(newSegment('exit')).legs).toEqual([]);
  });

  it('is its own inverse', () => {
    const s = { ...newSegment('main'), legs: legs([[18.4, -33.96], [18.41, -33.96]]) };
    expect(segmentCoords(flipSegment(flipSegment(s)))).toEqual(segmentCoords(s));
  });
});

describe('toFeatures', () => {
  it('writes role and a generated id', () => {
    const s = { ...newSegment('approach', 'via Kasteelspoort'),
                legs: legs([[18.4, -33.96], [18.41, -33.96]]) };
    const [f] = toFeatures(ROUTE, [s], '2026-08-21');
    expect(f.properties.role).toBe('approach');
    expect(f.properties.segmentId).toBe(`${ROUTE}/approach/via-kasteelspoort`);
    expect(f.properties.name).toBe('via Kasteelspoort');
  });

  it('keeps an id a segment already has, so it never moves', () => {
    const s = { ...newSegment('main'), id: `${ROUTE}/main/original`,
                name: 'renamed since',
                legs: legs([[18.4, -33.96], [18.41, -33.96]]) };
    expect(toFeatures(ROUTE, [s], '2026-08-21')[0].properties.segmentId)
      .toBe(`${ROUTE}/main/original`);
  });

  it('drops a segment with fewer than two points', () => {
    expect(toFeatures(ROUTE, [newSegment('main')], '2026-08-21')).toEqual([]);
  });

  it('writes a name even for a lone segment, unlike the old variant rule', () => {
    // A single main still names itself, because the reader's picker shows it
    // and a nameless row cannot be talked about.
    const s = { ...newSegment('main', 'Spring Buttress B'),
                legs: legs([[18.4, -33.96], [18.41, -33.96]]) };
    expect(toFeatures(ROUTE, [s], '2026-08-21')[0].properties.name).toBe('Spring Buttress B');
  });
});

describe('fromFeatures', () => {
  it('round-trips role, id, name and note', () => {
    const s = { ...newSegment('exit', 'via Diagonal'), note: 'shady after 3',
                legs: legs([[18.4, -33.96], [18.41, -33.96]]) };
    const [back] = fromFeatures(ROUTE, toFeatures(ROUTE, [s], '2026-08-21'));
    expect(back.role).toBe('exit');
    expect(back.name).toBe('via Diagonal');
    expect(back.note).toBe('shady after 3');
    expect(back.id).toBe(`${ROUTE}/exit/via-diagonal`);
  });

  it('ignores another route entirely', () => {
    const s = { ...newSegment('main'), legs: legs([[18.4, -33.96], [18.41, -33.96]]) };
    expect(fromFeatures('other--r--x', toFeatures(ROUTE, [s], '2026-08-21'))).toEqual([]);
  });
});
