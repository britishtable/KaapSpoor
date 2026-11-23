import { derived, get, writable, type Readable, type Writable } from 'svelte/store';
import {
  REVIEW_NOTE_MAX, REVIEW_SAFETY_NOTE_MAX,
  type Hike, type JournalPlan, type Review, type RouteNotes, type Visibility
} from '../data/types';
import { getAllHikes, getAllRouteNotes, putHike, putRouteNotes, replaceAllData } from './db';

export const hikes = writable<Map<string, Hike>>(new Map());
export const routeNotes = writable<Map<string, RouteNotes>>(new Map());
/** The signed-in user id. Set by the account flow; null when signed out. */
export const viewer = writable<string | null>(null);

export class ActiveHikeError extends Error {
  constructor() {
    super('A hike is already in progress.');
    this.name = 'ActiveHikeError';
  }
}

/** A review was refused: the hike is in progress or dated in the future. */
export class ReviewNotAllowedError extends Error {
  constructor() {
    super('A hike can be reviewed once it is finished and not dated in the future.');
    this.name = 'ReviewNotAllowedError';
  }
}

/** A review the server would refuse; carries the reason. */
export class InvalidReviewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidReviewError';
  }
}

/** Editing or deleting a hike saved to an account other than the viewer's (signed out: any account). */
export class LockedHikeError extends Error {
  constructor() {
    super('Sign in to change hikes saved to your account.');
    this.name = 'LockedHikeError';
  }
}

/** Signed out, a hike saved to an account is read-only: anyone may be holding the phone. */
export function isLocked(h: Hike, viewer: string | null): boolean {
  return h.owner !== null && h.owner !== viewer;
}

let clock: () => string = () => new Date().toISOString();
export function now(): string { return clock(); }
export function setClockForTests(fn: (() => string) | null): void {
  clock = fn ?? (() => new Date().toISOString());
}

