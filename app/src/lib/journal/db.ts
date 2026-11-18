import { openDB, type DBSchema, type IDBPDatabase, type IDBPTransaction, type StoreNames } from 'idb';
import type { Hike, RouteNotes } from '../data/types';
import { convertJournal } from './convert';

const DB_NAME = 'kaapspoor';

interface KaapSpoorDB extends DBSchema {
  hikes: { key: string; value: Hike; indexes: { byRoute: string } };
  routeNotes: { key: string; value: RouteNotes };
  meta: { key: string; value: unknown };
}

let dbPromise: Promise<IDBPDatabase<KaapSpoorDB>> | null = null;
let converter: typeof convertJournal = convertJournal;

function db(): Promise<IDBPDatabase<KaapSpoorDB>> {
  if (!dbPromise) {
    const convert = converter;
    const opening = openDB<KaapSpoorDB>(DB_NAME, 3, {
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
      }
    });
    dbPromise = opening;
    // A failed open must not poison later calls.
    opening.catch(() => {
      if (dbPromise === opening) dbPromise = null;
    });
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
  // `journal` is a legacy store absent from the schema, hence the casts.
  const legacy = oldVersion < 3 && database.objectStoreNames.contains('journal' as never);
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
