import { derived, get, writable, type Readable } from 'svelte/store';
import type { components } from '$lib/api/schema';
import type { Hike } from '$lib/data/types';
import { api, session } from '$lib/account/session';
import { hikes, visibleHikes, applyServerHike, onLocalWrite, now } from '$lib/journal/store';
import { getMeta, setMeta } from '$lib/journal/db';
import { cleanPlan, cleanReview } from '$lib/journal/convert';
import { flushOutbox, onOutboxWrite, OutboxOfflineError } from '$lib/reports/outbox';

type ServerHike = components['schemas']['Hike'];
type HikeWrite = components['schemas']['HikeWrite'];
type Client = NonNullable<ReturnType<typeof api>>;

export type SyncStatus = 'off' | 'idle' | 'syncing' | 'offline' | 'error';
/** pendingCount: waiting to upload. errorCount: the server refused them (each carries syncError). */
export interface SyncState { status: SyncStatus; pendingCount: number; errorCount: number; lastSyncedAt: string | null }

const DEBOUNCE_MS = 2000;

/** The engine's state belongs to the user it last ran for; another user starts from scratch. */
const engine = writable<{ user: string | null; status: Exclude<SyncStatus, 'off'>; lastSyncedAt: string | null }>({
	user: null, status: 'idle', lastSyncedAt: null
});

export const syncState: Readable<SyncState> = derived([engine, session, visibleHikes], ([$e, $s, $v]): SyncState => {
	const me = $s?.id ?? null;
	const ours = $e.user !== null && $e.user === me;
	const mine = $v.filter((h) => h.owner === null || h.owner === me);
	return {
		status: me === null || api() === null ? 'off' : ours ? $e.status : 'idle',
		pendingCount: mine.filter((h) => h.pending && !h.syncError).length,
		errorCount: mine.filter((h) => h.syncError).length,
		lastSyncedAt: ours ? $e.lastSyncedAt : null
	};
});

function setStatus(me: string, status: Exclude<SyncStatus, 'off'>): void {
	engine.update((e) => (e.user === me ? { ...e, status } : { user: me, status, lastSyncedAt: null }));
}

/** The server body, field by field: owner, pending and syncError never leave the device. */
function toWrite(h: Hike): HikeWrite {
	return {
		routeId: h.routeId, date: h.date, notes: h.notes, visibility: h.visibility,
		notesVisibility: h.notesVisibility, plan: h.plan ?? null, review: h.review ?? null, startedAt: h.startedAt,
		finishedAt: h.finishedAt, updatedAt: h.updatedAt, deleted: h.deleted
	};
}

/** Canonical ISO form, so instants stored locally all compare and sort the same way. */
const canonical = (iso: string) => new Date(iso).toISOString();

function fromServer(s: ServerHike, owner: string): Hike {
	const h: Hike = {
		id: s.id, routeId: s.routeId, date: s.date, notes: s.notes, visibility: s.visibility,
		notesVisibility: s.notesVisibility,
		startedAt: s.startedAt === null ? null : canonical(s.startedAt),
		finishedAt: s.finishedAt === null ? null : canonical(s.finishedAt),
		updatedAt: canonical(s.updatedAt), deleted: s.deleted, owner, pending: false
	};
	// Jackson may write absent legs as null; the device never stores them so.
	if (s.plan) h.plan = cleanPlan(s.plan);
	if (s.review) h.review = cleanReview(s.review);
	return h;
}

function problemDetail(error: unknown): string {
	const d = (error as { detail?: unknown } | undefined)?.detail;
	return typeof d === 'string' && d ? d : "The server didn't accept this hike.";
}

/** Instants compare as times: the server may drop zero millis ("…:00Z" vs "…:00.000Z"). */
const time = (iso: string) => Date.parse(iso);

class Offline extends Error {}
class Stop extends Error {}

/** One request; a rejected fetch means no signal. */
async function request<T>(fn: () => Promise<T>): Promise<T> {
	try {
		return await fn();
	} catch {
		throw new Offline();
	}
}

/** A sign-out or user switch ends the run: no further requests or pulled writes for the old user. */
function stillSignedInAs(me: string): void {
	if (get(session)?.id !== me) throw new Stop();
}

