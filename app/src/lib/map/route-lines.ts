import type { FilterSpecification, LineLayerSpecification } from 'maplibre-gl';
import type { LineString, MultiLineString } from 'geojson';
import { PIN_COLOR_DONE, PIN_COLOR_TODO } from './pins';

/**
 * The route's own line — from an OSM hiking relation, or stitched by walking
 * the paths its description names in order. See
 * docs/superpowers/specs/2026-08-16-phase4d-route-geometry-design.md.
 *
 * Drawn in the PIN COLOURS, unlike Phase 4e's mentioned paths: this is the
 * route, and colouring it as the pin says so without needing a legend.
 */
export const ROUTE_LINE_SOURCE = 'route-lines';

/**
 * Casing first so it draws underneath; the active variant last so it draws on
 * top of its siblings.
 */
export const ROUTE_LINE_LAYERS = ['route-line-casing', 'route-line', 'route-line-active'] as const;

/**
 * Match one route's line. An empty list matches nothing, which is how the
 * unselected state is expressed — the layers exist from style load and only
 * their filter changes, exactly as the named-path tiers do.
 */
export function routeLineFilter(routeId: string | null): FilterSpecification {
  return ['in', ['get', 'routeId'], ['literal', routeId ? [routeId] : []]];
}

export function routeLinePaint(): NonNullable<LineLayerSpecification['paint']> {
  return {
    // feature-state 'done' is set by MapView from the journal, the same signal
    // that colours the pin.
    'line-color': [
      'case',
      ['boolean', ['feature-state', 'done'], false],
      PIN_COLOR_DONE,
      PIN_COLOR_TODO
    ],
    'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2.5, 16, 5],
    // Sits back, because an entry may draw several of these at once and all of
    // them at full strength reads as a tangle rather than as choices.
    'line-opacity': 0.55
  };
}

/**
 * Match one route AND one variant. Both halves matter: variant names repeat
 * across entries — several routes have a "Right Hand" — so filtering on the
 * name alone would light a line on another mountain.
 */
export function activeVariantFilter(
  routeId: string | null,
  variant: string | null
): FilterSpecification {
  if (!routeId || !variant) return ['in', ['get', 'variant'], ['literal', []]];
  return [
    'all',
    ['in', ['get', 'routeId'], ['literal', [routeId]]],
    ['in', ['get', 'variant'], ['literal', [variant]]]
  ];
}

/** The variant the reader is pointing at: same colour, fully present. */
export function routeLineActivePaint(): NonNullable<LineLayerSpecification['paint']> {
  return {
    'line-color': [
      'case',
      ['boolean', ['feature-state', 'done'], false],
      PIN_COLOR_DONE,
      PIN_COLOR_TODO
    ],
    // Wider and opaque against the same colour at 0.55: the difference reads as
    // "this one" without turning the others into a different kind of thing.
    'line-width': ['interpolate', ['linear'], ['zoom'], 10, 4, 16, 7],
    'line-opacity': 1
  };
}

export function routeLineCasingPaint(): NonNullable<LineLayerSpecification['paint']> {
  return {
    'line-color': '#f4f1ea',
    'line-width': ['interpolate', ['linear'], ['zoom'], 10, 5, 16, 9],
    'line-opacity': 0.85
  };
}

/** The camera box for a drawn line, or null if there is nothing to frame. */
export function lineBounds(
  geometry: LineString | MultiLineString
): [[number, number], [number, number]] | null {
  const parts =
    geometry.type === 'LineString' ? [geometry.coordinates] : geometry.coordinates;
  const points = parts.flat();
  if (points.length === 0) return null;
  const lons = points.map((p) => p[0]);
  const lats = points.map((p) => p[1]);
  return [
    [Math.min(...lons), Math.min(...lats)],
    [Math.max(...lons), Math.max(...lats)]
  ];
}
