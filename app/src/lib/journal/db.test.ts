import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import {
  putHike, getAllHikes, putRouteNotes, getAllRouteNotes, replaceAllData,
  getMeta, setMeta, resetDbForTests, putOutboxItem, getOutboxFor
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

async function seedV3() {
  const raw = await openDB('kaapspoor', 3, {
    upgrade(d) {
      d.createObjectStore('hikes', { keyPath: 'id' }).createIndex('byRoute', 'routeId');
      d.createObjectStore('routeNotes', { keyPath: 'routeId' });
      d.createObjectStore('meta');
    }
  });
  await raw.put('hikes', hike('h1'));
  await raw.put('routeNotes', { routeId: 'r1', notes: 'plan', updatedAt: 'x' });
  await raw.put('meta', 7, 'syncCursor:u');
  raw.close();
}

const STORES = ['hikes', 'meta', 'outbox', 'routeNotes'];

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
    expect(raw.version).toBe(4);
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

  it('upgrading 3 → 4 adds outbox and keeps hikes and routeNotes', async () => {
    await seedV3();
    await resetDbForTests();
    expect(await getAllHikes()).toEqual([hike('h1')]);
    expect(await getAllRouteNotes()).toEqual([{ routeId: 'r1', notes: 'plan', updatedAt: 'x' }]);
    expect(await getMeta('syncCursor:u')).toBe(7);
    await putOutboxItem({ id: 'o1', owner: 'u', createdAt: 't', kind: 'confirmation', reportId: 'x', answer: 'GONE' });
    expect((await getOutboxFor('u')).map((i) => i.id)).toEqual(['o1']);
    await resetDbForTests();
    const raw = await openDB('kaapspoor');
    expect(raw.version).toBe(4);
    expect([...raw.objectStoreNames].sort()).toEqual(STORES);
    expect([...raw.transaction('outbox').store.indexNames]).toEqual(['byOwner']);
    raw.close();
  });

  it('a fresh install creates every store', async () => {
    expect(await getAllHikes()).toEqual([]);
    await resetDbForTests();
    const raw = await openDB('kaapspoor');
    expect(raw.version).toBe(4);
    expect([...raw.objectStoreNames].sort()).toEqual(STORES);
    expect([...raw.transaction('hikes').store.indexNames]).toEqual(['byRoute']);
    raw.close();
  });

  it("getOutboxFor returns only that owner's items", async () => {
    await putOutboxItem({ id: 'a1', owner: 'a', createdAt: 't', kind: 'confirmation', reportId: 'x', answer: 'GONE' });
    await putOutboxItem({ id: 'b1', owner: 'b', createdAt: 't', kind: 'confirmation', reportId: 'x', answer: 'GONE' });
    expect((await getOutboxFor('a')).map((i) => i.id)).toEqual(['a1']);
  });

  // This tab holds a v4 connection; v5 opening in another tab fires versionchange here, and the
  // blocking handler closes it so that open is not left hanging. (A tab still running the v3
  // build has no such handler; this fix helps from v4 on.)
  it('an open v4 connection is closed when another tab opens v5, so that upgrade completes', async () => {
    await getAllHikes(); // this tab's connection is open
    let blocked = false;
    const newer = openDB('kaapspoor', 5, { blocked() { blocked = true; } });
    const raw = await Promise.race([
      newer,
      new Promise<null>((r) => setTimeout(() => r(null), 1000))
    ]);
    expect(raw).not.toBeNull();
    expect(raw!.version).toBe(5);
    expect(blocked).toBe(false);
    raw!.close();
    // This tab's build is now too old: its next call fails cleanly instead of hanging.
    const later = await Promise.race([
      getAllHikes().then(() => 'resolved', (e: Error) => e.name),
      new Promise<string>((r) => setTimeout(() => r('hung'), 1000))
    ]);
    expect(later).toBe('VersionError');
  });
});
