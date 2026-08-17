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
  /** Every edge once, for snapping a click onto the line rather than a vertex. */
  edges: Edge[];
}

/** Points this close are the same point, whatever their last decimals say. */
const MERGE_M = 1;
/** Grid cell of roughly MERGE_M, in degrees. */
const CELL = 1e-5;

/**
 * Collapses coordinates that describe the same real point onto one.
 *
 * The vector tiles hand back a trail crossing a tile boundary once per tile,
 * and the two copies do not agree in their last decimals — measured in one
 * editor view, 135 pairs of nodes under a metre apart with different keys. Each
 * one is a place where a plainly continuous trail could not be walked, which is
 * the "no trail connects that to the last point" an author sees while looking
 * straight at the connection.
 *
 * Neighbouring cells are checked too, so a pair straddling a cell boundary
 * still merges.
 */
function canonicaliser(): (point: Point) => Point {
  const cells = new Map<string, Point[]>();
  return (point: Point) => {
    const cx = Math.round(point[0] / CELL);
    const cy = Math.round(point[1] / CELL);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const seen of cells.get(`${cx + dx},${cy + dy}`) ?? []) {
          if (haversineM(seen, point) <= MERGE_M) return seen;
        }
      }
    }
    const key = `${cx},${cy}`;
    const bucket = cells.get(key);
    if (bucket) bucket.push(point);
    else cells.set(key, [point]);
    return point;
  };
}

export function buildGraph(lines: Point[][]): SnapGraph {
  const adjacency = new Map<NodeKey, Edge[]>();
  const nodes = new Map<NodeKey, Point>();
  const edges: Edge[] = [];
  const canonical = canonicaliser();
  const push = (key: NodeKey, edge: Edge) => {
    const list = adjacency.get(key);
    if (list) list.push(edge);
    else adjacency.set(key, [edge]);
  };

  for (const line of lines) {
    if (line.length < 2) continue;
    for (let i = 1; i < line.length; i++) {
      const from = canonical(line[i - 1]);
      const to = canonical(line[i]);
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
      edges.push(edge);
    }
  }
  return { adjacency, nodes, edges };
}

/** Where a click landed on the network: a point on a line, and its node. */
export interface Snapped {
  key: NodeKey;
  point: Point;
  distanceM: number;
}

/**
 * The nearest point ON A LINE to `click`, or null if none is within `withinM`.
 *
 * Snapping to vertices alone was the editor's first real defect: a straight run
 * of trail carries two vertices, one at each end, so clicking the middle of a
 * plainly visible dashed line was refused because the nearest CORNER was
 * hundreds of metres off. What the author sees is the line, so the line is what
 * a click has to find.
 *
 * A click landing between two vertices SPLITS that edge, so the snapped point
 * is a real node the walk can start from. The graph is rebuilt whenever the map
 * settles, so these extra nodes never accumulate.
 */
export function snapToGraph(graph: SnapGraph, click: Point, withinM: number): Snapped | null {
  let best: { edge: Edge; point: Point; t: number; distanceM: number } | null = null;

  for (const edge of graph.edges) {
    const [from, to] = edge.coords;
    // Planar projection with longitude scaled by latitude: over a segment of a
    // few hundred metres the error is far below the click tolerance.
    const k = Math.cos((click[1] * Math.PI) / 180);
    const ax = (from[0] - click[0]) * k;
    const ay = from[1] - click[1];
    const bx = (to[0] - click[0]) * k;
    const by = to[1] - click[1];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 ? -(ax * dx + ay * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const point: Point = [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t];
    const distanceM = haversineM(click, point);
    if (distanceM <= withinM && (!best || distanceM < best.distanceM)) {
      best = { edge, point, t, distanceM };
    }
  }

  if (!best) return null;

  const key = nodeKey(best.point);
  // Landing on (or within rounding of) an existing node needs no split.
  if (graph.nodes.has(key)) return { key, point: graph.nodes.get(key)!, distanceM: best.distanceM };

  splitEdge(graph, best.edge, key, best.point);
  return { key, point: best.point, distanceM: best.distanceM };
}

/** Replace `edge` with two edges meeting at a new node. */
function splitEdge(graph: SnapGraph, edge: Edge, key: NodeKey, point: Point): void {
  const [from, to] = edge.coords;
  const first: Edge = { a: edge.a, b: key, coords: [from, point], lengthM: haversineM(from, point) };
  const second: Edge = { a: key, b: edge.b, coords: [point, to], lengthM: haversineM(point, to) };

  const drop = (node: NodeKey) => {
    const list = graph.adjacency.get(node);
    if (!list) return;
    const at = list.indexOf(edge);
    if (at >= 0) list.splice(at, 1);
  };
  const add = (node: NodeKey, next: Edge) => {
    const list = graph.adjacency.get(node);
    if (list) list.push(next);
    else graph.adjacency.set(node, [next]);
  };

  drop(edge.a);
  drop(edge.b);
  add(edge.a, first);
  add(key, first);
  add(key, second);
  add(edge.b, second);

  graph.nodes.set(key, point);
  const at = graph.edges.indexOf(edge);
  if (at >= 0) graph.edges.splice(at, 1, first, second);
  else graph.edges.push(first, second);
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

/**
 * Two clicks this close are one step, whatever the network says.
 *
 * OSM routinely has two ways passing within metres without sharing a node, so
 * the graph has no link between them and the only route is the long way round.
 * Measured on Lekkerwater Traverse: a click 10 m past the top of Grove Walk
 * sent the line 2 km back through Pimple Traverse and Victoria Ravine. At this
 * range a straight join is what the author plainly means, and it is visually
 * indistinguishable from the trail anyway.
 */
const BRIDGE_M = 30;

/**
 * The trail between two points — or a straight join where routing would be
 * absurd. Returns null only when the two are genuinely far apart and nothing
 * connects them.
 */
export function walkOrBridge(graph: SnapGraph, from: Point, to: Point): Point[] | null {
  const direct = haversineM(from, to);
  if (direct <= BRIDGE_M) return [from, to];

  const walked = routeBetween(graph, nodeKey(from), nodeKey(to));
  if (!walked) return null;

  // Connected, but only by a detour out of all proportion to the gap: the two
  // ways almost certainly do not meet, and the long way round is not the route.
  let length = 0;
  for (let i = 1; i < walked.length; i++) length += haversineM(walked[i - 1], walked[i]);
  if (length > Math.max(4 * direct, direct + 200)) return [from, to];

  return walked;
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
