import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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

	it('denied stops watching and keeps the problem; no resume on visible', () => {
		startLive();
		onError('denied');
		expect(stops).toBe(1);
		expect(get(livePosition).problem).toBe('denied');
		visibility('hidden');
		visibility('visible');
		expect(watches).toBe(1);
	});

	it('insecure stops watching and keeps the problem', () => {
		startLive();
		onError('insecure');
		expect(stops).toBe(1);
		expect(get(livePosition).problem).toBe('insecure');
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
});
