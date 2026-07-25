import { openDB, type IDBPDatabase } from 'idb';
import type { JournalEntry } from '../data/types';

const DB_NAME = 'kaapspoor';
const STORE = 'journal';

let dbPromise: Promise<IDBPDatabase> | null = null;

function db(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, 1, {
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
