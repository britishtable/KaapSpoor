import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { putEntry, getAllEntries, clearEntries } from './db';

beforeEach(async () => { await clearEntries(); });

describe('journal db', () => {
  it('stores and returns an entry', async () => {
    await putEntry({ routeId: 'r1', done: true, date: '2026-07-21', notes: 'nice' });
    expect(await getAllEntries()).toEqual([
      { routeId: 'r1', done: true, date: '2026-07-21', notes: 'nice' }
    ]);
  });
  it('overwrites an entry with the same routeId', async () => {
    await putEntry({ routeId: 'r1', done: true, date: null, notes: '' });
    await putEntry({ routeId: 'r1', done: false, date: null, notes: 'redone' });
    const all = await getAllEntries();
    expect(all).toHaveLength(1);
    expect(all[0].notes).toBe('redone');
  });
  it('clears all entries', async () => {
    await putEntry({ routeId: 'r1', done: true, date: null, notes: '' });
    await clearEntries();
    expect(await getAllEntries()).toEqual([]);
  });

  it('stores and returns an entry carrying a plan', async () => {
    await putEntry({
      routeId: 'a--b--c', done: true, date: null, notes: '',
      plan: { main: 'a--b--c/main/main', reversed: true }
    });
    const [entry] = await getAllEntries();
    expect(entry.plan?.reversed).toBe(true);
  });
});
