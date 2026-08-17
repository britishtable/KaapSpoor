import { describe, it, expect } from 'vitest';
import {
  nodeKey, haversineM, buildGraph, nearestNode, routeBetween, snapToGraph,
  type Point
} from './snap';

const A: Point = [18.400, -34.000];
const B: Point = [18.410, -34.000];
const C: Point = [18.420, -34.000];
const NORTH: Point = [18.410, -33.990];
const FAR: Point = [18.500, -34.000];
const FAR_EAST: Point = [18.510, -34.000];

describe('nodeKey', () => {
  it('rounds to seven places, which is how two lines are recognised as meeting', () => {
    expect(nodeKey([18.4012345678, -33.9587654321])).toBe(nodeKey([18.40123456, -33.95876543]));
  });

  it('keeps genuinely different nodes apart', () => {
    expect(nodeKey([18.4012346, -33.9587654])).not.toBe(nodeKey([18.4012347, -33.9587654]));
  });
});

describe('haversineM', () => {
  it('matches a known distance — a degree of latitude is ~111 km', () => {
    const d = haversineM([18.4, -34.0], [18.4, -33.0]);
    expect(d).toBeGreaterThan(110_000);
    expect(d).toBeLessThan(112_000);
  });
});

describe('buildGraph connectivity', () => {
  it('joins two lines that meet at an INTERIOR vertex of one of them', () => {
    // A third of junctions in the shipped tiles are interior vertices. Every
    // vertex being a node is what makes them usable without a separate
    // splitting step — a side path ending mid-way along a through path meets
    // it at a node already.
    const graph = buildGraph([[A, B, C], [B, NORTH]]);
    expect(routeBetween(graph, nodeKey(A), nodeKey(NORTH))).toEqual([A, B, NORTH]);
  });

  it('gives a click something to snap to between the junctions', () => {
    // The defect this replaced: with only line endpoints as nodes, a click on
    // the trail between two junctions had nothing within reach and was refused.
    const graph = buildGraph([[A, B, C]]);
    expect(graph.nodes.has(nodeKey(B))).toBe(true);
  });

  it('ignores a repeated coordinate rather than making a self-loop', () => {
    const graph = buildGraph([[A, A, B]]);
    expect(graph.adjacency.get(nodeKey(A))).toHaveLength(1);
  });
});

describe('buildGraph', () => {
  it('joins two lines that share an endpoint', () => {
    const graph = buildGraph([[A, B], [B, C]]);
    expect(graph.adjacency.get(nodeKey(B))).toHaveLength(2);
  });

  it('records every node so a click has something to snap to', () => {
    const graph = buildGraph([[A, B]]);
    expect([...graph.nodes.keys()].sort()).toEqual([nodeKey(A), nodeKey(B)].sort());
  });
});

describe('buildGraph merges what is really one point', () => {
  it('joins two lines whose shared point differs only in the last decimals', () => {
    // Tile-boundary fragmentation: a trail crossing a tile edge comes back from
    // each tile with slightly different coordinates for the same real point.
    // Measured in one editor view: 135 pairs of nodes under 1 m apart with
    // different keys — 135 places where a visibly continuous trail could not be
    // routed along.
    const shared: Point = [18.410, -34.000];
    const nudged: Point = [18.4100000, -34.0000034]; // ~0.38 m south
    const graph = buildGraph([[A, shared], [nudged, C]]);
    expect(routeBetween(graph, nodeKey(A), nodeKey(C))).not.toBe(null);
  });

  it('keeps two genuinely different nodes apart', () => {
    // 5 m is a real gap between two trail ends, not a rounding artefact.
    const near: Point = [18.410045, -34.0];
    const graph = buildGraph([[A, B], [near, C]]);
    expect(routeBetween(graph, nodeKey(A), nodeKey(C))).toBe(null);
  });
});

describe('snapToGraph', () => {
  it('snaps to a point ON the line, not to its nearest corner', () => {
    // THE defect this replaced. A straight run of trail carries two vertices,
    // one at each end. Clicking the middle of a visibly dashed line was refused
    // because the nearest VERTEX was hundreds of metres away, even though the
    // click was on the path. What is on screen is the line, so the line is what
    // a click must snap to.
    const graph = buildGraph([[A, C]]); // ~1.8 km, two vertices
    const middle: Point = [18.410, -34.0005]; // on the line, ~50 m south
    const hit = snapToGraph(graph, middle, 100);
    expect(hit).not.toBe(null);
    expect(hit!.point[0]).toBeCloseTo(18.410, 4);
    expect(hit!.point[1]).toBeCloseTo(-34.0, 4);
  });

  it('still refuses a click that is genuinely off any trail', () => {
    const graph = buildGraph([[A, C]]);
    expect(snapToGraph(graph, [18.41, -34.05], 100)).toBe(null);
  });

  it('makes the snapped point routable, so the next click can walk from it', () => {
    // Snapping mid-segment has to add a node, or the walk has nowhere to start.
    const graph = buildGraph([[A, C]]);
    const hit = snapToGraph(graph, [18.410, -34.0005], 100)!;
    expect(routeBetween(graph, hit.key, nodeKey(C))).not.toBe(null);
  });

  it('reuses an existing node when the click is already on one', () => {
    const graph = buildGraph([[A, B], [B, C]]);
    const before = graph.nodes.size;
    const hit = snapToGraph(graph, B, 50)!;
    expect(hit.key).toBe(nodeKey(B));
    expect(graph.nodes.size).toBe(before);
  });
});

describe('nearestNode', () => {
  it('finds the node under the click', () => {
    const graph = buildGraph([[A, B]]);
    // ~90 m east of A at this latitude.
    expect(nearestNode(graph, [18.401, -34.0], 250)).toBe(nodeKey(A));
  });

  it('refuses a click with no trail near it', () => {
    const graph = buildGraph([[A, B]]);
    expect(nearestNode(graph, [18.5, -34.0], 250)).toBe(null);
  });
});

describe('routeBetween', () => {
  it('follows the trails across a join', () => {
    const graph = buildGraph([[A, B], [B, C]]);
    expect(routeBetween(graph, nodeKey(A), nodeKey(C))).toEqual([A, B, C]);
  });

  it('takes the shorter of two ways round', () => {
    const detour: Point = [18.405, -34.05];
    const graph = buildGraph([[A, detour], [detour, C], [A, C]]);
    expect(routeBetween(graph, nodeKey(A), nodeKey(C))).toEqual([A, C]);
  });

  it('returns null when the two points are not connected', () => {
    // Two trails on opposite sides of the peninsula. The editor shows this as
    // "no trail connects that to the last point" rather than drawing a straight
    // line across the mountain.
    const graph = buildGraph([[A, B], [FAR, FAR_EAST]]);
    expect(routeBetween(graph, nodeKey(A), nodeKey(FAR))).toBe(null);
  });

  it('returns a single point when asked to route to where it already is', () => {
    const graph = buildGraph([[A, B]]);
    expect(routeBetween(graph, nodeKey(A), nodeKey(A))).toEqual([A]);
  });
});
