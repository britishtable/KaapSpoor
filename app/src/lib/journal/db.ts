import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { JournalEntry } from '../data/types';

const DB_NAME = 'kaapspoor';
const STORE = 'journal';

interface KaapSpoorDB extends DBSchema {
  journal: { key: string; value: JournalEntry };
}

let dbPromise: Promise<IDBPDatabase<KaapSpoorDB>> | null = null;

function db(): Promise<IDBPDatabase<KaapSpoorDB>> {
  if (!dbPromise) {
    dbPromise = openDB<KaapSpoorDB>(DB_NAME, 1, {
      upgrade(database) {
        if (!database.objectStoreNames.contains(STORE)) {
          database.createObjectStore(STORE, { keyPath: 'routeId' });
        }
      }
    });
  }
  return dbPromise;
}

export async function putEntry(entry: JournalEntry): Promise<void> {
  await (await db()).put(STORE, entry);
}

export async function getAllEntries(): Promise<JournalEntry[]> {
  return (await db()).getAll(STORE);
}

export async function clearEntries(): Promise<void> {
  await (await db()).clear(STORE);
}
