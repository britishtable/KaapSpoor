import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { get } from 'svelte/store';
import 'fake-indexeddb/auto';
import { fileReport, answerReport, discardOutboxItem, pendingOutbox, onOutboxWrite, hydrateOutbox, SignInRequiredError } from './outbox';
import { getAllOutbox, getOutboxFor, resetDbForTests } from '$lib/journal/db';
import { configureSession, signIn, signOut, type StoredSession, type TokenStorage } from '$lib/account/session';
import { setClockForTests } from '$lib/journal/store';

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function memoryStorage(): TokenStorage {
	let v: StoredSession | null = null;
	return { load: () => v, save: (s) => { v = s; }, clear: () => { v = null; } };
}

/** Signs in, then the network goes away: everything after is offline. */
async function signInOffline(key: 'a' | 'b') {
	const net = { down: false };
	const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
		if (net.down) throw new TypeError('Failed to fetch');
		const req = input instanceof Request ? input : new Request(input, init);
		const p = new URL(req.url).pathname;
		if (p === '/api/v1/auth/login') return json({ accessToken: `tok-${key}`, accessExpiresAt: new Date(Date.now() + 600_000).toISOString(), refreshToken: `r-${key}` });
		if (p === '/api/v1/auth/logout') return new Response(null, { status: 204 });
		return json({ id: `user-${key}`, displayName: key, initials: key.toUpperCase(), role: 'USER' });
	}) as typeof fetch;
	configureSession({ storage: memoryStorage(), fetch: f, baseUrl: 'http://srv' });
	await signIn(`${key}@example.com`, 'a-long-password');
	net.down = true;
}

let tick = 0;
beforeEach(async () => {
	await resetDbForTests();
	await new Promise<void>((resolve, reject) => {
		const req = indexedDB.deleteDatabase('kaapspoor');
		req.onsuccess = () => resolve();
		req.onerror = () => reject(req.error);
	});
	await hydrateOutbox();
	tick = 0;
	setClockForTests(() => new Date(Date.parse('2026-11-23T09:00:00.000Z') + 1000 * tick++).toISOString());
});

afterEach(() => {
	setClockForTests(null);
	configureSession();
});

describe('outbox', () => {
	it('fileReport while offline stores the item with "pending" and mints observedAt now', async () => {
		await signInOffline('a');
		let writes = 0;
		const off = onOutboxWrite(() => { writes++; });
		const id = await fileReport({ routeId: 'r1', category: 'OBSTRUCTION', note: 'fallen tree', hikeId: null, position: null });
		off();
		expect(id).toMatch(/^[0-9a-f-]{36}$/);
		const stored = await getOutboxFor('user-a');
		expect(stored).toEqual([{
			id, owner: 'user-a', createdAt: '2026-11-23T09:00:00.000Z', kind: 'report',
			body: { routeId: 'r1', category: 'OBSTRUCTION', note: 'fallen tree', hikeId: null, position: null, observedAt: '2026-11-23T09:00:00.000Z' }
		}]);
		// Pending: queued for this user, with no error.
		expect(get(pendingOutbox)).toEqual(stored);
		expect(writes).toBe(1);
	});

	it('keeps a given observedAt', async () => {
		await signInOffline('a');
		await fileReport({ routeId: 'r1', category: 'WATER', observedAt: '2026-11-23T07:00:00.000Z' });
		expect(get(pendingOutbox)[0]).toMatchObject({ kind: 'report', body: { observedAt: '2026-11-23T07:00:00.000Z' } });
	});

	it('a second answer to the same report replaces the first', async () => {
		await signInOffline('a');
		await answerReport('rep-1', 'STILL_THERE');
		await answerReport('rep-1', 'GONE');
		await answerReport('rep-2', 'NOT_SURE');
		const stored = await getOutboxFor('user-a');
		expect(stored.map((i) => i.id).sort()).toEqual(['rep-1:user-a', 'rep-2:user-a']);
		expect(stored.find((i) => i.id === 'rep-1:user-a')).toMatchObject({ kind: 'confirmation', reportId: 'rep-1', answer: 'GONE' });
		expect(get(pendingOutbox)).toHaveLength(2);
	});

	it('signed out throws SignInRequiredError', async () => {
		configureSession({ storage: memoryStorage(), baseUrl: 'http://srv' });
		await expect(fileReport({ routeId: 'r1', category: 'FIRE' })).rejects.toBeInstanceOf(SignInRequiredError);
		await expect(answerReport('rep-1', 'GONE')).rejects.toBeInstanceOf(SignInRequiredError);
		expect(await getAllOutbox()).toEqual([]);
		expect(get(pendingOutbox)).toEqual([]);
	});

	it("pendingOutbox shows only the signed-in user's items", async () => {
		await signInOffline('a');
		await fileReport({ routeId: 'r1', category: 'FIRE' });
		await signOut();
		expect(get(pendingOutbox)).toEqual([]);
		await signInOffline('b');
		expect(get(pendingOutbox)).toEqual([]);
		await fileReport({ routeId: 'r1', category: 'WATER' });
		expect(get(pendingOutbox).map((i) => i.owner)).toEqual(['user-b']);
	});

	it('hydrateOutbox loads the queue saved on disk', async () => {
		await signInOffline('a');
		const id = await fileReport({ routeId: 'r1', category: 'FIRE' });
		await resetDbForTests();
		await hydrateOutbox();
		expect(get(pendingOutbox).map((i) => i.id)).toEqual([id]);
	});

	it("discardOutboxItem removes the signed-in user's item", async () => {
		await signInOffline('a');
		const id = await fileReport({ routeId: 'r1', category: 'FIRE' });
		await answerReport('rep-1', 'GONE');
		await discardOutboxItem(id);
		expect((await getOutboxFor('user-a')).map((i) => i.id)).toEqual(['rep-1:user-a']);
		expect(get(pendingOutbox).map((i) => i.id)).toEqual(['rep-1:user-a']);
		await discardOutboxItem('no-such-id'); // a no-op
		expect(await getOutboxFor('user-a')).toHaveLength(1);
	});

	it("discardOutboxItem never removes another owner's item, nor anything signed out", async () => {
		await signInOffline('a');
		const id = await fileReport({ routeId: 'r1', category: 'FIRE' });
		await signOut();
		await discardOutboxItem(id);
		expect((await getAllOutbox()).map((i) => i.id)).toEqual([id]);
		await signInOffline('b');
		await discardOutboxItem(id);
		expect((await getAllOutbox()).map((i) => i.id)).toEqual([id]);
		await signOut();
		await signInOffline('a');
		expect(get(pendingOutbox).map((i) => i.id)).toEqual([id]);
	});
});
