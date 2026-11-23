import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { writable } from 'svelte/store';

const { fileReport, user } = vi.hoisted(() => ({
  fileReport: vi.fn(async (_i: unknown) => 'id-1'),
  user: { current: null as null | import('svelte/store').Writable<unknown> }
}));
vi.mock('$lib/reports/outbox', () => ({
  fileReport: (i: unknown) => fileReport(i),
  pendingOutbox: writable([]),
  SignInRequiredError: class extends Error {}
}));
vi.mock('$lib/account/session', () => {
  user.current = writable({ id: 'u1', displayName: 'T', initials: 'T' });
  return { session: { subscribe: (fn: (v: unknown) => void) => user.current!.subscribe(fn) } };
});

import RouteReporting from './RouteReporting.svelte';
import type { Point3 } from '$lib/map/profile';

const line: Point3[] = [[18.4, -34.0], [18.41, -34.0]];
type Handler = ((p: [number, number]) => void) | null;

function setup() {
  const modes: Handler[] = [];
  const spots: ([number, number] | null)[] = [];
  const view = vi.fn();
  const r = render(RouteReporting, {
    routeId: 'r1', lineCoords: line, hasLocation: true,
    onmapmode: (h: Handler) => modes.push(h), onspot: (p: [number, number] | null) => spots.push(p), onmapview: view
  });
  return { modes, spots, view, ...r };
}
const chip = (n: string | RegExp) => screen.getByRole('radio', { name: n }) as HTMLButtonElement;
const handler = (modes: Handler[]) => modes[modes.length - 1];

beforeEach(() => { fileReport.mockClear(); user.current!.set({ id: 'u1', displayName: 'T', initials: 'T' }); });

describe('RouteReporting', () => {
  it('signed out shows only the sign-in line', () => {
    user.current!.set(null);
    setup();
    expect(screen.getByRole('link', { name: 'Sign in to report what you see.' }).getAttribute('href')).toMatch(/\/account$/);
    expect(screen.queryByRole('button', { name: /Report something/ })).toBeNull();
  });

  it('a pick and its tap keep the form open with the answers, and mark the spot', async () => {
    const { modes, spots, view } = setup();
    await fireEvent.click(screen.getByRole('button', { name: 'Report something on this route' }));
    await fireEvent.click(chip('Water source'));
    await fireEvent.input(screen.getByLabelText('Note'), { target: { value: 'dry spring' } });

    await fireEvent.click(chip('Pick on the map'));
    expect(handler(modes)).toBeTypeOf('function'); // map is in pick mode
    expect(view).toHaveBeenCalled();
    expect(screen.getByLabelText('Note')).toBeTruthy(); // the form survived starting the pick

    handler(modes)!([18.405, -34.0 + 0.0027]);
    await screen.findByText('Marked on the map');
    expect(handler(modes)).toBeNull(); // pick mode ended
    expect(chip('Water source').getAttribute('aria-checked')).toBe('true');
    expect((screen.getByLabelText('Note') as HTMLTextAreaElement).value).toBe('dry spring');
    expect(spots[spots.length - 1]).toEqual([18.405, -34.0 + 0.0027]);
  });

  it('the marked spot is the snapped point when snapped', async () => {
    const { modes, spots } = setup();
    await fireEvent.click(screen.getByRole('button', { name: 'Report something on this route' }));
    await fireEvent.click(chip('Pick on the map'));
    handler(modes)!([18.405, -34.0 + 0.00036]);
    await screen.findByText('Snapped to the route');
    const last = spots[spots.length - 1]!;
    expect(last[1]).toBeCloseTo(-34.0, 6);
  });

  it('switching away from Pick on the map ends the pick', async () => {
    const { modes } = setup();
    await fireEvent.click(screen.getByRole('button', { name: 'Report something on this route' }));
    await fireEvent.click(chip('Pick on the map'));
    expect(handler(modes)).toBeTypeOf('function');
    await fireEvent.click(chip('No exact spot'));
    expect(handler(modes)).toBeNull();
    expect(screen.getByLabelText('Note')).toBeTruthy();
  });

  it('picking again after a spot is chosen starts a new pick', async () => {
    const { modes, spots } = setup();
    await fireEvent.click(screen.getByRole('button', { name: 'Report something on this route' }));
    await fireEvent.click(chip('Pick on the map'));
    handler(modes)!([18.405, -34.0 + 0.0027]);
    await screen.findByText('Marked on the map');
    await fireEvent.click(chip('Pick on the map'));
    expect(handler(modes)).toBeTypeOf('function');
    handler(modes)!([18.407, -34.0 + 0.0027]);
    await waitFor(() => expect(spots[spots.length - 1]).toEqual([18.407, -34.0 + 0.0027]));
  });

  it('closing the form ends the pick and clears the marked spot', async () => {
    const { modes, spots } = setup();
    await fireEvent.click(screen.getByRole('button', { name: 'Report something on this route' }));
    await fireEvent.click(chip('Pick on the map'));
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(handler(modes)).toBeNull();
    expect(spots[spots.length - 1]).toBeNull();
    expect(screen.getByRole('button', { name: 'Report something on this route' })).toBeTruthy();
  });
});
