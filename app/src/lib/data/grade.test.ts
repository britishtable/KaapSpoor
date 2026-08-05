import { describe, it, expect } from 'vitest';
import { summariseGrade } from './grade';

describe('summariseGrade', () => {
  it('splits a numeral from its quality stars', () => {
    expect(summariseGrade('3 ***')).toEqual({ level: '3', stars: '***' });
  });

  it('drops the prose a grade field often trails', () => {
    // 80 of the 152 graded routes carry more than 24 characters here, up to 145.
    // The pin popup is an annotation, not the route page: it states the grade
    // and gets out of the way.
    expect(summariseGrade('5 ***: E grade rock climbing at minimum. DO NOT attempt without gear.')).toEqual(
      { level: '5', stars: '***' }
    );
    expect(summariseGrade('2 * NOT RECOMMENDED')).toEqual({ level: '2', stars: '*' });
  });

  it('reads stars that run straight on from the numeral', () => {
    expect(summariseGrade('5****')).toEqual({ level: '5', stars: '****' });
    expect(summariseGrade('1*:')).toEqual({ level: '1', stars: '*' });
  });

  it('keeps a range as one level', () => {
    expect(summariseGrade('1/2')).toEqual({ level: '1/2', stars: null });
    expect(summariseGrade('3-4')).toEqual({ level: '3-4', stars: null });
    expect(summariseGrade('4/5')).toEqual({ level: '4/5', stars: null });
  });

  it('accepts a lettered grade', () => {
    expect(summariseGrade('B')).toEqual({ level: 'B', stars: null });
  });

  it('reports nothing to show rather than an empty string', () => {
    expect(summariseGrade(null)).toEqual({ level: null, stars: null });
    expect(summariseGrade('')).toEqual({ level: null, stars: null });
    expect(summariseGrade('   ')).toEqual({ level: null, stars: null });
  });

  it('does not mistake a prose sentence for a grade', () => {
    // Nothing in today's data starts a grade with a word, but gradeSource
    // 'prose' means this field is inferred, so it can.
    expect(summariseGrade('Moderate scramble throughout')).toEqual({ level: null, stars: null });
  });
});
