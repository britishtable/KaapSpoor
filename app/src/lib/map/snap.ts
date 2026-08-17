/**
 * Snapping a click to the trail network, and walking the trails between two
 * clicks.
 *
 * Adapted from tools/routelines/kaap_routelines/{geo,graph}.py, whose node key
 * and Dijkstra this keeps. The source of lines here is the vector tiles the map
 * has already loaded, so the editor needs no extra download and no server.
 *
 * EVERY VERTEX IS A NODE, which differs from the Python tool and matters twice.
 *
 * The Python tool made whole ways its edges, so it had to cut them wherever
 * another way met one mid-span — measured over 29 z14 tiles, 1,027 of 3,090
 * junctions are interior vertices, and missing those leaves the network in
 * pieces nothing can route across. Per-vertex edges make that splitting step
 * unnecessary: two lines sharing an interior vertex meet at a node already.
 *
 * It is also what makes the editor usable. Junctions are hundreds of metres
 * apart, so a graph of junctions alone can only be clicked at junctions — every
 * click on the trail between two of them lands too far from a node and is
 * refused. Tile vertices are ~2.5 m apart, so snapping to them is continuous
 * for a hand holding a mouse.
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

  for (const line of lines) {
    if (line.length < 2) continue;
    for (let i = 1; i < line.length; i++) {
      const from = line[i - 1];
      const to = line[i];
      const a = nodeKey(from);
      const b = nodeKey(to);
      // A zero-length segment (a repeated coordinate) is not an edge, and it
      // would put a self-loop in the adjacency for nothing.
      if (a === b) continue;
      const edge: Edge = { a, b, coords: [from, to], lengthM: haversineM(from, to) };
      nodes.set(a, from);
      nodes.set(b, to);
      push(a, edge);
      push(b, edge);
    }
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

/** The smallest heap that does the job; nothing here needs decrease-key. */
class MinHeap {
  private items: { key: NodeKey; cost: number }[] = [];

  get size(): number {
    return this.items.length;
  }

  push(key: NodeKey, cost: number): void {
    this.items.push({ key, cost });
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.items[parent].cost <= this.items[i].cost) break;
      [this.items[parent], this.items[i]] = [this.items[i], this.items[parent]];
      i = parent;
    }
  }

  pop(): { key: NodeKey; cost: number } | undefined {
    const top = this.items[0];
    const last = this.items.pop();
    if (this.items.length && last) {
      this.items[0] = last;
      let i = 0;
      for (;;) {
        const left = 2 * i + 1;
        const right = left + 1;
        let smallest = i;
        if (left < this.items.length && this.items[left].cost < this.items[smallest].cost) {
          smallest = left;
        }
        if (right < this.items.length && this.items[right].cost < this.items[smallest].cost) {
          smallest = right;
        }
        if (smallest === i) break;
        [this.items[smallest], this.items[i]] = [this.items[i], this.items[smallest]];
        i = smallest;
      }
    }
    return top;
  }
}

/** The coordinates walked from `from` to `to` along the trails, or null. */
export function routeBetween(graph: SnapGraph, from: NodeKey, to: NodeKey): Point[] | null {
  const start = graph.nodes.get(from);
  if (!start) return null;
  if (from === to) return [start];

  const best = new Map<NodeKey, number>([[from, 0]]);
  const cameBy = new Map<NodeKey, { edge: Edge; prev: NodeKey }>();
  // A binary heap, not a sorted array. Every tile vertex is a node, so a view
  // of Table Mountain is tens of thousands of them, and re-sorting the queue on
  // each pop turned a click into a visible pause.
  const queue = new MinHeap();
  queue.push(from, 0);

  while (queue.size) {
    const next = queue.pop();
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
        queue.push(other, nextCost);
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
