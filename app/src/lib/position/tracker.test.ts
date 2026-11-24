import { describe, expect, it } from 'vitest';
import { createTracker } from './tracker';
import type { LivePosition } from './live';
import { reverseCoords, type Point3 } from '../map/profile';

// 500 m east, then back west along the same ground: the way back is only told apart by continuity.
const M = 1 / 92_000; // degrees of longitude per metre near 34 S, close enough here
// A vertex every 25 m, as a drawn line has.
const steps = Array.from({ length: 21 }, (_, i) => i * 25);
const outAndBack: Point3[] = [
	...steps.map((m): Point3 => [18.4 + m * M, -34]),
	...steps.reverse().slice(1).map((m): Point3 => [18.4 + m * M, -34])
];
const live = (alongM: number, over: Partial<LivePosition> = {}): LivePosition => ({
	on: true,
	problem: null,
	fix: { lon: 18.4 + alongM * M, lat: -34, accuracy: 8, at: 1000 },
	...over
});
const doneM = (s: ReturnType<ReturnType<typeof createTracker>>) =>
	s && (s.kind === 'on' || s.kind === 'off') ? s.doneM : NaN;
const walkOut = (track: ReturnType<typeof createTracker>) => {
	for (const m of [100, 200, 300, 400, 490, 440, 400]) track(live(m), outAndBack, null, 2000);
};

describe('createTracker', () => {
	it('is null when off or before the first fix', () => {
		const track = createTracker();
		expect(track(live(100, { on: false, fix: null }), outAndBack, null, 0)).toBeNull();
		expect(track(live(100, { fix: null }), outAndBack, null, 0)).toBeNull();
	});

	it('carries the walked leg from fix to fix', () => {
		const track = createTracker();
		walkOut(track);
		expect(doneM(track(live(200), outAndBack, null, 2000))).toBeGreaterThan(700);
	});

	it('keeps the leg across a hidden tab, which clears the fix', () => {
		const track = createTracker();
		walkOut(track);
		track(live(0, { fix: null }), outAndBack, null, 2000);
		expect(doneM(track(live(200), outAndBack, null, 2000))).toBeGreaterThan(700);
	});

	it('starts afresh after being turned off', () => {
		const track = createTracker();
		walkOut(track);
		track(live(0, { on: false, fix: null }), outAndBack, null, 2000);
		expect(doneM(track(live(200), outAndBack, null, 2000))).toBeLessThan(300);
	});

	it('starts afresh when the line changes: a distance along one plan means nothing on another', () => {
		const track = createTracker();
		walkOut(track);
		const other = reverseCoords(outAndBack);
		expect(doneM(track(live(200), other, null, 2000))).toBeLessThan(300);
	});

	it('a rough fix in between does not lose the leg', () => {
		const track = createTracker();
		walkOut(track);
		const rough = track(live(200, { fix: { lon: 18.4, lat: -34, accuracy: 150, at: 1 } }), outAndBack, null, 2000);
		expect(rough?.kind).toBe('rough');
		expect(doneM(track(live(200), outAndBack, null, 2000))).toBeGreaterThan(700);
	});

	it('the age is measured against now', () => {
		const track = createTracker();
		expect(track(live(100), outAndBack, null, 46_000)?.ageS).toBe(45);
	});
});
