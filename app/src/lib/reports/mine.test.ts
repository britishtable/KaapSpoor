import { describe, it, expect, beforeEach } from 'vitest';
import { rememberMine, mineIds } from './mine';

beforeEach(() => { localStorage.clear(); });

describe('reports filed by me', () => {
  it('remembers ids per account', () => {
    rememberMine('u1', 'a');
    rememberMine('u1', 'b');
    rememberMine('u2', 'c');
    expect([...mineIds('u1')].sort()).toEqual(['a', 'b']);
    expect([...mineIds('u2')]).toEqual(['c']);
    expect(mineIds('u3').size).toBe(0);
  });

  it('remembering twice keeps one', () => {
    rememberMine('u1', 'a');
    rememberMine('u1', 'a');
    expect([...mineIds('u1')]).toEqual(['a']);
  });

  it('a broken store reads as empty rather than throwing', () => {
    localStorage.setItem('ks.reports.mine', '{not json');
    expect(mineIds('u1').size).toBe(0);
    expect(() => rememberMine('u1', 'a')).not.toThrow();
    expect([...mineIds('u1')]).toEqual(['a']);
  });
});
