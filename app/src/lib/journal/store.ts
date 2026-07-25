import { writable } from 'svelte/store';
import type { JournalEntry } from '../data/types';
import { getAllEntries, putEntry, clearEntries } from './db';

export const journal = writable<Map<string, JournalEntry>>(new Map());

function update(fn: (m: Map<string, JournalEntry>) => void): void {
  journal.update((m) => { const next = new Map(m); fn(next); return next; });
}

export async function hydrate(): Promise<void> {
  const rows = await getAllEntries();
  journal.set(new Map(rows.map((r) => [r.routeId, r])));
}

export async function setEntry(entry: JournalEntry): Promise<void> {
  await putEntry(entry);
  update((m) => m.set(entry.routeId, entry));
}

export async function toggleDone(routeId: string): Promise<void> {
  let current: JournalEntry | undefined;
  journal.subscribe((m) => (current = m.get(routeId)))();
  const next: JournalEntry = current
    ? { ...current, done: !current.done }
    : { routeId, done: true, date: null, notes: '' };
  await setEntry(next);
}

export async function replaceAll(entries: JournalEntry[]): Promise<void> {
  await clearEntries();
  for (const e of entries) await putEntry(e);
  journal.set(new Map(entries.map((e) => [e.routeId, e])));
}
