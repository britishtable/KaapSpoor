import { get, writable, type Readable } from 'svelte/store';
import { webSource, type Fix, type PositionProblem, type PositionSource } from './source';

export interface LivePosition {
	on: boolean;
	fix: Fix | null;
	problem: PositionProblem | null;
}

const store = writable<LivePosition>({ on: false, fix: null, problem: null });
export const livePosition: Readable<LivePosition> = { subscribe: store.subscribe };

let source: PositionSource = webSource;
let stopWatch: (() => void) | null = null;
let listening = false;
let owner: symbol | null = null;
// Each watch gets a generation; callbacks from any watch but the current one are ignored.
let generation = 0;

/** Tests and the native (plan 6) source swap the position source here. */
export function setSource(s: PositionSource): void {
	source = s;
}

function endWatch(): void {
	generation++; // late callbacks from the watch being ended are now ignored
	const stop = stopWatch;
	stopWatch = null;
	stop?.();
}

function beginWatch(): void {
	if (stopWatch) return;
	const mine = ++generation;
	let errored = false;
	const stop = source.watch(
		(fix) => {
			if (mine !== generation) return;
			store.update((s) => ({ ...s, fix, problem: null }));
		},
		(problem) => {
			if (mine !== generation) return;
			// A watch that is over leaves no position behind: "On route" beside "Location is off" is a lie.
			store.update((s) => ({ ...s, problem, fix: problem === 'unavailable' ? s.fix : null }));
			if (problem !== 'unavailable') {
				errored = true;
				endWatch();
			}
		}
	);
	// A source may report an error synchronously, before it returned its stop function.
	if (errored) stop();
	else stopWatch = stop;
}

function onVisibility(): void {
	if (document.visibilityState === 'visible') {
		// insecure cannot be fixed by returning; denied is retried once per hidden-to-visible flip.
		if (get(store).problem !== 'insecure') {
			store.update((s) => ({ ...s, problem: null }));
			beginWatch();
		}
	} else {
		endWatch();
		// A stale dot must not show on return before a new fix.
		store.update((s) => ({ ...s, fix: null }));
	}
}

/**
 * Turns live position on and returns an owner token. The newest caller owns it:
 * a start while already running keeps the single watch but hands ownership to
 * the new token, so an old page's destroy (stopLive(oldToken)) arriving after
 * the next page's mount is ignored and can't kill the watch the new page wants.
 */
export function startLive(): symbol {
	const token = Symbol('live');
	owner = token;
	if (listening) return token;
	listening = true;
	store.set({ on: true, fix: null, problem: null });
	document.addEventListener('visibilitychange', onVisibility);
	if (document.visibilityState === 'visible') beginWatch();
	return token;
}

/** Stops only if `token` is the current owner. No token always stops: the hiker's own stop (the button, Finish hike), and tests. */
export function stopLive(token?: symbol): void {
	if (token !== undefined && token !== owner) return;
	owner = null;
	endWatch();
	if (listening) document.removeEventListener('visibilitychange', onVisibility);
	listening = false;
	store.set({ on: false, fix: null, problem: null });
}
