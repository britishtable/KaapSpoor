import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import 'fake-indexeddb/auto';
import {
  hikes, visibleHikes, doneRouteIds, activeHike, hikesForRoute, viewer,
  logHike, updateHike, deleteHike, startHike, finishHike, setRouteNotes,
  hydrate, replaceAll, onLocalWrite, applyServerHike, setClockForTests, ActiveHikeError, LockedHikeError
} from './store';
import { getAllHikes } from './db';
import type { Hike } from '../data/types';

// Passthrough mock: real behaviour by default; one test forces a write failure.
vi.mock('./db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./db')>();
  return { ...actual, putHike: vi.fn(actual.putHike) };
});

const hike = (id: string, over: Partial<Hike> = {}): Hike => ({
  id, routeId: 'r1', date: null, notes: '', visibility: 'PRIVATE', notesVisibility: 'PRIVATE',
  startedAt: null, finishedAt: null, updatedAt: '2026-01-01T00:00:00.000Z',
  deleted: false, owner: null, pending: false, ...over
});

beforeEach(async () => {
  setClockForTests(null);
  viewer.set(null);
  await replaceAll({ hikes: [], routeNotes: [] });
});

describe('hike store', () => {
  it('replaceAll (an import) notifies onLocalWrite', async () => {
    const fn = vi.fn();
    const off = onLocalWrite(fn);
    await replaceAll({ hikes: [], routeNotes: [] });
    off();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('logHike adds a pending hike and notifies onLocalWrite', async () => {
    setClockForTests(() => '2026-05-05T10:00:00.000Z');
    const fn = vi.fn();
    const off = onLocalWrite(fn);
    const h = await logHike({ routeId: 'r1', date: '2026-05-05', notes: 'x' });
    off();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(h.pending).toBe(true);
    expect(h.updatedAt).toBe('2026-05-05T10:00:00.000Z');
    expect(h.visibility).toBe('PRIVATE');
    expect(get(hikes).get(h.id)).toEqual(h);
    expect(await getAllHikes()).toEqual([h]);
  });

  it('two hikes on one route both count, route is done', async () => {
    await logHike({ routeId: 'r1', date: '2026-01-01', notes: '' });
    await logHike({ routeId: 'r1', date: '2026-02-01', notes: '' });
    expect(get(visibleHikes)).toHaveLength(2);
    expect([...get(doneRouteIds)]).toEqual(['r1']);
  });

  it('deleteHike hides it and scrubs notes, plan and when it was hiked', async () => {
    const h = await startHike('r1', { reversed: true });
    await updateHike(h.id, { notes: 'secret' });
    await finishHike(h.id);
    await deleteHike(h.id);
    expect(get(visibleHikes)).toHaveLength(0);
    expect(get(doneRouteIds).size).toBe(0);
    const t = get(hikes).get(h.id)!;
    expect(t).toMatchObject({ deleted: true, notes: '', date: null, startedAt: null, finishedAt: null, routeId: 'r1' });
    expect(t.plan).toBeUndefined();
    expect(t.pending).toBe(true);
  });

  it("signed in, new hikes are the viewer's and an edit claims an unowned hike", async () => {
    await replaceAll({ hikes: [hike('free')], routeNotes: [] });
    viewer.set('u1');
    expect((await logHike({ routeId: 'r1', date: null, notes: '' })).owner).toBe('u1');
    const started = await startHike('r2');
    expect(started.owner).toBe('u1');
    await updateHike('free', { notes: 'mine now' });
    expect(get(hikes).get('free')!.owner).toBe('u1');
    viewer.set(null);
    expect((await logHike({ routeId: 'r1', date: null, notes: '' })).owner).toBeNull();
  });

  it('signed out, a hike saved to an account cannot be edited or deleted', async () => {
    await replaceAll({ hikes: [hike('theirs', { owner: 'u1', notes: 'keep' }), hike('free')], routeNotes: [] });
    await expect(updateHike('theirs', { notes: 'x' })).rejects.toBeInstanceOf(LockedHikeError);
    await expect(deleteHike('theirs')).rejects.toBeInstanceOf(LockedHikeError);
    expect(get(hikes).get('theirs')).toMatchObject({ notes: 'keep', deleted: false, pending: false });
    await deleteHike('free');
    expect(get(hikes).get('free')!.deleted).toBe(true);
    viewer.set('u1');
    await updateHike('theirs', { notes: 'x' });
    expect(get(hikes).get('theirs')!.notes).toBe('x');
  });

  it('startHike sets today and startedAt; a second start throws ActiveHikeError', async () => {
    setClockForTests(() => '2026-05-05T10:00:00.000Z');
    const h = await startHike('r1');
    expect(h.startedAt).toBe('2026-05-05T10:00:00.000Z');
    expect(h.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(get(activeHike)?.id).toBe(h.id);
    await expect(startHike('r2')).rejects.toBeInstanceOf(ActiveHikeError);
  });

  it('finishHike clears activeHike', async () => {
    const h = await startHike('r1');
    await finishHike(h.id);
    expect(get(activeHike)).toBeNull();
    expect(get(hikes).get(h.id)?.finishedAt).not.toBeNull();
  });

  it('updateHike clears syncError and marks pending', async () => {
    await replaceAll({ hikes: [hike('a', { syncError: 'bad' })], routeNotes: [] });
    await updateHike('a', { notes: 'edited' });
    const h = get(hikes).get('a')!;
    expect(h.notes).toBe('edited');
    expect(h.syncError).toBeUndefined();
    expect(h.pending).toBe(true);
  });

  it("viewer filter hides another owner's hikes, shows unowned ones", async () => {
    await replaceAll({
      hikes: [hike('a', { owner: 'u1' }), hike('b', { owner: 'u2' }), hike('c', { owner: null })],
      routeNotes: []
    });
    expect(get(visibleHikes)).toHaveLength(3);
    viewer.set('u1');
    expect(get(visibleHikes).map((h) => h.id).sort()).toEqual(['a', 'c']);
  });

  it('a failed write rolls back', async () => {
    const db = await import('./db');
    vi.mocked(db.putHike).mockRejectedValueOnce(new Error('disk full'));
    await expect(logHike({ routeId: 'r1', date: null, notes: '' })).rejects.toThrow('disk full');
    expect(get(hikes).size).toBe(0);
  });

  it('a failed edit restores the previous hike, and does not clobber a newer write', async () => {
    const h = await logHike({ routeId: 'r1', date: null, notes: 'first' });
    const db = await import('./db');
    vi.mocked(db.putHike).mockImplementationOnce(
      () => new Promise((_, reject) => setTimeout(() => reject(new Error('slow fail')), 20))
    );
    const older = updateHike(h.id, { notes: 'older' });
    await updateHike(h.id, { notes: 'newer' });
    await expect(older).rejects.toThrow('slow fail');
    expect(get(hikes).get(h.id)?.notes).toBe('newer');
  });

  it('hikesForRoute orders dated newest first, undated last', async () => {
    await replaceAll({
      hikes: [
        hike('undated', { date: null }),
        hike('old', { date: '2026-01-01' }),
        hike('new', { date: '2026-03-01' }),
        hike('other', { routeId: 'r2', date: '2026-04-01' })
      ],
      routeNotes: []
    });
    expect(get(hikesForRoute('r1')).map((h) => h.id)).toEqual(['new', 'old', 'undated']);
  });

  it('hydrate loads db rows; setRouteNotes and applyServerHike persist', async () => {
    await applyServerHike(hike('s', { owner: 'u1', pending: false }));
    await setRouteNotes('r1', 'plan notes');
    hikes.set(new Map());
    await hydrate();
    expect(get(hikes).get('s')?.pending).toBe(false);
    expect(get(hikes).get('s')?.updatedAt).toBe('2026-01-01T00:00:00.000Z');
  });
});
