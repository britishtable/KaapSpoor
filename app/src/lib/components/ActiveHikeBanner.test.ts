import { render, screen } from '@testing-library/svelte';
import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import ActiveHikeBanner from './ActiveHikeBanner.svelte';
import { replaceAll, startHike } from '../journal/store';

beforeEach(async () => { await replaceAll({ hikes: [], routeNotes: [] }); });

describe('ActiveHikeBanner', () => {
  it('hidden with no active hike; links to the route when active', async () => {
    render(ActiveHikeBanner);
    expect(screen.queryByText('Hike in progress')).toBeNull();
    await startHike('r9');
    await screen.findByText('Hike in progress');
    expect(screen.getByRole('link', { name: 'Open' }).getAttribute('href')).toMatch(/\/route\/r9$/);
  });
});
