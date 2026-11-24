import type { Point3 } from '../map/profile';
import type { LivePosition } from './live';
import { routeStatus, type RouteStatus } from './route-status';

/**
 * Chains routeStatus from fix to fix, so a hiker stays on the leg they are walking. The chain
 * restarts when live position is off or the line changes (a distance along one plan means nothing
 * on another). It survives a missing fix: hiding the tab clears the fix, and the hiker who comes
 * back has usually walked on.
 */
export function createTracker() {
	let prev: RouteStatus | null = null;
	let line: Point3[] | null = null;
	return (
		live: LivePosition,
		lineCoords: Point3[],
		pin: { lon: number; lat: number } | null,
		now: number
	): RouteStatus | null => {
		if (!live.on || lineCoords !== line) prev = null;
		line = lineCoords;
		if (!live.on || !live.fix) return null;
		prev = routeStatus({ fix: live.fix, lineCoords, pin, prev, now });
		return prev;
	};
}
