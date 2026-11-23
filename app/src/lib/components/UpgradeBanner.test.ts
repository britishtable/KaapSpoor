import { render, screen, waitFor } from '@testing-library/svelte';
import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import { getAllHikes, resetDbForTests } from '../journal/db';
import UpgradeBanner from './UpgradeBanner.svelte';

const LINE = 'Close other KaapSpoor tabs to finish updating.';

beforeEach(async () => {
  await resetDbForTests();
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase('kaapspoor');
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
});

describe('UpgradeBanner', () => {
  it('says nothing normally', async () => {
    render(UpgradeBanner);
    await getAllHikes();
    expect(screen.queryByText(LINE)).toBeNull();
  });

  it('asks to close other tabs while a v3 tab blocks the update, and goes once it is closed', async () => {
    const old = await openDB('kaapspoor', 3, {
      upgrade(d) {
        d.createObjectStore('hikes', { keyPath: 'id' }).createIndex('byRoute', 'routeId');
        d.createObjectStore('routeNotes', { keyPath: 'routeId' });
        d.createObjectStore('meta');
      }
    });
    render(UpgradeBanner);
    let reading: Promise<unknown> | null = null;
    try {
      reading = getAllHikes();
      expect((await screen.findByRole('status')).textContent).toBe(LINE);
    } finally {
      old.close();
    }
    expect(await reading).toEqual([]);
    await waitFor(() => expect(screen.queryByText(LINE)).toBeNull());
  });
});
