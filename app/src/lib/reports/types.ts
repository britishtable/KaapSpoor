import type { components } from '$lib/api/schema';

export type ReportWrite = components['schemas']['ReportWrite'];
export type MyReport = components['schemas']['MyReport'];
export type PublicReport = components['schemas']['PublicReport'];
export type RouteReports = components['schemas']['RouteReports'];
export type Category = ReportWrite['category'];
export type Answer = components['schemas']['ConfirmationWrite']['answer'];

/**
 * A report or confirmation waiting on this device to be sent. `id` is the report's UUID for a
 * report, and `reportId + ':' + owner` for a confirmation, so a newer answer replaces the older.
 * `error` is the server's reason for refusing it; such an item is kept, never retried blindly.
 */
export type OutboxItem = { id: string; owner: string; createdAt: string; error?: string } & (
	| { kind: 'report'; body: ReportWrite }
	| { kind: 'confirmation'; reportId: string; answer: Answer }
);
export type ReportItem = Extract<OutboxItem, { kind: 'report' }>;

/** A route's reports as the reader sees them: public, plus their own held and not-yet-sent ones. */
export interface RouteReportsView {
	active: PublicReport[];
	history: PublicReport[];
	mineHeld: MyReport[];
	minePending: ReportItem[];
}

/** Reports carry a name, so filing or answering needs an account. */
export class SignInRequiredError extends Error {
	constructor() {
		super('Sign in to report what you see.');
		this.name = 'SignInRequiredError';
	}
}
