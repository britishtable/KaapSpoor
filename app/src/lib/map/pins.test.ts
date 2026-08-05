import { describe, it, expect } from 'vitest';
// MapLibre's own validator, via maplibre-gl's dependency. Unit-testing the
// shape of an expression proves nothing about whether the renderer will take
// it; this is the authority that decides.
import { validateStyleMin, type StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import {
  pinsPaint,
  uncertaintyPaint,
  uncertaintyRadiusPx,
  uncertaintyRadiusExpression,
  uncertaintyBounds,
  M_PER_PX_AT_Z0,
  MAX_UNCERTAINTY_PX,
  PIN_COLOR_DONE,
  PIN_COLOR_TODO
} from './pins';

/** Walks an expression tree looking for any occurrence of `["zoom"]`. */
function mentionsZoom(node: unknown): boolean {
  if (!Array.isArray(node)) return false;
  if (node.length === 1 && node[0] === 'zoom') return true;
  return node.some(mentionsZoom);
}

describe('pins paint', () => {
  const paint = pinsPaint();

  it('drives circle-opacity from coordsSource, so an approximate pin reads hollow', () => {
    // The always-visible honesty signal: a surveyed pin is filled, an area
    // centroid is not, at every zoom and whether or not it is selected.
    expect(JSON.stringify(paint['circle-opacity'])).toContain('coordsSource');
    expect(JSON.stringify(paint['circle-opacity'])).toContain('area-approx');
  });

  it('fills a surveyed pin and empties an approximate one', () => {
    const opacity = JSON.stringify(paint['circle-opacity']);
    // ['case', <is approx>, 0, 1] -- the approx branch is the transparent one.
    expect(opacity).toBe(JSON.stringify(['case', ['==', ['get', 'coordsSource'], 'area-approx'], 0, 1]));
  });

  it('gives a hollow pin a coloured stroke, or it would be invisible', () => {
    // The default stroke is white, which on a light basemap plus a transparent
    // fill would leave nothing to see at all.
    const stroke = JSON.stringify(paint['circle-stroke-color']);
    expect(stroke).toContain('coordsSource');
    expect(stroke).toContain(PIN_COLOR_TODO);
    expect(stroke).toContain('#fff');
  });

  it('keeps done and to-do colours on both filled and hollow pins', () => {
    const all = JSON.stringify(paint);
    expect(all).toContain(PIN_COLOR_DONE);
    expect(all).toContain(PIN_COLOR_TODO);
  });

  it('still grows the pin when it is hovered or selected', () => {
    expect(JSON.stringify(paint['circle-radius'])).toContain('active');
  });
});

describe('uncertainty radius', () => {
  it('converts metres to pixels at this latitude, doubling every zoom level', () => {
    // radius_px = accuracyM x 2^zoom / 129774
    expect(uncertaintyRadiusPx(3911, 12)).toBeCloseTo((3911 * 2 ** 12) / M_PER_PX_AT_Z0, 6);
    expect(uncertaintyRadiusPx(1000, 11) * 2).toBeCloseTo(uncertaintyRadiusPx(1000, 12), 6);
  });

  it('uses the metres-per-pixel constant for ~34 degrees south, not the equator', () => {
    // 156543.03 x cos(34 degrees). Getting the equatorial value by mistake
    // would draw every circle ~21% too small, so this is what the test is
    // really guarding -- a 0.1% band, not the exact rounding of the constant.
    const atRegion = 156543.03 * Math.cos((34 * Math.PI) / 180);
    expect(Math.abs(M_PER_PX_AT_Z0 - atRegion) / atRegion).toBeLessThan(0.001);
    expect(M_PER_PX_AT_Z0).toBeLessThan(156543.03 * 0.9);
  });

  it('caps the drawn radius so an extreme zoom cannot ask for an absurd quad', () => {
    // 5.5 km at z22 is ~1.4 million pixels uncapped.
    expect(uncertaintyRadiusPx(5500, 22)).toBe(MAX_UNCERTAINTY_PX);
  });

  it('sets the cap past any viewport diagonal, so it never clips a visible edge', () => {
    // The cap is a guard against absurd geometry, NOT a way to shrink an honest
    // circle: below it the circle is exactly as big as the uncertainty is.
    expect(MAX_UNCERTAINTY_PX).toBeGreaterThan(2560);
  });

  it('leaves a circle framed at its own bounds well under the cap', () => {
    // The camera frames an approximate route on uncertaintyBounds (see MapView),
    // which lands the radius at roughly a third of the pane -- a few hundred
    // pixels. The cap must not be reaching into that.
    expect(uncertaintyRadiusPx(3911, 13)).toBeLessThan(MAX_UNCERTAINTY_PX);
  });
});

describe('uncertainty radius expression', () => {
  const expr = uncertaintyRadiusExpression();

  it('feeds zoom to an outermost interpolate, which the style spec requires', () => {
    // ["zoom"] may only appear as the input to a top-level "step"/"interpolate"
    // in a paint property. The natural-looking ['min', <maths on ['zoom']>, cap]
    // is REJECTED by MapLibre, which is why this is stops rather than arithmetic.
    expect(expr[0]).toBe('interpolate');
    expect(expr[1]).toEqual(['exponential', 2]);
    expect(expr[2]).toEqual(['zoom']);
  });

  it('mentions zoom exactly once, at that input position', () => {
    const stops = expr.slice(3);
    expect(stops.some(mentionsZoom)).toBe(false);
  });

  it('agrees with the radius helper at every stop, so the two cannot drift', () => {
    const stops = expr.slice(3);
    for (let i = 0; i < stops.length; i += 2) {
      const zoom = stops[i] as number;
      const value = stops[i + 1];
      // Each stop output is ['min', <metres->px at this zoom>, cap], evaluated
      // here the same way MapLibre would.
      const [op, computed, cap] = value as [string, number, number];
      expect(op).toBe('min');
      expect(cap).toBe(MAX_UNCERTAINTY_PX);
      expect(Math.min(evalStop(computed, 3911), cap)).toBeCloseTo(
        uncertaintyRadiusPx(3911, zoom), 6
      );
    }
  });

  it('covers the whole usable zoom range', () => {
    const zooms = expr.slice(3).filter((_, i) => i % 2 === 0);
    expect(zooms[0]).toBe(0);
    expect(zooms[zooms.length - 1]).toBe(22);
  });
});

/** Evaluates ['/', ['*', ['get','coordsAccuracyM'], 2^z], M] against one accuracy. */
function evalStop(node: unknown, accuracyM: number): number {
  if (typeof node === 'number') return node;
  if (!Array.isArray(node)) throw new Error(`unexpected node: ${JSON.stringify(node)}`);
  const [op, ...args] = node as [string, ...unknown[]];
  if (op === 'get') return accuracyM;
  const vals = args.map((a) => evalStop(a, accuracyM));
  if (op === '*') return vals[0] * vals[1];
  if (op === '/') return vals[0] / vals[1];
  if (op === 'min') return Math.min(...vals);
  throw new Error(`unexpected operator: ${op}`);
}

describe('paint accepted by the real MapLibre style validator', () => {
  const styleWith = (paint: unknown): StyleSpecification =>
    ({
      version: 8,
      sources: { s: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } } },
      layers: [{ id: 'l', type: 'circle', source: 's', paint }]
    }) as StyleSpecification;

  const messages = (paint: unknown) => validateStyleMin(styleWith(paint)).map((e) => e.message);

  it('validates the uncertainty paint', () => {
    expect(messages(uncertaintyPaint())).toEqual([]);
  });

  it('validates the pins paint', () => {
    expect(messages(pinsPaint())).toEqual([]);
  });

  it('rejects the arithmetic form of the radius, which is why stops exist at all', () => {
    // This is the expression the formula reads like, and it is invalid. Keeping
    // the proof here means the comment in pins.ts can never quietly rot into a
    // claim nobody checks.
    const naive = [
      'min',
      ['/', ['*', ['get', 'coordsAccuracyM'], ['^', 2, ['zoom']]], M_PER_PX_AT_Z0],
      140
    ];
    expect(messages({ 'circle-radius': naive }).join(' ')).toContain(
      'may only be used as input to a top-level "step" or "interpolate"'
    );
  });
});

