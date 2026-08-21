import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import 'fake-indexeddb/auto';
import JournalControls from './JournalControls.svelte';
import { journal, replaceAll } from '../journal/store';

beforeEach(async () => { await replaceAll([]); });

describe('JournalControls', () => {
  it('marks a route done through the store', async () => {
    render(JournalControls, { routeId: 'r1' });
    await fireEvent.click(screen.getByLabelText(/mark done/i));
    await waitFor(() => expect(get(journal).get('r1')?.done).toBe(true));
  });

  it('attaches the current plan when Done is ticked on an entry that already exists without one', async () => {
    await replaceAll([{ routeId: 'r4', done: false, date: '2026-01-01', notes: 'existing' }]);
    render(JournalControls, { routeId: 'r4', plan: { main: 'r4/main/main', reversed: false } });
    await fireEvent.click(screen.getByLabelText(/mark done/i));
    await waitFor(() => expect(get(journal).get('r4')?.done).toBe(true));
    const entry = get(journal).get('r4');
    expect(entry?.plan).toEqual({ main: 'r4/main/main', reversed: false });
    expect(entry?.date).toBe('2026-01-01');
    expect(entry?.notes).toBe('existing');
  });

  it('leaves the stored plan untouched when Done is unticked', async () => {
    await replaceAll([
      { routeId: 'r5', done: true, date: null, notes: '', plan: { main: 'r5/main/main', reversed: true } }
    ]);
    render(JournalControls, { routeId: 'r5', plan: { main: 'r5/main/main', reversed: false } });
    await fireEvent.click(screen.getByLabelText(/mark done/i));
    await waitFor(() => expect(get(journal).get('r5')?.done).toBe(false));
    expect(get(journal).get('r5')?.plan).toEqual({ main: 'r5/main/main', reversed: true });
  });

  it('leaves the stored plan untouched when Done is ticked with no plan prop (nothing drawn)', async () => {
    await replaceAll([
      { routeId: 'r6', done: false, date: null, notes: '', plan: { main: 'r6/main/main', reversed: true } }
    ]);
    render(JournalControls, { routeId: 'r6' });
    await fireEvent.click(screen.getByLabelText(/mark done/i));
    await waitFor(() => expect(get(journal).get('r6')?.done).toBe(true));
    expect(get(journal).get('r6')?.plan).toEqual({ main: 'r6/main/main', reversed: true });
  });
});
