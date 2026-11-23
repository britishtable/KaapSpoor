import { render, screen } from '@testing-library/svelte';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { get } from 'svelte/store';
import 'fake-indexeddb/auto';
import { syncNow, startSync as realStartSync, syncState } from './sync';
import { configureSession, signIn, signOut, type TokenStorage, type StoredSession } from '$lib/account/session';
import { hikes, visibleHikes, replaceAll, logHike, updateHike, setReview, setClockForTests } from '$lib/journal/store';
import { getMeta, setMeta } from '$lib/journal/db';
import { serialize, parse, exportableHikes } from '$lib/journal/io';
import type { Hike } from '$lib/data/types';
import type { components } from '$lib/api/schema';
import HikeLog from '$lib/components/HikeLog.svelte';

type ServerHike = components['schemas']['Hike'];
type HikeWrite = components['schemas']['HikeWrite'];

const BASE = 'http://srv';
const USERS: Record<string, { id: string; displayName: string; initials: string }> = {
	a: { id: 'user-a', displayName: 'Anele', initials: 'A' },
	b: { id: 'user-b', displayName: 'Bongi', initials: 'B' }
};

/** Spring serialises an Instant without trailing zero millis; the app must not string-compare. */
const instant = (iso: string) => new Date(iso).toISOString().replace('.000Z', 'Z');
const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** In-memory server applying the Task 2 rules. */
function fakeServer() {
	const rows = new Map<string, { owner: string; hike: ServerHike }>();
	let revision = 0;
	const puts: { user: string; id: string; body: HikeWrite }[] = [];
	const gets: { user: string; since: number }[] = [];
	const net = { down: false };
	let gate: Promise<void> | null = null;
	const held = { count: 0 };
	let pageSize = 50;

	/** Jackson's default inclusion writes an absent leg as null, so the fake does too. */
	const jacksonPlan = (p: HikeWrite['plan']) =>
		(p ? { approach: p.approach ?? null, main: p.main ?? null, exit: p.exit ?? null, reversed: p.reversed } : null) as ServerHike['plan'];

	function store(owner: string, id: string, w: HikeWrite): ServerHike {
		const hike: ServerHike = {
			id, routeId: w.routeId, date: w.date ?? null, notes: w.notes, visibility: w.visibility,
			notesVisibility: w.notesVisibility, plan: jacksonPlan(w.plan), startedAt: w.startedAt ?? null,
			finishedAt: w.finishedAt ?? null, updatedAt: instant(w.updatedAt), deleted: w.deleted,
			revision: ++revision, review: w.review ?? null
		};
		rows.set(id, { owner, hike });
		return hike;
	}

	const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const req = input instanceof Request ? input : new Request(input, init);
		if (net.down) throw new TypeError('Failed to fetch');
		const url = new URL(req.url);
		const p = url.pathname;
		if (p === '/api/v1/auth/login') {
			const { email } = await req.json();
			const key = String(email)[0];
			return json({ accessToken: `tok-${key}`, accessExpiresAt: new Date(Date.now() + 600_000).toISOString(), refreshToken: `r-${key}` });
		}
		if (p === '/api/v1/auth/logout') return new Response(null, { status: 204 });
		const key = (req.headers.get('Authorization') ?? '').replace('Bearer tok-', '');
		const user = USERS[key];
		if (!user) return json({ detail: 'Sign in again.' }, 401);
		if (p === '/api/v1/me') return json({ ...user, role: 'USER' });
		if (gate) { held.count++; await gate; }
		const m = p.match(/^\/api\/v1\/hikes\/(.+)$/);
		if (m && req.method === 'PUT') {
			const id = m[1];
			const body = (await req.json()) as HikeWrite;
			puts.push({ user: user.id, id, body });
			if (body.routeId === 'bad') return json({ title: 'Bad Request', status: 400, detail: 'That route does not exist.' }, 400);
			const existing = rows.get(id);
			if (existing && existing.owner !== user.id) return json({ detail: 'Not yours.' }, 409);
			if (existing?.hike.deleted) return json(existing.hike);
			if (!existing || body.deleted || Date.parse(body.updatedAt) > Date.parse(existing.hike.updatedAt)) {
				return json(store(user.id, id, body));
			}
			return json(existing.hike);
		}
		if (p === '/api/v1/hikes' && req.method === 'GET') {
			const since = Number(url.searchParams.get('since') ?? 0);
			gets.push({ user: user.id, since });
			const mine = [...rows.values()]
				.filter((r) => r.owner === user.id && r.hike.revision > since)
				.map((r) => r.hike)
				.sort((x, y) => x.revision - y.revision);
			const page = mine.slice(0, pageSize);
			const next = page.length ? page[page.length - 1].revision : since;
			return json({ hikes: page, next, hasMore: mine.length > page.length });
		}
		return json({ detail: 'Not found' }, 404);
	}) as typeof fetch;

	return {
		f, rows, puts, gets, net, store, held,
		setPageSize(n: number) { pageSize = n; },
		hold() { let open!: () => void; gate = new Promise((r) => { open = () => { gate = null; r(); }; }); return open; }
	};
}