describe('uncertainty layer paint', () => {
  const paint = uncertaintyPaint();

  it('sizes the circle from the route radius rather than a fixed pixel size', () => {
    expect(JSON.stringify(paint['circle-radius'])).toContain('coordsAccuracyM');
  });

  it('is translucent enough to read the map through', () => {
    expect(paint['circle-opacity']).toBeLessThan(0.3);
  });
});

describe('uncertaintyBounds', () => {
  const centre = { lon: 18.4, lat: -33.96 };

  it('returns a box that contains the whole circle', () => {
    const [[west, south], [east, north]] = uncertaintyBounds(centre.lon, centre.lat, 3911);
    expect(west).toBeLessThan(centre.lon);
    expect(east).toBeGreaterThan(centre.lon);
    expect(south).toBeLessThan(centre.lat);
    expect(north).toBeGreaterThan(centre.lat);
  });

  it('spans about two radii north to south', () => {
    const [[, south], [, north]] = uncertaintyBounds(centre.lon, centre.lat, 3911);
    // 1 degree of latitude is ~111320 m everywhere.
    expect(((north - south) / 2) * 111320).toBeCloseTo(3911, 0);
  });

  it('widens the longitude span to match, since a degree of longitude is shorter here', () => {
    // At 34 degrees south a degree of longitude covers only ~83% of the ground a
    // degree of latitude does, so an equal-degree box would be an ellipse that
    // clips the circle east and west.
    const [[west, south], [east, north]] = uncertaintyBounds(centre.lon, centre.lat, 3911);
    expect(east - west).toBeGreaterThan(north - south);
    const metresPerDegLon = 111320 * Math.cos((centre.lat * Math.PI) / 180);
    expect(((east - west) / 2) * metresPerDegLon).toBeCloseTo(3911, 0);
  });
});
