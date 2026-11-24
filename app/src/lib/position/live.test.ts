import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { livePosition, setSource, startLive, stopLive } from './live';
import type { Fix, PositionProblem, PositionSource } from './source';

let watches = 0;
let stops = 0;
let onFix: (f: Fix) => void;
let onError: (e: PositionProblem) => void;
const fake: PositionSource = {
	watch(f, e) {
		watches++;
		onFix = f;
		onError = e;
		return () => {
			stops++;
		};
	}
};
const fix: Fix = { lon: 18.4, lat: -33.9, accuracy: 10, at: 1000 };

function visibility(state: 'visible' | 'hidden') {
	Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
	document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
	watches = 0;
	stops = 0;
	Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
	setSource(fake);
});
afterEach(() => stopLive());
afterAll(() => {
	delete (document as unknown as Record<string, unknown>).visibilityState;
});

describe('livePosition', () => {
	it("startLive watches once; a second startLive doesn't add a watch", () => {
		startLive();
		startLive();
		expect(watches).toBe(1);
		expect(get(livePosition).on).toBe(true);
	});

	it('hiding the tab stops the watch and showing it resumes', () => {
		startLive();
		visibility('hidden');
		expect(stops).toBe(1);
		expect(get(livePosition).on).toBe(true);
		visibility('hidden');
		expect(stops).toBe(1);
		visibility('visible');
		expect(watches).toBe(2);
		visibility('visible');
		expect(watches).toBe(2);
	});

	it('does not watch when started while hidden, until visible', () => {
		visibility('hidden');
		startLive();
		expect(watches).toBe(0);
		visibility('visible');
		expect(watches).toBe(1);
	});

	it('stopLive stops the watch, removes the listener and clears the fix', () => {
		startLive();
		onFix(fix);
		stopLive();
		expect(stops).toBe(1);
		expect(get(livePosition)).toEqual({ on: false, fix: null, problem: null });
		visibility('hidden');
		visibility('visible');
		expect(watches).toBe(1);
	});

	it('denied stops watching, keeps the problem, and retries once per return', () => {
		startLive();
		onError('denied');
		expect(stops).toBe(1);
		expect(get(livePosition).problem).toBe('denied');
		visibility('hidden');
		visibility('visible');
		expect(watches).toBe(2);
		onError('denied');
		expect(watches).toBe(2);
		visibility('visible');
		expect(watches).toBe(3);
	});

	it('denied mid-watch clears the fix; unavailable keeps it', () => {
		startLive();
		onFix(fix);
		onError('unavailable');
		expect(get(livePosition).fix).toEqual(fix);
		onError('denied');
		expect(get(livePosition).fix).toBeNull();
	});

	it('insecure stops watching and keeps the problem', () => {
		startLive();
		onError('insecure');
		expect(stops).toBe(1);
		expect(get(livePosition).problem).toBe('insecure');
		visibility('hidden');
		visibility('visible');
		expect(watches).toBe(1);
	});

	it('unavailable keeps watching', () => {
		startLive();
		onError('unavailable');
		expect(stops).toBe(0);
		expect(get(livePosition).problem).toBe('unavailable');
	});

	it('a fix is stored, and the problem clears on the next good fix', () => {
		startLive();
		onError('unavailable');
		onFix(fix);
		expect(get(livePosition)).toEqual({ on: true, fix, problem: null });
	});

	it('hiding the tab clears the fix', () => {
		startLive();
		onFix(fix);
		visibility('hidden');
		expect(get(livePosition).fix).toBeNull();
	});

	it('late callbacks after stopLive or hide are ignored', () => {
		startLive();
		const f = onFix, e = onError;
		stopLive();
		f(fix);
		e('denied');
		expect(get(livePosition)).toEqual({ on: false, fix: null, problem: null });
		startLive();
		const f2 = onFix, e2 = onError;
		visibility('hidden');
		f2(fix);
		e2('denied');
		expect(get(livePosition).fix).toBeNull();
		expect(get(livePosition).problem).toBeNull();
		visibility('visible');
		expect(watches).toBe(3);
	});

	it("an old watch's late fix is ignored once a new watch began", () => {
		startLive();
		const old = onFix;
		visibility('hidden');
		visibility('visible');
		old({ ...fix, at: 1 });
		expect(get(livePosition).fix).toBeNull();
		onFix(fix);
		expect(get(livePosition).fix).toEqual(fix);
	});

	it('a source that errors synchronously is stopped once it returns', () => {
		let sStops = 0;
		setSource({
			watch(_f, e) {
				e('insecure');
				return () => {
					sStops++;
				};
			}
		});
		startLive();
		expect(sStops).toBe(1);
		expect(get(livePosition).problem).toBe('insecure');
	});

	it("an old owner's stop after a newer start is ignored", () => {
		const a = startLive();
		const b = startLive();
		expect(watches).toBe(1);
		stopLive(a);
		expect(stops).toBe(0);
		expect(get(livePosition).on).toBe(true);
		stopLive(b);
		expect(stops).toBe(1);
		expect(get(livePosition).on).toBe(false);
	});
});
