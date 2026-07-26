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
  let previous: JournalEntry | undefined;
  journal.subscribe((m) => (previous = m.get(entry.routeId)))();

  // Update the store first: the checkbox flips optimistically on click, so the
  // store must match it immediately or a reload in between loses the toggle.
  update((m) => m.set(entry.routeId, entry));

  try {
    await putEntry(entry);
  } catch (err) {
    // Roll back so the UI stops claiming a save that did not happen.
    update((m) => {
      if (previous) m.set(entry.routeId, previous);
      else m.delete(entry.routeId);
    });
    throw err;
  }
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
