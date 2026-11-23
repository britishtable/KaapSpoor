import { render, screen, fireEvent } from '@testing-library/svelte';
import { describe, it, expect, afterEach } from 'vitest';
import RouteReviews from './RouteReviews.svelte';
import { configureSession } from '../account/session';
import type { PublicReview } from '../reviews/reviews';

afterEach(() => configureSession());

const ok = (body: unknown) =>
  configureSession({ baseUrl: 'https://api.test', fetch: (async () => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch });
const rev = (i: number, over: Partial<PublicReview> = {}): PublicReview =>
  ({ displayName: `Walker ${i}`, month: '2026-03', dateRecorded: true, enjoyment: 4, ...over });
const empty = { difficulty: null, enjoyment: null, safety: null, navigation: null, water: null };

describe('RouteReviews', () => {
  it('renders nothing when unavailable', async () => {
    configureSession({ baseUrl: null });
    const { container } = render(RouteReviews, { routeId: 'r1' });
    await new Promise((r) => setTimeout(r, 20));
    expect(container.querySelector('section')).toBeNull();
    expect(container.textContent?.trim()).toBe('');
  });
  it('shows the offline line', async () => {
    configureSession({ baseUrl: 'https://api.test', fetch: (() => Promise.reject(new TypeError('x'))) as typeof fetch });
    render(RouteReviews, { routeId: 'r1' });
    await screen.findByText('Reviews need a connection.');
  });
  it('says No reviews yet', async () => {
    ok({ graded: true, people: 0, summary: empty, reviews: [] });
    render(RouteReviews, { routeId: 'r1' });
    await screen.findByText('No reviews yet.');
  });
  it('hidden summary says Not enough reviews yet', async () => {
    ok({ graded: true, people: 2, summary: { ...empty, difficulty: { answered: 3, counts: { HARDER: 2, AS_GRADED: 1 } } }, reviews: [rev(1), rev(2)] });
    render(RouteReviews, { routeId: 'r1' });
    await screen.findByText('2 of 3 said harder than graded');
    expect(screen.getAllByText('Not enough reviews yet')).toHaveLength(4);
  });
  it('a review note with <b> renders as literal text', async () => {
    ok({ graded: false, people: 1, summary: empty, reviews: [rev(1, { note: '<b>bold</b> steep', displayName: '<i>Sam</i>' })] });
    const { container } = render(RouteReviews, { routeId: 'r1' });
    await screen.findByText('<b>bold</b> steep');
    expect(screen.getByText('<i>Sam</i>')).toBeTruthy();
    expect(container.querySelector('b, i')).toBeNull();
  });
  it('shows month and Date not recorded', async () => {
    ok({ graded: false, people: 2, summary: empty, reviews: [rev(1), rev(2, { month: null, dateRecorded: false }), rev(3, { month: null, dateRecorded: true })] });
    render(RouteReviews, { routeId: 'r1' });
    await screen.findByText('March 2026');
    expect(screen.getByText('Date not recorded')).toBeTruthy();
  });
  it('Show more reveals the rest and counts only what is listed', async () => {
    ok({ graded: false, people: 9, summary: empty, reviews: Array.from({ length: 7 }, (_, i) => rev(i + 1)) });
    render(RouteReviews, { routeId: 'r1' });
    await screen.findByText('Walker 1');
    expect(screen.queryByText('Walker 6')).toBeNull();
    expect(screen.queryByRole('button', { name: /Show all/ })).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Show 2 more' }));
    expect(screen.getByText('Walker 7')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Show/ })).toBeNull();
  });
});
