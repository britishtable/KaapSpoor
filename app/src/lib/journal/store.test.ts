import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import 'fake-indexeddb/auto';
import { journal, hydrate, setEntry, toggleDone, replaceAll } from './store';
import { clearEntries, getAllEntries } from './db';

beforeEach(async () => { await clearEntries(); await replaceAll([]); });

describe('journal store', () => {
  it('write-through updates both the store and the db', async () => {
    await setEntry({ routeId: 'r1', done: true, date: '2026-07-21', notes: 'x' });
    expect(get(journal).get('r1')?.done).toBe(true);
    expect(await getAllEntries()).toHaveLength(1);
  });
  it('toggleDone creates an entry when none exists, then flips it', async () => {
    await toggleDone('r2');
    expect(get(journal).get('r2')?.done).toBe(true);
    await toggleDone('r2');
    expect(get(journal).get('r2')?.done).toBe(false);
  });
  it('hydrate loads existing db rows into the store', async () => {
    await setEntry({ routeId: 'r3', done: true, date: null, notes: '' });
    await replaceAll([]);            // empties store+db
    await setEntry({ routeId: 'r3', done: true, date: null, notes: '' });
    await hydrate();
    expect(get(journal).get('r3')?.done).toBe(true);
  });
  it('replaceAll swaps the entire journal', async () => {
    await setEntry({ routeId: 'old', done: true, date: null, notes: '' });
    await replaceAll([{ routeId: 'new', done: false, date: null, notes: 'n' }]);
    expect([...get(journal).keys()]).toEqual(['new']);
  });
});
