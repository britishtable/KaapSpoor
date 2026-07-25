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
});
