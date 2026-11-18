import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import 'fake-indexeddb/auto';
import {
	session, configureSession, restoreSession, signIn, register, signOut, getAccessToken, api,
	SessionError, type StoredSession, type TokenStorage
} from './session';
import { viewer, hikes, replaceAll, logHike } from '$lib/journal/store';

const BASE = 'http://srv';
const user = { id: 'u1', displayName: 'Thandi', initials: 'T' };
const later = (ms: number) => new Date(Date.now() + ms).toISOString();

function memoryStorage(initial: StoredSession | null = null): TokenStorage & { value: StoredSession | null } {
	const s = {
		value: initial,
		load: () => s.value,
		save: (v: StoredSession) => { s.value = v; },
		clear: () => { s.value = null; }
	};
	return s;
}

function stored(over: Partial<StoredSession> = {}): StoredSession {
	return { accessToken: 'a1', accessExpiresAt: later(600_000), refreshToken: 'r1', user, ...over };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const pair = (n: number) => ({ accessToken: `a${n}`, accessExpiresAt: later(600_000), refreshToken: `r${n}` });

type Handler = (req: Request) => Response | Promise<Response>;
function fakeFetch(handler: Handler) {
	const calls: Request[] = [];
	const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const req = input instanceof Request ? input : new Request(input, init);
		calls.push(req);
		return handler(req);
	}) as typeof fetch;
	return { f, calls, paths: () => calls.map((c) => new URL(c.url).pathname) };
}

beforeEach(async () => {
	await replaceAll({ hikes: [], routeNotes: [] });
	configureSession({ storage: memoryStorage(), baseUrl: BASE });
});

describe('sign in', () => {
	it('stores tokens and user, sets viewer', async () => {
		const st = memoryStorage();
		const { f, calls } = fakeFetch((r) => {
			const p = new URL(r.url).pathname;
			if (p === '/api/v1/auth/login') return json(pair(1));
			return json({ ...user, role: 'USER' });
		});
		configureSession({ storage: st, fetch: f, baseUrl: BASE });
		await signIn('t@example.com', 'secret-password');
		expect(get(session)).toEqual(user);
		expect(get(viewer)).toBe('u1');
		expect(st.value).toMatchObject({ accessToken: 'a1', refreshToken: 'r1', user });
		expect(calls[1].headers.get('Authorization')).toBe('Bearer a1');
		expect(calls[0].headers.get('Authorization')).toBeNull();
	});

	it('register posts the display name', async () => {
		const { f, calls } = fakeFetch((r) =>
			new URL(r.url).pathname === '/api/v1/auth/register' ? json(pair(1), 201) : json({ ...user, role: 'USER' }));
		configureSession({ storage: memoryStorage(), fetch: f, baseUrl: BASE });
		await register('t@example.com', 'long-enough-pw', 'Thandi');
		expect(await calls[0].clone().json()).toEqual({ email: 't@example.com', password: 'long-enough-pw', displayName: 'Thandi' });
		expect(get(session)).toEqual(user);
	});

	it('401 throws SessionError with the server detail', async () => {
		const { f } = fakeFetch(() => json({ detail: 'Email or password is wrong.' }, 401));
		configureSession({ storage: memoryStorage(), fetch: f, baseUrl: BASE });
		const err = await signIn('a@b.c', 'x').catch((e) => e);
		expect(err).toBeInstanceOf(SessionError);
		expect(err.message).toBe('Email or password is wrong.');
		expect(get(session)).toBeNull();
	});

	it('network failure throws the signal message', async () => {
		configureSession({ storage: memoryStorage(), fetch: (async () => { throw new TypeError('fail'); }) as typeof fetch, baseUrl: BASE });
		const err = await signIn('a@b.c', 'x').catch((e) => e);
		expect(err).toBeInstanceOf(SessionError);
		expect(err.message).toBe("Can't reach KaapSpoor right now. Check your signal and try again.");
	});
});

