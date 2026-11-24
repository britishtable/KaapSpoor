import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Writable } from 'svelte/store';
import type { OutboxItem, PublicReport } from '$lib/reports/types';

const h = vi.hoisted(() => ({
  answer: vi.fn(async (_id: string, _a: string) => {}),
  outbox: null as null | Writable<OutboxItem[]>,
  user: null as null | Writable<unknown>
}));
vi.mock('$lib/reports/outbox', async () => {
  const { writable } = await import('svelte/store');
  h.outbox = writable<OutboxItem[]>([]);
  return {
    answerReport: (id: string, a: string) => h.answer(id, a),
    pendingOutbox: { subscribe: (fn: (v: OutboxItem[]) => void) => h.outbox!.subscribe(fn) }
  };
});
vi.mock('$lib/account/session', async () => {
  const { writable } = await import('svelte/store');
  h.user = writable({ id: 'u1' });
  return { session: { subscribe: (fn: (v: unknown) => void) => h.user!.subscribe(fn) } };
});

import NearReportPrompt from './NearReportPrompt.svelte';

const HERE = { lon: 18.4, lat: -34 };
/** A point this many metres north of HERE. */
const north = (m: number) => ({ lon: 18.4, lat: -34 + m / 111_195 });
const fix = (over = {}) => ({ ...HERE, accuracy: 10, at: 1000, ...over });
const pub = (id: string, position: { lon: number; lat: number } | null, over: Partial<PublicReport> = {}): PublicReport => ({
  id, category: 'OBSTRUCTION', note: '', observedAt: '2026-11-23T07:00:00Z', lastConfirmedAt: null,
  expiresAt: null, clearedAt: null, position, displayName: 'Bongi', unverified: false, ...over
});
const queue = (id: string): OutboxItem =>
  ({ id: `${id}:u1`, owner: 'u1', createdAt: '2026-11-24T07:00:00Z', kind: 'confirmation', reportId: id, answer: 'GONE' });
const base = () => ({ fix: fix(), active: [pub('a', north(50))], own: new Set<string>() });
const question = () => screen.queryByTestId('near-question')?.textContent ?? null;
const tap = (name: string) => fireEvent.click(screen.getByRole('button', { name }));

let clock = 0;
beforeEach(() => {
  clock = 10_000;
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  h.answer.mockReset();
  h.answer.mockImplementation(async (id) => { h.outbox!.update((q) => [...q, queue(id)]); });
  h.outbox!.set([]);
  h.user!.set({ id: 'u1' });
});

afterEach(() => { vi.restoreAllMocks(); });

