import { locateOnLine, totalDistanceM, type Point3 } from '../map/profile';
import { haversineM } from '../map/snap';
import type { Fix } from './source';

export const OFF_ROUTE_M = 40;
export const ROUGH_FIX_M = 100;
export const STALE_S = 30;
const BACK_ON_M = 30;
const HYSTERESIS_M = 10;

export type RouteStatus = { ageS: number } & (
  | { kind: 'rough'; accuracy: number; prevGood: RouteStatus | null }
  | { kind: 'on' | 'off'; offM: number; doneM: number; remainingM: number; alongM: number }
  | { kind: 'noline'; toPinM: number | null }
);

export function routeStatus(input: {
  fix: Fix;
  lineCoords: Point3[];
  pin: { lon: number; lat: number } | null;
  prev: RouteStatus | null;
  now: number;
}): RouteStatus {
  const { fix, lineCoords, pin, prev, now } = input;
  const ageS = Math.max(0, Math.floor((now - fix.at) / 1000));
  // The last status that was not rough: a rough fix never changes it.
  const good = prev?.kind === 'rough' ? prev.prevGood : prev;

  if (fix.accuracy > ROUGH_FIX_M) return { kind: 'rough', accuracy: fix.accuracy, ageS, prevGood: good };

  if (lineCoords.length < 2) {
    const toPinM = pin ? haversineM([fix.lon, fix.lat], [pin.lon, pin.lat]) : null;
    return { kind: 'noline', toPinM, ageS };
  }

  const prevAlong = good && (good.kind === 'on' || good.kind === 'off') ? good.alongM : null;
  const loc = locateOnLine(lineCoords, [fix.lon, fix.lat], prevAlong);
  if (!loc) return { kind: 'noline', toPinM: null, ageS };

  const wasOff = good?.kind === 'off';
  const off = wasOff
    ? !(loc.offM < Math.max(BACK_ON_M, fix.accuracy - HYSTERESIS_M))
    : loc.offM > Math.max(OFF_ROUTE_M, fix.accuracy);
  const total = totalDistanceM(lineCoords);
  return {
    kind: off ? 'off' : 'on',
    offM: loc.offM,
    doneM: loc.alongM,
    remainingM: total - loc.alongM,
    alongM: loc.alongM,
    ageS,
  };
}
