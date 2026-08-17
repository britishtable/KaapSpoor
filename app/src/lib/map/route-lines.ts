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

/** Casing first: it must draw underneath the line it lifts off the contours. */
export const ROUTE_LINE_LAYERS = ['route-line-casing', 'route-line'] as const;

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
    'line-opacity': 0.9
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
