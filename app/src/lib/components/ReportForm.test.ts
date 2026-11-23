import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writable } from 'svelte/store';
import type { Point3 } from '$lib/map/profile';

const { fileReport, queued } = vi.hoisted(() => ({
  fileReport: vi.fn(async (_input: unknown) => 'id-1'),
  queued: { current: null as null | import('svelte/store').Writable<{ id: string }[]> }
}));
vi.mock('$lib/reports/outbox', () => ({
  fileReport: (input: unknown) => fileReport(input),
  pendingOutbox: { subscribe: (fn: (v: { id: string }[]) => void) => queued.current!.subscribe(fn) },
  SignInRequiredError: class SignInRequiredError extends Error {}
}));

import ReportForm from './ReportForm.svelte';

queued.current = writable<{ id: string }[]>([]);

// A line due east along lat -34.0; one degree of longitude is ~92 km here, so 0.001 deg is ~92 m.
const line: Point3[] = [[18.4, -34.0], [18.41, -34.0]];
// 40 m north of the line is ~0.00036 deg of latitude.
const NEAR: [number, number] = [18.405, -34.0 + 0.00036];
const FAR: [number, number] = [18.405, -34.0 + 0.0027];

function fix(lon: number, lat: number) {
  const getCurrentPosition = vi.fn((ok: PositionCallback) =>
    ok({ coords: { longitude: lon, latitude: lat, accuracy: 8 } } as GeolocationPosition));
  Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition }, configurable: true });
  return getCurrentPosition;
}
function denied() {
  const getCurrentPosition = vi.fn((_ok: PositionCallback, err: PositionErrorCallback) =>
    err({ code: 1, message: 'denied' } as GeolocationPositionError));
  Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition }, configurable: true });
}

type Over = Partial<{ lineCoords: Point3[]; hasLocation: boolean; activeHikeId: string | null; onpickrequest: () => Promise<[number, number] | null>; oncancelpick: () => void }>;
function setup(over: Over = {}) {
  const onclose = vi.fn();
  render(ReportForm, {
    routeId: 'r1', lineCoords: line, hasLocation: true, activeHikeId: null,
    onpickrequest: async () => null, onclose, ...over
  });
  return { onclose };
}
const send = () => screen.getByRole('button', { name: 'Send report' }) as HTMLButtonElement;
const chip = (name: string | RegExp) => screen.getByRole('radio', { name }) as HTMLButtonElement;

beforeEach(() => { fileReport.mockClear(); queued.current!.set([]); });
afterEach(() => { Reflect.deleteProperty(navigator, 'geolocation'); });

