import { render, screen, fireEvent } from '@testing-library/svelte';
import { describe, it, expect, vi } from 'vitest';
import LivePosition from './LivePosition.svelte';
import type { RouteStatus } from '$lib/position/route-status';

type Measured = { kind: 'on' | 'off'; offM: number; doneM: number; remainingM: number; alongM: number; ageS: number };
const on = (over: Partial<Measured> = {}): RouteStatus & Measured => ({
  kind: 'on', offM: 5, doneM: 600, remainingM: 1400, alongM: 600, ageS: 2, ...over
});

const base = { status: null, on: true, problem: null };

describe('LivePosition', () => {
  it('toggle reads Show where I am and has aria-pressed', async () => {
    const ontoggle = vi.fn();
    const { rerender } = render(LivePosition, { ...base, on: false, ontoggle });
    const btn = screen.getByRole('button', { name: 'Show where I am' });
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    await fireEvent.click(btn);
    expect(ontoggle).toHaveBeenCalledTimes(1);
    await rerender({ ...base, on: true, ontoggle });
    const pressed = screen.getByRole('button', { name: 'Stop showing where I am' });
    expect(pressed.getAttribute('aria-pressed')).toBe('true');
  });

  it('off shows nothing but the toggle', () => {
    render(LivePosition, { ...base, on: false, status: on() });
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByText(/done/)).toBeNull();
  });

  it('on route shows "On route" and "600 m done · 1.4 km to go"', () => {
    render(LivePosition, { ...base, status: on() });
    expect(screen.getByRole('status').textContent).toBe('On route');
    expect(screen.getByTestId('live-distances').textContent).toBe('600 m done · 1.4 km to go');
  });

  it('km on both sides reads "1.2 km done · 1.8 km to go"', () => {
    render(LivePosition, { ...base, status: on({ doneM: 1200, remainingM: 1800 }) });
    expect(screen.getByTestId('live-distances').textContent).toBe('1.2 km done · 1.8 km to go');
  });

  it('off route shows "Off route by 85 m"', () => {
    render(LivePosition, { ...base, status: on({ kind: 'off', offM: 85 }) });
    expect(screen.getByRole('status').textContent).toBe('Off route by 85 m');
    expect(screen.getByTestId('live-distances').textContent).toBe('600 m done · 1.4 km to go');
  });

  it('rough shows the waiting line with ±150 m', () => {
    render(LivePosition, { ...base, status: { kind: 'rough', accuracy: 150.4, ageS: 1, prevGood: null } });
    expect(screen.getByRole('status').textContent).toBe('Waiting for a better GPS fix (±150 m)');
    expect(screen.queryByTestId('live-distances')).toBeNull();
  });

  it('rough shows the last good distances greyed under the waiting line', () => {
    render(LivePosition, { ...base, status: { kind: 'rough', accuracy: 150, ageS: 1, prevGood: on() } });
    expect(screen.getByRole('status').textContent).toBe('Waiting for a better GPS fix (±150 m)');
    const d = screen.getByTestId('live-distances');
    expect(d.textContent).toBe('600 m done · 1.4 km to go');
    expect(d.classList.contains('stale')).toBe(true);
  });

  it('noline shows "1.2 km to the route pin, as the crow flies"', () => {
    render(LivePosition, { ...base, status: { kind: 'noline', toPinM: 1200, ageS: 0 } });
    expect(screen.getByRole('status').textContent).toBe('1.2 km to the route pin, as the crow flies');
  });

  it('on with no fix yet says it is finding you', () => {
    render(LivePosition, { ...base });
    expect(screen.getByRole('status').textContent).toBe('Finding where you are');
  });

  it('denied, unavailable and insecure each show their copy', async () => {
    const { rerender } = render(LivePosition, { ...base, problem: 'denied' });
    expect(screen.getByText("Location is off for this site. You can turn it on in your browser's settings.")).toBeTruthy();
    await rerender({ ...base, problem: 'unavailable' });
    expect(screen.getByText("Couldn't get your location just now. It will keep trying.")).toBeTruthy();
    await rerender({ ...base, problem: 'insecure' });
    expect(screen.getByText('Location needs a secure (https) page.')).toBeTruthy();
  });

  it('denied shows only its copy, with no finding-you line', () => {
    render(LivePosition, { ...base, problem: 'denied' });
    expect(screen.queryByText('Finding where you are')).toBeNull();
  });

  it('unavailable keeps the last status in view', () => {
    render(LivePosition, { ...base, problem: 'unavailable', status: on({ ageS: 45 }) });
    expect(screen.getByText('On route')).toBeTruthy();
    expect(screen.getByTestId('live-age').textContent).toBe('Last fix 45 s ago');
  });

  it('a 45 s old fix shows "Last fix 45 s ago"', () => {
    render(LivePosition, { ...base, status: on({ ageS: 45 }) });
    expect(screen.getByTestId('live-age').textContent).toBe('Last fix 45 s ago');
  });

  it('a fresh fix shows no age line', () => {
    render(LivePosition, { ...base, status: on({ ageS: 30 }) });
    expect(screen.queryByTestId('live-age')).toBeNull();
  });
});
