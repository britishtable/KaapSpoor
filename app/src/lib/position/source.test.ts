import { afterEach, describe, expect, it, vi } from 'vitest';
import { webSource, type Fix, type PositionProblem } from './source';

afterEach(() => {
	vi.unstubAllGlobals();
});

function stubGeo(secure: boolean) {
	const watchPosition = vi.fn((_ok: PositionCallback, _err: PositionErrorCallback, _o?: PositionOptions) => 7);
	const clearWatch = vi.fn();
	vi.stubGlobal('isSecureContext', secure);
	vi.stubGlobal('navigator', { geolocation: { watchPosition, clearWatch } });
	return { watchPosition, clearWatch };
}

describe('webSource', () => {
	it('insecure context reports insecure without calling geolocation', () => {
		const { watchPosition } = stubGeo(false);
		const problems: PositionProblem[] = [];
		webSource.watch(() => {}, (p) => problems.push(p));
		expect(problems).toEqual(['insecure']);
		expect(watchPosition).not.toHaveBeenCalled();
	});

	it('watches with high accuracy and a 5 s maximumAge, and maps a position to a fix', () => {
		const { watchPosition, clearWatch } = stubGeo(true);
		const fixes: Fix[] = [];
		const stop = webSource.watch((f) => fixes.push(f), () => {});
		const [ok, , opts] = watchPosition.mock.calls[0];
		expect(opts).toMatchObject({ enableHighAccuracy: true, maximumAge: 5000 });
		ok({ coords: { longitude: 18.4, latitude: -33.9, accuracy: 12 }, timestamp: 1234 } as GeolocationPosition);
		expect(fixes).toEqual([{ lon: 18.4, lat: -33.9, accuracy: 12, at: 1234 }]);
		stop();
		expect(clearWatch).toHaveBeenCalledWith(7);
	});

	it('maps error codes 1/2/3', () => {
		const { watchPosition } = stubGeo(true);
		const problems: PositionProblem[] = [];
		webSource.watch(() => {}, (p) => problems.push(p));
		const err = watchPosition.mock.calls[0][1];
		for (const code of [1, 2, 3]) err({ code } as GeolocationPositionError);
		expect(problems).toEqual(['denied', 'unavailable', 'unavailable']);
	});
});
