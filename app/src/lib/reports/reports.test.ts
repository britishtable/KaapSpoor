import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { loadRouteReports } from './reports';
import { hydrateOutbox } from './outbox';
import { putOutboxItem, resetDbForTests } from '$lib/journal/db';

/** Lets a test make the outbox read fail, as a broken IndexedDB would. */
const idb = vi.hoisted(() => ({ fail: false }));
vi.mock('$lib/journal/db', async (original) => {
	const actual = await original<typeof import('$lib/journal/db')>();
	return {
		...actual,
		getOutboxFor: (owner: string) => (idb.fail ? Promise.reject(new Error('idb broke')) : actual.getOutboxFor(owner))
	};
});
import { configureSession, restoreSession, type StoredSession, type TokenStorage } from '$lib/account/session';
import type { MyReport, PublicReport } from './types';

const BASE = 'http://srv';
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

function storageWith(s: StoredSession | null): TokenStorage {
	let v = s;
	return { load: () => v, save: (n) => { v = n; }, clear: () => { v = null; } };
}
const signedIn = (token = 'tok-a'): StoredSession => ({
	accessToken: token, accessExpiresAt: new Date(Date.now() + 600_000).toISOString(), refreshToken: 'r-a',
	user: { id: 'user-a', displayName: 'Anele', initials: 'A' }
});

const pub = (id: string, over: Partial<PublicReport> = {}): PublicReport => ({
	id, category: 'OBSTRUCTION', note: '', observedAt: '2026-11-23T07:00:00Z', lastConfirmedAt: null,
	expiresAt: null, clearedAt: null, position: null, displayName: 'Bongi', unverified: false, ...over
});
const mine = (id: string): MyReport => ({
	id, routeId: 'r1', category: 'FIRE', note: '', observedAt: '2026-11-23T08:00:00Z', lastConfirmedAt: null,
	expiresAt: null, clearedAt: null, position: null, hikeId: 'h1', held: true, unverified: false
});
const reportItem = (id: string, owner: string, routeId = 'r1') => ({
	id, owner, createdAt: '2026-11-23T09:00:00.000Z', kind: 'report' as const,
	body: { routeId, category: 'WATER' as const, observedAt: '2026-11-23T09:00:00.000Z' }
});

type Handler = (req: Request, path: string) => Response | Promise<Response>;
function fakeFetch(handler: Handler) {
	const calls: Request[] = [];
	const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const req = input instanceof Request ? input : new Request(input, init);
		calls.push(req.clone());
		return handler(req, new URL(req.url).pathname);
	}) as typeof fetch;
	return { f, calls };
}

beforeEach(async () => {
	await resetDbForTests();
	await new Promise<void>((resolve, reject) => {
		const req = indexedDB.deleteDatabase('kaapspoor');
		req.onsuccess = () => resolve();
		req.onerror = () => reject(req.error);
	});
	await hydrateOutbox();
});
afterEach(() => {
	idb.fail = false;
	configureSession();
});