describe('refresh', () => {
	it('access token near expiry refreshes before the request', async () => {
		const st = memoryStorage(stored({ accessExpiresAt: later(10_000) }));
		const { f, paths } = fakeFetch(() => json(pair(2)));
		configureSession({ storage: st, fetch: f, baseUrl: BASE });
		restoreSession();
		expect(await getAccessToken()).toBe('a2');
		expect(paths()).toEqual(['/api/v1/auth/refresh']);
		expect(st.value?.refreshToken).toBe('r2');
	});

	it('a fresh token is returned without a request', async () => {
		const { f, calls } = fakeFetch(() => json(pair(2)));
		configureSession({ storage: memoryStorage(stored()), fetch: f, baseUrl: BASE });
		restoreSession();
		expect(await getAccessToken()).toBe('a1');
		expect(calls).toHaveLength(0);
	});

	it('two concurrent getAccessToken calls make one refresh request', async () => {
		const { f, calls } = fakeFetch(() => json(pair(2)));
		configureSession({ storage: memoryStorage(stored({ accessExpiresAt: later(1000) })), fetch: f, baseUrl: BASE });
		restoreSession();
		const [a, b] = await Promise.all([getAccessToken(), getAccessToken()]);
		expect([a, b]).toEqual(['a2', 'a2']);
		expect(calls).toHaveLength(1);
	});

	it('refresh 401 with rotated storage adopts the stored session', async () => {
		const st = memoryStorage(stored({ accessExpiresAt: later(1000) }));
		const { f } = fakeFetch(() => {
			st.value = stored({ accessToken: 'a9', refreshToken: 'r9' }); // another tab rotated meanwhile
			return new Response(null, { status: 401 });
		});
		configureSession({ storage: st, fetch: f, baseUrl: BASE });
		restoreSession();
		expect(await getAccessToken()).toBe('a9');
		expect(get(session)).toEqual(user);
	});

	it('refresh 401 with unchanged storage signs out but leaves hikes in the store', async () => {
		await logHike({ routeId: 'r1', date: '2026-07-01', notes: '' });
		const before = get(hikes).size;
		expect(before).toBe(1);
		const st = memoryStorage(stored({ accessExpiresAt: later(1000) }));
		const { f } = fakeFetch(() => new Response(null, { status: 401 }));
		configureSession({ storage: st, fetch: f, baseUrl: BASE });
		restoreSession();
		expect(await getAccessToken()).toBeNull();
		expect(get(session)).toBeNull();
		expect(get(viewer)).toBeNull();
		expect(st.value).toBeNull();
		expect(get(hikes).size).toBe(before);
	});

	it('a network error during refresh keeps the session', async () => {
		const st = memoryStorage(stored({ accessExpiresAt: later(1000) }));
		configureSession({ storage: st, fetch: (async () => { throw new TypeError('offline'); }) as typeof fetch, baseUrl: BASE });
		restoreSession();
		expect(await getAccessToken()).toBe('a1');
		expect(get(session)).toEqual(user);
	});
});

describe('api()', () => {
	const invalid = () => new Response(null, { status: 401, headers: { 'WWW-Authenticate': 'Bearer error="invalid_token"' } });

	it('data 401 invalid_token refreshes and retries once', async () => {
		const { f, calls, paths } = fakeFetch((r) => {
			const p = new URL(r.url).pathname;
			if (p === '/api/v1/auth/refresh') return json(pair(2));
			return r.headers.get('Authorization') === 'Bearer a2' ? json({ ...user, role: 'USER' }) : invalid();
		});
		configureSession({ storage: memoryStorage(stored()), fetch: f, baseUrl: BASE });
		restoreSession();
		const res = await api()!.GET('/api/v1/me');
		expect(res.data?.id).toBe('u1');
		expect(paths()).toEqual(['/api/v1/me', '/api/v1/auth/refresh', '/api/v1/me']);
		expect(calls[2].headers.get('Authorization')).toBe('Bearer a2');
	});

	it('second 401 signs out', async () => {
		const { f, paths } = fakeFetch((r) =>
			new URL(r.url).pathname === '/api/v1/auth/refresh' ? json(pair(2)) : invalid());
		const st = memoryStorage(stored());
		configureSession({ storage: st, fetch: f, baseUrl: BASE });
		restoreSession();
		const res = await api()!.GET('/api/v1/me');
		expect(res.response.status).toBe(401);
		expect(paths().filter((p) => p === '/api/v1/me')).toHaveLength(2);
		expect(get(session)).toBeNull();
		expect(st.value).toBeNull();
	});

	it('is null without a base URL', () => {
		configureSession({ storage: memoryStorage(), baseUrl: null });
		expect(api()).toBeNull();
	});
});

describe('sign out and storage', () => {
	it('signOut calls logout and clears even if logout fails', async () => {
		const st = memoryStorage(stored());
		const { f, paths } = fakeFetch(() => new Response(null, { status: 500 }));
		configureSession({ storage: st, fetch: f, baseUrl: BASE });
		restoreSession();
		await signOut();
		expect(paths()).toEqual(['/api/v1/auth/logout']);
		expect(get(session)).toBeNull();
		expect(st.value).toBeNull();
		const thrower = fakeFetch(() => { throw new TypeError('x'); });
		configureSession({ storage: memoryStorage(stored()), fetch: thrower.f, baseUrl: BASE });
		restoreSession();
		await expect(signOut()).resolves.toBeUndefined();
		expect(get(session)).toBeNull();
	});

	it('storage that throws acts as signed out', async () => {
		const bad: TokenStorage = {
			load() { throw new Error('denied'); },
			save() { throw new Error('denied'); },
			clear() { throw new Error('denied'); }
		};
		configureSession({ storage: bad, baseUrl: BASE });
		expect(() => restoreSession()).not.toThrow();
		expect(get(session)).toBeNull();
		await expect(signOut()).resolves.toBeUndefined();
	});
});
