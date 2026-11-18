import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import 'fake-indexeddb/auto';
import JournalControls from './JournalControls.svelte';
import { visibleHikes, doneRouteIds, replaceAll, logHike } from '../journal/store';

beforeEach(async () => { await replaceAll({ hikes: [], routeNotes: [] }); });

describe('JournalControls', () => {
  it('logs a hike when Done is ticked', async () => {
    render(JournalControls, { routeId: 'r1' });
    await fireEvent.click(screen.getByLabelText(/mark done/i));
    await waitFor(() => expect(get(doneRouteIds).has('r1')).toBe(true));
    expect(get(visibleHikes)).toHaveLength(1);
  });

  it('records the plan on the logged hike', async () => {
    render(JournalControls, { routeId: 'r4', plan: { main: 'r4/main/main', reversed: false } });
    await fireEvent.click(screen.getByLabelText(/mark done/i));
    await waitFor(() => expect(get(visibleHikes)).toHaveLength(1));
    expect(get(visibleHikes)[0].plan).toEqual({ main: 'r4/main/main', reversed: false });
  });

  it('is checked and disabled once the route is done', async () => {
    await logHike({ routeId: 'r5', date: null, notes: '' });
    render(JournalControls, { routeId: 'r5' });
    const box = screen.getByLabelText(/mark done/i) as HTMLInputElement;
    expect(box.checked).toBe(true);
    expect(box.disabled).toBe(true);
  });
});
