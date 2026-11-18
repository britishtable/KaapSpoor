import { describe, it, expect } from 'vitest';
import { serialize, parse, merge } from './io';
import type { Hike } from '../data/types';

const h = (id: string, over: Partial<Hike> = {}): Hike => ({
  id, routeId: 'a--b--c', date: '2026-07-02', notes: 'n',
  visibility: 'PRIVATE', notesVisibility: 'PRIVATE',
  startedAt: null, finishedAt: null, updatedAt: '2026-07-02T10:00:00.000Z',
  deleted: false, owner: 'u1', pending: false, ...over
});

describe('v2 serialize / parse', () => {
  it('round-trip strips owner/pending/syncError and tombstones', () => {
    const live = h('1', { syncError: 'x', plan: { main: 'a--b--c/main/main', reversed: true } });
    const dead = h('2', { deleted: true });
    const json = serialize({ hikes: [live, dead], routeNotes: [{ routeId: 'r', notes: 'p', updatedAt: 't' }] });
    const raw = JSON.parse(json);
    expect(raw.version).toBe(2);
    expect(raw.hikes).toHaveLength(1);
    expect(raw.hikes[0]).not.toHaveProperty('owner');
    expect(raw.hikes[0]).not.toHaveProperty('pending');
    expect(raw.hikes[0]).not.toHaveProperty('syncError');
    const out = parse(json);
    const { syncError: _s, ...expected } = live;
    expect(out.hikes).toEqual([{ ...expected, owner: null, pending: true }]);
    expect(out.routeNotes).toEqual([{ routeId: 'r', notes: 'p', updatedAt: 't' }]);
  });

  it('v1 file converts', () => {
    const json = JSON.stringify({
      version: 1, exportedAt: '',
      entries: [
        { routeId: 'r1', done: true, date: '2026-07-02', notes: 'good day',
          plan: { main: 'r1/main/main', reversed: false } },
        { routeId: 'r2', done: false, date: null, notes: '' }
      ]
    });
    const out = parse(json);
    expect(out.hikes).toHaveLength(1);
    expect(out.hikes[0]).toMatchObject({ routeId: 'r1', date: '2026-07-02', owner: null, pending: true });
    expect(out.routeNotes).toHaveLength(1);
    expect(out.routeNotes[0].notes).toBe('good day');
  });

  it('junk fields are dropped', () => {
    const raw = JSON.parse(serialize({ hikes: [h('1', { plan: { main: 'm', reversed: false } })], routeNotes: [] }));
    raw.hikes[0].extra = 99;
    raw.hikes[0].plan.sneaky = 1;
    const [out] = parse(JSON.stringify(raw)).hikes;
    expect(out).not.toHaveProperty('extra');
    expect(out.plan).toEqual({ main: 'm', reversed: false });
  });

  it('malformed hike rejected with the message', () => {
    const bad = JSON.stringify({ version: 2, exportedAt: '', hikes: [{ id: 1 }], routeNotes: [] });
    expect(() => parse(bad)).toThrow('The file contains a malformed hike.');
  });

  it('rejects junk with the friendly messages', () => {
    expect(() => parse('not json')).toThrow('Not valid JSON.');
    expect(() => parse('null')).toThrow('Not a KaapSpoor export.');
    expect(() => parse('{"nope":1}')).toThrow('Not a KaapSpoor export.');
  });
});

describe('merge', () => {
  const cur = { hikes: [h('1', { notes: 'cur' }), h('2')], routeNotes: [{ routeId: 'r', notes: 'cur', updatedAt: '2026-02' }] };

  it('merge keeps newer by updatedAt', () => {
    const inc = {
      hikes: [h('1', { notes: 'old', updatedAt: '2026-01-01T00:00:00.000Z' }), h('3')],
      routeNotes: [{ routeId: 'r', notes: 'inc', updatedAt: '2026-03' }]
    };
    const out = merge(cur, inc, 'merge');
    expect(out.hikes.find((x) => x.id === '1')!.notes).toBe('cur');
    expect(out.hikes.map((x) => x.id).sort()).toEqual(['1', '2', '3']);
    expect(out.routeNotes[0].notes).toBe('inc');
  });

  it('replace replaces', () => {
    const inc = { hikes: [h('9')], routeNotes: [] };
    expect(merge(cur, inc, 'replace')).toEqual(inc);
  });

  it("replace keeps another owner's hikes and local tombstones", () => {
    const c = {
      hikes: [h('mine', { owner: 'u1' }), h('theirs', { owner: 'u2' }), h('dead', { deleted: true, owner: null })],
      routeNotes: []
    };
    const out = merge(c, { hikes: [h('new')], routeNotes: [] }, 'replace', 'u1');
    expect(out.hikes.map((x) => x.id).sort()).toEqual(['dead', 'new', 'theirs']);
  });

  it('merge skips incoming ids owned by another user', () => {
    const c = { hikes: [h('theirs', { owner: 'u2', notes: 'theirs' })], routeNotes: [] };
    const inc = {
      hikes: [h('theirs', { notes: 'x', owner: null, updatedAt: '2030-01-01T00:00:00.000Z' })], routeNotes: []
    };
    expect(merge(c, inc, 'merge', 'u1').hikes[0].notes).toBe('theirs');
  });

  it('does not resurrect a local tombstone, even with a newer live hike', () => {
    const c = { hikes: [h('d', { deleted: true, notes: '' })], routeNotes: [] };
    const inc = { hikes: [h('d', { updatedAt: '2030-01-01T00:00:00.000Z' })], routeNotes: [] };
    expect(merge(c, inc, 'merge').hikes[0].deleted).toBe(true);
    expect(merge(c, inc, 'replace').hikes[0].deleted).toBe(true);
  });
});
