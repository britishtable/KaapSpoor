import { describe, it, expect } from 'vitest';
import { ROLES, isRole, makeSegmentId } from './segments';

const ROUTE = 'table-mountain--atlantic-west--pimple-traverse';

describe('roles', () => {
  it('lists the three roles in walking order', () => {
    expect(ROLES).toEqual(['approach', 'main', 'exit']);
  });

  it('rejects anything that is not a role', () => {
    expect(isRole('main')).toBe(true);
    expect(isRole('descent')).toBe(false);
    expect(isRole(undefined)).toBe(false);
  });
});

// slugging a name is `slugify` from ./ids (see ids.test.ts) -- makeSegmentId
// just applies it to a segment name and qualifies the result by routeId/role.
describe('makeSegmentId', () => {
  it('qualifies by the full routeId, because route slugs repeat', () => {
    // data/routes.json carries two distinct routes both slugged `klipspringer`.
    const a = makeSegmentId('table-mountain--x--klipspringer', 'main', '', new Set());
    const b = makeSegmentId('hottentots--y--klipspringer', 'main', '', new Set());
    expect(a).not.toBe(b);
  });

  it('falls back to the role when the segment has no name', () => {
    expect(makeSegmentId(ROUTE, 'main', '', new Set())).toBe(`${ROUTE}/main/main`);
  });

  it('uses the slugged name when there is one', () => {
    expect(makeSegmentId(ROUTE, 'approach', 'via Kasteelspoort', new Set()))
      .toBe(`${ROUTE}/approach/via-kasteelspoort`);
  });

  it('suffixes rather than colliding with an id already taken', () => {
    const taken = new Set([`${ROUTE}/approach/via-kasteelspoort`]);
    expect(makeSegmentId(ROUTE, 'approach', 'via Kasteelspoort', taken))
      .toBe(`${ROUTE}/approach/via-kasteelspoort-2`);
  });
});
