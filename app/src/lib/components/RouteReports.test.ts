import { render, screen, fireEvent, waitFor, within } from '@testing-library/svelte';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { writable, type Writable } from 'svelte/store';
import type { OutboxItem, PublicReport, MyReport, ReportItem, RouteReportsView } from '$lib/reports/types';

const h = vi.hoisted(() => ({
  load: vi.fn(),
  answer: vi.fn(async (_id: string, _a: string) => {}),
  discard: vi.fn(async (_id: string) => {}),
  waits: vi.fn((_i: unknown) => false),
  mine: new Set<string>(),
  outbox: null as null | Writable<OutboxItem[]>,
  user: null as null | Writable<unknown>
}));
vi.mock('$lib/reports/reports', () => ({ loadRouteReports: (id: string) => h.load(id) }));
vi.mock('$lib/reports/outbox', async () => {
  const { writable } = await import('svelte/store');
  h.outbox = writable<OutboxItem[]>([]);
  return {
    answerReport: (id: string, a: string) => h.answer(id, a),
    discardOutboxItem: (id: string) => h.discard(id),
    waitsOnHike: (i: unknown) => h.waits(i),
    pendingOutbox: { subscribe: (fn: (v: OutboxItem[]) => void) => h.outbox!.subscribe(fn) }
  };
});
vi.mock('$lib/reports/mine', () => ({ mineIds: () => h.mine }));
vi.mock('$lib/account/session', async () => {
  const { writable } = await import('svelte/store');
  h.user = writable({ id: 'u1', displayName: 'Thandi', initials: 'T' });
  return { session: { subscribe: (fn: (v: unknown) => void) => h.user!.subscribe(fn) } };
});

import RouteReports from './RouteReports.svelte';

const HOUR = 3600_000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const pub = (id: string, over: Partial<PublicReport> = {}): PublicReport => ({
  id, category: 'OBSTRUCTION', note: '', observedAt: ago(3 * HOUR), lastConfirmedAt: null,
  expiresAt: null, clearedAt: null, position: { lon: 18.4, lat: -34 }, displayName: 'Bongi', unverified: false, ...over
});
const held = (id: string, over: Partial<MyReport> = {}): MyReport => ({
  id, routeId: 'r1', category: 'FIRE', note: 'smoke on the ridge', observedAt: ago(HOUR), lastConfirmedAt: null,
  expiresAt: null, clearedAt: null, position: null, hikeId: 'h1', held: true, unverified: false, ...over
});
const queued = (id: string, over: Partial<ReportItem> = {}): ReportItem => ({
  id, owner: 'u1', createdAt: ago(0), kind: 'report',
  body: { routeId: 'r1', category: 'WATER', note: 'spring dry', observedAt: ago(0) }, ...over
});
const view = (over: Partial<RouteReportsView> = {}): RouteReportsView =>
  ({ active: [], history: [], mineHeld: [], minePending: [], ...over });

beforeEach(() => {
  h.load.mockReset();
  h.answer.mockClear();
  h.discard.mockClear();
  h.waits.mockReset();
  h.waits.mockReturnValue(false);
  h.mine = new Set();
  h.outbox!.set([]);
  h.user!.set({ id: 'u1', displayName: 'Thandi', initials: 'T' });
});

