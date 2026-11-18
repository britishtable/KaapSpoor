import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { configureSession } from '$lib/account/session';
import type { StoredSession, TokenStorage } from '$lib/account/session';

const configMock = vi.hoisted(() => ({ url: 'http://srv' as string | null }));
vi.mock('$lib/api/config', () => ({ apiBaseUrl: () => configMock.url }));

import Page from './+page.svelte';

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function setup() {
	let saved: StoredSession | null = null;
	const storage: TokenStorage = { load: () => saved, save: (s) => { saved = s; }, clear: () => { saved = null; } };
	const paths: string[] = [];
	const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const req = input instanceof Request ? input : new Request(input, init);
		const p = new URL(req.url).pathname;
		paths.push(p);
		if (p.startsWith('/api/v1/auth/')) {
			return p.endsWith('logout') ? new Response(null, { status: 204 })
				: json({ accessToken: 'a', accessExpiresAt: new Date(Date.now() + 600000).toISOString(), refreshToken: 'r' });
		}
		return json({ id: 'u1', displayName: 'Thandi', initials: 'T', role: 'USER' });
	}) as typeof fetch;
	configureSession({ storage, fetch: f, baseUrl: 'http://srv' });
	return { paths };
}

beforeEach(() => { configMock.url = 'http://srv'; });

describe('account page', () => {
	it('shows unavailable copy when no base URL', () => {
		configMock.url = null;
		render(Page);
		expect(screen.getByText(/accounts aren't available in this build yet/i)).toBeTruthy();
		expect(screen.queryByRole('button', { name: /sign in/i })).toBeNull();
	});

	it('sign in form signs in and shows Signed in as', async () => {
		setup();
		render(Page);
		await fireEvent.input(screen.getByLabelText('Email'), { target: { value: 't@example.com' } });
		await fireEvent.input(screen.getByLabelText('Password'), { target: { value: 'a-long-password' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
		expect(await screen.findByText('Signed in as Thandi')).toBeTruthy();
		expect(screen.getByText('Your hikes stay on this device.')).toBeTruthy();
	});

	it('create account validates min 10 chars client-side before calling', async () => {
		const { paths } = setup();
		render(Page);
		await fireEvent.click(screen.getByRole('button', { name: /create account/i }));
		await fireEvent.input(screen.getByLabelText('Display name'), { target: { value: 'Thandi' } });
		await fireEvent.input(screen.getByLabelText('Email'), { target: { value: 't@example.com' } });
		await fireEvent.input(screen.getByLabelText('Password'), { target: { value: 'short' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
		expect((await screen.findByRole("alert")).textContent).toMatch(/at least 10 characters/i);
		expect(paths).toEqual([]);
		await fireEvent.input(screen.getByLabelText('Password'), { target: { value: 'long-enough-pw' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
		expect(await screen.findByText('Signed in as Thandi')).toBeTruthy();
		expect(paths[0]).toBe('/api/v1/auth/register');
	});

	it('sign out returns to the form', async () => {
		setup();
		render(Page);
		await fireEvent.input(screen.getByLabelText('Email'), { target: { value: 't@example.com' } });
		await fireEvent.input(screen.getByLabelText('Password'), { target: { value: 'a-long-password' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
		await fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
		await waitFor(() => expect(screen.getByLabelText('Email')).toBeTruthy());
	});
});
