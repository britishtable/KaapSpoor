import type { CircleLayerSpecification, ExpressionSpecification } from 'maplibre-gl';

/**
 * How a route's position is drawn.
 *
 * Two separate signals, deliberately:
 *
 *  - The **hollow pin** is permanent. An `area-approx` route is an area centroid,
 *    not a surveyed point, and it must be distinguishable from one at a glance
 *    at every zoom whether or not it is selected.
 *  - The **uncertainty circle** is drawn for the selected route only. The 31
 *    area-approx routes in this region sit on just 9 centroids (7 stacked on
 *    one), with radii of 2.0-5.5 km over a peninsula ~20 km wide, so permanent
 *    circles would be nine overlapping discs covering most of the map -- an
 *    opaque soup that obscures everything and says nothing. A circle is an
 *    explanation of a selection: you pick a route, and the map shows you how
 *    loosely it knows where that route is.
 */

export const PIN_COLOR_DONE = '#4a6741';
export const PIN_COLOR_TODO = '#c1663f';

/** True for a route positioned at an area centroid rather than a surveyed point. */
const IS_APPROX: ExpressionSpecification = ['==', ['get', 'coordsSource'], 'area-approx'];

/** Done routes read differently from to-do ones, hollow or filled alike. */
const ROUTE_COLOR: ExpressionSpecification = [
  'case',
  ['boolean', ['feature-state', 'done'], false],
  PIN_COLOR_DONE,
  PIN_COLOR_TODO
];

export function pinsPaint(): NonNullable<CircleLayerSpecification['paint']> {
  return {
    'circle-color': ROUTE_COLOR,
    // Hover/selection grows the pin.
    'circle-radius': ['case', ['boolean', ['feature-state', 'active'], false], 9, 6],
    // The hollow pin itself: an approximate position gets no fill.
    'circle-opacity': ['case', IS_APPROX, 0, 1],
    // ...which means the stroke has to carry the colour. Left white (the
    // filled pin's outline) a hollow pin would be a white ring on a pale
    // basemap -- invisible, and the honesty signal lost with it.
    'circle-stroke-color': ['case', IS_APPROX, ROUTE_COLOR, '#fff'],
    'circle-stroke-width': ['case', IS_APPROX, 2, 1.5]
  };
}

/**
 * Metres per pixel at zoom 0: 156543.03 x cos(latitude), which at this region's
 * centre (~34 degrees south) is ~129774.
 *
 * ASSUMPTION, and it is only safe here: cos(latitude) is treated as a constant.
 * The region spans 0.44 degrees of latitude (-33.89 to -34.33), over which
 * cos varies by 0.53% -- well under a percent, and far below what any reader
 * could perceive in a circle several kilometres across. A region spanning many
 * degrees would need latitude in the expression instead of this constant.
 */
export const M_PER_PX_AT_Z0 = 129774;

/**
 * Ceiling on the drawn radius, in CSS pixels.
 *
 * This is a guard against absurd geometry, NOT a way to shrink an honest
 * circle: 5.5 km at z22 asks for ~1.4 million pixels. It sits past the diagonal
 * of any viewport it could be drawn in, so it can never clip an edge a reader
 * would otherwise have seen -- below it, the circle is exactly as big as the
 * uncertainty is, which is the whole point of drawing it.
 *
 * A tight cap (~140px) was considered and rejected: the camera frames a
 * selected approximate route on its own uncertainty bounds, which puts the
 * radius at a few hundred pixels, so a tight cap would clamp every circle to
 * the same size and quietly assert that a 2 km guess and a 5.5 km guess are
 * equally good.
 */
export const MAX_UNCERTAINTY_PX = 4096;

const MAX_ZOOM_STOP = 22;

/** radius_px = accuracyM x 2^zoom / 129774, capped. */
export function uncertaintyRadiusPx(accuracyM: number, zoom: number): number {
  return Math.min((accuracyM * 2 ** zoom) / M_PER_PX_AT_Z0, MAX_UNCERTAINTY_PX);
}

/**
 * The same conversion as a paint expression.
 *
 * It has to be an `interpolate` over zoom stops rather than the arithmetic the
 * formula suggests, because the style spec allows `["zoom"]` in a paint
 * property ONLY as the input to an outermost `step`/`interpolate` -- MapLibre
 * rejects `['min', <maths involving ['zoom']>, cap]` outright.
 *
 * An exponential interpolation with base 2 between per-zoom stops is exact, not
 * an approximation: interpolating base-2 between v(z1) and v(z2) of a value
 * that doubles per zoom level reproduces it exactly at every point in between.
 * Capping each stop rather than wrapping the whole expression keeps the cap
 * inside the outermost-interpolate rule, and cannot overshoot: interpolation
 * between two capped stops stays between them.
 */
export function uncertaintyRadiusExpression(): ExpressionSpecification {
  const stops: unknown[] = [];
  for (let z = 0; z <= MAX_ZOOM_STOP; z++) {
    stops.push(z, [
      'min',
      ['/', ['*', ['get', 'coordsAccuracyM'], 2 ** z], M_PER_PX_AT_Z0],
      MAX_UNCERTAINTY_PX
    ]);
  }
  return ['interpolate', ['exponential', 2], ['zoom'], ...stops] as ExpressionSpecification;
}

export function uncertaintyPaint(): NonNullable<CircleLayerSpecification['paint']> {
  return {
    'circle-radius': uncertaintyRadiusExpression(),
    'circle-color': PIN_COLOR_TODO,
    // Faint enough to read the terrain underneath: this qualifies the pin, it
    // does not replace the map.
    'circle-opacity': 0.12,
    'circle-stroke-color': PIN_COLOR_TODO,
    'circle-stroke-width': 1,
    'circle-stroke-opacity': 0.5
  };
}

/** 1 degree of latitude, in metres. Near enough constant everywhere. */
const M_PER_DEG_LAT = 111320;

/**
 * The lat/lon box enclosing an accuracy circle, for framing the camera on it.
 *
 * The longitude span is widened by 1/cos(lat): at 34 degrees south a degree of
 * longitude covers only ~83% of the ground a degree of latitude does, so an
 * equal-degree box would clip the circle east and west.
 */
export function uncertaintyBounds(
  lon: number,
  lat: number,
  accuracyM: number
): [[number, number], [number, number]] {
  const dLat = accuracyM / M_PER_DEG_LAT;
  const dLon = accuracyM / (M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180));
  return [
    [lon - dLon, lat - dLat],
    [lon + dLon, lat + dLat]
  ];
}
