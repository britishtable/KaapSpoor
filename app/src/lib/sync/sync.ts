import { derived, get, writable, type Readable } from 'svelte/store';
import type { components } from '$lib/api/schema';
import type { Hike } from '$lib/data/types';
import { api, session } from '$lib/account/session';
import { hikes, visibleHikes, applyServerHike, onLocalWrite, now } from '$lib/journal/store';
import { getMeta, setMeta } from '$lib/journal/db';

type ServerHike = components['schemas']['Hike'];
type HikeWrite = components['schemas']['HikeWrite'];
type Client = NonNullable<ReturnType<typeof api>>;

export type SyncStatus = 'off' | 'idle' | 'syncing' | 'offline' | 'error';
export interface SyncState { status: SyncStatus; pendingCount: number; lastSyncedAt: string | null }

const DEBOUNCE_MS = 2000;

const engine = writable<{ status: Exclude<SyncStatus, 'off'>; lastSyncedAt: string | null }>({
	status: 'idle', lastSyncedAt: null
});

export const syncState: Readable<SyncState> = derived([engine, session, visibleHikes], ([$e, $s, $v]): SyncState => {
	const me = $s?.id ?? null;
	return {
		status: me === null || api() === null ? 'off' : $e.status,
		pendingCount: $v.filter((h) => h.pending && (h.owner === null || h.owner === me)).length,
		lastSyncedAt: $e.lastSyncedAt
	};
});

function setStatus(status: Exclude<SyncStatus, 'off'>): void {
	engine.update((e) => ({ ...e, status }));
}

/** The server body, field by field: owner, pending and syncError never leave the device. */
function toWrite(h: Hike): HikeWrite {
	return {
		routeId: h.routeId, date: h.date, notes: h.notes, visibility: h.visibility,
		notesVisibility: h.notesVisibility, plan: h.plan ?? null, startedAt: h.startedAt,
		finishedAt: h.finishedAt, updatedAt: h.updatedAt, deleted: h.deleted
	};
}

function fromServer(s: ServerHike, owner: string): Hike {
	const h: Hike = {
		id: s.id, routeId: s.routeId, date: s.date, notes: s.notes, visibility: s.visibility,
		notesVisibility: s.notesVisibility, startedAt: s.startedAt, finishedAt: s.finishedAt,
		updatedAt: s.updatedAt, deleted: s.deleted, owner, pending: false
	};
	if (s.plan) h.plan = s.plan;
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

/** One request; a rejected fetch means no signal, and a changed user means this run is over. */
async function call<T>(me: string, fn: () => Promise<T>): Promise<T> {
	let res: T;
	try {
		res = await fn();
	} catch {
		throw new Offline();
	}
	if (get(session)?.id !== me) throw new Stop();
	return res;
}

async function push(client: Client, me: string): Promise<void> {
	const queue = [...get(hikes).values()].filter((h) => h.pending && (h.owner === null || h.owner === me));
	for (const sent of queue) {
		const res = await call(me, () =>
			client.PUT('/api/v1/hikes/{id}', { params: { path: { id: sent.id } }, body: toWrite(sent) })
		);
		const current = get(hikes).get(sent.id);
		const status = res.response.status;
		if (res.data) {
			if (current === sent) await applyServerHike(fromServer(res.data, me));
			// Edited while in flight: the server's answer is already stale. Claim it and keep it queued.
			else if (current) await applyServerHike({ ...current, owner: me });
		} else if (status === 400 || status === 409) {
			// Keep the data; the next edit re-queues it.
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
		const res = await call(me, () => client.GET('/api/v1/hikes', { params: { query: { since } } }));
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
		setStatus('offline');
		return;
	}
	setStatus('syncing');
	try {
		await push(client, me);
		await pull(client, me);
		engine.set({ status: 'idle', lastSyncedAt: now() });
	} catch (e) {
		if (e instanceof Offline) setStatus('offline');
		else if (e instanceof Stop) setStatus('idle'); // signed out or switched user; that change triggers its own run
		else setStatus('error');
	}
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
		if (id !== null && id !== user) trigger();
		user = id;
	});
	const offWrite = onLocalWrite(() => {
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => { timer = null; trigger(); }, DEBOUNCE_MS);
	});
	const onVisible = () => { if (document.visibilityState === 'visible') trigger(); };
	window.addEventListener('online', trigger);
	document.addEventListener('visibilitychange', onVisible);

	return () => {
		offSession();
		offWrite();
		if (timer) clearTimeout(timer);
		window.removeEventListener('online', trigger);
		document.removeEventListener('visibilitychange', onVisible);
	};
}
