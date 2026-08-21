import type { FilterSpecification, LineLayerSpecification, SymbolLayerSpecification } from 'maplibre-gl';
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
 * Match the segments the reader's plan is made of.
 *
 * A segment id already carries its routeId, so unlike the variant filter this
 * replaced there is nothing to pair it with: variant names repeated across
 * entries — several routes had a "Right Hand" — and matching on the name alone
 * lit a line on another mountain. Ids cannot do that.
 */
export function activeSegmentFilter(segmentIds: string[]): FilterSpecification {
  return ['in', ['get', 'segmentId'], ['literal', segmentIds]];
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

/** The id the arrow image is registered under, via map.addImage(). */
export const ARROW_IMAGE = 'route-arrow';

/**
 * A small chevron pointing along the line, drawn pixel by pixel.
 *
 * An IMAGE, not a glyph: only Open Sans Regular ships, and `text-font` governs
 * text. Building it here rather than shipping a PNG keeps it in the same file
 * as the colours it has to match.
 */
export function arrowImage(size = 16): ImageData {
  const data = new Uint8ClampedArray(size * size * 4);
  const put = (x: number, y: number) => {
    const at = (y * size + x) * 4;
    data[at] = 255;
    data[at + 1] = 255;
    data[at + 2] = 255;
    data[at + 3] = 255;
  };
  // A chevron: two strokes trailing back from a single vertex at the
  // LEADING (high-y) edge — the image's own +y axis is "forward", not +x.
  //
  // Measured in a real browser (Chromium via Playwright), not assumed: with
  // symbol-placement: 'line' and icon-rotation-alignment: 'map', MapLibre's
  // zero-rotation reference is the icon's own +y axis (screen-down when
  // unrotated), not +x. An earlier version of this function drew the vertex
  // at high x, which on an east-running line rendered a chevron pointing
  // due north (perpendicular to the line, 90 degrees off) and on a
  // south-running line rendered one pointing due east/west — confirmed on
  // two routes with near-orthogonal line segments (Lekkerwater Traverse,
  // near-horizontal; Dark Gorge, near-vertical), both showing the arrow
  // rotated 90 degrees from the line's own bearing.
  //
  // The vertex sits near y = size-1 at the horizontal centre; the strokes
  // fan out toward -y (upward) as they approach the left and right columns.
  const mid = Math.floor(size / 2);
  const tip = size - 1;
  for (let i = 0; i < mid; i++) {
    for (let t = 0; t < 2; t++) {
      const y = Math.max(0, tip - i - t);
      put(Math.max(0, mid - i), y);
      put(Math.min(size - 1, mid + i), y);
    }
  }
  // jsdom has no ImageData constructor, and this module must import cleanly
  // in unit tests (no WebGL there), so the return value is shaped like
  // ImageData rather than built with `new ImageData(...)`. The one cast this
  // plan allows: map.addImage() only cares about the shape, and a real
  // browser's map.addImage(ARROW_IMAGE, arrowImage()) is the code path that
  // proves it works.
  return { data, width: size, height: size, colorSpace: 'srgb' } as ImageData;
}

export function routeArrowLayout(): NonNullable<SymbolLayerSpecification['layout']> {
  return {
    'icon-image': ARROW_IMAGE,
    'symbol-placement': 'line',
    // Without this the arrows keep screen orientation and point the wrong way
    // as soon as the map rotates.
    'icon-rotation-alignment': 'map',
    'icon-allow-overlap': false,
    'symbol-spacing': 90,
    'icon-size': ['interpolate', ['linear'], ['zoom'], 12, 0.5, 16, 0.9]
  };
}

export function routeArrowPaint(): NonNullable<SymbolLayerSpecification['paint']> {
  return {
    // White arrows with a dark halo read on both the terracotta line and the
    // green done state, without introducing a third colour.
    'icon-halo-color': '#3f2d1d',
    'icon-halo-width': 1,
    'icon-opacity': 0.9
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
