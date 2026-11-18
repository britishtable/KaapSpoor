import { describe, it, expect } from 'vitest';
import { convertJournal } from './convert';

const NOW = '2026-11-18T10:00:00.000Z';
let n = 0;
const id = () => `id${++n}`;
const plan = { main: 'a--b--c/main/main', reversed: true };

describe('convertJournal', () => {
  it('done with date → hike on that date, plan copied to hike and route notes', () => {
    const r = convertJournal([{ routeId: 'r1', done: true, date: '2026-07-21', notes: 'nice', plan }], NOW, id);
    expect(r.hikes).toHaveLength(1);
    expect(r.hikes[0]).toMatchObject({
      routeId: 'r1', date: '2026-07-21', notes: '', visibility: 'PRIVATE', notesVisibility: 'PRIVATE',
      plan, startedAt: null, finishedAt: null, updatedAt: NOW, deleted: false, owner: null, pending: true
    });
    expect(r.routeNotes).toEqual([{ routeId: 'r1', notes: 'nice', plan, updatedAt: NOW }]);
  });
  it('done without date → hike with date null', () => {
    const r = convertJournal([{ routeId: 'r1', done: true, date: null, notes: '' }], NOW, id);
    expect(r.hikes).toHaveLength(1);
    expect(r.hikes[0].date).toBeNull();
    expect(r.routeNotes).toEqual([]);
  });
  it('not done with notes → route notes only, no hike', () => {
    const r = convertJournal([{ routeId: 'r1', done: false, date: null, notes: 'later' }], NOW, id);
    expect(r.hikes).toEqual([]);
    expect(r.routeNotes).toEqual([{ routeId: 'r1', notes: 'later', updatedAt: NOW }]);
  });
  it('empty not-done entry → nothing', () => {
    const r = convertJournal([{ routeId: 'r1', done: false, date: null, notes: '' }], NOW, id);
    expect(r).toEqual({ hikes: [], routeNotes: [] });
  });
  it('lenient legacy entry', () => {
    const r = convertJournal(
      [{ routeId: 'r1', done: true }, { routeId: 'r2', done: true, date: 20260101, notes: 7 }],
      NOW, id
    );
    expect(r.hikes).toHaveLength(2);
    expect(r.hikes.every((h) => h.date === null)).toBe(true);
    expect(r.routeNotes).toEqual([]);
  });
  it('entry without a routeId is skipped', () => {
    const r = convertJournal([{ done: true, notes: 'x' }, { routeId: '', done: true }, null, 5], NOW, id);
    expect(r).toEqual({ hikes: [], routeNotes: [] });
  });
});
