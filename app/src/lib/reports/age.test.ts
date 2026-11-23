import { describe, it, expect } from 'vitest';
import { formatAge } from './age';

const NOW = new Date('2026-11-23T12:00:00Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const S = 1000, M = 60 * S, H = 60 * M, D = 24 * H;

describe('formatAge', () => {
  it('under a minute is just now', () => {
    expect(formatAge(ago(0), NOW)).toBe('just now');
    expect(formatAge(ago(59 * S), NOW)).toBe('just now');
  });
  it('a time slightly in the future (clock skew) is just now', () => {
    expect(formatAge(ago(-30 * S), NOW)).toBe('just now');
  });
  it('minutes, singular and plural', () => {
    expect(formatAge(ago(61 * S), NOW)).toBe('1 minute ago');
    expect(formatAge(ago(12 * M), NOW)).toBe('12 minutes ago');
    expect(formatAge(ago(59 * M + 59 * S), NOW)).toBe('59 minutes ago');
  });
  it('hours, singular and plural', () => {
    expect(formatAge(ago(61 * M), NOW)).toBe('1 hour ago');
    expect(formatAge(ago(3 * H), NOW)).toBe('3 hours ago');
    expect(formatAge(ago(23 * H + 59 * M), NOW)).toBe('23 hours ago');
  });
  it('one to two days is yesterday', () => {
    expect(formatAge(ago(1 * D), NOW)).toBe('yesterday');
    expect(formatAge(ago(2 * D - S), NOW)).toBe('yesterday');
  });
  it('days up to two weeks', () => {
    expect(formatAge(ago(2 * D), NOW)).toBe('2 days ago');
    expect(formatAge(ago(13 * D), NOW)).toBe('13 days ago');
  });
  it('weeks from two weeks on', () => {
    expect(formatAge(ago(14 * D), NOW)).toBe('2 weeks ago');
    expect(formatAge(ago(20 * D), NOW)).toBe('2 weeks ago');
    expect(formatAge(ago(90 * D), NOW)).toBe('12 weeks ago');
  });
  it('an unreadable time says so rather than NaN', () => {
    expect(formatAge('not a date', NOW)).toBe('at an unknown time');
  });
});
