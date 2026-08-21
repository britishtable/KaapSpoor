import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import 'fake-indexeddb/auto';
import { journal, hydrate, setEntry, replaceAll } from './store';
import { clearEntries, getAllEntries } from './db';

// Passthrough mock: real behaviour by default, so existing tests are unaffected.
// One test below overrides putEntry to force a write failure.
vi.mock('./db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./db')>();
  return { ...actual, putEntry: vi.fn(actual.putEntry) };
});

beforeEach(async () => { await clearEntries(); await replaceAll([]); });

describe('journal store', () => {
  it('write-through updates both the store and the db', async () => {
    await setEntry({ routeId: 'r1', done: true, date: '2026-07-21', notes: 'x' });
    expect(get(journal).get('r1')?.done).toBe(true);
    expect(await getAllEntries()).toHaveLength(1);
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

  it('reflects the entry in the store before the write resolves', async () => {
    const pending = setEntry({ routeId: 'r9', done: true, date: null, notes: '' });
    // Deliberately not awaited yet: the store must already show the change, so a
    // reload in this window cannot lose the toggle.
    expect(get(journal).get('r9')?.done).toBe(true);
    await pending;
    expect(await getAllEntries()).toHaveLength(1);
  });

  it('rolls the store back when the write fails', async () => {
    const db = await import('./db');
    vi.mocked(db.putEntry).mockRejectedValueOnce(new Error('disk full'));

    await expect(
      setEntry({ routeId: 'r10', done: true, date: null, notes: '' })
    ).rejects.toThrow('disk full');

    // The optimistic update must not survive a failed write.
    expect(get(journal).get('r10')).toBeUndefined();
  });

  it('restores the previous value when a write over an existing entry fails', async () => {
    await setEntry({ routeId: 'r11', done: true, date: '2026-01-01', notes: 'first' });

    const db = await import('./db');
    vi.mocked(db.putEntry).mockRejectedValueOnce(new Error('quota exceeded'));
    await expect(
      setEntry({ routeId: 'r11', done: false, date: null, notes: 'second' })
    ).rejects.toThrow('quota exceeded');

    // Rolls back to the stored entry, not to absent.
    expect(get(journal).get('r11')).toEqual({
      routeId: 'r11', done: true, date: '2026-01-01', notes: 'first'
    });
  });

  it('does not clobber a newer write when an older one fails', async () => {
    const db = await import('./db');
    // The first save fails slowly; the second succeeds in the meantime.
    vi.mocked(db.putEntry).mockImplementationOnce(
      () => new Promise((_, reject) => setTimeout(() => reject(new Error('slow fail')), 20))
    );

    const first = setEntry({ routeId: 'r12', done: true, date: null, notes: 'older' });
    await setEntry({ routeId: 'r12', done: false, date: null, notes: 'newer' });
    await expect(first).rejects.toThrow('slow fail');

    // The newer write must survive the older one's rollback.
    expect(get(journal).get('r12')?.notes).toBe('newer');
  });
});
