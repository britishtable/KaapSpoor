import { describe, it, expect, afterEach } from 'vitest';
import { phrase, formatMonth, fetchRouteReviews } from './reviews';
import { configureSession, restoreSession } from '../account/session';

afterEach(() => configureSession());

describe('phrase', () => {
  it('orders by count and omits zeros', () => {
    const lines = phrase('difficulty', { answered: 9, counts: { EASIER: 0, AS_GRADED: 2, HARDER: 7 } }, true);
    expect(lines).toEqual(['7 of 9 said harder than graded', '2 of 9 said as graded']);
  });
  it('uses graded wording only when graded', () => {
    const counts = { answered: 4, counts: { HARDER: 3, HARD: 1 } };
    expect(phrase('difficulty', counts, true)).toEqual(['3 of 4 said harder than graded']);
    expect(phrase('difficulty', counts, false)).toEqual(['1 of 4 said hard']);
  });
  it('words enjoyment and the other questions', () => {
    expect(phrase('enjoyment', { answered: 5, counts: { '4': 3, '5': 2 } }, false))
      .toEqual(['3 of 5 gave it 4 out of 5', '2 of 5 gave it 5 out of 5']);
    expect(phrase('safety', { answered: 3, counts: { YES: 3 } }, false)).toEqual(['3 of 3 felt safe']);
  });
});

describe('formatMonth', () => {
  it('formats, flags a missing date, or shows nothing', () => {
    expect(formatMonth('2026-03', true)).toBe('March 2026');
    expect(formatMonth(null, false)).toBe('Date not recorded');
    expect(formatMonth(null, true)).toBeNull();
  });
});

describe('fetchRouteReviews', () => {
  it("returns 'unavailable' with no API base", async () => {
    configureSession({ baseUrl: null });
    expect(await fetchRouteReviews('r1')).toBe('unavailable');
  });
  it("returns 'offline' when fetch rejects", async () => {
    configureSession({ baseUrl: 'https://api.test', fetch: (() => Promise.reject(new TypeError('x'))) as typeof fetch });
    expect(await fetchRouteReviews('r1')).toBe('offline');
  });
  it("returns 'unavailable' on 404 and 5xx", async () => {
    for (const status of [404, 503]) {
      configureSession({ baseUrl: 'https://api.test', fetch: (async () => new Response('{}', { status })) as typeof fetch });
      expect(await fetchRouteReviews('r1')).toBe('unavailable');
    }
  });

  it('a stale token never breaks the public read', async () => {
    const sent: (string | null)[] = [];
    const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = input instanceof Request ? input : new Request(input, init);
      const path = new URL(req.url).pathname;
      if (path === '/api/v1/auth/refresh') return new Response('{}', { status: 503 }); // keeps the session
      sent.push(req.headers.get('Authorization'));
      if (req.headers.get('Authorization')) {
        return new Response('{}', { status: 401, headers: { 'WWW-Authenticate': 'Bearer error="invalid_token"' } });
      }
      return new Response(JSON.stringify({ graded: false, people: 0, reviews: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    let stored: import('../account/session').StoredSession | null = {
      accessToken: 'expired', accessExpiresAt: new Date(Date.now() + 600_000).toISOString(), refreshToken: 'r',
      user: { id: 'u', displayName: 'U', initials: 'U' }
    };
    configureSession({
      baseUrl: 'https://api.test', fetch: f,
      storage: { load: () => stored, save: (s) => { stored = s; }, clear: () => { stored = null; } }
    });
    restoreSession();
    expect(await fetchRouteReviews('r1')).toEqual({ graded: false, people: 0, reviews: [] });
    expect(sent).toEqual([null]);
  });
});
