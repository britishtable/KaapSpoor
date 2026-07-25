import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import 'fake-indexeddb/auto';
import Page from './+page.svelte';
import { journal, replaceAll } from '$lib/journal/store';
import { serialize } from '$lib/journal/io';

beforeEach(async () => { await replaceAll([]); });

describe('settings import', () => {
  it('imports a journal file and applies it to the store', async () => {
    render(Page);
    const json = serialize([{ routeId: 'r1', done: true, date: null, notes: 'imported' }]);
    const file = new File([json], 'journal.json', { type: 'application/json' });
    vi.spyOn(file, 'text').mockResolvedValue(json);
    const input = screen.getByLabelText(/import file/i) as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [file] });
    await fireEvent.change(input);
    await fireEvent.click(screen.getByRole('button', { name: /apply import/i }));
    // replaceAll persists to IndexedDB (fake-indexeddb) before updating the
    // store, same async-settle pattern as JournalControls.test.ts, so the
    // store update lands a tick after the click resolves.
    await waitFor(() => expect(get(journal).get('r1')?.notes).toBe('imported'));
  });
});
