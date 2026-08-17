/**
 * Snapping a click to the trail network, and walking the trails between two
 * clicks.
 *
 * A port of tools/routelines/kaap_routelines/{geo,graph}.py, whose behaviour is
 * pinned by that tool's tests. The source of lines here is the vector tiles the
 * map has already loaded, so the editor needs no extra download and no server.
 *
 * `splitAtJunctions` is the load-bearing piece. Measured over 29 z14 tiles of
 * Table Mountain's path network: 2,063 junctions are visible endpoint-to-
 * endpoint and 1,027 are interior vertices of some feature. Joining only at
 * endpoints would therefore miss a third of them and leave the network in
 * pieces a click cannot route across.
 */

export type Point = [number, number]; // [lon, lat]
export type NodeKey = string;

const PLACES = 7; // ~1 cm; two distinct nodes are never that close
const EARTH_RADIUS_M = 6_371_008.8;

export function nodeKey(point: Point): NodeKey {
  return `${point[0].toFixed(PLACES)},${point[1].toFixed(PLACES)}`;
}

export function haversineM(a: Point, b: Point): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const [lon1, lat1] = [toRad(a[0]), toRad(a[1])];
  const [lon2, lat2] = [toRad(b[0]), toRad(b[1])];
  const h =
    Math.sin((lat2 - lat1) / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin((lon2 - lon1) / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/** Cut every line at the vertices it shares with a DIFFERENT line. */
export function splitAtJunctions(lines: Point[][]): Point[][] {
  const carrying = new Map<NodeKey, number>();
  for (const line of lines) {
    // One vote per line, so a line touching itself makes no junction.
    const own = new Set(line.map(nodeKey));
    for (const key of own) carrying.set(key, (carrying.get(key) ?? 0) + 1);
  }

  const pieces: Point[][] = [];
  for (const line of lines) {
    const keys = line.map(nodeKey);
    const cuts = [0];
    for (let i = 1; i < keys.length - 1; i++) {
      if ((carrying.get(keys[i]) ?? 0) > 1) cuts.push(i);
    }
    cuts.push(keys.length - 1);
    for (let c = 0; c < cuts.length - 1; c++) {
      const piece = line.slice(cuts[c], cuts[c + 1] + 1);
      if (piece.length >= 2) pieces.push(piece);
    }
  }
  return pieces;
}

export interface Edge {
  a: NodeKey;
  b: NodeKey;
  coords: Point[];
  lengthM: number;
}

export interface SnapGraph {
  adjacency: Map<NodeKey, Edge[]>;
  nodes: Map<NodeKey, Point>;
}

export function buildGraph(lines: Point[][]): SnapGraph {
  const adjacency = new Map<NodeKey, Edge[]>();
  const nodes = new Map<NodeKey, Point>();
  const push = (key: NodeKey, edge: Edge) => {
    const list = adjacency.get(key);
    if (list) list.push(edge);
    else adjacency.set(key, [edge]);
  };

  for (const coords of lines) {
    if (coords.length < 2) continue;
    const a = nodeKey(coords[0]);
    const b = nodeKey(coords[coords.length - 1]);
    let lengthM = 0;
    for (let i = 1; i < coords.length; i++) lengthM += haversineM(coords[i - 1], coords[i]);
    const edge: Edge = { a, b, coords, lengthM };
    nodes.set(a, coords[0]);
    nodes.set(b, coords[coords.length - 1]);
    push(a, edge);
    // A closed loop would otherwise list itself twice from one node.
    if (b !== a) push(b, edge);
  }
  return { adjacency, nodes };
}

export function nearestNode(graph: SnapGraph, point: Point, withinM: number): NodeKey | null {
  let best: NodeKey | null = null;
  let bestD = withinM;
  for (const [key, node] of graph.nodes) {
    const d = haversineM(point, node);
    if (d <= bestD) {
      best = key;
      bestD = d;
    }
  }
  return best;
}

/** The coordinates walked from `from` to `to` along the trails, or null. */
export function routeBetween(graph: SnapGraph, from: NodeKey, to: NodeKey): Point[] | null {
  const start = graph.nodes.get(from);
  if (!start) return null;
  if (from === to) return [start];

  const best = new Map<NodeKey, number>([[from, 0]]);
  const cameBy = new Map<NodeKey, { edge: Edge; prev: NodeKey }>();
  // A plain array used as a priority queue: the editor's graph is the loaded
  // tiles, thousands of edges, and a binary heap would be more machinery than
  // the problem needs.
  const queue: { key: NodeKey; cost: number }[] = [{ key: from, cost: 0 }];

  while (queue.length) {
    queue.sort((x, y) => x.cost - y.cost);
    const next = queue.shift();
    if (!next) break;
    const { key, cost } = next;
    if (key === to) break;
    if (cost > (best.get(key) ?? Infinity)) continue;
    for (const edge of graph.adjacency.get(key) ?? []) {
      const other = edge.a === key ? edge.b : edge.a;
      const nextCost = cost + edge.lengthM;
      if (nextCost < (best.get(other) ?? Infinity)) {
        best.set(other, nextCost);
        cameBy.set(other, { edge, prev: key });
        queue.push({ key: other, cost: nextCost });
      }
    }
  }

  if (!best.has(to)) return null;

  // Walk back, collecting each edge's coordinates in the direction travelled.
  const legs: Point[][] = [];
  let at = to;
  while (at !== from) {
    const step = cameBy.get(at);
    if (!step) return null;
    const forward = nodeKey(step.edge.coords[0]) === step.prev;
    legs.push(forward ? step.edge.coords : [...step.edge.coords].reverse());
    at = step.prev;
  }
  legs.reverse();

  const out: Point[] = [];
  for (const leg of legs) out.push(...(out.length ? leg.slice(1) : leg));
  return out;
}
