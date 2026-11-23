export type Fix = { lon: number; lat: number; accuracy: number; at: number };
export type PositionProblem = 'denied' | 'unavailable' | 'insecure';
export type PositionSource = {
	/** Starts watching; returns a function that stops the watch. */
	watch(onFix: (f: Fix) => void, onError: (e: PositionProblem) => void): () => void;
};

/** Browser geolocation. Touches window/navigator only when watch() is called. */
export const webSource: PositionSource = {
	watch(onFix, onError) {
		if (!window.isSecureContext || !navigator.geolocation) {
			onError('insecure');
			return () => {};
		}
		const id = navigator.geolocation.watchPosition(
			(p) =>
				onFix({
					lon: p.coords.longitude,
					lat: p.coords.latitude,
					accuracy: p.coords.accuracy,
					at: p.timestamp
				}),
			(e) => onError(e.code === 1 ? 'denied' : 'unavailable'),
			{ enableHighAccuracy: true, maximumAge: 5000 }
		);
		return () => navigator.geolocation.clearWatch(id);
	}
};
