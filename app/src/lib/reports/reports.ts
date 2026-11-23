import { get } from 'svelte/store';
import { api, publicApi, session } from '$lib/account/session';
import { getOutboxFor } from '$lib/journal/db';
import type { MyReport, ReportItem, RouteReportsView } from './types';

/**
 * A route's reports: the public lists, plus the signed-in user's own held reports, their
 * reports still waiting on this device, and the ids of every report of theirs on the route
 * (`mineIds`, from the server: the public list carries no author). Each report shows once: public first, then held, then
 * pending. 'unavailable': no API in this build, or the server says no (404, 5xx).
 * 'offline': no network.
 */
export async function loadRouteReports(routeId: string): Promise<RouteReportsView | 'offline' | 'unavailable'> {
	const client = publicApi();
	if (!client) return 'unavailable';
	let pub;
	try {
		pub = (await client.GET('/api/v1/routes/{routeId}/reports', { params: { path: { routeId } } })).data;
	} catch {
		return 'offline';
	}
	if (!pub) return 'unavailable';

	const me = get(session)?.id ?? null;
	const seen = new Set([...pub.active, ...pub.history].map((r) => r.id));
	let mineHeld: MyReport[] = [];
	let minePending: ReportItem[] = [];
	let mineIds: string[] = [];
	if (me !== null) {
		const mine = await myReports(routeId);
		mineIds = mine.map((r) => r.id);
		mineHeld = mine.filter((r) => r.held && !seen.has(r.id));
		for (const r of mineHeld) seen.add(r.id);
		minePending = (await queuedFor(me))
			.filter((i): i is ReportItem => i.kind === 'report' && i.body.routeId === routeId && !seen.has(i.id))
			.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
	}
	return { active: pub.active, history: pub.history, mineHeld, minePending, mineIds };
}

/** The caller's queued items; none when IndexedDB fails, as the public part still stands. */
async function queuedFor(me: string) {
	try {
		return await getOutboxFor(me);
	} catch {
		return [];
	}
}

/** All the caller's reports on this route, held or not; none when that read fails, as the public part still stands. */
async function myReports(routeId: string): Promise<MyReport[]> {
	const client = api();
	if (!client) return [];
	try {
		return (await client.GET('/api/v1/reports/mine', { params: { query: { routeId } } })).data ?? [];
	} catch {
		return [];
	}
}
