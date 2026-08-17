import { describe, it, expect } from 'vitest';
import {
  ROUTE_LINE_LAYERS, ROUTE_LINE_SOURCE, routeLineFilter, routeLinePaint, lineBounds,
  activeVariantFilter, routeLineActivePaint,
  ARROW_IMAGE, arrowImage, routeArrowLayout
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

  it('names the source the map fills at runtime', () => {
    expect(ROUTE_LINE_SOURCE).toBe('route-lines');
  });
});

describe('variants', () => {
  it('names three layers, the active one last so it draws on top', () => {
    expect([...ROUTE_LINE_LAYERS]).toEqual([
      'route-line-casing', 'route-line', 'route-line-active'
    ]);
  });

  it('matches nothing when no variant is being pointed at', () => {
    expect(activeVariantFilter('a--b--c', null)).toEqual([
      'in', ['get', 'variant'], ['literal', []]
    ]);
  });

  it('matches one route AND one variant, never a namesake on another route', () => {
    // 'Right Hand' is a name several entries will use.
    expect(activeVariantFilter('a--b--c', 'Right Hand')).toEqual([
      'all',
      ['in', ['get', 'routeId'], ['literal', ['a--b--c']]],
      ['in', ['get', 'variant'], ['literal', ['Right Hand']]]
    ]);
  });

  it('sits an unemphasised variant back, so the one being read stands out', () => {
    // Several lines at full strength on one mountain read as a tangle rather
    // than as choices.
    expect(routeLinePaint()['line-opacity']).toBeLessThan(
      routeLineActivePaint()['line-opacity'] as number
    );
  });
});

describe('direction', () => {
  it('places arrows along the line, turning with it', () => {
    const layout = routeArrowLayout();
    expect(layout['symbol-placement']).toBe('line');
    // Without map alignment the arrows keep screen orientation and point the
    // wrong way the moment the map rotates.
    expect(layout['icon-rotation-alignment']).toBe('map');
    expect(layout['icon-image']).toBe(ARROW_IMAGE);
  });

  it('carries no text, so it needs no fontstack', () => {
    // Only one glyph set ships (Open Sans Regular). An arrow is an image.
    expect(JSON.stringify(routeArrowLayout())).not.toContain('text-font');
    expect(JSON.stringify(routeArrowLayout())).not.toContain('text-field');
  });

  it('builds an arrow image the map can register', () => {
    const image = arrowImage();
    expect(image.width).toBeGreaterThan(0);
    expect(image.height).toBe(image.width);
    expect(image.data.length).toBe(image.width * image.height * 4);
  });
});
