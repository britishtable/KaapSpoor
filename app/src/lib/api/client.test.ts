import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from './client';

function stubFetch() {
	return vi.fn(
		async (_req: RequestInfo | URL) =>
			new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
	);
}

describe('createApiClient', () => {
	it('attaches bearer token', async () => {
		const fetchStub = stubFetch();
		const client = createApiClient('https://api.test', () => 't1', fetchStub);
		await client.GET('/api/v1/me');
		const req = fetchStub.mock.calls[0][0] as Request;
		expect(req.url).toBe('https://api.test/api/v1/me');
		expect(req.headers.get('Authorization')).toBe('Bearer t1');
	});

	it('omits header when signed out', async () => {
		const fetchStub = stubFetch();
		const client = createApiClient('https://api.test', () => null, fetchStub);
		await client.GET('/api/v1/me');
		expect((fetchStub.mock.calls[0][0] as Request).headers.has('Authorization')).toBe(false);
	});

	it('does not send Authorization to /api/v1/auth/*', async () => {
		const fetchStub = stubFetch();
		const client = createApiClient('https://api.test', () => 'tok', fetchStub);
		await client.POST('/api/v1/auth/refresh', { body: { refreshToken: 'r' } });
		const req = fetchStub.mock.calls[0][0] as Request;
		expect(req.url).toBe('https://api.test/api/v1/auth/refresh');
		expect(req.headers.has('Authorization')).toBe(false);
	});

	it('awaits an async token getter', async () => {
		const fetchStub = stubFetch();
		const client = createApiClient('https://api.test', async () => 'tok', fetchStub);
		await client.GET('/api/v1/me');
		expect((fetchStub.mock.calls[0][0] as Request).headers.get('Authorization')).toBe('Bearer tok');
	});
});