const listeners = new Set<() => void>();
export function onLocalWrite(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
function notifyLocalWrite(): void {
  for (const fn of [...listeners]) fn();
}

function updateMap<T>(store: Writable<Map<string, T>>, fn: (m: Map<string, T>) => void): void {
  store.update((m) => { const next = new Map(m); fn(next); return next; });
}

export function localDate(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** May this hike be reviewed: live, not in progress, not dated after `today` (YYYY-MM-DD). */
export function canReview(h: Hike, today: string): boolean {
  if (h.deleted) return false;
  if (h.startedAt !== null && h.finishedAt === null) return false;
  return h.date === null || h.date <= today;
}

/** Why the server would refuse this review, or null. The one definition of a valid review's shape. */
export function reviewProblem(r: Review): string | null {
  const answered = r.difficulty !== undefined || r.enjoyment !== undefined || r.safety !== undefined ||
    r.navigation !== undefined || r.water !== undefined;
  if (!answered && (r.note === undefined || r.note.trim() === '')) return 'Answer at least one question or write a note.';
  if (r.safetyNote !== undefined && r.safety === undefined) return 'A safety note needs a safety answer.';
  if (r.enjoyment !== undefined && (!Number.isInteger(r.enjoyment) || r.enjoyment < 1 || r.enjoyment > 5)) {
    return 'Enjoyment is 1 to 5.';
  }
  if (r.note !== undefined && r.note.length > REVIEW_NOTE_MAX) return `The note is over ${REVIEW_NOTE_MAX} characters.`;
  if (r.safetyNote !== undefined && r.safetyNote.length > REVIEW_SAFETY_NOTE_MAX) {
    return `The safety note is over ${REVIEW_SAFETY_NOTE_MAX} characters.`;
  }
  return null;
}

// ---- derived ----

export const visibleHikes: Readable<Hike[]> = derived([hikes, viewer], ([$h, $v]) =>
  [...$h.values()].filter((h) => !h.deleted && ($v === null || h.owner === null || h.owner === $v))
);

export const doneRouteIds: Readable<Set<string>> = derived(
  visibleHikes, ($v) => new Set($v.map((h) => h.routeId))
);

export const activeHike: Readable<Hike | null> = derived(
  visibleHikes, ($v) => $v.find((h) => h.startedAt !== null && h.finishedAt === null) ?? null
);

export function hikesForRoute(routeId: string): Readable<Hike[]> {
  return derived(visibleHikes, ($v) =>
    $v.filter((h) => h.routeId === routeId).sort((a, b) => {
      if (a.date !== b.date) {
        if (a.date === null) return 1;
        if (b.date === null) return -1;
        return a.date < b.date ? 1 : -1;
      }
      return a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0;
    })
  );
}

// ---- persistence ----

export async function hydrate(): Promise<void> {
  const [h, n] = await Promise.all([getAllHikes(), getAllRouteNotes()]);
  hikes.set(new Map(h.map((x) => [x.id, x])));
  routeNotes.set(new Map(n.map((x) => [x.routeId, x])));
}

export async function replaceAll(d: { hikes: Hike[]; routeNotes: RouteNotes[] }): Promise<void> {
  await replaceAllData(d);
  hikes.set(new Map(d.hikes.map((x) => [x.id, x])));
  routeNotes.set(new Map(d.routeNotes.map((x) => [x.routeId, x])));
  // An import is a local write: imported pending hikes should sync too.
  notifyLocalWrite();
}

/** Optimistic write of one hike; rolls back only if this call's value is still current. */
async function writeHike(hike: Hike): Promise<void> {
  const previous = get(hikes).get(hike.id);
  // Update the store first so the UI and a reload in between agree.
  updateMap(hikes, (m) => m.set(hike.id, hike));
  try {
    await putHike(hike);
  } catch (err) {
    // Only undo our own value: a newer overlapping write must survive.
    updateMap(hikes, (m) => {
      if (m.get(hike.id) !== hike) return;
      if (previous) m.set(hike.id, previous);
      else m.delete(hike.id);
    });
    throw err;
  }
}

async function localWriteHike(hike: Hike): Promise<Hike> {
  // Written while signed in: the hike is the viewer's now, so it can never upload to the next account.
  const owner = hike.owner ?? get(viewer);
  const stamped: Hike = { ...hike, owner, updatedAt: now(), pending: true };
  delete stamped.syncError;
  await writeHike(stamped);
  notifyLocalWrite();
  return stamped;
}

function requireHike(id: string): Hike {
  const h = get(hikes).get(id);
  if (!h) throw new Error(`No hike ${id}.`);
  return h;
}

function requireEditable(id: string): Hike {
  const h = requireHike(id);
  if (isLocked(h, get(viewer))) throw new LockedHikeError();
  return h;
}

// ---- actions ----

export async function logHike(input: {
  routeId: string; date: string | null; notes: string;
  visibility?: Visibility; notesVisibility?: Visibility; plan?: JournalPlan;
}): Promise<Hike> {
  const hike: Hike = {
    id: crypto.randomUUID(), routeId: input.routeId, date: input.date, notes: input.notes,
    visibility: input.visibility ?? 'PRIVATE', notesVisibility: input.notesVisibility ?? 'PRIVATE',
    startedAt: null, finishedAt: null, updatedAt: now(),
    deleted: false, owner: get(viewer), pending: true
  };
  if (input.plan) hike.plan = input.plan;
  return localWriteHike(hike);
}

export async function updateHike(
  id: string,
  patch: Partial<Pick<Hike, 'date' | 'notes' | 'visibility' | 'notesVisibility' | 'plan'>>
): Promise<void> {
  const next = { ...requireEditable(id), ...patch };
  // Never drop a review silently: refuse the edit that would make the server refuse it.
  if (next.review && !canReview(next, localDate())) throw new ReviewNotAllowedError();
  await localWriteHike(next);
}

/** Final and scrubbed, as on the server: only the route and visibility stay. */
export async function deleteHike(id: string): Promise<void> {
  const next: Hike = {
    ...requireEditable(id), deleted: true, notes: '', date: null, startedAt: null, finishedAt: null
  };
  delete next.plan;
  delete next.review;
  await localWriteHike(next);
}

/** Saves (or, with null, removes) the hike's review. */
export async function setReview(hikeId: string, review: Review | null): Promise<Hike> {
  const h = requireEditable(hikeId);
  if (review !== null) {
    if (!canReview(h, localDate())) throw new ReviewNotAllowedError();
    const problem = reviewProblem(review);
    if (problem) throw new InvalidReviewError(problem);
  }
  const next: Hike = { ...h };
  if (review) next.review = review;
  else delete next.review;
  return localWriteHike(next);
}

export async function startHike(routeId: string, plan?: JournalPlan): Promise<Hike> {
  if (get(activeHike)) throw new ActiveHikeError();
  const hike: Hike = {
    id: crypto.randomUUID(), routeId, date: localDate(), notes: '',
    visibility: 'PRIVATE', notesVisibility: 'PRIVATE',
    startedAt: now(), finishedAt: null, updatedAt: now(),
    deleted: false, owner: get(viewer), pending: true
  };
  if (plan) hike.plan = plan;
  return localWriteHike(hike);
}

export async function finishHike(id: string): Promise<void> {
  await localWriteHike({ ...requireHike(id), finishedAt: now() });
}

export async function setRouteNotes(routeId: string, notes: string, plan?: JournalPlan): Promise<void> {
  const previous = get(routeNotes).get(routeId);
  const next: RouteNotes = { routeId, notes, updatedAt: now() };
  if (plan) next.plan = plan;
  updateMap(routeNotes, (m) => m.set(routeId, next));
  try {
    await putRouteNotes(next);
  } catch (err) {
    updateMap(routeNotes, (m) => {
      if (m.get(routeId) !== next) return;
      if (previous) m.set(routeId, previous);
      else m.delete(routeId);
    });
    throw err;
  }
  notifyLocalWrite();
}

/** Writes a server-sourced hike as given: no updatedAt or pending change, no listeners. */
export async function applyServerHike(h: Hike): Promise<void> {
  await writeHike(h);
}
