import { writable, type Readable } from 'svelte/store';
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

/** Tests and the native (plan 6) source swap the position source here. */
export function setSource(s: PositionSource): void {
	source = s;
}

function endWatch(): void {
	const stop = stopWatch;
	stopWatch = null;
	stop?.();
}

function beginWatch(): void {
	if (stopWatch) return;
	let stopped = false;
	let stop: (() => void) | null = null;
	const halt = () => {
		stopped = true;
		if (stopWatch === stop) stopWatch = null;
		stop?.();
	};
	stop = source.watch(
		(fix) => store.update((s) => ({ ...s, fix, problem: null })),
		(problem) => {
			store.update((s) => ({ ...s, problem }));
			if (problem !== 'unavailable') halt();
		}
	);
	// A source may report an error synchronously, before it returned its stop function.
	if (stopped) stop();
	else stopWatch = stop;
}

function onVisibility(): void {
	if (document.visibilityState === 'visible') {
		let blocked = false;
		store.update((s) => ((blocked = s.problem === 'denied' || s.problem === 'insecure'), s));
		if (!blocked) beginWatch();
	} else endWatch();
}

export function startLive(): void {
	if (listening) return;
	listening = true;
	store.set({ on: true, fix: null, problem: null });
	document.addEventListener('visibilitychange', onVisibility);
	if (document.visibilityState === 'visible') beginWatch();
}

export function stopLive(): void {
	endWatch();
	if (listening) document.removeEventListener('visibilitychange', onVisibility);
	listening = false;
	store.set({ on: false, fix: null, problem: null });
}