describe('NearReportPrompt', () => {
  it('asks about the nearest active report within 100 m', () => {
    render(NearReportPrompt, { ...base(), active: [pub('far', north(90), { category: 'WATER' }), pub('a', north(50))] });
    expect(question()).toBe('Obstruction (fallen tree, rockfall), 50 m from you. Still there?');
    expect(screen.getByRole('status')).toBeTruthy();
    for (const name of ['Still there', 'Gone', 'Not sure', 'Not now']) {
      expect(screen.getByRole('button', { name })).toBeTruthy();
    }
  });

  it('ignores one 150 m away', () => {
    render(NearReportPrompt, { ...base(), active: [pub('a', north(150))] });
    expect(question()).toBeNull();
  });

  it('never asks about your own report', () => {
    render(NearReportPrompt, { ...base(), own: new Set(['a']) });
    expect(question()).toBeNull();
  });

  it('never asks a hiker standing there about a safety incident, and asks about the next nearest', () => {
    const safety = pub('s', north(20), { category: 'SAFETY' });
    const { unmount } = render(NearReportPrompt, { ...base(), active: [safety] });
    expect(question()).toBeNull();
    unmount();
    render(NearReportPrompt, { ...base(), active: [safety, pub('a', north(50))] });
    expect(question()).toContain('Obstruction');
  });

  it('not for a report with no position', () => {
    render(NearReportPrompt, { ...base(), active: [pub('a', null)] });
    expect(question()).toBeNull();
  });

  it('not while the fix is rough, or before there is one', async () => {
    const { rerender } = render(NearReportPrompt, { ...base(), fix: fix({ accuracy: 101 }) });
    expect(question()).toBeNull();
    await rerender({ ...base(), fix: null });
    expect(question()).toBeNull();
  });

  it('signed out, no prompt', () => {
    h.user!.set(null);
    render(NearReportPrompt, base());
    expect(question()).toBeNull();
  });

  it('not again after Not now', async () => {
    const { rerender } = render(NearReportPrompt, base());
    await tap('Not now');
    expect(question()).toBeNull();
    clock += 2000;
    await rerender({ ...base(), fix: fix({ at: 2000 }) });
    expect(question()).toBeNull();
    expect(h.answer).not.toHaveBeenCalled();
  });

  it('answering calls answerReport and shows Will send when you have signal while queued', async () => {
    const { rerender } = render(NearReportPrompt, base());
    await tap('Still there');
    expect(h.answer).toHaveBeenCalledWith('a', 'STILL_THERE');
    await waitFor(() => expect(question()).toBeNull());
    expect(screen.getByText('Will send when you have signal')).toBeTruthy();
    h.outbox!.set([]); // sent
    await waitFor(() => expect(screen.queryByText('Will send when you have signal')).toBeNull());
    clock += 2000;
    await rerender({ ...base(), fix: fix({ at: 2000 }) });
    expect(question()).toBeNull();
  });

  it('not about one answered in the list on this page, even after that answer was sent', async () => {
    const { rerender } = render(NearReportPrompt, { ...base(), fix: null });
    h.outbox!.set([queue('a')]);
    h.outbox!.set([]);
    await rerender({ ...base() });
    expect(question()).toBeNull();
  });

  it('not about one whose answer was already queued when the page opened', () => {
    h.outbox!.set([queue('a')]);
    render(NearReportPrompt, base());
    expect(question()).toBeNull();
  });

  it('the next one is asked at the next fix, not under the same tap', async () => {
    const two = [pub('a', north(50)), pub('b', north(80), { category: 'WATER' })];
    const { rerender } = render(NearReportPrompt, { ...base(), active: two });
    await tap('Not now');
    expect(question()).toBeNull();
    // A fix may land a moment after the tap, and a second tap of a double tap with it.
    clock += 300;
    await rerender({ ...base(), active: two, fix: fix({ at: 2000 }) });
    expect(question()).toBeNull();
    clock += 1000;
    await rerender({ ...base(), active: two, fix: fix({ at: 3000 }) });
    expect(question()).toContain('80 m from you. Still there?');
  });

  it('nor right after an answer, when the list reloads under it', async () => {
    const two = [pub('a', north(50)), pub('b', north(80), { category: 'WATER' })];
    const { rerender } = render(NearReportPrompt, { ...base(), active: two });
    await tap('Gone');
    await waitFor(() => expect(question()).toBeNull());
    clock += 300;
    await rerender({ ...base(), active: [...two] });
    expect(question()).toBeNull();
    expect(h.answer).toHaveBeenCalledTimes(1);
  });

  it('keeps asking about the same report while another becomes nearer', async () => {
    const two = [pub('a', north(50)), pub('b', north(-60), { category: 'WATER' })];
    const { rerender } = render(NearReportPrompt, { ...base(), active: two });
    expect(question()).toContain('50 m');
    await rerender({ ...base(), active: two, fix: fix({ ...north(-20), at: 2000 }) });
    expect(question()).toBe('Obstruction (fallen tree, rockfall), 70 m from you. Still there?');
  });

  it('a failed save keeps the question and says so', async () => {
    h.answer.mockRejectedValue(new Error('disk'));
    render(NearReportPrompt, base());
    await tap('Gone');
    expect(await screen.findByText("Couldn't save that answer on this device.")).toBeTruthy();
    expect(question()).not.toBeNull();
  });

  it('another account on the same phone is asked afresh', async () => {
    const { rerender } = render(NearReportPrompt, base());
    await tap('Not now');
    h.user!.set({ id: 'u2' });
    clock += 2000;
    await rerender({ ...base(), fix: fix({ at: 2000 }) });
    expect(question()).not.toBeNull();
  });
});
