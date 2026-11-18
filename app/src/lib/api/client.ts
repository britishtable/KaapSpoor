import createClient from 'openapi-fetch';
import type { paths } from './schema';

/**
 * Typed client for the KaapSpoor server. Request and response types come from
 * schema.d.ts, generated from server/openapi.json (npm run gen:api).
 */
export function createApiClient(
	baseUrl: string,
	getAccessToken: () => string | null | Promise<string | null>,
	fetch?: typeof globalThis.fetch
) {
	const client = createClient<paths>({ baseUrl, fetch });
	client.use({
		async onRequest({ request }) {
			// The auth endpoints are public; a stale token there would only get in the way.
			if (new URL(request.url).pathname.startsWith('/api/v1/auth/')) return request;
			const token = await getAccessToken();
			if (token) request.headers.set('Authorization', `Bearer ${token}`);
			return request;
		}
	});
	return client;
}
