import { describe, it, expect } from 'vitest';
import {
  nodeKey, haversineM, splitAtJunctions, buildGraph, nearestNode, routeBetween,
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

describe('splitAtJunctions', () => {
  it('leaves a line with no junction inside it alone', () => {
    expect(splitAtJunctions([[A, B, C]])).toEqual([[A, B, C]]);
  });

  it('cuts a line where another meets it mid-span', () => {
    // THE reason this function exists. A third of junctions in the shipped
    // tiles are interior vertices of some feature, so joining only at feature
    // endpoints leaves the network in disconnected pieces and no click can
    // route across them.
    const pieces = splitAtJunctions([[A, B, C], [B, NORTH]]);
    expect(pieces).toHaveLength(3);
    expect(pieces).toContainEqual([A, B]);
    expect(pieces).toContainEqual([B, C]);
  });

  it('does not cut a line where it touches only itself', () => {
    // A lollipop shares a coordinate with itself, not with another line.
    expect(splitAtJunctions([[A, B, C, B, NORTH]])).toHaveLength(1);
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

  it('walks a split line, so an interior junction is usable', () => {
    const graph = buildGraph(splitAtJunctions([[A, B, C], [B, NORTH]]));
    expect(routeBetween(graph, nodeKey(A), nodeKey(NORTH))).toEqual([A, B, NORTH]);
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
