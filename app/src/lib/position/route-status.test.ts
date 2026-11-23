import { describe, it, expect } from 'vitest';
import { routeStatus, OFF_ROUTE_M, ROUGH_FIX_M, STALE_S, type RouteStatus } from './route-status';
import { totalDistanceM, type Point3 } from '../map/profile';
import { haversineM } from '../map/snap';

const line: Point3[] = [[18, -34], [18.01, -34], [18.02, -34]];
const M = 1 / 111195; // degrees of latitude per metre
const NOW = 1_000_000;
const fixAt = (offM: number, accuracy = 10, lon = 18.005, at = NOW) => ({ lon, lat: -34 + offM * M, accuracy, at });
const run = (offM: number, prev: RouteStatus | null, accuracy = 10, lon = 18.005) =>
  routeStatus({ fix: fixAt(offM, accuracy, lon), lineCoords: line, pin: null, prev, now: NOW });

describe('routeStatus', () => {
  it('exports the constants', () => {
    expect([OFF_ROUTE_M, ROUGH_FIX_M, STALE_S]).toEqual([40, 100, 30]);
  });
  it('threshold: on at 35 m, off at 45 m', () => {
    expect(run(35, null).kind).toBe('on');
    expect(run(45, null).kind).toBe('off');
    const on = run(35, null);
    expect(run(45, on).kind).toBe('off');
  });
  it('hysteresis: from off, 35 m stays off and 25 m turns on', () => {
    const off = run(45, null);
    expect(run(35, off).kind).toBe('off');
    expect(run(25, off).kind).toBe('on');
  });
  it('accuracy widens the limit', () => {
    expect(run(50, null, 60).kind).toBe('on');
    const off = run(100, null, 10);
    expect(run(55, off, 60).kind).toBe('off'); // below 50 needed
    expect(run(45, off, 60).kind).toBe('on');
  });
  it('rough fix gives rough with prevGood, and next good fix decides from state before it', () => {
    const off = run(45, null);
    const rough = run(0, off, 150);
    expect(rough).toMatchObject({ kind: 'rough', accuracy: 150, prevGood: off });
    expect(run(35, rough).kind).toBe('off');
    expect(run(25, rough).kind).toBe('on');
    const rough2 = run(0, rough, 200);
    expect(rough2).toMatchObject({ kind: 'rough', prevGood: off });
    expect(run(0, null, 150)).toMatchObject({ kind: 'rough', prevGood: null });
  });
  it('rough prev passes prevGood alongM for continuity', () => {
    const good = run(0, null, 10, 18.005) as Extract<RouteStatus, { alongM: number }>;
    const rough = run(0, good, 150);
    const next = run(0, rough, 10, 18.006) as Extract<RouteStatus, { alongM: number }>;
    expect(next.alongM).toBeGreaterThan(good.alongM);
  });
  it('one wild fix turns state off', () => {
    const on = run(0, null);
    expect(run(300, on, 20).kind).toBe('off');
  });
  it('noline: toPinM from haversine, null without pin', () => {
    const f = fixAt(0);
    const pin = { lon: 18.1, lat: -34 };
    const r = routeStatus({ fix: f, lineCoords: [[18, -34]], pin, prev: null, now: NOW });
    expect(r).toMatchObject({ kind: 'noline' });
    expect((r as { toPinM: number }).toPinM).toBeCloseTo(haversineM([f.lon, f.lat], [pin.lon, pin.lat]), 6);
    expect(routeStatus({ fix: f, lineCoords: [], pin: null, prev: null, now: NOW })).toMatchObject({ kind: 'noline', toPinM: null });
  });
  it('ageS is floored seconds', () => {
    const r = routeStatus({ fix: fixAt(0, 10, 18.005, NOW - 12_900), lineCoords: line, pin: null, prev: null, now: NOW });
    expect(r.ageS).toBe(12);
  });
  it('done + remaining equals the total', () => {
    const r = run(5, null, 10, 18.013) as Extract<RouteStatus, { alongM: number }>;
    expect(r.doneM + r.remainingM).toBe(totalDistanceM(line));
    expect(r.doneM).toBeGreaterThan(1000);
  });
});
