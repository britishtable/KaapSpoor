import { render, screen, fireEvent, waitFor, within } from '@testing-library/svelte';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { get } from 'svelte/store';
import 'fake-indexeddb/auto';
import type { PublicReport, RouteReportsView } from '../reports/types';

const rep = vi.hoisted(() => ({
  load: vi.fn(async (_id: string): Promise<unknown> => 'unavailable'),
  answer: vi.fn(async (_id: string, _a: string) => {}),
  mine: new Set<string>()
}));
vi.mock('../reports/reports', () => ({ loadRouteReports: (id: string) => rep.load(id) }));
vi.mock('../reports/mine', () => ({ mineIds: () => rep.mine, rememberMine: () => {} }));
vi.mock('../reports/outbox', async (original) => ({
  ...(await original<typeof import('../reports/outbox')>()),
  answerReport: (id: string, a: string) => rep.answer(id, a)
}));

import HikeLog from './HikeLog.svelte';
import { configureSession, restoreSession } from '../account/session';
import {
  activeHike, visibleHikes, routeNotes, replaceAll, logHike, startHike, setClockForTests, viewer
} from '../journal/store';
import type { Hike } from '../data/types';

const stored = (id: string, over: Partial<Hike> = {}): Hike => ({
  id, routeId: 'r1', date: '2026-07-21', notes: '', visibility: 'PRIVATE', notesVisibility: 'PRIVATE',
  startedAt: null, finishedAt: null, updatedAt: '2026-11-18T10:00:00.000Z', deleted: false,
  owner: null, pending: false, ...over
});

beforeEach(async () => { await replaceAll({ hikes: [], routeNotes: [] }); });
afterEach(() => { setClockForTests(null); });

