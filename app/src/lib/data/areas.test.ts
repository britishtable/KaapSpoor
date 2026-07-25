import { describe, it, expect } from 'vitest';
import { buildAreaTree, humanizeArea, areaProgress } from './areas';
import type { RouteIndexEntry } from './types';

function entry(id: string, area: string[]): RouteIndexEntry {
  return { id, title: id, area, coords: null, grade: null, gradeSource: null,
    time: null, heightGain: null, isFullEntry: true };
}

const entries = [
  entry('a', ['Table-Mountain', 'atlantic-west']),
  entry('b', ['Table-Mountain', 'atlantic-west']),
  entry('c', ['Table-Mountain', 'back-table']),
  entry('d', ['peninsula'])
];

describe('humanizeArea', () => {
  it('turns a slug segment into a label', () => {
    expect(humanizeArea('atlantic-west')).toBe('Atlantic West');
  });
});

describe('buildAreaTree', () => {
  it('nests sub-areas under their parent area', () => {
    const tree = buildAreaTree(entries);
    expect(tree.map((n) => n.label)).toEqual(['Peninsula', 'Table Mountain']);
    const tm = tree.find((n) => n.key === 'table-mountain')!;
    expect(tm.children.map((n) => n.label)).toEqual(['Atlantic West', 'Back Table']);
  });
  it('attaches routes to the leaf area that owns them', () => {
    const tm = buildAreaTree(entries).find((n) => n.key === 'table-mountain')!;
    const aw = tm.children.find((n) => n.key === 'atlantic-west')!;
    expect(aw.routes.map((r) => r.id)).toEqual(['a', 'b']);
  });
  it('collapses different casings of the same area into one node', () => {
    const mixed = [
      entry('a', ['Table-Mountain', 'atlantic-west']),
      entry('b', ['table-mountain', 'Atlantic-West'])
    ];
    const tree = buildAreaTree(mixed);
    expect(tree).toHaveLength(1);
    expect(tree[0].key).toBe('table-mountain');
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children[0].key).toBe('atlantic-west');
    expect(tree[0].children[0].routes.map((r) => r.id)).toEqual(['a', 'b']);
  });
});

describe('areaProgress', () => {
  it('counts done routes across a node and its descendants', () => {
    const tm = buildAreaTree(entries).find((n) => n.key === 'table-mountain')!;
    expect(areaProgress(tm, new Set(['a', 'c']))).toEqual({ done: 2, total: 3 });
  });
});
