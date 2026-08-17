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

  it('draws a chevron pointing +x, not -x', () => {
    // A pixel-content check, not just a shape check: mirroring the image
    // (vertex at low x instead of high x) must fail this test. For each
    // column, count how many rows are lit -- the vertex column has the
    // fewest lit rows (the strokes haven't fanned out yet), and the columns
    // near the open tail have the most. If the chevron pointed the wrong
    // way, the narrowest column would sit in the low-x half instead.
    const image = arrowImage();
    const litRowsByColumn = (img: ImageData): number[] => {
      const counts: number[] = [];
      for (let x = 0; x < img.width; x++) {
        let n = 0;
        for (let y = 0; y < img.height; y++) {
          if (img.data[(y * img.width + x) * 4 + 3] > 0) n++;
        }
        counts.push(n);
      }
      return counts;
    };
    const counts = litRowsByColumn(image);
    // Only columns the chevron actually touches -- the far side of the image
    // is deliberately blank (the strokes fan out from the vertex, they don't
    // reach across the whole width).
    const litColumns = counts
      .map((n, x) => ({ x, n }))
      .filter(({ n }) => n > 0);
    expect(litColumns.length).toBeGreaterThan(0);

    const vertex = litColumns.reduce((min, c) => (c.n < min.n ? c : min));
    // The vertex column is in the high-x half of the image -- the leading
    // edge, since icon-rotation-alignment: 'map' rotates the image's own +x
    // axis to match the line's bearing.
    expect(vertex.x).toBeGreaterThanOrEqual(image.width / 2);

    // A column near the open tail (low x) has strictly more lit rows than
    // the vertex -- the strokes have visibly spread apart by then.
    const tailColumn = litColumns.reduce((min, c) => (c.x < min.x ? c : min));
    expect(tailColumn.n).toBeGreaterThan(vertex.n);
  });
});