function memoryStorage(): TokenStorage {
	let v: StoredSession | null = null;
	return { load: () => v, save: (s) => { v = s; }, clear: () => { v = null; } };
}

function local(id: string, over: Partial<Hike> = {}): Hike {
	return {
		id, routeId: 'r1', date: '2026-07-21', notes: '', visibility: 'PRIVATE', notesVisibility: 'PRIVATE',
		startedAt: null, finishedAt: null, updatedAt: '2026-11-18T10:00:00.000Z', deleted: false,
		owner: null, pending: true, ...over
	};
}
function write(h: Partial<HikeWrite> = {}): HikeWrite {
	return {
		routeId: 'r1', date: '2026-07-21', notes: '', visibility: 'PRIVATE', notesVisibility: 'PRIVATE',
		startedAt: null, finishedAt: null, updatedAt: '2026-11-18T10:00:00.000Z', deleted: false, plan: null, review: null, ...h
	};
}

const teardowns: (() => void)[] = [];
function startSync(): () => void {
	const stop = realStartSync();
	teardowns.push(stop);
	return stop;
}

let online = true;
let tick = 0;
let server: ReturnType<typeof fakeServer>;

async function signInAs(key: 'a' | 'b') {
	await signIn(`${key}@example.com`, 'a-long-password');
}

beforeEach(async () => {
	online = true;
	Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => online });
	tick = 0;
	// Each call is a second later, so "edited since the request was built" is observable.
	setClockForTests(() => new Date(Date.parse('2026-11-18T12:00:00.000Z') + 1000 * tick++).toISOString());
	await replaceAll({ hikes: [], routeNotes: [] });
	await setMeta('syncCursor:user-a', 0);
	await setMeta('syncCursor:user-b', 0);
	server = fakeServer();
	configureSession({ storage: memoryStorage(), fetch: server.f, baseUrl: BASE });
});

afterEach(async () => {
	for (const stop of teardowns.splice(0)) stop();
	await syncNow();
	setClockForTests(null);
	vi.useRealTimers();
});

