import { describe, it, expect } from 'vitest';
import { filterEntries, type FilterOptions } from './filter';
import type { RouteIndexEntry } from './types';

function e(id: string, title: string, located: boolean): RouteIndexEntry {
  return { id, title, area: ['x'], coords: located ? { lat: 0, lon: 0, zoom: 1 } : null,
    coordsSource: located ? 'crawl' : null, coordsAccuracyM: null, coordsOsm: null,
    mentionedPaths: [],
    hasLine: false,
    grade: null, gradeSource: null, time: null, heightGain: null, isFullEntry: true };
}
const entries = [e('a', 'Blind Gully', true), e('b', 'Kasteelspoort', false)];
const base: FilterOptions = { query: '', status: 'all', located: 'all' };

describe('filterEntries', () => {
  it('matches the search query against the title, case-insensitively', () => {
    expect(filterEntries(entries, { ...base, query: 'kastee' }, new Set()).map((r) => r.id)).toEqual(['b']);
  });
  it('filters by done status', () => {
    expect(filterEntries(entries, { ...base, status: 'done' }, new Set(['a'])).map((r) => r.id)).toEqual(['a']);
    expect(filterEntries(entries, { ...base, status: 'todo' }, new Set(['a'])).map((r) => r.id)).toEqual(['b']);
  });
  it('filters by mapped / unmapped', () => {
    expect(filterEntries(entries, { ...base, located: 'mapped' }, new Set()).map((r) => r.id)).toEqual(['a']);
    expect(filterEntries(entries, { ...base, located: 'unmapped' }, new Set()).map((r) => r.id)).toEqual(['b']);
  });
});