describe('ReportForm', () => {
  it('Send disabled until a category', async () => {
    setup();
    expect(send().disabled).toBe(true);
    await fireEvent.click(chip(/Obstruction/));
    expect(send().disabled).toBe(false);
  });

  it('shows all eight category labels', () => {
    setup();
    for (const l of ['Obstruction (fallen tree, rockfall)', 'Trail damage or erosion', 'Closure', 'Fire or fire damage',
      'Water source', 'Wildlife (e.g. baboons)', 'Safety incident', 'Mud, flooding or snow']) {
      expect(chip(l)).toBeTruthy();
    }
  });

  it('SAFETY shows the guidance line', async () => {
    setup();
    expect(screen.queryByText(/Please don't name or describe the people involved/)).toBeNull();
    await fireEvent.click(chip('Safety incident'));
    expect(screen.getByText("Describe what happened and where. Please don't name or describe the people involved.")).toBeTruthy();
  });

  it('the note is capped at 500 characters', () => {
    setup();
    expect((screen.getByLabelText('Note') as HTMLTextAreaElement).maxLength).toBe(500);
  });

  it('a fix 40 m from the line is snapped and says "Snapped to the route"', async () => {
    fix(...NEAR);
    setup();
    await fireEvent.click(chip('Obstruction (fallen tree, rockfall)'));
    await fireEvent.click(chip('Use my location'));
    await screen.findByText('Snapped to the route');
    await fireEvent.click(send());
    await waitFor(() => expect(fileReport).toHaveBeenCalled());
    const body = fileReport.mock.calls[0][0] as { position: { lon: number; lat: number } };
    expect(body.position.lat).toBeCloseTo(-34.0, 6);
    expect(body.position.lon).toBeCloseTo(18.405, 4);
  });

  it('asks for a one-shot high-accuracy fix with a 15 s timeout', async () => {
    const g = fix(...NEAR);
    setup();
    await fireEvent.click(chip('Use my location'));
    await screen.findByText('Snapped to the route');
    expect((g.mock.calls[0] as unknown[])[2]).toEqual({ enableHighAccuracy: true, timeout: 15000 });
  });

  it('a fix 300 m away is kept and says "Marked where you are"', async () => {
    fix(...FAR);
    setup();
    await fireEvent.click(chip('Obstruction (fallen tree, rockfall)'));
    await fireEvent.click(chip('Use my location'));
    await screen.findByText('Marked where you are');
    await fireEvent.click(send());
    await waitFor(() => expect(fileReport).toHaveBeenCalled());
    const body = fileReport.mock.calls[0][0] as { position: { lon: number; lat: number } };
    expect(body.position).toEqual({ lon: FAR[0], lat: FAR[1] });
  });

  it('a route with no drawn line keeps the tapped point unsnapped', async () => {
    const tapped: [number, number] = [18.405, -34.0];
    setup({ lineCoords: [], onpickrequest: async () => tapped });
    await fireEvent.click(chip('Wildlife (e.g. baboons)'));
    await fireEvent.click(chip('Pick on the map'));
    await screen.findByText('Marked on the map');
    await fireEvent.click(send());
    await waitFor(() => expect(fileReport).toHaveBeenCalled());
    expect((fileReport.mock.calls[0][0] as { position: unknown }).position).toEqual({ lon: 18.405, lat: -34.0 });
  });

  it('a tapped point near the line is snapped', async () => {
    setup({ onpickrequest: async () => NEAR });
    await fireEvent.click(chip('Pick on the map'));
    await screen.findByText('Snapped to the route');
  });

  it('denied permission shows the calm copy and keeps the answers', async () => {
    denied();
    setup();
    await fireEvent.click(chip('Water source'));
    await fireEvent.input(screen.getByLabelText('Note'), { target: { value: 'dry spring' } });
    await fireEvent.click(chip('Use my location'));
    await screen.findByText("Couldn't get your location. You can pick the spot on the map instead.");
    expect(chip('Water source').getAttribute('aria-checked')).toBe('true');
    expect((screen.getByLabelText('Note') as HTMLTextAreaElement).value).toBe('dry spring');
    expect(send().disabled).toBe(false);
  });

  it('no location: only "No exact spot" is offered', () => {
    setup({ hasLocation: false, lineCoords: [] });
    expect(screen.queryByRole('radio', { name: 'Use my location' })).toBeNull();
    expect(screen.queryByRole('radio', { name: 'Pick on the map' })).toBeNull();
    expect(chip('No exact spot').getAttribute('aria-checked')).toBe('true');
  });

  it('with no location the report files without any position', async () => {
    setup({ hasLocation: false, lineCoords: [] });
    await fireEvent.click(chip('Closure'));
    await fireEvent.click(send());
    await waitFor(() => expect(fileReport).toHaveBeenCalled());
    const body = fileReport.mock.calls[0][0] as Record<string, unknown>;
    expect(body.position ?? null).toBeNull();
    expect(body.routeId).toBe('r1');
    expect(body.category).toBe('CLOSURE');
  });

  it('during an active hike the saved line says it will show once you finish', async () => {
    setup({ activeHikeId: 'h1' });
    await fireEvent.click(chip('Closure'));
    await fireEvent.click(send());
    await screen.findByText('Saved. It will show once you finish your hike.');
    expect((fileReport.mock.calls[0][0] as { hikeId: string }).hikeId).toBe('h1');
  });

  it('after a hike it just says Saved, and says it will send while queued', async () => {
    queued.current!.set([{ id: 'id-1' }]);
    setup();
    await fireEvent.click(chip('Closure'));
    await fireEvent.click(send());
    await screen.findByText('Saved.');
    expect(screen.getByText('Will send when you have signal')).toBeTruthy();
    expect((fileReport.mock.calls[0][0] as { hikeId: unknown }).hikeId ?? null).toBeNull();
  });

  it('Earlier opens a time picker bounded to the last 14 days', async () => {
    setup();
    expect(screen.queryByLabelText('When did you see it?')).toBeNull();
    await fireEvent.click(chip('Earlier'));
    const input = screen.getByLabelText('When did you see it?') as HTMLInputElement;
    expect(input.type).toBe('datetime-local');
    expect(Date.parse(input.max) - Date.parse(input.min)).toBeGreaterThan(13 * 864e5);
    expect(Date.parse(input.max) - Date.parse(input.min)).toBeLessThan(14 * 864e5);
  });

  it('keeps the input when saving fails', async () => {
    fileReport.mockRejectedValueOnce(new Error('disk'));
    setup();
    await fireEvent.click(chip('Closure'));
    await fireEvent.input(screen.getByLabelText('Note'), { target: { value: 'gate locked' } });
    await fireEvent.click(send());
    await screen.findByText("Couldn't save that on this device. Your report is still here.");
    expect((screen.getByLabelText('Note') as HTMLTextAreaElement).value).toBe('gate locked');
  });

  it('preselects No exact spot so the outcome is visible', () => {
    setup();
    expect(chip('No exact spot').getAttribute('aria-checked')).toBe('true');
  });

  it('arrow keys in Where move focus without starting a fix or a pick', async () => {
    const g = fix(...NEAR);
    const onpickrequest = vi.fn(async () => null);
    setup({ onpickrequest });
    chip('No exact spot').focus();
    await fireEvent.keyDown(chip('No exact spot'), { key: 'ArrowLeft' });
    await fireEvent.keyDown(chip('Pick on the map'), { key: 'ArrowLeft' });
    expect(g).not.toHaveBeenCalled();
    expect(onpickrequest).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(chip('Use my location'));
    expect(chip('No exact spot').getAttribute('aria-checked')).toBe('true');
  });

  it('an out-of-area spot is not left selected and says so', async () => {
    fix(10, 10);
    setup();
    await fireEvent.click(chip('Use my location'));
    await screen.findByRole('alert');
    expect(chip('Use my location').getAttribute('aria-checked')).toBe('false');
  });

  it('abandoning a pick tells the page', async () => {
    const oncancelpick = vi.fn();
    setup({ onpickrequest: () => new Promise(() => {}), oncancelpick } as never);
    await fireEvent.click(chip('Pick on the map'));
    await fireEvent.click(chip('No exact spot'));
    expect(oncancelpick).toHaveBeenCalled();
  });

  it('focus moves into the form on open and to Done after saving', async () => {
    setup();
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Report something on this route' }));
    await fireEvent.click(chip('Closure'));
    await fireEvent.click(send());
    const done = await screen.findByRole('button', { name: 'Done' });
    await waitFor(() => expect(document.activeElement).toBe(done));
  });
});