describe('loadRouteReports', () => {
	it('merges public, mine-held and pending without duplicates', async () => {
		// sent-1 was sent and is now held on the server; its outbox row is still on disk.
		await putOutboxItem(reportItem('sent-1', 'user-a'));
		await putOutboxItem(reportItem('queued-1', 'user-a'));
		await putOutboxItem(reportItem('other-route', 'user-a', 'r2'));
		await putOutboxItem(reportItem('by-b', 'user-b'));
		await putOutboxItem({ id: 'x:user-a', owner: 'user-a', createdAt: 't', kind: 'confirmation', reportId: 'p1', answer: 'GONE' });
		const { f, calls } = fakeFetch((req, p) => {
			if (p === '/api/v1/routes/r1/reports') return json({ active: [pub('p1')], history: [pub('p0', { clearedAt: '2026-11-22T00:00:00Z' })] });
			if (p === '/api/v1/reports/mine') {
				expect(new URL(req.url).searchParams.get('routeId')).toBe('r1');
				expect(req.headers.get('Authorization')).toBe('Bearer tok-a');
				return json([mine('sent-1')]);
			}
			return json({}, 404);
		});
		configureSession({ storage: storageWith(signedIn()), fetch: f, baseUrl: BASE });
		restoreSession();
		const view = await loadRouteReports('r1');
		expect(view).not.toBeTypeOf('string');
		if (typeof view === 'string') return;
		expect(view.active.map((r) => r.id)).toEqual(['p1']);
		expect(view.history.map((r) => r.id)).toEqual(['p0']);
		expect(view.mineHeld.map((r) => r.id)).toEqual(['sent-1']);
		expect(view.minePending.map((r) => r.id)).toEqual(['queued-1']);
		expect(calls).toHaveLength(2);
	});

	it('mineIds lists every own report on the route; mineHeld only the held ones not public', async () => {
		const released = { ...mine('rel-1'), held: false };
		const { f } = fakeFetch((_r, p) =>
			p === '/api/v1/routes/r1/reports'
				? json({ active: [pub('rel-1')], history: [] })
				: json([mine('held-1'), released])
		);
		configureSession({ storage: storageWith(signedIn()), fetch: f, baseUrl: BASE });
		restoreSession();
		const view = await loadRouteReports('r1');
		if (typeof view === 'string') throw new Error(view);
		expect([...view.mineIds].sort()).toEqual(['held-1', 'rel-1']);
		expect(view.mineHeld.map((r) => r.id)).toEqual(['held-1']);
	});

	it('a report /mine says is released but the public list lacks is not shown as held', async () => {
		const { f } = fakeFetch((_r, p) =>
			p === '/api/v1/routes/r1/reports' ? json({ active: [], history: [] }) : json([{ ...mine('rel-1'), held: false }])
		);
		configureSession({ storage: storageWith(signedIn()), fetch: f, baseUrl: BASE });
		restoreSession();
		const view = await loadRouteReports('r1');
		if (typeof view === 'string') throw new Error(view);
		expect(view.mineHeld).toEqual([]);
		expect(view.mineIds).toEqual(['rel-1']);
	});

	it('a pending report already public shows once, in the public list', async () => {
		await putOutboxItem(reportItem('p1', 'user-a'));
		const { f } = fakeFetch((_r, p) =>
			p === '/api/v1/routes/r1/reports' ? json({ active: [pub('p1')], history: [] }) : json([])
		);
		configureSession({ storage: storageWith(signedIn()), fetch: f, baseUrl: BASE });
		restoreSession();
		const view = await loadRouteReports('r1');
		if (typeof view === 'string') throw new Error(view);
		expect(view.active.map((r) => r.id)).toEqual(['p1']);
		expect(view.minePending).toEqual([]);
	});

	it('signed out: public only, no /mine request and no pending items', async () => {
		await putOutboxItem(reportItem('queued-1', 'user-a'));
		const { f, calls } = fakeFetch((_r, p) =>
			p === '/api/v1/routes/r1/reports' ? json({ active: [], history: [] }) : json({}, 401)
		);
		configureSession({ storage: storageWith(null), fetch: f, baseUrl: BASE });
		const view = await loadRouteReports('r1');
		expect(view).toEqual({ active: [], history: [], mineHeld: [], minePending: [], mineIds: [] });
		expect(calls.map((c) => new URL(c.url).pathname)).toEqual(['/api/v1/routes/r1/reports']);
	});

	it('a stale token never breaks the public read', async () => {
		const { f, calls } = fakeFetch((req, p) => {
			if (req.headers.get('Authorization')) {
				return json({}, 401, { 'WWW-Authenticate': 'Bearer error="invalid_token"' });
			}
			if (p === '/api/v1/routes/r1/reports') return json({ active: [pub('p1')], history: [] });
			return json({}, 503); // refresh: server trouble keeps the session
		});
		configureSession({ storage: storageWith(signedIn('expired')), fetch: f, baseUrl: BASE });
		restoreSession();
		const view = await loadRouteReports('r1');
		if (typeof view === 'string') throw new Error(view);
		expect(view.active.map((r) => r.id)).toEqual(['p1']);
		expect(view.mineHeld).toEqual([]);
		const publicCall = calls.find((c) => new URL(c.url).pathname === '/api/v1/routes/r1/reports')!;
		expect(publicCall.headers.get('Authorization')).toBeNull();
	});

	it("'unavailable' with no API base", async () => {
		configureSession({ baseUrl: null });
		expect(await loadRouteReports('r1')).toBe('unavailable');
	});

	it("'offline' on a network error", async () => {
		configureSession({ baseUrl: BASE, fetch: (() => Promise.reject(new TypeError('x'))) as typeof fetch });
		expect(await loadRouteReports('r1')).toBe('offline');
	});

	it("'unavailable' on 404 and 5xx from the public read", async () => {
		for (const status of [404, 503]) {
			configureSession({ baseUrl: BASE, fetch: (async () => new Response('{}', { status })) as typeof fetch });
			expect(await loadRouteReports('r1')).toBe('unavailable');
		}
	});

	it('a failing outbox read still returns the public view and held reports', async () => {
		const { f } = fakeFetch((_r, p) =>
			p === '/api/v1/routes/r1/reports' ? json({ active: [pub('p1')], history: [] }) : json([mine('h1')])
		);
		configureSession({ storage: storageWith(signedIn()), fetch: f, baseUrl: BASE });
		restoreSession();
		idb.fail = true;
		const view = await loadRouteReports('r1');
		if (typeof view === 'string') throw new Error(view);
		expect(view.active.map((r) => r.id)).toEqual(['p1']);
		expect(view.mineHeld.map((r) => r.id)).toEqual(['h1']);
		expect(view.minePending).toEqual([]);
	});
});
