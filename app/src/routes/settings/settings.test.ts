import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import 'fake-indexeddb/auto';
import Page from './+page.svelte';
import { hikes, viewer, replaceAll, logHike } from '$lib/journal/store';

beforeEach(async () => { await replaceAll({ hikes: [], routeNotes: [] }); });

describe('settings', () => {
  it('imports a v1 file and shows the converted hike in the store', async () => {
    render(Page);
    const json = JSON.stringify({
      version: 1, exportedAt: '',
      entries: [{ routeId: 'r1', done: true, date: '2026-07-01', notes: 'imported' }]
    });
    const file = new File([json], 'journal.json', { type: 'application/json' });
    vi.spyOn(file, 'text').mockResolvedValue(json);
    const input = screen.getByLabelText(/import file/i) as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [file] });
    await fireEvent.change(input);
    await fireEvent.click(screen.getByRole('button', { name: /apply import/i }));
    await waitFor(() => expect(get(hikes).size).toBe(1));
    const [h] = [...get(hikes).values()];
    expect(h).toMatchObject({ routeId: 'r1', date: '2026-07-01', pending: true, owner: null });
  });

  it('exports version 2 under kaapspoor-data.json', async () => {
    await logHike({ routeId: 'r1', date: '2026-07-01', notes: 'n' });
    let blob: Blob | undefined;
    URL.createObjectURL = vi.fn((b: Blob) => { blob = b; return 'blob:x'; });
    URL.revokeObjectURL = vi.fn();
    const names: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      names.push(this.download);
    });
    render(Page);
    await fireEvent.click(screen.getByRole('button', { name: /export my data/i }));
    expect(names).toEqual(['kaapspoor-data.json']);
    const text = await new Promise<string>((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.readAsText(blob!);
    });
    const out = JSON.parse(text);
    expect(out.version).toBe(2);
    expect(out.hikes).toHaveLength(1);
  });

  it("exports only the viewer's hikes, not another account's", async () => {
    const base = {
      date: null, notes: '', visibility: 'PRIVATE', notesVisibility: 'PRIVATE', startedAt: null,
      finishedAt: null, updatedAt: '2026-01-01T00:00:00.000Z', deleted: false, pending: false
    } as const;
    await replaceAll({
      hikes: [{ ...base, id: 'a', routeId: 'r1', owner: 'u1' }, { ...base, id: 'b', routeId: 'r2', owner: 'u2' }],
      routeNotes: []
    });
    viewer.set('u1');
    let blob: Blob | undefined;
    URL.createObjectURL = vi.fn((b: Blob) => { blob = b; return 'blob:x'; });
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(Page);
    await fireEvent.click(screen.getByRole('button', { name: /export my data/i }));
    const text = await new Promise<string>((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.readAsText(blob!);
    });
    viewer.set(null);
    expect(JSON.parse(text).hikes.map((x: { id: string }) => x.id)).toEqual(['a']);
  });

  it("signed out, exports only unowned hikes: an account's hikes stay locked", async () => {
    const base = {
      date: null, notes: '', visibility: 'PRIVATE', notesVisibility: 'PRIVATE', startedAt: null,
      finishedAt: null, updatedAt: '2026-01-01T00:00:00.000Z', deleted: false, pending: false
    } as const;
    await replaceAll({
      hikes: [{ ...base, id: 'a', routeId: 'r1', owner: 'u1' }, { ...base, id: 'free', routeId: 'r2', owner: null }],
      routeNotes: []
    });
    viewer.set(null);
    let blob: Blob | undefined;
    URL.createObjectURL = vi.fn((b: Blob) => { blob = b; return 'blob:x'; });
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(Page);
    await fireEvent.click(screen.getByRole('button', { name: /export my data/i }));
    const text = await new Promise<string>((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.readAsText(blob!);
    });
    expect(JSON.parse(text).hikes.map((x: { id: string }) => x.id)).toEqual(['free']);
  });
});