describe('RouteReports', () => {
  it('renders nothing when unavailable', async () => {
    h.load.mockResolvedValue('unavailable');
    const { container } = render(RouteReports, { routeId: 'r1' });
    await waitFor(() => expect(h.load).toHaveBeenCalledWith('r1'));
    await Promise.resolve();
    expect(container.querySelector('section')).toBeNull();
  });

  it('offline line', async () => {
    h.load.mockResolvedValue('offline');
    render(RouteReports, { routeId: 'r1' });
    await screen.findByText('Reports need a connection.');
    expect(screen.getByRole('heading', { name: 'Trail reports' })).toBeTruthy();
  });

  it('nothing reported recently', async () => {
    h.load.mockResolvedValue(view());
    render(RouteReports, { routeId: 'r1' });
    await screen.findByText('Nothing reported recently.');
  });

  it('active report shows category, Seen …, name and note as text', async () => {
    h.load.mockResolvedValue(view({ active: [pub('a', { note: '<b>big</b> tree', displayName: 'Bongi' })] }));
    const { container } = render(RouteReports, { routeId: 'r1' });
    await screen.findByText('Obstruction (fallen tree, rockfall)');
    expect(screen.getByText('Seen 3 hours ago')).toBeTruthy();
    expect(screen.getByText('Bongi')).toBeTruthy();
    expect(screen.getByText('<b>big</b> tree')).toBeTruthy();
    expect(container.querySelector('b')).toBeNull();
  });

  it('last confirmed shows when set', async () => {
    h.load.mockResolvedValue(view({ active: [pub('a', { lastConfirmedAt: ago(1.5 * HOUR) })] }));
    render(RouteReports, { routeId: 'r1' });
    await screen.findByText('Seen 3 hours ago · last confirmed 1 hour ago');
  });

  it('unverified safety shows the calm line; a verified one does not', async () => {
    h.load.mockResolvedValue(view({ active: [
      pub('s1', { category: 'SAFETY', unverified: true }),
      pub('s2', { category: 'SAFETY', unverified: false })
    ] }));
    render(RouteReports, { routeId: 'r1' });
    await screen.findAllByText('Safety incident');
    expect(screen.getAllByText('Not yet confirmed by anyone else')).toHaveLength(1);
  });

  it('others’ reports offer three answers that call answerReport', async () => {
    h.load.mockResolvedValue(view({ active: [pub('a')] }));
    render(RouteReports, { routeId: 'r1' });
    await screen.findByText('Bongi');
    await fireEvent.click(screen.getByRole('button', { name: 'Still there' }));
    expect(h.answer).toHaveBeenCalledWith('a', 'STILL_THERE');
    await fireEvent.click(screen.getByRole('button', { name: 'Gone' }));
    expect(h.answer).toHaveBeenCalledWith('a', 'GONE');
    await fireEvent.click(screen.getByRole('button', { name: 'Not sure' }));
    expect(h.answer).toHaveBeenCalledWith('a', 'NOT_SURE');
    expect(screen.getByRole('button', { name: 'Not sure' }).getAttribute('aria-pressed')).toBe('true');
  });

  it("own report shows It's gone now instead of three answers", async () => {
    h.mine = new Set(['own']);
    h.load.mockResolvedValue(view({ active: [pub('own', { displayName: 'Thandi' })] }));
    render(RouteReports, { routeId: 'r1' });
    await screen.findByText('You reported this');
    expect(screen.queryByRole('button', { name: 'Still there' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Not sure' })).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: "It's gone now" }));
    expect(h.answer).toHaveBeenCalledWith('own', 'GONE');
  });

  it('signed out: reports show but offer no answers', async () => {
    h.user!.set(null);
    h.load.mockResolvedValue(view({ active: [pub('a')] }));
    render(RouteReports, { routeId: 'r1' });
    await screen.findByText('Bongi');
    expect(screen.queryByRole('button', { name: 'Gone' })).toBeNull();
  });

  it('held and pending own reports show their lines', async () => {
    h.load.mockResolvedValue(view({ mineHeld: [held('h1')] }));
    h.outbox!.set([queued('q1')]);
    render(RouteReports, { routeId: 'r1' });
    await screen.findByText('Only you can see these until you finish your hike.');
    expect(screen.getByText('smoke on the ridge')).toBeTruthy();
    expect(screen.getByText('spring dry')).toBeTruthy();
    expect(screen.getByText('Will send when you have signal')).toBeTruthy();
  });

  it('pending reports come from the live outbox: a new one appears without a reload', async () => {
    h.load.mockResolvedValue(view());
    render(RouteReports, { routeId: 'r1' });
    await screen.findByText('Nothing reported recently.');
    h.outbox!.set([queued('q1'), queued('other', { body: { routeId: 'r2', category: 'FIRE', observedAt: ago(0), note: 'elsewhere' } })]);
    await screen.findByText('spring dry');
    expect(screen.queryByText('elsewhere')).toBeNull();
    expect(h.load).toHaveBeenCalledTimes(1);
  });

  it('a report waiting on an unsent hike says so', async () => {
    h.load.mockResolvedValue(view());
    h.waits.mockImplementation((i) => (i as OutboxItem).id === 'q1');
    h.outbox!.set([queued('q1')]);
    render(RouteReports, { routeId: 'r1' });
    await screen.findByText('Waiting for your hike to send');
    expect(screen.queryByText('Will send when you have signal')).toBeNull();
  });

  it('a refused report shows the server reason and can be discarded', async () => {
    h.load.mockResolvedValue(view());
    h.outbox!.set([queued('q1', { error: 'That route is not known.' })]);
    render(RouteReports, { routeId: 'r1' });
    await screen.findByText('That route is not known.');
    expect(screen.queryByText('Will send when you have signal')).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(h.discard).toHaveBeenCalledWith('q1');
  });

  it('history is collapsed and labelled Expired or Cleared', async () => {
    h.load.mockResolvedValue(view({ history: [
      pub('x', { expiresAt: ago(48 * HOUR), observedAt: ago(10 * 24 * HOUR) }),
      pub('y', { clearedAt: ago(26 * HOUR), category: 'WATER' })
    ] }));
    render(RouteReports, { routeId: 'r1' });
    const summary = await screen.findByText('Earlier reports (2)');
    const details = summary.closest('details')!;
    expect(details.open).toBe(false);
    expect(within(details).getByText(/^Expired 2 days ago/)).toBeTruthy();
    expect(within(details).getByText(/^Cleared yesterday/)).toBeTruthy();
    expect(within(details).queryByRole('button')).toBeNull();
  });

  it('answering shows Will send when you have signal while queued', async () => {
    h.load.mockResolvedValue(view({ active: [pub('a')] }));
    h.answer.mockImplementation(async (id, answer) => {
      h.outbox!.set([{ id: `${id}:u1`, owner: 'u1', createdAt: ago(0), kind: 'confirmation', reportId: id, answer: answer as 'GONE' }]);
    });
    render(RouteReports, { routeId: 'r1' });
    await screen.findByText('Bongi');
    expect(screen.queryByText('Will send when you have signal')).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Gone' }));
    await screen.findByText('Will send when you have signal');
  });

  it('a refused answer shows the server reason and can be discarded', async () => {
    h.load.mockResolvedValue(view({ active: [pub('a')] }));
    h.outbox!.set([{ id: 'a:u1', owner: 'u1', createdAt: ago(0), kind: 'confirmation', reportId: 'a', answer: 'GONE', error: 'This report is no longer active.' }]);
    render(RouteReports, { routeId: 'r1' });
    await screen.findByText('This report is no longer active.');
    await fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(h.discard).toHaveBeenCalledWith('a:u1');
  });

  it('once a queued answer sends, the list reloads', async () => {
    h.load.mockResolvedValue(view({ active: [pub('a')] }));
    h.outbox!.set([{ id: 'a:u1', owner: 'u1', createdAt: ago(0), kind: 'confirmation', reportId: 'a', answer: 'STILL_THERE' }]);
    render(RouteReports, { routeId: 'r1' });
    await screen.findByText('Will send when you have signal');
    h.load.mockResolvedValue(view({ active: [pub('a', { lastConfirmedAt: ago(0) })] }));
    h.outbox!.set([]);
    await screen.findByText('Seen 3 hours ago · last confirmed just now');
  });

  it('hands its active reports to the page, never held or pending ones', async () => {
    const onactive = vi.fn();
    h.load.mockResolvedValue(view({ active: [pub('a')], mineHeld: [held('h1', { position: { lon: 18.4, lat: -34 } })] }));
    h.outbox!.set([queued('q1')]);
    render(RouteReports, { routeId: 'r1', onactive });
    await waitFor(() => expect(onactive).toHaveBeenLastCalledWith([expect.objectContaining({ id: 'a' })]));
    expect(onactive.mock.calls.every(([list]) => (list as PublicReport[]).every((r) => r.id === 'a'))).toBe(true);
  });

  it('show(id) scrolls to that report', async () => {
    h.load.mockResolvedValue(view({ active: [pub('a'), pub('b', { displayName: 'Sipho' })] }));
    const { component } = render(RouteReports, { routeId: 'r1' });
    const name = await screen.findByText('Sipho');
    const item = name.closest('li')!;
    const scroll = vi.fn();
    item.scrollIntoView = scroll;
    await (component as unknown as { show: (id: string) => Promise<void> }).show('b');
    expect(scroll).toHaveBeenCalled();
    expect(document.activeElement).toBe(item);
  });
});
