import { render, screen } from '@testing-library/svelte';
import { describe, it, expect } from 'vitest';
import AreaTree from './AreaTree.svelte';
import { buildAreaTree } from '../data/areas';
import type { RouteIndexEntry } from '../data/types';

function entry(id: string, area: string[]): RouteIndexEntry {
  return { id, title: id, area, coords: null, coordsSource: null, coordsAccuracyM: null, coordsOsm: null,
    grade: null, gradeSource: null, time: null, heightGain: null, isFullEntry: true };
}

describe('AreaTree', () => {
  it('renders nested sub-areas and a rolled-up done/total count', () => {
    const nodes = buildAreaTree([
      entry('a', ['Table-Mountain', 'atlantic-west']),
      entry('b', ['Table-Mountain', 'back-table'])
    ]);
    render(AreaTree, { nodes, doneIds: new Set(['a']) });
    expect(screen.getByText('Atlantic West')).toBeTruthy();
    expect(screen.getByText('Back Table')).toBeTruthy();
    expect(screen.getByText('1/2')).toBeTruthy(); // Table Mountain rolls up 1 of 2
  });
});
