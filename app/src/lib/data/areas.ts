import type { RouteIndexEntry } from './types';

export interface AreaNode {
  key: string;
  label: string;
  path: string[];
  children: AreaNode[];
  routes: RouteIndexEntry[];
}

export function humanizeArea(segment: string): string {
  return segment
    .split('-')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

function ensureChild(parent: AreaNode, segment: string): AreaNode {
  const key = segment.toLowerCase();
  let node = parent.children.find((c) => c.key === key);
  if (!node) {
    node = { key, label: humanizeArea(key), path: [...parent.path, key], children: [], routes: [] };
    parent.children.push(node);
  }
  return node;
}

function sortTree(nodes: AreaNode[]): void {
  nodes.sort((a, b) => a.label.localeCompare(b.label));
  for (const n of nodes) sortTree(n.children);
}

export function buildAreaTree(entries: RouteIndexEntry[]): AreaNode[] {
  const root: AreaNode = { key: '', label: '', path: [], children: [], routes: [] };
  for (const e of entries) {
    let node = root;
    for (const segment of e.area) node = ensureChild(node, segment);
    node.routes.push(e);
  }
  for (const n of walk(root.children)) n.routes.sort((a, b) => a.title.localeCompare(b.title));
  sortTree(root.children);
  return root.children;
}

function* walk(nodes: AreaNode[]): Generator<AreaNode> {
  for (const n of nodes) { yield n; yield* walk(n.children); }
}

export function areaProgress(node: AreaNode, doneIds: Set<string>): { done: number; total: number } {
  let done = 0, total = 0;
  for (const n of [node, ...walk(node.children)]) {
    for (const r of n.routes) { total++; if (doneIds.has(r.id)) done++; }
  }
  return { done, total };
}
