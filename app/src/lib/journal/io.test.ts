import { describe, it, expect } from 'vitest';
import { serialize, parse, merge } from './io';
import type { JournalEntry } from '../data/types';

const e = (routeId: string, done = true): JournalEntry => ({ routeId, done, date: null, notes: '' });

describe('serialize / parse round-trip', () => {
  it('preserves entries', () => {
    const entries = [e('r1'), e('r2', false)];
    expect(parse(serialize(entries))).toEqual(entries);
  });
  it('rejects non-journal JSON', () => {
    expect(() => parse('{"nope":1}')).toThrow();
  });
  it('rejects entries missing required fields', () => {
    expect(() => parse('{"version":1,"entries":[{"routeId":"r1"}]}')).toThrow();
  });
  it('rejects invalid JSON text', () => {
    expect(() => parse('not json')).toThrow();
  });
  it('rejects literal null with the friendly message', () => {
    expect(() => parse('null')).toThrow('Not a KaapSpoor journal export.');
  });
  it('strips unknown extra fields from imported entries', () => {
    const json = '{"version":1,"entries":[{"routeId":"r1","done":true,"date":null,"notes":"","extra":99}]}';
    expect(parse(json)).toEqual([{ routeId: 'r1', done: true, date: null, notes: '' }]);
  });
});

describe('merge', () => {
  const current = new Map([[ 'r1', e('r1') ], [ 'r2', e('r2') ]]);
  it('merge overlays incoming, incoming winning on id clash', () => {
    const out = merge(current, [e('r2', false), e('r3')], 'merge');
    const byId = new Map(out.map((x) => [x.routeId, x]));
    expect(byId.get('r2')!.done).toBe(false);
    expect([...byId.keys()].sort()).toEqual(['r1', 'r2', 'r3']);
  });
  it('replace discards current entirely', () => {
    expect(merge(current, [e('r3')], 'replace')).toEqual([e('r3')]);
  });
});
