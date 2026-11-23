import { writable, type Readable } from 'svelte/store';
import { openDB, type DBSchema, type IDBPDatabase, type IDBPTransaction, type StoreNames } from 'idb';
import type { Hike, RouteNotes } from '../data/types';
import type { OutboxItem } from '../reports/types';
import { convertJournal } from './convert';

const DB_NAME = 'kaapspoor';

interface KaapSpoorDB extends DBSchema {
  hikes: { key: string; value: Hike; indexes: { byRoute: string } };
  routeNotes: { key: string; value: RouteNotes };
  meta: { key: string; value: unknown };
  outbox: { key: string; value: OutboxItem; indexes: { byOwner: string } };
}

let dbPromise: Promise<IDBPDatabase<KaapSpoorDB>> | null = null;

const blockedState = writable(false);
/**
 * True while an upgrade waits on another tab that still holds an older version open (a tab on
 * the v3 build never lets go by itself). The layout shows it, so the wait is never silent.
 */
export const upgradeBlocked: Readable<boolean> = { subscribe: blockedState.subscribe };
let converter: typeof convertJournal = convertJournal;

function db(): Promise<IDBPDatabase<KaapSpoorDB>> {
  if (!dbPromise) {
    const convert = converter;
    const opening = openDB<KaapSpoorDB>(DB_NAME, 4, {
      // Everything runs in the one versionchange transaction, so a throw
      // aborts it and leaves the old database untouched.
      async upgrade(database, oldVersion, _newVersion, tx) {
        try {
          await migrate(database, oldVersion, tx, convert);
        } catch {
          // idb does not await this callback, so a throw would not abort the
          // transaction by itself. Abort explicitly; the open then rejects.
          // tx.done rejects on abort; the open's rejection already reports it.
          tx.done.catch(() => {});
          try { tx.abort(); } catch { /* already finished */ }
        }
      },
      // Another tab holds an older version open. Its blocking handler (from v4 on) closes it,
      // and then this open goes ahead. A v3 tab has no such handler, so this waits until the
      // person closes it: say so.
      blocked() { blockedState.set(true); },
      // A newer version is opening in another tab: let go, or that tab's upgrade hangs.
      // The next call here reopens, and fails cleanly if this tab's build is now too old.
      blocking() {
        if (dbPromise === opening) dbPromise = null;
        void opening.then((d) => d.close(), () => {});
      }
    });
    dbPromise = opening;
    // A failed open must not poison later calls.
    opening.catch(() => {
      if (dbPromise === opening) dbPromise = null;
    });
    // Either way the wait is over.
    opening.then(() => blockedState.set(false), () => blockedState.set(false));
  }
  return dbPromise;
}

type UpgradeTx = IDBPTransaction<KaapSpoorDB, StoreNames<KaapSpoorDB>[], 'versionchange'>;

async function migrate(
  database: IDBPDatabase<KaapSpoorDB>,
  oldVersion: number,
  tx: UpgradeTx,
  convert: typeof convertJournal
): Promise<void> {
  // Each step runs only for databases older than it, so every version upgrades additively.
  if (oldVersion < 3) {
    // `journal` is a legacy store absent from the schema, hence the casts.
    const legacy = database.objectStoreNames.contains('journal' as never);
    const rows = legacy
      ? await (tx as unknown as { objectStore(n: string): { getAll(): Promise<unknown[]> } })
          .objectStore('journal').getAll()
      : [];

    const hikes = database.createObjectStore('hikes', { keyPath: 'id' });
    hikes.createIndex('byRoute', 'routeId');
    const notes = database.createObjectStore('routeNotes', { keyPath: 'routeId' });
    database.createObjectStore('meta');

    if (legacy) {
      const out = convert(rows, new Date().toISOString(), () => crypto.randomUUID());
      for (const h of out.hikes) await hikes.put(h);
      for (const n of out.routeNotes) await notes.put(n);
      (database as unknown as { deleteObjectStore(n: string): void }).deleteObjectStore('journal');
    }
  }
  if (oldVersion < 4) {
    database.createObjectStore('outbox', { keyPath: 'id' }).createIndex('byOwner', 'owner');
  }
}

export async function putHike(h: Hike): Promise<void> {
  await (await db()).put('hikes', h);
}

export async function getAllHikes(): Promise<Hike[]> {
  return (await db()).getAll('hikes');
}

export async function putRouteNotes(n: RouteNotes): Promise<void> {
  await (await db()).put('routeNotes', n);
}

export async function getAllRouteNotes(): Promise<RouteNotes[]> {
  return (await db()).getAll('routeNotes');
}

export async function replaceAllData(d: { hikes: Hike[]; routeNotes: RouteNotes[] }): Promise<void> {
  const tx = (await db()).transaction(['hikes', 'routeNotes'], 'readwrite');
  const hikes = tx.objectStore('hikes');
  const notes = tx.objectStore('routeNotes');
  await Promise.all([
    hikes.clear(),
    notes.clear(),
    ...d.hikes.map((h) => hikes.put(h)),
    ...d.routeNotes.map((n) => notes.put(n)),
    tx.done
  ]);
}

export async function putOutboxItem(item: OutboxItem): Promise<void> {
  await (await db()).put('outbox', item);
}

export async function getOutboxItem(id: string): Promise<OutboxItem | undefined> {
  return (await db()).get('outbox', id);
}

export async function deleteOutboxItem(id: string): Promise<void> {
  await (await db()).delete('outbox', id);
}

/** One account's queued items, in no particular order. */
export async function getOutboxFor(owner: string): Promise<OutboxItem[]> {
  return (await db()).getAllFromIndex('outbox', 'byOwner', owner);
}

export async function getAllOutbox(): Promise<OutboxItem[]> {
  return (await db()).getAll('outbox');
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  return (await (await db()).get('meta', key)) as T | undefined;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await (await db()).put('meta', value, key);
}

/** Closes the connection and forgets it, so tests can reopen at a chosen version. */
export async function resetDbForTests(opts?: { convert?: typeof convertJournal }): Promise<void> {
  const p = dbPromise;
  dbPromise = null;
  converter = opts?.convert ?? convertJournal;
  if (p) {
    try { (await p).close(); } catch { /* the open had failed */ }
  }
}