describe('sync engine', () => {
	it('pushes pending hikes and clears pending', async () => {
		await signInAs('a');
		await replaceAll({ hikes: [local('h1', { notes: 'windy', syncError: undefined })], routeNotes: [] });
		await syncNow();
		expect(server.puts).toHaveLength(1);
		// The body is HikeWrite only: no owner, pending or syncError.
		expect(server.puts[0].body).toEqual(write({ notes: 'windy' }));
		const h = get(hikes).get('h1')!;
		expect(h).toMatchObject({ pending: false, owner: 'user-a', notes: 'windy' });
		expect(h).not.toHaveProperty('revision');
		expect(h).not.toHaveProperty('syncError');
		expect(get(syncState)).toMatchObject({ status: 'idle', pendingCount: 0 });
		expect(get(syncState).lastSyncedAt).not.toBeNull();
	});

	it('offline: logging a hike keeps it, status offline, uploads on online event', async () => {
		await signInAs('a');
		online = false;
		server.net.down = true;
		const stop = startSync();
		render(HikeLog, { routeId: 'r1' });
		await logHike({ routeId: 'r1', date: '2026-07-21', notes: 'on the ridge' });
		await syncNow();
		expect(server.puts).toHaveLength(0);
		expect(get(syncState)).toMatchObject({ status: 'offline', pendingCount: 1 });
		expect(await screen.findByText('Will send when you have signal')).toBeTruthy();
		expect(get(visibleHikes)[0].notes).toBe('on the ridge');

		online = true;
		server.net.down = false;
		window.dispatchEvent(new Event('online'));
		await vi.waitFor(() => expect(get(visibleHikes)[0].pending).toBe(false));
		expect(server.puts).toHaveLength(1);
		expect(screen.queryByText('Will send when you have signal')).toBeNull();
		stop();
	});

	it('a review written signed out uploads on sign-in', async () => {
		await replaceAll({ hikes: [local('h1', { date: '2026-07-21' })], routeNotes: [] });
		const stop = startSync();
		await setReview('h1', { enjoyment: 4, water: 'RELIABLE' });
		await signInAs('a');
		await vi.waitFor(() => expect(server.puts).toHaveLength(1), { timeout: 5000 });
		expect(server.puts[0].body.review).toEqual({ enjoyment: 4, water: 'RELIABLE' });
		stop();
	});

	it("a pulled hike's review is stored without null fields", async () => {
		await signInAs('a');
		const row = server.store('user-a', 'p1', write({ updatedAt: '2026-11-18T10:00:00.000Z' }));
		row.review = { enjoyment: 3, water: null, note: null } as unknown as ServerHike['review'];
		await syncNow();
		const h = get(hikes).get('p1')!;
		expect(h.review).toEqual({ enjoyment: 3 });
		expect(Object.keys(h.review!)).toEqual(['enjoyment']);
	});

	it('a review written offline shows pending and sends when online fires', async () => {
		await signInAs('a');
		await replaceAll({ hikes: [local('h1', { date: '2026-07-21', pending: false, owner: 'user-a' })], routeNotes: [] });
		online = false;
		server.net.down = true;
		const stop = startSync();
		await setReview('h1', { safety: 'MOSTLY' });
		await syncNow();
		expect(get(hikes).get('h1')!.pending).toBe(true);
		expect(get(syncState)).toMatchObject({ pendingCount: 1 });
		online = true;
		server.net.down = false;
		window.dispatchEvent(new Event('online'));
		await vi.waitFor(() => expect(get(hikes).get('h1')!.pending).toBe(false));
		expect(server.puts.at(-1)!.body.review).toEqual({ safety: 'MOSTLY' });
		stop();
	});

	it('network error mid-run stops and reports offline', async () => {
		await signInAs('a');
		await replaceAll({ hikes: [local('h1')], routeNotes: [] });
		server.net.down = true;
		await syncNow();
		expect(get(syncState).status).toBe('offline');
		expect(get(hikes).get('h1')!.pending).toBe(true);
	});

	it('server newer wins on pull; local pending newer is kept and pushed', async () => {
		await signInAs('a');
		server.store('user-a', 'old', write({ notes: 'from phone 2', updatedAt: '2026-11-18T11:00:00.000Z' }));
		server.store('user-a', 'mine', write({ notes: 'server copy', updatedAt: '2026-11-18T11:00:00.000Z' }));
		await replaceAll({
			hikes: [
				local('old', { notes: 'stale', owner: 'user-a', pending: false, updatedAt: '2026-11-18T10:00:00.000Z' }),
				local('mine', { notes: 'my edit', owner: 'user-a', pending: true, updatedAt: '2026-11-18T11:30:00.000Z' })
			],
			routeNotes: []
		});
		await syncNow();
		expect(get(hikes).get('old')).toMatchObject({ notes: 'from phone 2', pending: false });
		expect(get(hikes).get('mine')).toMatchObject({ notes: 'my edit', pending: false });
		expect(server.rows.get('mine')!.hike.notes).toBe('my edit');
	});

	it('pull compares instants, not strings: a pending local edit 0.5 s newer is kept', async () => {
		await signInAs('a');
		// The server copy is exactly 13:00:05 and arrives as "…:05Z"; as strings it would sort after "…:05.500Z".
		server.store('user-a', 'h1', write({ notes: 'other phone', updatedAt: '2026-11-18T13:00:05.000Z' }));
		await replaceAll({
			hikes: [
				local('h0'),
				local('h1', { owner: 'user-a', pending: false, notes: 'old', updatedAt: '2026-11-18T12:00:00.000Z' })
			],
			routeNotes: []
		});
		const open = server.hold();
		const run = syncNow();
		await vi.waitFor(() => expect(server.held.count).toBe(1)); // h0's PUT is in flight
		setClockForTests(() => '2026-11-18T13:00:05.500Z');
		await updateHike('h1', { notes: 'my edit' }); // pending at pull time, half a second newer
		open();
		await run;
		expect(get(hikes).get('h1')).toMatchObject({ notes: 'my edit', pending: true });
		await syncNow();
		expect(server.rows.get('h1')!.hike.notes).toBe('my edit');
	});

	it('a pulled hike is stored with canonical instants', async () => {
		await signInAs('a');
		server.store('user-a', 'h1', write({
			updatedAt: '2026-11-18T13:00:05.000Z', startedAt: '2026-11-18T08:00:00.000Z', finishedAt: '2026-11-18T12:00:00.000Z'
		}));
		expect(server.rows.get('h1')!.hike.updatedAt).toBe('2026-11-18T13:00:05Z');
		await syncNow();
		expect(get(hikes).get('h1')).toMatchObject({
			updatedAt: '2026-11-18T13:00:05.000Z', startedAt: '2026-11-18T08:00:00.000Z', finishedAt: '2026-11-18T12:00:00.000Z'
		});
	});

	it('pull pages with hasMore and stores the cursor per user', async () => {
		server.setPageSize(2);
		for (const id of ['p1', 'p2', 'p3', 'p4', 'p5']) server.store('user-a', id, write({ notes: id }));
		server.store('user-b', 'q1', write({ notes: 'q1' }));
		await signInAs('a');
		await syncNow();
		expect(server.gets.map((g) => g.since)).toEqual([0, 2, 4]);
		expect(await getMeta('syncCursor:user-a')).toBe(5);
		expect([...get(hikes).keys()].sort()).toEqual(['p1', 'p2', 'p3', 'p4', 'p5']);

		await syncNow();
		expect(server.gets.at(-1)).toEqual({ user: 'user-a', since: 5 });

		await signOut();
		await signInAs('b');
		await syncNow();
		expect(server.gets.at(-1)).toEqual({ user: 'user-b', since: 0 });
		expect(await getMeta('syncCursor:user-b')).toBe(6);
		expect(await getMeta('syncCursor:user-a')).toBe(5);
	});

	it('tombstone from server hides the hike locally', async () => {
		await signInAs('a');
		server.store('user-a', 'gone', write({ deleted: true, notes: '', updatedAt: '2026-11-18T09:00:00.000Z' }));
		server.store('user-a', 'gone2', write({ deleted: true, notes: '', updatedAt: '2026-11-18T09:00:00.000Z' }));
		await replaceAll({
			hikes: [
				local('gone', { owner: 'user-a', pending: false }),
				// A newer local edit cannot resurrect a deleted hike: the PUT answers with the tombstone.
				local('gone2', { owner: 'user-a', pending: true, notes: 'edited', updatedAt: '2026-11-18T11:00:00.000Z' })
			],
			routeNotes: []
		});
		await syncNow();
		expect(get(hikes).get('gone')!.deleted).toBe(true);
		expect(get(hikes).get('gone2')).toMatchObject({ deleted: true, pending: false });
		expect(get(visibleHikes)).toHaveLength(0);
	});

	it('400 sets syncError and stops retrying until edited', async () => {
		await signInAs('a');
		await replaceAll({ hikes: [local('h1', { routeId: 'bad', notes: 'keep me' })], routeNotes: [] });
		await syncNow();
		expect(get(hikes).get('h1')).toMatchObject({ pending: false, syncError: 'That route does not exist.', notes: 'keep me' });
		expect(get(syncState).pendingCount).toBe(0);
		await syncNow();
		expect(server.puts).toHaveLength(1);
		await updateHike('h1', { notes: 'edited' });
		expect(get(hikes).get('h1')!.syncError).toBeUndefined();
		await syncNow();
		expect(server.puts).toHaveLength(2);
	});

	it('edit during an in-flight push stays pending', async () => {
		await signInAs('a');
		await replaceAll({ hikes: [local('h1', { notes: 'first' })], routeNotes: [] });
		const open = server.hold();
		const run = syncNow();
		await vi.waitFor(() => expect(get(syncState).status).toBe('syncing'));
		await updateHike('h1', { notes: 'second' });
		open();
		await run;
		// The server's answer is for "first"; the newer "second" stays and is now owned by A.
		expect(get(hikes).get('h1')).toMatchObject({ notes: 'second', pending: true, owner: 'user-a' });
		await syncNow();
		expect(server.puts.map((p) => p.body.notes)).toEqual(['first', 'second']);
		expect(get(hikes).get('h1')).toMatchObject({ notes: 'second', pending: false });
	});

	it('shared phone', async () => {
		await signInAs('a');
		await logHike({ routeId: 'r1', date: '2026-07-21', notes: 'h1 by A' });
		await syncNow();
		const h1 = get(visibleHikes)[0];
		expect(h1.owner).toBe('user-a');

		await signOut();
		const h2 = await logHike({ routeId: 'r2', date: '2026-07-22', notes: 'h2 unowned' });
		await signInAs('b');
		await syncNow();
		expect(server.puts.filter((p) => p.user === 'user-b').map((p) => p.id)).toEqual([h2.id]);
		expect(get(visibleHikes).map((h) => h.id)).toEqual([h2.id]);
		expect(get(hikes).get(h1.id)!.owner).toBe('user-a');
	});

	it('sign-out during an in-flight PUT still records the owner, so B never sees the hike', async () => {
		await signInAs('a');
		const h = await logHike({ routeId: 'r1', date: '2026-07-21', notes: 'by A' });
		const open = server.hold();
		const run = syncNow();
		await vi.waitFor(() => expect(server.held.count).toBe(1));
		await signOut();
		open();
		await run;
		expect(server.rows.get(h.id)!.owner).toBe('user-a');
		expect(get(hikes).get(h.id)).toMatchObject({ owner: 'user-a', pending: false });
		await signInAs('b');
		await syncNow();
		expect(get(visibleHikes).map((x) => x.id)).not.toContain(h.id);
		expect(server.puts.filter((p) => p.user === 'user-b')).toHaveLength(0);
	});

	it('a hike logged signed in but not yet sent stays with that account, never the next', async () => {
		await signInAs('a');
		online = false;
		server.net.down = true;
		const h = await logHike({ routeId: 'r1', date: '2026-07-21', notes: 'offline by A' });
		await syncNow();
		expect(server.puts).toHaveLength(0);
		online = true;
		server.net.down = false;
		await signOut();
		await signInAs('b');
		await syncNow();
		expect(get(visibleHikes).map((x) => x.id)).not.toContain(h.id);
		expect(server.puts.filter((p) => p.user === 'user-b')).toHaveLength(0);
		expect(get(hikes).get(h.id)).toMatchObject({ owner: 'user-a', pending: true });
	});

	it('a pulled plan with null legs is stored without them and survives export then import', async () => {
		await signInAs('a');
		server.store('user-a', 'p1', write({ plan: { main: 'r1/main/main', reversed: true } }));
		expect(server.rows.get('p1')!.hike.plan).toEqual({ approach: null, main: 'r1/main/main', exit: null, reversed: true });
		await syncNow();
		const pulled = get(hikes).get('p1')!;
		expect(pulled.plan).toEqual({ main: 'r1/main/main', reversed: true });
		const file = serialize({ hikes: exportableHikes([...get(hikes).values()], 'user-a'), routeNotes: [] });
		const back = parse(file);
		expect(back.hikes).toHaveLength(1);
		expect(back.hikes[0].plan).toEqual({ main: 'r1/main/main', reversed: true });
	});

	it('sign-in retries a refused hike once, so a server-side fix heals it without an edit', async () => {
		await replaceAll({
			hikes: [local('h1', { owner: 'user-a', pending: false, syncError: 'That route does not exist.' })],
			routeNotes: []
		});
		const stop = startSync();
		await signInAs('a');
		await vi.waitFor(() => expect(get(hikes).get('h1')!.pending).toBe(false));
		await syncNow();
		expect(server.puts.map((p) => p.id)).toEqual(['h1']);
		expect(get(hikes).get('h1')).not.toHaveProperty('syncError');
		expect(get(syncState)).toMatchObject({ pendingCount: 0, errorCount: 0 });
		await syncNow();
		expect(server.puts).toHaveLength(1);
		stop();
	});

	it('a retried hike the server still refuses keeps its error and is not retried again', async () => {
		await replaceAll({
			hikes: [local('h1', { routeId: 'bad', owner: 'user-a', pending: false, syncError: 'old reason' })],
			routeNotes: []
		});
		const stop = startSync();
		await signInAs('a');
		expect(get(hikes).get('h1')).toMatchObject({ pending: true, syncError: 'old reason' });
		expect(get(syncState)).toMatchObject({ pendingCount: 0, errorCount: 1 });
		await vi.waitFor(() => expect(get(hikes).get('h1')!.pending).toBe(false));
		await syncNow();
		expect(get(hikes).get('h1')!.syncError).toBe('That route does not exist.');
		await syncNow();
		expect(server.puts).toHaveLength(1);
		stop();
	});

	it("sync state is per user: B never sees A's last-synced time or status", async () => {
		await signInAs('a');
		await syncNow();
		expect(get(syncState).lastSyncedAt).not.toBeNull();
		server.net.down = true;
		await replaceAll({ hikes: [local('h1')], routeNotes: [] });
		await syncNow();
		expect(get(syncState).status).toBe('offline');
		server.net.down = false;
		await signOut();
		await signInAs('b');
		expect(get(syncState)).toMatchObject({ status: 'idle', lastSyncedAt: null });
	});

	it('a pending hike of another user is never pushed', async () => {
		await replaceAll({ hikes: [local('theirs', { owner: 'user-a', pending: true })], routeNotes: [] });
		await signInAs('b');
		await syncNow();
		expect(server.puts).toHaveLength(0);
		expect(get(syncState).pendingCount).toBe(0);
	});

	it('concurrent triggers run one sync then one follow-up', async () => {
		await signInAs('a');
		const open = server.hold();
		const first = syncNow();
		const others = [syncNow(), syncNow(), syncNow()];
		open();
		await Promise.all([first, ...others]);
		expect(server.gets).toHaveLength(2);
	});

	it('signed out: no requests, status off', async () => {
		await replaceAll({ hikes: [local('h1')], routeNotes: [] });
		const stop = startSync();
		await syncNow();
		window.dispatchEvent(new Event('online'));
		await syncNow();
		expect(server.puts).toHaveLength(0);
		expect(server.gets).toHaveLength(0);
		expect(get(syncState).status).toBe('off');
		stop();
	});

	it('signing in starts a sync', async () => {
		await replaceAll({ hikes: [local('h1')], routeNotes: [] });
		const stop = startSync();
		await signInAs('a');
		await vi.waitFor(() => expect(server.puts).toHaveLength(1));
		await syncNow();
		stop();
	});

	it('a local write syncs after a 2 s debounce', async () => {
		await signInAs('a');
		await syncNow();
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		const stop = startSync();
		await syncNow(); // the sign-in trigger's run
		await logHike({ routeId: 'r1', date: null, notes: 'a' });
		await logHike({ routeId: 'r1', date: null, notes: 'b' });
		await vi.advanceTimersByTimeAsync(1999);
		expect(server.puts).toHaveLength(0);
		await vi.advanceTimersByTimeAsync(1);
		await vi.waitFor(() => expect(server.puts).toHaveLength(2));
		await syncNow();
		stop();
	});

	it('an import syncs too', async () => {
		await signInAs('a');
		await syncNow();
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		const stop = startSync();
		await syncNow();
		await replaceAll({ hikes: [local('imported')], routeNotes: [] });
		await vi.advanceTimersByTimeAsync(2000);
		await vi.waitFor(() => expect(server.puts.map((p) => p.id)).toEqual(['imported']));
		await syncNow();
		stop();
	});

	it('visible again triggers a sync', async () => {
		await signInAs('a');
		const stop = startSync();
		await syncNow();
		const before = server.gets.length;
		Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
		document.dispatchEvent(new Event('visibilitychange'));
		await vi.waitFor(() => expect(server.gets).toHaveLength(before + 1));
		await syncNow();
		stop();
	});
});
