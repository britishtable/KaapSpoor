import { derived, get, writable, type Readable } from 'svelte/store';
import type { Hike } from '$lib/data/types';
import { api, session } from '$lib/account/session';
import { hikes, now } from '$lib/journal/store';
import { deleteOutboxItem, getAllOutbox, getOutboxFor, getOutboxItem, putOutboxItem } from '$lib/journal/db';
import { SignInRequiredError, type Answer, type OutboxItem, type ReportWrite } from './types';

export { SignInRequiredError };

type Client = NonNullable<ReturnType<typeof api>>;

/** Every account's queued items on this device, by id. Only the owner's are ever shown or sent. */
const items = writable<Map<string, OutboxItem>>(new Map());

const byAge = (a: OutboxItem, b: OutboxItem) =>
	a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/** The signed-in user's queued items, oldest first; none when signed out. */
export const pendingOutbox: Readable<OutboxItem[]> = derived([items, session], ([$items, $s]) =>
	$s ? [...$items.values()].filter((i) => i.owner === $s.id).sort(byAge) : []
);

function remember(item: OutboxItem): void {
	items.update((m) => new Map(m).set(item.id, item));
}
function forget(id: string): void {
	items.update((m) => { const next = new Map(m); next.delete(id); return next; });
}

/** Loads the queue saved on disk; call once at app start. */
export async function hydrateOutbox(): Promise<void> {
	items.set(new Map((await getAllOutbox()).map((i) => [i.id, i])));
}

const listeners = new Set<() => void>();
/** Called after every item queued here, so the sync engine can send it. */
export function onOutboxWrite(fn: () => void): () => void {
	listeners.add(fn);
	return () => { listeners.delete(fn); };
}

async function enqueue(item: OutboxItem): Promise<void> {
	await putOutboxItem(item);
	remember(item);
	for (const fn of [...listeners]) fn();
}

function signedInId(): string {
	const me = get(session)?.id;
	if (!me) throw new SignInRequiredError();
	return me;
}

/** Saves a report to send; returns its id. `observedAt` defaults to now. */
export async function fileReport(
	input: Omit<ReportWrite, 'observedAt'> & { observedAt?: string }
): Promise<string> {
	const owner = signedInId();
	const id = crypto.randomUUID();
	const createdAt = now();
	await enqueue({ id, owner, createdAt, kind: 'report', body: { ...input, observedAt: input.observedAt ?? createdAt } });
	return id;
}

/** Saves an answer to send. A newer answer to the same report replaces one not yet sent. */
export async function answerReport(reportId: string, answer: Answer): Promise<void> {
	const owner = signedInId();
	await enqueue({ id: `${reportId}:${owner}`, owner, createdAt: now(), kind: 'confirmation', reportId, answer });
}

/** Removes one of the signed-in user's queued items, such as one the server refused. Otherwise a no-op. */
export async function discardOutboxItem(id: string): Promise<void> {
	const me = get(session)?.id;
	if (!me) return;
	const item = await getOutboxItem(id);
	if (item?.owner !== me) return;
	await deleteOutboxItem(id);
	forget(id);
}

/**
 * A report naming a hike the server doesn't hold yet (still queued, or refused) must wait:
 * sent now it would be refused for good. It goes on a later run, once the hike is accepted.
 * Exported so the UI can say why such a report hasn't gone yet; the UI passes its `$hikes` so the
 * line follows the hike as it syncs.
 */
export function waitsOnHike(item: OutboxItem, known: Map<string, Hike> = get(hikes)): boolean {
	if (item.kind !== 'report' || !item.body.hikeId) return false;
	const h = known.get(item.body.hikeId);
	return h !== undefined && (h.pending || h.syncError !== undefined);
}

/** The fetch itself failed: no signal. The flush stops and everything stays queued. */
export class OutboxOfflineError extends Error {}

function problemDetail(error: unknown, fallback: string): string {
	const d = (error as { detail?: unknown } | undefined)?.detail;
	return typeof d === 'string' && d ? d : fallback;
}

/** The item on disk is still the one that was sent (not replaced by a newer answer meanwhile). */
async function unchanged(sent: OutboxItem): Promise<boolean> {
	return JSON.stringify(await getOutboxItem(sent.id)) === JSON.stringify(sent);
}

/**
 * Sends `me`'s queued items, oldest first. A 2xx removes the item. A 409 on an answer removes it
 * too: the report is no longer active, so there is nothing left to answer and nothing is lost.
 * Any other 4xx but 401 keeps the item with the server's reason, never to be retried blindly,
 * and the flush goes on. A network error
 * throws OutboxOfflineError; a 401 or 5xx throws; either stops the flush with everything kept.
 * A sign-out or user switch stops it quietly: no item is ever sent under another account.
 */
export async function flushOutbox(client: Client, me: string): Promise<void> {
	const queue = (await getOutboxFor(me)).filter((i) => i.error === undefined).sort(byAge);
	for (const sent of queue) {
		if (get(session)?.id !== me) return;
		if (waitsOnHike(sent)) continue;
		let res: { error?: unknown; response: Response };
		try {
			res = sent.kind === 'report'
				? await client.PUT('/api/v1/reports/{id}', { params: { path: { id: sent.id } }, body: sent.body })
				: await client.PUT('/api/v1/reports/{id}/confirmation', {
						params: { path: { id: sent.reportId } }, body: { answer: sent.answer }
					});
		} catch {
			throw new OutboxOfflineError();
		}
		const status = res.response.status;
		if (res.response.ok || (status === 409 && sent.kind === 'confirmation')) {
			// Write-once on the server: the stored report is the truth, so nothing here needs it.
			if (await unchanged(sent)) {
				await deleteOutboxItem(sent.id);
				forget(sent.id);
			}
		} else if (status >= 400 && status < 500 && status !== 401) {
			if (await unchanged(sent)) {
				const fallback = sent.kind === 'report' ? "The server didn't accept this report." : "The server didn't accept this answer.";
				const refused: OutboxItem = { ...sent, error: problemDetail(res.error, fallback) };
				await putOutboxItem(refused);
				remember(refused);
			}
		} else {
			// 401: the session has already decided. 5xx: try again on the next trigger.
			throw new Error(`PUT ${status}`);
		}
	}
}