async function push(client: Client, me: string): Promise<void> {
	const queue = [...get(hikes).values()].filter((h) => h.pending && (h.owner === null || h.owner === me));
	for (const sent of queue) {
		const res = await request(() =>
			client.PUT('/api/v1/hikes/{id}', { params: { path: { id: sent.id } }, body: toWrite(sent) })
		);
		const current = get(hikes).get(sent.id);
		const status = res.response.status;
		if (res.data) {
			// The server now holds this hike under `me`. Record that even if the user signed out
			// meanwhile, or it would stay unowned and show up for the next person on this phone.
			if (current === sent) await applyServerHike(fromServer(res.data, me));
			// Edited while in flight: the server's answer is already stale. Claim it and keep it queued.
			else if (current) await applyServerHike({ ...current, owner: me });
			stillSignedInAs(me);
			continue;
		}
		stillSignedInAs(me);
		if (status === 400 || status === 409) {
			// Keep the data; the next edit, sign-in or app start re-queues it.
			if (current === sent) await applyServerHike({ ...current, pending: false, syncError: problemDetail(res.error) });
		} else {
			// 401: the session has already decided. Anything else: try again on the next trigger.
			throw new Error(`PUT ${status}`);
		}
	}
}

async function pull(client: Client, me: string): Promise<void> {
	const key = `syncCursor:${me}`;
	let since = (await getMeta<number>(key)) ?? 0;
	for (;;) {
		const res = await request(() => client.GET('/api/v1/hikes', { params: { query: { since } } }));
		stillSignedInAs(me);
		if (!res.data) throw new Error(`GET ${res.response.status}`);
		for (const s of res.data.hikes) {
			const local = get(hikes).get(s.id);
			if (!local || !local.pending || time(s.updatedAt) >= time(local.updatedAt)) {
				await applyServerHike(fromServer(s, me));
			}
		}
		since = res.data.next;
		await setMeta(key, since);
		if (!res.data.hasMore) return;
	}
}

async function runOnce(): Promise<void> {
	const me = get(session)?.id ?? null;
	const client = api();
	if (me === null || client === null) return;
	if (typeof navigator !== 'undefined' && navigator.onLine === false) {
		setStatus(me, 'offline');
		return;
	}
	setStatus(me, 'syncing');
	try {
		await push(client, me);
		// After the hikes: a report may name a hike the server must already hold.
		await flushOutbox(client, me);
		stillSignedInAs(me);
		await pull(client, me);
		engine.set({ user: me, status: 'idle', lastSyncedAt: now() });
	} catch (e) {
		if (e instanceof Offline || e instanceof OutboxOfflineError) setStatus(me, 'offline');
		else if (e instanceof Stop) setStatus(me, 'idle'); // signed out or switched user; that change triggers its own run
		else setStatus(me, 'error');
	}
}

/**
 * Gives every hike the server refused one more try, so a fix on the server heals it without
 * an edit. Its syncError stays until the server answers again. The store updates before this
 * returns (only the disk write is awaited), so a sync started right after already sees them.
 */
export function requeueRefused(me: string): Promise<void> {
	const refused = [...get(hikes).values()].filter(
		(h) => h.syncError && !h.pending && (h.owner === null || h.owner === me)
	);
	return Promise.all(refused.map((h) => applyServerHike({ ...h, pending: true }))).then(() => undefined);
}

let running: Promise<void> | null = null;
let followUp: Promise<void> | null = null;

/** Single-flight: a call during a run schedules exactly one more run after it. */
export function syncNow(): Promise<void> {
	if (!running) {
		running = runOnce().finally(() => { running = null; });
		return running;
	}
	followUp ??= running.then(() => {
		followUp = null;
		return syncNow();
	});
	return followUp;
}

/** Wires the event triggers (no polling) and returns a teardown. */
export function startSync(): () => void {
	const trigger = () => { void syncNow(); };
	let timer: ReturnType<typeof setTimeout> | null = null;
	let user: string | null = null;

	const offSession = session.subscribe((s) => {
		const id = s?.id ?? null;
		// Sign-in, or the session restored at app start: retry refused hikes once, then sync.
		if (id !== null && id !== user) {
			void requeueRefused(id).catch(() => undefined); // a failed disk write rolls back; the retry waits for next time
			trigger();
		}
		user = id;
	});
	const offWrite = onLocalWrite(() => {
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => { timer = null; trigger(); }, DEBOUNCE_MS);
	});
	// A report or answer is one deliberate act, not typing: send it at once.
	const offOutbox = onOutboxWrite(trigger);
	const onVisible = () => { if (document.visibilityState === 'visible') trigger(); };
	window.addEventListener('online', trigger);
	document.addEventListener('visibilitychange', onVisible);

	return () => {
		offSession();
		offWrite();
		offOutbox();
		if (timer) clearTimeout(timer);
		window.removeEventListener('online', trigger);
		document.removeEventListener('visibilitychange', onVisible);
	};
}
