import { describe, it, expect } from 'vitest';
import { encodePlan, decodePlan } from './plan-params';

const CHOICE = {
  approach: 'a--b--c/approach/via-kasteelspoort',
  main: 'a--b--c/main/main',
  exit: 'a--b--c/exit/via-diagonal',
  reversed: false
};

describe('plan params', () => {
  it('round-trips a full choice', () => {
    expect(decodePlan(encodePlan(CHOICE))).toEqual(CHOICE);
  });

  it('round-trips the reversed flag', () => {
    expect(decodePlan(encodePlan({ ...CHOICE, reversed: true })).reversed).toBe(true);
  });

  it('omits empty slots rather than writing blanks into the URL', () => {
    const params = encodePlan({ approach: null, main: 'm', exit: null, reversed: false });
    expect(params.toString()).toBe('m=m');
  });

  it('reads an empty query as no preference, not as an empty plan', () => {
    expect(decodePlan(new URLSearchParams())).toEqual({ reversed: false });
  });

  it('survives the slashes segment ids contain', () => {
    const params = encodePlan(CHOICE);
    expect(new URLSearchParams(params.toString()).get('a')).toBe(CHOICE.approach);
  });
});
