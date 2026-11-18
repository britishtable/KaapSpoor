import { writable, type Readable } from 'svelte/store';
import { createApiClient } from '$lib/api/client';
import { apiBaseUrl } from '$lib/api/config';
import { viewer } from '$lib/journal/store';

export interface SessionUser { id: string; displayName: string; initials: string }
export interface StoredSession {
	accessToken: string;
	accessExpiresAt: string;
	refreshToken: string;
	user: SessionUser;
}
export interface TokenStorage {
	load(): StoredSession | null;
	save(s: StoredSession): void;
	clear(): void;
}

const KEY = 'kaapspoor.session';
const NETWORK_MESSAGE = "Can't reach KaapSpoor right now. Check your signal and try again.";
const FALLBACK_MESSAGE = 'Something went wrong. Try again.';
const REFRESH_MARGIN_MS = 30_000;

export class SessionError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'SessionError';
	}
}

/** localStorage-backed storage. Plan 6 swaps in native secure storage. */
export const localTokenStorage: TokenStorage = {
	load() {
		try {
			const raw = localStorage.getItem(KEY);
			if (!raw) return null;
			const s = JSON.parse(raw) as StoredSession;
			return s && s.accessToken && s.refreshToken && s.user ? s : null;
		} catch {
			return null;
		}
	},
	save(s) {
		try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* unavailable: session lasts until reload */ }
	},
	clear() {
		try { localStorage.removeItem(KEY); } catch { /* nothing to clear */ }
	}
};

let storage: TokenStorage = localTokenStorage;
let fetchImpl: typeof fetch | undefined;
let baseUrlOverride: string | null | undefined;
let current: StoredSession | null = null;
let inflight: Promise<void> | null = null;

const store = writable<SessionUser | null>(null);
export const session: Readable<SessionUser | null> = { subscribe: store.subscribe };

function baseUrl(): string | null {
	return baseUrlOverride === undefined ? apiBaseUrl() : baseUrlOverride;
}

function setCurrent(s: StoredSession | null) {
	current = s;
	store.set(s ? s.user : null);
	viewer.set(s ? s.user.id : null);
}

function guard<T>(fn: () => T): T | null {
	try { return fn(); } catch { return null; }
}

function adopt(s: StoredSession) {
	guard(() => storage.save(s));
	setCurrent(s);
}

function dropSession() {
	guard(() => storage.clear());
	setCurrent(null);
}

export function configureSession(opts: { storage?: TokenStorage; fetch?: typeof fetch; baseUrl?: string | null } = {}): void {
	storage = opts.storage ?? localTokenStorage;
	fetchImpl = opts.fetch;
	baseUrlOverride = opts.baseUrl;
	inflight = null;
	setCurrent(null);
}

export function restoreSession(): void {
	setCurrent(guard(() => storage.load()));
}

/** Client for the public auth endpoints (never sends Authorization). */
function authClient() {
	const url = baseUrl();
	if (!url) throw new SessionError("Accounts aren't available in this build yet.");
	return createApiClient(url, () => null, fetchImpl);
}

function problemDetail(error: unknown): string {
	const detail = (error as { detail?: unknown } | undefined)?.detail;
	return typeof detail === 'string' && detail ? detail : FALLBACK_MESSAGE;
}

type Pair = { accessToken: string; accessExpiresAt: string; refreshToken: string };

async function establish(
	call: (c: ReturnType<typeof authClient>) => Promise<{ data?: Pair; error?: unknown }>
): Promise<void> {
	try {
		const c = authClient();
		const tokens = await call(c);
		if (!tokens.data) throw new SessionError(problemDetail(tokens.error));
		const me = await c.GET('/api/v1/me', { headers: { Authorization: `Bearer ${tokens.data.accessToken}` } });
		if (!me.data) throw new SessionError(problemDetail(me.error));
		adopt({
			accessToken: tokens.data.accessToken,
			accessExpiresAt: tokens.data.accessExpiresAt,
			refreshToken: tokens.data.refreshToken,
			user: { id: me.data.id, displayName: me.data.displayName, initials: me.data.initials }
		});
	} catch (e) {
		if (e instanceof SessionError) throw e;
		throw new SessionError(NETWORK_MESSAGE);
	}
}

export function signIn(email: string, password: string): Promise<void> {
	return establish((c) => c.POST('/api/v1/auth/login', { body: { email, password } }));
}

export function register(email: string, password: string, displayName: string): Promise<void> {
	return establish((c) => c.POST('/api/v1/auth/register', { body: { email, password, displayName } }));
}

export async function signOut(): Promise<void> {
	const s = current;
	dropSession();
	if (!s || !baseUrl()) return;
	try {
		await authClient().POST('/api/v1/auth/logout', { body: { refreshToken: s.refreshToken } });
	} catch { /* best effort: the local session is already gone */ }
}

function nearExpiry(s: StoredSession): boolean {
	return Date.parse(s.accessExpiresAt) - Date.now() < REFRESH_MARGIN_MS;
}

async function refreshOnce(adoptedAlready: boolean): Promise<void> {
	const s = current;
	if (!s) return;
	let res;
	try {
		res = await authClient().POST('/api/v1/auth/refresh', { body: { refreshToken: s.refreshToken } });
	} catch {
		return; // offline: keep the session and the current token
	}
	if (res.data) {
		adopt({ ...s, accessToken: res.data.accessToken, accessExpiresAt: res.data.accessExpiresAt, refreshToken: res.data.refreshToken });
		return;
	}
	if (res.response.status !== 401) return; // server trouble is not a sign-out
	// Another tab may have rotated the token a moment ago; the server answers a reused token with a bare 401.
	const stored = guard(() => storage.load());
	if (!adoptedAlready && stored && stored.refreshToken !== s.refreshToken) {
		setCurrent(stored);
		if (nearExpiry(stored)) await refreshOnce(true);
		return;
	}
	dropSession();
}

/** Single-flight refresh: concurrent callers share one request. */
function refresh(): Promise<void> {
	inflight ??= refreshOnce(false).finally(() => { inflight = null; });
	return inflight;
}

export async function getAccessToken(): Promise<string | null> {
	if (!current) return null;
	if (nearExpiry(current)) await refresh();
	return current?.accessToken ?? null;
}

/** fetch wrapper: a 401 invalid_token refreshes and retries once; a second 401 signs out. */
function retryingFetch(): typeof fetch {
	return async (input, init) => {
		const base = fetchImpl ?? fetch;
		const req = input instanceof Request ? input : new Request(input, init);
		const retry = req.clone();
		const res = await base(req);
		if (res.status !== 401 || !(res.headers.get('WWW-Authenticate') ?? '').includes('invalid_token')) return res;
		const sent = req.headers.get('Authorization');
		if (!current) return res;
		if (sent === `Bearer ${current.accessToken}`) await refresh(); // else another caller already refreshed
		if (!current) return res;
		retry.headers.set('Authorization', `Bearer ${current.accessToken}`);
		const second = await base(retry);
		if (second.status === 401) dropSession();
		return second;
	};
}

export function api(): ReturnType<typeof createApiClient> | null {
	const url = baseUrl();
	return url ? createApiClient(url, getAccessToken, retryingFetch()) : null;
}
