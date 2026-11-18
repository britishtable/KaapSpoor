import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import {
  putHike, getAllHikes, putRouteNotes, getAllRouteNotes, replaceAllData,
  getMeta, setMeta, resetDbForTests
} from './db';
import type { Hike } from '../data/types';

const hike = (id: string, routeId = 'r1'): Hike => ({
  id, routeId, date: '2026-07-21', notes: 'n', visibility: 'PRIVATE', notesVisibility: 'PRIVATE',
  startedAt: null, finishedAt: null, updatedAt: '2026-07-21T08:00:00.000Z',
  deleted: false, owner: null, pending: true
});

async function seedV2() {
  const raw = await openDB('kaapspoor', 2, {
    upgrade(d) { d.createObjectStore('journal', { keyPath: 'routeId' }); }
  });
  await raw.put('journal', { routeId: 'a', done: true, date: '2026-07-21', notes: 'nice', plan: { reversed: true } });
  await raw.put('journal', { routeId: 'b', done: false, date: null, notes: 'later' });
  await raw.put('journal', { routeId: 'c', done: true, date: null, notes: '' });
  raw.close();
}

beforeEach(async () => {
  await resetDbForTests();
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase('kaapspoor');
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
});

describe('hikes db', () => {
  it('upgrades a v2 journal', async () => {
    await seedV2();
    await resetDbForTests();
    const hikes = await getAllHikes();
    const notes = await getAllRouteNotes();
    expect(hikes.map((h) => h.routeId).sort()).toEqual(['a', 'c']);
    expect(hikes.find((h) => h.routeId === 'a')).toMatchObject({
      date: '2026-07-21', plan: { reversed: true }, pending: true
    });
    expect(notes.map((n) => n.routeId).sort()).toEqual(['a', 'b']);
    await resetDbForTests();
    const raw = await openDB('kaapspoor');
    expect(raw.version).toBe(3);
    expect([...raw.objectStoreNames]).not.toContain('journal');
    raw.close();
  });

  it('a failing upgrade leaves v2 intact', async () => {
    await seedV2();
    await resetDbForTests({ convert: () => { throw new Error('boom'); } });
    await expect(getAllHikes()).rejects.toBeDefined();
    await resetDbForTests();
    const raw = await openDB('kaapspoor');
    expect(raw.version).toBe(2);
    expect(await raw.getAll('journal')).toHaveLength(3);
    raw.close();
  });

  it('retries after a failed open', async () => {
    await seedV2();
    await resetDbForTests({ convert: () => { throw new Error('boom'); } });
    await expect(getAllHikes()).rejects.toBeDefined();
    await resetDbForTests();
    expect(await getAllHikes()).toHaveLength(2);
  });

  it('round-trips a hike and route notes', async () => {
    await putHike(hike('h1'));
    await putRouteNotes({ routeId: 'r1', notes: 'plan', updatedAt: 'x' });
    expect(await getAllHikes()).toEqual([hike('h1')]);
    expect(await getAllRouteNotes()).toEqual([{ routeId: 'r1', notes: 'plan', updatedAt: 'x' }]);
  });

  it('replaceAllData replaces both stores', async () => {
    await putHike(hike('old'));
    await putRouteNotes({ routeId: 'old', notes: '', updatedAt: 'x' });
    await replaceAllData({ hikes: [hike('new')], routeNotes: [{ routeId: 'new', notes: 'q', updatedAt: 'y' }] });
    expect((await getAllHikes()).map((h) => h.id)).toEqual(['new']);
    expect((await getAllRouteNotes()).map((n) => n.routeId)).toEqual(['new']);
  });

  it('meta get/set', async () => {
    expect(await getMeta('k')).toBeUndefined();
    await setMeta('k', { a: 1 });
    expect(await getMeta('k')).toEqual({ a: 1 });
  });
});
