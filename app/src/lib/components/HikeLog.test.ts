import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { get } from 'svelte/store';
import 'fake-indexeddb/auto';
import HikeLog from './HikeLog.svelte';
import {
  activeHike, visibleHikes, routeNotes, replaceAll, logHike, startHike, setClockForTests
} from '../journal/store';

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
});
