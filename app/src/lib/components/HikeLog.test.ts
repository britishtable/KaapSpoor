import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { get } from 'svelte/store';
import 'fake-indexeddb/auto';
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
});
