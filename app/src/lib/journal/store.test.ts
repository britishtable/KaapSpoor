import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import 'fake-indexeddb/auto';
import {
  hikes, visibleHikes, doneRouteIds, activeHike, hikesForRoute, viewer,
  logHike, updateHike, deleteHike, startHike, finishHike, setRouteNotes,
  setReview, canReview, ReviewNotAllowedError, InvalidReviewError, hydrate, replaceAll, onLocalWrite, applyServerHike, setClockForTests, ActiveHikeError, LockedHikeError, localDate
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

describe('reviews', () => {
  const done = (id: string, over: Partial<Hike> = {}) =>
    hike(id, { date: '2026-05-05', startedAt: '2026-05-05T06:00:00.000Z', finishedAt: '2026-05-05T10:00:00.000Z', ...over });

  it('setReview saves the review and marks the hike pending', async () => {
    await replaceAll({ hikes: [done('h1')], routeNotes: [] });
    const out = await setReview('h1', { enjoyment: 4, water: 'SEASONAL' });
    expect(out.review).toEqual({ enjoyment: 4, water: 'SEASONAL' });
    expect(out.pending).toBe(true);
    expect(get(hikes).get('h1')!.review).toEqual({ enjoyment: 4, water: 'SEASONAL' });
    expect((await getAllHikes())[0].review).toEqual({ enjoyment: 4, water: 'SEASONAL' });
  });

  it('setReview(null) removes it', async () => {
    await replaceAll({ hikes: [done('h1', { review: { enjoyment: 2 } })], routeNotes: [] });
    const out = await setReview('h1', null);
    expect(out).not.toHaveProperty('review');
    expect(out.pending).toBe(true);
  });

  it('setReview on an active hike throws ReviewNotAllowedError', async () => {
    await replaceAll({ hikes: [done('h1', { finishedAt: null })], routeNotes: [] });
    await expect(setReview('h1', { enjoyment: 3 })).rejects.toBeInstanceOf(ReviewNotAllowedError);
  });

  it("setReview on another owner's hike throws LockedHikeError", async () => {
    await replaceAll({ hikes: [done('h1', { owner: 'u1' })], routeNotes: [] });
    await expect(setReview('h1', { enjoyment: 3 })).rejects.toBeInstanceOf(LockedHikeError);
  });

  it('setReview rejects reviews the server would refuse', async () => {
    await replaceAll({ hikes: [done('h1')], routeNotes: [] });
    const bad = [
      {}, { note: '   ' }, { safetyNote: 'rockfall' }, { enjoyment: 0 }, { enjoyment: 6 }, { enjoyment: 2.5 },
      { note: 'x'.repeat(2001) }, { safety: 'NO' as const, safetyNote: 'x'.repeat(1001) }
    ];
    for (const r of bad) await expect(setReview('h1', r)).rejects.toBeInstanceOf(InvalidReviewError);
    expect(get(hikes).get('h1')).not.toHaveProperty('review');
    await expect(setReview('h1', { safety: 'NO', safetyNote: 'rockfall' })).resolves.toBeTruthy();
  });

  it('setReview on a future-dated hike throws ReviewNotAllowedError', async () => {
    await replaceAll({ hikes: [done('h1', { date: '2999-01-01' })], routeNotes: [] });
    await expect(setReview('h1', { enjoyment: 3 })).rejects.toBeInstanceOf(ReviewNotAllowedError);
  });

  it('setReview(null) on an active hike succeeds', async () => {
    await replaceAll({ hikes: [done('h1', { finishedAt: null, review: { enjoyment: 3 } })], routeNotes: [] });
    const out = await setReview('h1', null);
    expect(out).not.toHaveProperty('review');
  });

  it('updateHike to a future date on a reviewed hike throws and changes nothing', async () => {
    const h = done('h1', { review: { enjoyment: 3 } });
    await replaceAll({ hikes: [h], routeNotes: [] });
    await expect(updateHike('h1', { date: '2999-01-01' })).rejects.toBeInstanceOf(ReviewNotAllowedError);
    expect(get(hikes).get('h1')).toEqual(h);
  });

  it('deleteHike leaves no review on the tombstone', async () => {
    await replaceAll({ hikes: [done('h1', { review: { enjoyment: 3 } })], routeNotes: [] });
    await deleteHike('h1');
    expect(get(hikes).get('h1')).not.toHaveProperty('review');
  });

  it('canReview is false for a hike dated tomorrow', () => {
    expect(canReview(hike('h', { date: '2026-11-24' }), '2026-11-23')).toBe(false);
    expect(canReview(hike('h', { date: '2026-11-23' }), '2026-11-23')).toBe(true);
    expect(canReview(hike('h', { date: null }), '2026-11-23')).toBe(true);
  });
});

describe('localDate', () => {
  it('formats a given day in local time, padded; today by default', () => {
    expect(localDate(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    expect(localDate()).toBe(`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`);
  });
});
