import { describe, it, expect } from 'vitest';
import { mentionedPaths, normaliseForMatch, type OsmPathName } from './path-mentions';

const names = (...entries: [string, number][]): OsmPathName[] =>
  entries.map(([name, segments]) => ({ name, segments }));

describe('normaliseForMatch', () => {
  it('folds apostrophes away and collapses punctuation, preserving case', () => {
    expect(normaliseForMatch("Smuts' Track")).toBe('Smuts Track');
    expect(normaliseForMatch('Myburgh’s  Waterfall-Ravine')).toBe('Myburghs Waterfall Ravine');
    expect(normaliseForMatch('Ledges')).toBe('Ledges');
  });
});

describe('mentionedPaths', () => {
  it('finds a name the prose uses', () => {
    const found = mentionedPaths('Follow the Contour Path north.', names(['Contour Path', 27]));
    expect(found).toEqual(['Contour Path']);
  });

  it("folds apostrophe variants onto one entry, keeping the better-attested spelling", () => {
    // OSM carries both "Smuts' Track" and "Smuts Track" for the same path.
    // Two labels on one path is the defect this prevents.
    const found = mentionedPaths(
      'Take Smuts Track to the top.',
      names(["Smuts' Track", 7], ['Smuts Track', 3])
    );
    expect(found).toEqual(["Smuts' Track"]);
  });

  it('matches a single-word name — Ledges is a real path', () => {
    expect(mentionedPaths('Traverse into Ledges.', names(['Ledges', 2]))).toEqual(['Ledges']);
  });

  it('does not match a common noun in lower case', () => {
    // "ledges" the rock feature is not "Ledges" the path. Case is the only
    // signal separating them.
    expect(mentionedPaths('Scramble over broken ledges.', names(['Ledges', 2]))).toEqual([]);
  });

  it("rejects a one-letter name — 'B' is an OSM path AND a grade in this archive", () => {
    // Without the length floor this matches 98 times across 40 routes.
    expect(mentionedPaths("A fun 'B' grade scramble.", names(['B', 1]))).toEqual([]);
  });

  it('lets the longest name win over one contained in it', () => {
    const found = mentionedPaths(
      'Follow the Twelve Apostles Path.',
      names(['Twelve Apostles Path', 18], ['Twelve Apostles', 11])
    );
    expect(found).toEqual(['Twelve Apostles Path']);
  });

  it('does not let a short name steal characters from a longer one elsewhere', () => {
    // "Fountain Ledges" must claim its own text; "Ledges" may still match its
    // own separate mention.
    const found = mentionedPaths(
      'Up Fountain Ledges, then traverse into Ledges.',
      names(['Fountain Ledges', 4], ['Ledges', 2])
    );
    expect(found).toEqual(['Fountain Ledges', 'Ledges']);
  });

  it('requires whole words, not substrings', () => {
    expect(mentionedPaths('The Ledgesmith path.', names(['Ledges', 2]))).toEqual([]);
  });

  it('returns names in the order the prose first mentions them', () => {
    // The panel is read alongside the description, so reading order is the
    // useful order.
    const found = mentionedPaths(
      'Start on the Pipe Track, join the Contour Path, finish up India Venster.',
      names(['Contour Path', 27], ['India Venster', 6], ['Pipe Track', 18])
    );
    expect(found).toEqual(['Pipe Track', 'Contour Path', 'India Venster']);
  });

  it('yields an empty array, not null, for a route naming nothing', () => {
    expect(mentionedPaths('A pleasant walk.', names(['Contour Path', 27]))).toEqual([]);
  });

  it('names each path once however often the prose repeats it', () => {
    const found = mentionedPaths(
      'The Contour Path is long. Leave the Contour Path at the cairn.',
      names(['Contour Path', 27])
    );
    expect(found).toEqual(['Contour Path']);
  });
});