describe('HikeLog', () => {
  it('Start hike creates an active hike and shows Finish hike', async () => {
    render(HikeLog, { routeId: 'r1' });
    await fireEvent.click(screen.getByRole('button', { name: 'Start hike' }));
    await screen.findByRole('button', { name: 'Finish hike' });
    expect(get(activeHike)?.routeId).toBe('r1');
    expect(screen.getByText(/Hike in progress since \d\d:\d\d/)).toBeTruthy();
    expect(screen.getByText('In progress')).toBeTruthy();
  });

  it('Finish hike ends it and shows the finished line', async () => {
    render(HikeLog, { routeId: 'r1' });
    await fireEvent.click(screen.getByRole('button', { name: 'Start hike' }));
    await fireEvent.click(await screen.findByRole('button', { name: 'Finish hike' }));
    await screen.findByText('Hike finished. Nice one.');
    expect(get(activeHike)).toBeNull();
    expect(screen.getByRole('button', { name: 'Start hike' })).toBeTruthy();
  });

  it('active hike elsewhere shows Go to it instead of Start', async () => {
    await startHike('other');
    render(HikeLog, { routeId: 'r1' });
    expect(screen.getByText("You're on a hike on another route.")).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Go to it' }).getAttribute('href')).toMatch(/\/route\/other$/);
    expect(screen.queryByRole('button', { name: 'Start hike' })).toBeNull();
  });

  it('log a past hike with unknown date lists Date not recorded', async () => {
    render(HikeLog, { routeId: 'r1' });
    expect(screen.getByText('No hikes logged here yet.')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Log a past hike' }));
    const date = screen.getByLabelText('Date') as HTMLInputElement;
    await fireEvent.input(date, { target: { value: '2026-07-21' } });
    await fireEvent.click(screen.getByLabelText("I don't remember the date"));
    expect(date.disabled).toBe(true);
    expect(date.value).toBe('');
    await fireEvent.click(screen.getByRole('button', { name: 'Save hike' }));
    await screen.findByText('Date not recorded');
    expect(get(visibleHikes)[0].date).toBeNull();
  });

  it('while a form is open the other entry points are disabled and the draft survives', async () => {
    await logHike({ routeId: 'r1', date: '2026-07-21', notes: 'existing' });
    render(HikeLog, { routeId: 'r1' });
    await fireEvent.click(screen.getByRole('button', { name: 'Log a past hike' }));
    await fireEvent.input(screen.getByLabelText('Notes'), { target: { value: 'my draft' } });
    expect((screen.getByRole('button', { name: 'Edit' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Log a past hike' }) as HTMLButtonElement).disabled).toBe(true);
    // Real clicks never reach a disabled button; the draft is simply still there.
    expect((screen.getByLabelText('Notes') as HTMLTextAreaElement).value).toBe('my draft');
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect((screen.getByRole('button', { name: 'Edit' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows a known date as D MMM YYYY without a timezone shift', async () => {
    await logHike({ routeId: 'r1', date: '2026-07-21', notes: '' });
    render(HikeLog, { routeId: 'r1' });
    expect(screen.getByText('21 Jul 2026')).toBeTruthy();
  });

  it('edit changes the notes', async () => {
    await logHike({ routeId: 'r1', date: '2026-07-21', notes: 'old' });
    render(HikeLog, { routeId: 'r1' });
    await fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const notes = screen.getByLabelText('Notes') as HTMLTextAreaElement;
    expect(notes.value).toBe('old');
    await fireEvent.input(notes, { target: { value: 'new notes' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save hike' }));
    await screen.findByText('new notes');
    expect(get(visibleHikes)[0].notes).toBe('new notes');
  });

  it('delete asks inline, Keep keeps, Delete removes', async () => {
    await logHike({ routeId: 'r1', date: '2026-07-21', notes: 'x' });
    render(HikeLog, { routeId: 'r1' });
    await fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByText('Delete this hike?')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Keep' }));
    expect(screen.queryByText('Delete this hike?')).toBeNull();
    expect(get(visibleHikes)).toHaveLength(1);
    await fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(get(visibleHikes)).toHaveLength(0));
    await screen.findByText('No hikes logged here yet.');
  });

  it('shows the sync error and no pending copy', async () => {
    await replaceAll({
      hikes: [{
        id: 'h1', routeId: 'r1', date: '2026-07-21', notes: '', visibility: 'PRIVATE',
        notesVisibility: 'PRIVATE', startedAt: null, finishedAt: null, updatedAt: 'x',
        deleted: false, owner: null, pending: true, syncError: 'Too long'
      }],
      routeNotes: []
    });
    render(HikeLog, { routeId: 'r1' });
    expect(screen.getByText("Couldn't sync: Too long")).toBeTruthy();
    expect(screen.queryByText(/not synced yet/i)).toBeNull();
  });

  it('signed in: a pending hike shows Not synced yet', async () => {
    const user = { id: 'u1', displayName: 'Thandi', initials: 'T' };
    const s = { accessToken: 'a', accessExpiresAt: new Date(Date.now() + 600_000).toISOString(), refreshToken: 'r', user };
    configureSession({ storage: { load: () => s, save: () => {}, clear: () => {} }, baseUrl: 'http://srv' });
    restoreSession();
    try {
      await logHike({ routeId: 'r1', date: '2026-07-21', notes: 'x' });
      render(HikeLog, { routeId: 'r1' });
      expect(screen.getByText('Not synced yet')).toBeTruthy();
    } finally {
      configureSession();
    }
  });

  it('planning notes persist to routeNotes', async () => {
    render(HikeLog, { routeId: 'r1' });
    expect(screen.getByText('Only on this device for now.')).toBeTruthy();
    const box = screen.getByLabelText('Planning notes');
    await fireEvent.input(box, { target: { value: 'bring water' } });
    await fireEvent.change(box);
    await waitFor(() => expect(get(routeNotes).get('r1')?.notes).toBe('bring water'));
  });

  it('start attaches the plan prop', async () => {
    const plan = { main: 'r1/main/main', reversed: false };
    render(HikeLog, { routeId: 'r1', plan });
    await fireEvent.click(screen.getByRole('button', { name: 'Start hike' }));
    await waitFor(() => expect(get(activeHike)?.plan).toEqual(plan));
  });

  it("signed out, an account's hikes are read-only with one hint; unowned ones stay editable", async () => {
    viewer.set(null);
    await replaceAll({
      hikes: [
        stored('a1', { owner: 'u1', notes: 'saved one' }),
        stored('a2', { owner: 'u1', notes: 'saved two', date: '2026-07-20' }),
        stored('free', { notes: 'on this phone', date: '2026-07-19' })
      ],
      routeNotes: []
    });
    render(HikeLog, { routeId: 'r1' });
    expect(screen.getByText('saved one')).toBeTruthy();
    expect(screen.getByText('saved two')).toBeTruthy();
    expect(screen.getAllByText('Sign in to change hikes saved to your account.')).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Edit' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Delete' })).toHaveLength(1);
  });

  it('no hint when every hike here can be changed', async () => {
    viewer.set('u1');
    try {
      await replaceAll({ hikes: [stored('a1', { owner: 'u1' }), stored('free')], routeNotes: [] });
      render(HikeLog, { routeId: 'r1' });
      expect(screen.queryByText('Sign in to change hikes saved to your account.')).toBeNull();
      expect(screen.getAllByRole('button', { name: 'Edit' })).toHaveLength(2);
    } finally {
      viewer.set(null);
    }
  });

  it('the form limits the date to 1950..tomorrow and notes to 5000 characters', async () => {
    render(HikeLog, { routeId: 'r1' });
    await fireEvent.click(screen.getByRole('button', { name: 'Log a past hike' }));
    const date = screen.getByLabelText('Date') as HTMLInputElement;
    const d = new Date();
    d.setDate(d.getDate() + 1);
    const p = (n: number) => String(n).padStart(2, '0');
    expect(date.min).toBe('1950-01-01');
    expect(date.max).toBe(`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`);
    expect((screen.getByLabelText('Notes') as HTMLTextAreaElement).maxLength).toBe(5000);
  });

  it('a date not written as YYYY-MM-DD is shown as written, not thrown on', async () => {
    await replaceAll({ hikes: [stored('odd', { date: '21/07/2026' })], routeNotes: [] });
    render(HikeLog, { routeId: 'r1' });
    expect(screen.getByText('21/07/2026')).toBeTruthy();
  });

  it('after Finish, Review the route opens the form for that hike and saving stores it', async () => {
    render(HikeLog, { routeId: 'r1', graded: true, gradeLevel: '3' });
    await fireEvent.click(screen.getByRole('button', { name: 'Start hike' }));
    await fireEvent.click(await screen.findByRole('button', { name: 'Finish hike' }));
    await fireEvent.click(await screen.findByRole('button', { name: 'Review the route' }));
    expect(screen.getByText('Compared with grade 3:')).toBeTruthy();
    await fireEvent.click(screen.getByRole('radio', { name: 'Harder' }));
    await fireEvent.click(screen.getByRole('radio', { name: '4' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Save review' }));
    await waitFor(() => expect(get(visibleHikes)[0].review).toEqual({ difficulty: 'HARDER', enjoyment: 4 }));
    await screen.findByText('Harder than graded · 4/5');
    expect(screen.queryByRole('button', { name: 'Save review' })).toBeNull();
  });

  it('the hike form says reviews are public and a Public hike shows its month', async () => {
    render(HikeLog, { routeId: 'r1' });
    await fireEvent.click(screen.getByRole('button', { name: 'Log a past hike' }));
    expect(screen.getByText("Only you can see your hikes. Reviews are public; a Public hike's month shows on its review.")).toBeTruthy();
    expect(screen.queryByText(/For now only you/)).toBeNull();
  });

  it('a finished hike that is locked to another account offers no review', async () => {
    render(HikeLog, { routeId: 'r1' });
    await fireEvent.click(screen.getByRole('button', { name: 'Start hike' }));
    await fireEvent.click(await screen.findByRole('button', { name: 'Finish hike' }));
    const id = get(visibleHikes)[0].id;
    await screen.findByRole('button', { name: 'Review the route' });
    viewer.set(null);
    await replaceAll({ hikes: [{ ...get(visibleHikes)[0], id, owner: 'u1' }], routeNotes: [] });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Review the route' })).toBeNull());
  });

  it('moving a reviewed hike into the future says why and keeps the form', async () => {
    await replaceAll({ hikes: [stored('a', { review: { enjoyment: 4 } })], routeNotes: [] });
    render(HikeLog, { routeId: 'r1' });
    await fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const t = new Date();
    t.setDate(t.getDate() + 1); // the date field allows tomorrow, which a review does not
    const p2 = (n: number) => String(n).padStart(2, '0');
    const tomorrow = `${t.getFullYear()}-${p2(t.getMonth() + 1)}-${p2(t.getDate())}`;
    await fireEvent.input(screen.getByLabelText('Date'), { target: { value: tomorrow } });
    await fireEvent.input(screen.getByLabelText('Notes'), { target: { value: 'my typing' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save hike' }));
    await screen.findByText("This hike has a review, so its date can't be in the future. Pick another date or remove the review.");
    expect((screen.getByLabelText('Notes') as HTMLTextAreaElement).value).toBe('my typing');
    expect(screen.queryByText(/Couldn't save that on this device/)).toBeNull();
  });

  it('an active hike offers no review', async () => {
    await startHike('r1');
    render(HikeLog, { routeId: 'r1' });
    expect(screen.queryByRole('button', { name: /review/i })).toBeNull();
  });

  it('a reviewed hike shows its summary and Edit review; an unreviewed one shows Add review', async () => {
    await replaceAll({
      hikes: [
        stored('a', { review: { difficulty: 'HARDER', enjoyment: 4 } }),
        stored('b', { date: '2026-07-20' })
      ],
      routeNotes: []
    });
    render(HikeLog, { routeId: 'r1', graded: true, gradeLevel: '3' });
    expect(screen.getByText('Harder than graded · 4/5')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /^Edit review/ })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Edit review, hike on 21 Jul 2026' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add review, hike on 20 Jul 2026' })).toBeTruthy();
  });

  it('an undated hike names its review button with the list wording', async () => {
    await replaceAll({ hikes: [stored('u', { date: null })], routeNotes: [] });
    render(HikeLog, { routeId: 'r1' });
    expect(screen.getByRole('button', { name: 'Add review, hike on Date not recorded' })).toBeTruthy();
  });

  it('the summary shows difficulty only when it is on the route\'s current scale', async () => {
    await replaceAll({ hikes: [stored('a', { review: { difficulty: 'EASY', enjoyment: 4 } })], routeNotes: [] });
    render(HikeLog, { routeId: 'r1', graded: true, gradeLevel: '3' });
    expect(screen.getByText('4/5')).toBeTruthy();
    expect(screen.queryByText(/Easy/)).toBeNull();
  });

  it('only one form is open: opening a review disables the other entry points', async () => {
    await replaceAll({ hikes: [stored('a'), stored('b', { date: '2026-07-20' })], routeNotes: [] });
    render(HikeLog, { routeId: 'r1' });
    await fireEvent.click(screen.getByRole('button', { name: 'Add review, hike on 21 Jul 2026' }));
    expect((screen.getByRole('button', { name: 'Add review, hike on 20 Jul 2026' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Log a past hike' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('a pending review shares the hike pending line (signed in: Not synced yet)', async () => {
    const user = { id: 'u1', displayName: 'Thandi', initials: 'T' };
    const sess = { accessToken: 'a', accessExpiresAt: new Date(Date.now() + 600_000).toISOString(), refreshToken: 'r', user };
    configureSession({ storage: { load: () => sess, save: () => {}, clear: () => {} }, baseUrl: 'http://srv' });
    restoreSession();
    try {
      await replaceAll({ hikes: [stored('a', { review: { enjoyment: 3 }, pending: true })], routeNotes: [] });
      render(HikeLog, { routeId: 'r1' });
      expect(screen.getByText('Not synced yet')).toBeTruthy();
      expect(screen.getByText('3/5')).toBeTruthy();
    } finally {
      configureSession();
    }
  });

  it('a locked hike (another owner) offers no review', async () => {
    viewer.set(null);
    await replaceAll({ hikes: [stored('a1', { owner: 'u1' })], routeNotes: [] });
    render(HikeLog, { routeId: 'r1' });
    expect(screen.queryByRole('button', { name: /review/i })).toBeNull();
  });

  it('a hike dated in the future offers no review', async () => {
    await replaceAll({ hikes: [stored('f', { date: '2999-01-01' })], routeNotes: [] });
    render(HikeLog, { routeId: 'r1' });
    expect(screen.queryByRole('button', { name: /review/i })).toBeNull();
  });

  describe('reporting', () => {
    const signIn = () => {
      const user = { id: 'u1', displayName: 'Thandi', initials: 'T' };
      const sess = { accessToken: 'a', accessExpiresAt: new Date(Date.now() + 600_000).toISOString(), refreshToken: 'r', user };
      configureSession({ storage: { load: () => sess, save: () => {}, clear: () => {} }, baseUrl: 'http://srv' });
      restoreSession();
    };

    it('an active hike shows Report something under Finish', async () => {
      signIn();
      try {
        await startHike('r1');
        const onreport = vi.fn();
        render(HikeLog, { routeId: 'r1', onreport });
        const finish = await screen.findByRole('button', { name: 'Finish hike' });
        const report = screen.getByRole('button', { name: 'Report something' });
        expect(finish.compareDocumentPosition(report) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        await fireEvent.click(report);
        expect(onreport).toHaveBeenCalled();
      } finally {
        configureSession();
      }
    });

    it('signed out shows the sign-in line instead', async () => {
      await startHike('r1');
      render(HikeLog, { routeId: 'r1' });
      await screen.findByRole('button', { name: 'Finish hike' });
      expect(screen.queryByRole('button', { name: 'Report something' })).toBeNull();
      const link = screen.getByRole('link', { name: 'Sign in to report what you see.' });
      expect(link.getAttribute('href')).toMatch(/\/account$/);
    });
  });
});

describe('HikeLog: Still there?', () => {
  const user = { id: 'u1', displayName: 'Thandi', initials: 'T' };
  const pub = (id: string, over: Partial<PublicReport> = {}): PublicReport => ({
    id, category: 'OBSTRUCTION', note: 'tree across the path', observedAt: new Date(Date.now() - 2 * 3600_000).toISOString(),
    lastConfirmedAt: null, expiresAt: null, clearedAt: null, position: null, displayName: 'Bongi', unverified: false, ...over
  });
  const view = (over: Partial<RouteReportsView> = {}): RouteReportsView =>
    ({ active: [], history: [], mineHeld: [], minePending: [], ...over });
  function signIn() {
    const s = { accessToken: 'a', accessExpiresAt: new Date(Date.now() + 600_000).toISOString(), refreshToken: 'r', user };
    configureSession({ storage: { load: () => s, save: () => {}, clear: () => {} }, baseUrl: 'http://srv' });
    restoreSession();
  }
  beforeEach(() => {
    rep.load.mockReset();
    rep.answer.mockClear();
    rep.mine = new Set();
    signIn();
  });
  afterEach(() => { configureSession(); });

  async function finishAHike() {
    await fireEvent.click(screen.getByRole('button', { name: 'Start hike' }));
    await fireEvent.click(await screen.findByRole('button', { name: 'Finish hike' }));
  }

  it("after Finish, Still there? lists others' active reports and Skip sends nothing", async () => {
    rep.load.mockResolvedValue(view({ active: [pub('a'), pub('b', { category: 'WATER', displayName: 'Sipho' })] }));
    render(HikeLog, { routeId: 'r1' });
    expect(screen.queryByRole('heading', { name: 'Still there?' })).toBeNull();
    await finishAHike();
    const card = (await screen.findByRole('heading', { name: 'Still there?' })).closest('section')!;
    expect(rep.load).toHaveBeenCalledWith('r1');
    expect(within(card).getByText('Obstruction (fallen tree, rockfall)')).toBeTruthy();
    expect(within(card).getByText('Water source')).toBeTruthy();
    expect(within(card).getAllByText('Seen 2 hours ago')).toHaveLength(2);
    expect(within(card).getAllByRole('button', { name: 'Still there' })).toHaveLength(2);
    await fireEvent.click(within(card).getByRole('button', { name: 'Skip' }));
    expect(screen.queryByRole('heading', { name: 'Still there?' })).toBeNull();
    expect(rep.answer).not.toHaveBeenCalled();
  });

  it('an answer from the card calls answerReport', async () => {
    rep.load.mockResolvedValue(view({ active: [pub('a')] }));
    render(HikeLog, { routeId: 'r1' });
    await finishAHike();
    await screen.findByRole('heading', { name: 'Still there?' });
    await fireEvent.click(screen.getByRole('button', { name: 'Gone' }));
    expect(rep.answer).toHaveBeenCalledWith('a', 'GONE');
    expect(screen.getByRole('button', { name: 'Gone' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy();
  });

  it('own reports are not asked about', async () => {
    rep.mine = new Set(['own']);
    rep.load.mockResolvedValue(view({ active: [pub('own', { displayName: 'Thandi' })], mineHeld: [] }));
    render(HikeLog, { routeId: 'r1' });
    await finishAHike();
    await screen.findByText('Hike finished. Nice one.');
    await waitFor(() => expect(rep.load).toHaveBeenCalled());
    await Promise.resolve();
    expect(screen.queryByRole('heading', { name: 'Still there?' })).toBeNull();
  });

  it('after logging a past hike, Still there? asks too', async () => {
    rep.load.mockResolvedValue(view({ active: [pub('a')] }));
    render(HikeLog, { routeId: 'r1' });
    await fireEvent.click(screen.getByRole('button', { name: 'Log a past hike' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Save hike' }));
    await screen.findByRole('heading', { name: 'Still there?' });
  });

  it('signed out, nothing is asked', async () => {
    configureSession();
    rep.load.mockResolvedValue(view({ active: [pub('a')] }));
    render(HikeLog, { routeId: 'r1' });
    await finishAHike();
    await screen.findByText('Hike finished. Nice one.');
    expect(rep.load).not.toHaveBeenCalled();
  });
});
