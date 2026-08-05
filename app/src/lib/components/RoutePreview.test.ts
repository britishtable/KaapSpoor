import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import RoutePreview from './RoutePreview.svelte';
import type { RouteContent } from '../data/types';

function content(id: string, title: string, over: Partial<RouteContent> = {}): RouteContent {
  return {
    id, title, area: ['table-mountain', 'atlantic-west'],
    coords: { lat: -33.95, lon: 18.4, zoom: 14 },
    coordsSource: 'crawl', coordsAccuracyM: null, coordsOsm: null,
    grade: '3 ***', gradeSource: 'label', time: '5 hours', heightGain: '700 m',
    isFullEntry: true,
    sections: { Overview: 'A long walk up a big hill.' },
    description: 'Overview:\nA long walk up a big hill.',
    related: [], attachments: [], photoCount: 0,
    sourceUrl: 'https://example.invalid/route',
    ...over
  };
}

/**
 * Every fetch is held open until the test resolves it by id, so a test can
 * order two responses however it likes -- which is the only way to exercise the
 * stale-response guard.
 */
const pending = new Map<
  string,
  { ok: (c: RouteContent) => void; notFound: () => void; fail: () => void }
>();

function idOf(url: string): string {
  return url.split('/').pop()!.replace(/\.json$/, '');
}

/** The component touches only `ok`, `status` and `json()`; the rest of Response is noise here. */
function stubResponse(init: { ok: boolean; status: number; json: () => Promise<unknown> }): Response {
  return init as unknown as Response;
}

beforeEach(() => {
  pending.clear();
  vi.stubGlobal('fetch', (url: string) =>
    new Promise<Response>((resolve, reject) => {
      pending.set(idOf(String(url)), {
        ok: (c) => resolve(stubResponse({ ok: true, status: 200, json: async () => c })),
        notFound: () =>
          resolve(
            stubResponse({
              ok: false, status: 404,
              json: async () => { throw new SyntaxError('Unexpected token < in JSON'); }
            })
          ),
        fail: () => reject(new Error('network down'))
      });
    })
  );
});

afterEach(() => vi.unstubAllGlobals());

/** Effects are scheduled, so the request for an id may not exist on the same tick. */
async function requestFor(id: string) {
  await waitFor(() => expect(pending.has(id)).toBe(true));
  return pending.get(id)!;
}

describe('RoutePreview', () => {
  it('shows a loading state before the fetch settles', async () => {
    render(RoutePreview, { routeId: 'a' });
    expect(screen.getByTestId('preview-loading')).toBeTruthy();
    expect(screen.queryByTestId('preview-error')).toBeNull();
  });

  it('renders the title and stats once loaded', async () => {
    render(RoutePreview, { routeId: 'a' });
    (await requestFor('a')).ok(content('a', 'Blind Gully'));

    await waitFor(() => expect(screen.getByText('Blind Gully')).toBeTruthy());
    expect(screen.getByText('3 ***')).toBeTruthy();
    expect(screen.getByText('5 hours')).toBeTruthy();
    expect(screen.getByText('700 m')).toBeTruthy();
    // The provenance note travels with the preview, in the same words as the route page.
    expect(screen.getByText('Location from the Mountain Meanders page.')).toBeTruthy();
    expect(screen.getByText('A long walk up a big hill.')).toBeTruthy();
    expect(screen.getByRole('link', { name: /full route/i }).getAttribute('href')).toContain('/route/a');
    expect(screen.queryByTestId('preview-loading')).toBeNull();
  });

  it('says so when the fetch fails, rather than rendering an empty panel', async () => {
    render(RoutePreview, { routeId: 'a' });
    (await requestFor('a')).fail();

    await waitFor(() => expect(screen.getByTestId('preview-error')).toBeTruthy());
    expect(screen.queryByTestId('preview-loading')).toBeNull();
    expect(screen.queryByTestId('preview-body')).toBeNull();
  });

  it('treats a non-ok response as a failure', async () => {
    render(RoutePreview, { routeId: 'a' });
    // A 404 resolves rather than rejecting, so a panel that only caught
    // rejections would sail on and try to parse the error page as route JSON.
    (await requestFor('a')).notFound();
    await waitFor(() => expect(screen.getByTestId('preview-error')).toBeTruthy());
    expect(screen.queryByTestId('preview-body')).toBeNull();
  });

  it('replaces its content when routeId changes', async () => {
    const { rerender } = render(RoutePreview, { routeId: 'a' });
    (await requestFor('a')).ok(content('a', 'Blind Gully'));
    await waitFor(() => expect(screen.getByText('Blind Gully')).toBeTruthy());

    await rerender({ routeId: 'b' });
    (await requestFor('b')).ok(content('b', 'Skeleton Gorge'));

    await waitFor(() => expect(screen.getByText('Skeleton Gorge')).toBeTruthy());
    expect(screen.queryByText('Blind Gully')).toBeNull();
  });

  it('ignores a late response for a route that is no longer selected', async () => {
    const { rerender } = render(RoutePreview, { routeId: 'a' });
    const first = await requestFor('a'); // deliberately left in flight

    await rerender({ routeId: 'b' });
    (await requestFor('b')).ok(content('b', 'Skeleton Gorge'));
    await waitFor(() => expect(screen.getByText('Skeleton Gorge')).toBeTruthy());

    first.ok(content('a', 'Blind Gully'));
    await new Promise((r) => setTimeout(r, 0));

    expect(screen.getByText('Skeleton Gorge')).toBeTruthy();
    expect(screen.queryByText('Blind Gully')).toBeNull();
  });

  it('does not let a late failure blank out the current route', async () => {
    const { rerender } = render(RoutePreview, { routeId: 'a' });
    const first = await requestFor('a');

    await rerender({ routeId: 'b' });
    (await requestFor('b')).ok(content('b', 'Skeleton Gorge'));
    await waitFor(() => expect(screen.getByText('Skeleton Gorge')).toBeTruthy());

    first.fail();
    await new Promise((r) => setTimeout(r, 0));

    expect(screen.queryByTestId('preview-error')).toBeNull();
    expect(screen.getByText('Skeleton Gorge')).toBeTruthy();
  });

  it('calls onclose when the close control is used', async () => {
    const onclose = vi.fn();
    render(RoutePreview, { routeId: 'a', onclose });
    await fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onclose).toHaveBeenCalled();
  });
});
