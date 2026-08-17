import { describe, it, expect } from 'vitest';
import {
  ROUTE_LINE_LAYERS, ROUTE_LINE_SOURCE, routeLineFilter, routeLinePaint, lineBounds
} from './route-lines';
import { PIN_COLOR_DONE, PIN_COLOR_TODO } from './pins';

describe('route lines', () => {
  it('matches nothing when nothing is selected', () => {
    // The unselected state is a filter, not an absent layer: the layers exist
    // from style load so nothing is added or removed at runtime.
    expect(routeLineFilter(null)).toEqual(['in', ['get', 'routeId'], ['literal', []]]);
  });

  it('matches exactly the selected route', () => {
    expect(routeLineFilter('a--b--c')).toEqual(['in', ['get', 'routeId'], ['literal', ['a--b--c']]]);
  });

  it('draws the line in the pin colours, because this IS the route', () => {
    const paint = routeLinePaint();
    expect(JSON.stringify(paint)).toContain(PIN_COLOR_DONE);
    expect(JSON.stringify(paint)).toContain(PIN_COLOR_TODO);
  });

  it('never draws a hairline', () => {
    const width = routeLinePaint()['line-width'] as unknown[];
    // ['interpolate', ['linear'], ['zoom'], z0, w0, ...] — the first width.
    expect(width[4]).toBeGreaterThanOrEqual(0.8);
  });

  it('bounds a LineString', () => {
    expect(lineBounds({ type: 'LineString', coordinates: [[18.4, -34.0], [18.5, -33.9]] }))
      .toEqual([[18.4, -34.0], [18.5, -33.9]]);
  });

  it('bounds a MultiLineString across all its parts', () => {
    expect(lineBounds({
      type: 'MultiLineString',
      coordinates: [[[18.4, -34.0], [18.45, -33.95]], [[18.3, -34.1], [18.5, -33.9]]]
    })).toEqual([[18.3, -34.1], [18.5, -33.9]]);
  });

  it('returns null for empty geometry rather than an inverted box', () => {
    expect(lineBounds({ type: 'LineString', coordinates: [] })).toBe(null);
  });

  it('names both layers, casing first so it draws underneath', () => {
    expect(ROUTE_LINE_LAYERS).toEqual(['route-line-casing', 'route-line']);
    expect(ROUTE_LINE_SOURCE).toBe('route-lines');
  });
});
