import type { FilterSpecification, StyleSpecification } from 'maplibre-gl';
import { SHIPPED_REGION } from './region';

export type Basemap = 'opentopo' | 'selfhosted';

// The basemap the app actually ships. OpenTopoMap was a staging basemap while the
// map UX was built; shipping it would reintroduce an external dependency.
export const SHIPPED_BASEMAP: Basemap = 'selfhosted';

export const ATTRIBUTION_OSM = '© OpenStreetMap contributors';
const ATTRIBUTION_OPENTOPO = `${ATTRIBUTION_OSM}, © <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)`;
const ATTRIBUTION_SELF = `${ATTRIBUTION_OSM}, elevation data from Copernicus DEM`;

// Self-hosted glyphs. MapLibre's demotiles font server is a demo service, not
// production infrastructure — depending on it would leave the app with an
// external, rate-limitable dependency for every label. The glyph PBFs are
// fetched into app/static/fonts/ by tools/tiles/fetch-fonts.sh.
// Both basemaps share this so switching cannot silently drop every label.
const glyphs = (base: string) => `${base}/fonts/{fontstack}/{range}.pbf`;

/**
 * The layers showing the paths a selected route's description names. Filtered
 * together, always: filtering the line but not its casing leaves a pale halo
 * round nothing.
 */
export const REFERENCED_PATH_LAYERS = [
  'paths-referenced-casing',
  'paths-referenced',
  'paths-referenced-label'
] as const;

/** The quiet tier labelling every path the guides name anywhere. */
export const NAMED_PATH_LAYER = 'paths-named';

/**
 * Match paths by OSM name. An empty list matches nothing, which is how the
 * unselected state is expressed — the layers exist from style load and only
 * their filter changes, so nothing is added or removed at runtime.
 */
export function pathNameFilter(names: string[]): FilterSpecification {
  return ['in', ['get', 'name'], ['literal', names]];
}

const NO_PATHS = pathNameFilter([]);

function openTopo(base: string): StyleSpecification {
  return {
    version: 8,
    glyphs: glyphs(base),
    sources: {
      basemap: {
        type: 'raster',
        tiles: ['https://a.tile.opentopomap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        maxzoom: 17,
        attribution: ATTRIBUTION_OPENTOPO
      }
    },
    layers: [{ id: 'basemap', type: 'raster', source: 'basemap' }]
  };
}

function selfHosted(base: string): StyleSpecification {
  return {
    version: 8,
    glyphs: glyphs(base),
    sources: {
      trails: {
        type: 'vector',
        url: `pmtiles://${base}/tiles/trails-${SHIPPED_REGION.id}.pmtiles`,
        attribution: ATTRIBUTION_SELF
      },
      contours: {
        type: 'vector',
        url: `pmtiles://${base}/tiles/contours-${SHIPPED_REGION.id}.pmtiles`,
        attribution: ATTRIBUTION_SELF
      },
      hillshade: {
        type: 'raster',
        url: `pmtiles://${base}/tiles/hillshade-${SHIPPED_REGION.id}.pmtiles`,
        tileSize: 256,
        // Built z9-13 by tools/tiles/build-hillshade.sh. Declaring the range
        // makes MapLibre overzoom past 13 instead of requesting absent tiles.
        minzoom: 9,
        maxzoom: 13,
        attribution: ATTRIBUTION_SELF
      },
      'region-mask': {
        type: 'geojson',
        // planetiler's --bounds decides which tiles are built, not where their
        // features end: an edge tile still carries whole roads and place
        // labels past the region, which then render on bare background. This
        // masks everything outside SHIPPED_REGION so the region reads as the
        // whole map, not a rectangle with debris around it.
        data: {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'Polygon',
            coordinates: [
              // Exterior ring: the whole world, wound counter-clockwise per
              // RFC 7946.
              [
                [-180, -85],
                [180, -85],
                [180, 85],
                [-180, 85],
                [-180, -85]
              ],
              // Hole: the shipped region, wound clockwise (the opposite of
              // the exterior) so it reads as a hole rather than a second
              // filled ring. Derived from SHIPPED_REGION.bbox, never
              // hard-coded, so a region change cannot desynchronise the mask
              // from the tiles it was built for.
              [
                [SHIPPED_REGION.bbox.west, SHIPPED_REGION.bbox.south],
                [SHIPPED_REGION.bbox.west, SHIPPED_REGION.bbox.north],
                [SHIPPED_REGION.bbox.east, SHIPPED_REGION.bbox.north],
                [SHIPPED_REGION.bbox.east, SHIPPED_REGION.bbox.south],
                [SHIPPED_REGION.bbox.west, SHIPPED_REGION.bbox.south]
              ]
            ]
          }
        }
      }
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#f4f1ea' } },
      {
        // A backdrop, not a feature layer: it gives the mountain its shape at a
        // glance while the 20 m contours stay the thing you actually read
        // elevation from. Kept low-opacity for that reason — at full strength it
        // muddies both the contours and the landcover fills above it.
        id: 'hillshade',
        type: 'raster',
        source: 'hillshade',
        paint: {
          // Relief compresses at overview zoom, where a flat 0.25 turned the
          // whole peninsula into a dark mass that buried the landcover and the
          // contours. Ramped: barely there when you are looking at the whole
          // map, full strength when you are close enough for shading to say
          // something about the ground. Verified in a browser at z10.3 and z12.5.
          //
          // Rises to full strength at z13, the top of what
          // tools/tiles/build-hillshade.sh actually builds, then decays: above
          // that MapLibre overzooms a pre-rendered raster, and the shading
          // turns to blur right where the contours and paths carry the detail.
          // Both ends verified in a browser — a flat 0.25 made the overview a
          // dark mass, and holding 0.3 above z13 smeared the close-in view.
          'raster-opacity': [
            'interpolate', ['linear'], ['zoom'],
            9, 0.08, 11, 0.15, 13, 0.3, 14, 0.12, 15, 0.03
          ]
        }
      },
      {
        // Grouped by what it is on the ground, not by which OSM tag was used:
        // scrub and heath are both fynbos here and must read as one cover type.
        // Vineyard is the single largest class in this region (296 polygons),
        // so it gets a colour of its own rather than being lumped with woodland.
        id: 'landcover',
        type: 'fill',
        source: 'trails',
        'source-layer': 'landcover',
        paint: {
          'fill-color': [
            'match',
            ['coalesce', ['get', 'natural'], ['get', 'landuse']],
            // Woodland is the darkest cover here, and the anchor the rest are
            // spaced against.
            ['wood', 'forest'], '#a9bd8c',
            // Fynbos — scrub and heath are the same vegetation on this
            // peninsula and must not read as two different covers.
            ['scrub', 'heath'], '#c3d0a6',
            // Vineyard and orchard get a warm ochre rather than a fourth green:
            // at 313 polygons combined they are the largest class, and there is
            // no lightness room left among the greens to separate them.
            ['vineyard', 'orchard'], '#e0cfa0',
            // Neutral and desaturated, so rock reads as rock beside the ochre
            // at a similar lightness.
            ['bare_rock'], '#d8d2ca',
            ['grassland'], '#dbe3bc',
            ['beach', 'sand'], '#efe4c6',
            '#ece7db'
          ],
          // Low enough that the hillshade beneath still shapes the terrain.
          'fill-opacity': 0.55
        }
      },
      {
        id: 'water',
        type: 'fill',
        source: 'trails',
        'source-layer': 'water',
        paint: { 'fill-color': '#a8c8e0' }
      },
      {
        // The 100 m index lines carry the mid zooms on their own. The archive
        // starts at z10, so that is the floor — below it there is nothing to draw.
        id: 'contours-index',
        type: 'line',
        source: 'contours',
        'source-layer': 'contours',
        minzoom: 10,
        filter: ['==', ['%', ['get', 'ele'], 100], 0],
        paint: {
          'line-color': '#b08968',
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.8, 13, 1.1, 16, 1.8],
          'line-opacity': ['interpolate', ['linear'], ['zoom'], 10, 0.45, 13, 0.7]
        }
      },
      {
        // 20 m intermediates are sub-pixel noise until you are close in, which
        // is the whole reason this is a separate layer rather than a width case.
        id: 'contours-intermediate',
        type: 'line',
        source: 'contours',
        'source-layer': 'contours',
        minzoom: 13,
        filter: ['!=', ['%', ['get', 'ele'], 100], 0],
        paint: {
          'line-color': '#b08968',
          'line-width': ['interpolate', ['linear'], ['zoom'], 13, 0.8, 16, 0.8],
          'line-opacity': 0.55
        }
      },
      {
        // Never hidden: the national routes are how you orient yourself at
        // region scale, and hiding them entirely left the opening view blank.
        // Only trunk and primary draw here — a few hundred features rather
        // than the 5,180 that made the overview unreadable.
        id: 'roads-major',
        type: 'line',
        source: 'trails',
        'source-layer': 'roads',
        filter: ['match', ['get', 'highway'], ['trunk', 'primary'], true, false],
        paint: {
          'line-color': '#cfc7bb',
          'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0.8, 9, 1.2, 12, 2, 16, 3.5]
        }
      },
      {
        // Everything below primary. These are the streets you need once you are
        // looking for a trailhead, and noise before that.
        id: 'roads-minor',
        type: 'line',
        source: 'trails',
        'source-layer': 'roads',
        minzoom: 11,
        filter: ['!', ['match', ['get', 'highway'], ['trunk', 'primary'], true, false]],
        paint: {
          'line-color': '#cfc7bb',
          'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.8, 16, 2.5]
        }
      },
      {
        // Below z12 individual footpaths are indistinguishable from each other:
        // 10,555 of them rendered at the opening view as brown speckle that
        // buried the 13 route pins. They appear once they can be followed.
        id: 'paths',
        type: 'line',
        source: 'trails',
        'source-layer': 'paths',
        minzoom: 12,
        paint: {
          'line-color': '#8a5a3b',
          'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.8, 16, 1.8],
          'line-dasharray': [3, 2]
        }
      },
      {
        // A pale casing under the referenced line. Without it the highlight is
        // hard to separate from the 100 m contours it crosses — they share a
        // hue family by design, and a brown line over brown lines reads as
        // more contour, not as emphasis.
        id: 'paths-referenced-casing',
        type: 'line',
        source: 'trails',
        'source-layer': 'paths',
        // The archive's own floor: trails-profile.yml builds paths from z11.
        // Below this there is nothing to filter, so a lower value would be a
        // highlight that silently never draws.
        minzoom: 11,
        filter: NO_PATHS,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#f4f1ea',
          'line-width': ['interpolate', ['linear'], ['zoom'], 11, 4.5, 14, 7],
          'line-opacity': 0.85
        }
      },
      {
        // The paths the selected route's description names. SOLID, where
        // ordinary paths are dashed — that contrast is the whole signal, and it
        // says "this path, emphasised" rather than "a different kind of thing".
        //
        // Deliberately NOT the pin colours: green means done and nothing else,
        // and terracotta means to-do. These paths are neither. They are what
        // the text refers to, which includes escape routes and paths merely
        // crossed — see the spec on why they are never presented as the route.
        id: 'paths-referenced',
        type: 'line',
        source: 'trails',
        'source-layer': 'paths',
        minzoom: 11,
        filter: NO_PATHS,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#6b3f24',
          'line-width': ['interpolate', ['linear'], ['zoom'], 11, 2, 14, 3.5]
        }
      },
      {
        // The quiet tier: every path the guides name somewhere, labelled once
        // you are close enough to follow one. Held to z13 — a zoom later than
        // the paths themselves — because a label needs more room than a line.
        id: 'paths-named',
        type: 'symbol',
        source: 'trails',
        'source-layer': 'paths',
        minzoom: 13,
        filter: NO_PATHS,
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Open Sans Regular'],
          'symbol-placement': 'line',
          'text-size': ['interpolate', ['linear'], ['zoom'], 13, 10, 16, 12],
          // A name repeats along its trail at this interval. Names here are
          // fragmented (Contour Path is 27 features), so each feature offers a
          // placement and collision thins them — which is ordinary topographic
          // cartography, and why text-allow-overlap must stay off.
          'symbol-spacing': 400,
          'text-max-angle': 30,
          // Lower wins a collision. The referenced tier scores 0.
          'symbol-sort-key': 1
        },
        paint: {
          'text-color': '#7a5a42',
          'text-halo-color': '#f4f1ea',
          'text-halo-width': 1.4
        }
      },
      {
        // The four highest summits on the peninsula (Table Mountain 1086 m
        // down to Devil's Peak ~1000 m), anchoring the overview from the
        // opening view. The old >=1500 m threshold was set for the Cederberg,
        // whose summits exceed 2000 m; Table Mountain is only 1086 m, so
        // nothing here ever cleared it. minzoom 8 is deliberately below any
        // plausible opening zoom — fitBounds derives that zoom from the pane
        // size, so it varies with viewport (9.92 in the Playwright pane, ~10.3
        // in a desktop browser, lower on a phone); a minzoom inside that range
        // would leave some viewports with no peak label, reproducing the
        // defect this tier exists to fix. `ele` is the raw OSM tag, so it is a
        // string and may be unconvertible — to-number's second argument is
        // the fallback, and 0 sorts such peaks into the minor layer, never
        // here.
        id: 'peaks-headline',
        type: 'symbol',
        source: 'trails',
        'source-layer': 'peaks',
        minzoom: 8,
        filter: ['>=', ['to-number', ['get', 'ele'], 0], 1000],
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Open Sans Regular'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 7, 11, 10, 13],
          'text-offset': [0, 0.8],
          // Lower sort key wins a collision, so negate elevation: the highest
          // summit in a crowded cluster is the one that keeps its label.
          'symbol-sort-key': ['-', 0, ['to-number', ['get', 'ele'], 0]]
        },
        paint: { 'text-color': '#5b4636', 'text-halo-color': '#fff', 'text-halo-width': 1.2 }
      },
      {
        // The mid tier: ~18 summits between 600 m and 1000 m, including
        // Lion's Head (669 m). Drawn from z12, where you are looking at one
        // mountain rather than the whole peninsula. `ele` is the raw OSM tag,
        // so it is a string and may be unconvertible — to-number's second
        // argument is the fallback, and 0 sorts such peaks into the minor layer.
        id: 'peaks-major',
        type: 'symbol',
        source: 'trails',
        'source-layer': 'peaks',
        minzoom: 12,
        filter: [
          'all',
          ['>=', ['to-number', ['get', 'ele'], 0], 600],
          ['<', ['to-number', ['get', 'ele'], 0], 1000]
        ],
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Open Sans Regular'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 10, 10, 15, 13],
          'text-offset': [0, 0.8],
          // Lower sort key wins a collision, so negate elevation: the highest
          // summit in a crowded cluster is the one that keeps its label.
          'symbol-sort-key': ['-', 0, ['to-number', ['get', 'ele'], 0]]
        },
        paint: { 'text-color': '#5b4636', 'text-halo-color': '#fff', 'text-halo-width': 1.2 }
      },
      {
        // Everything under 600 m, plus peaks with no usable `ele` (which score
        // 0 via the to-number fallback). ~55 of these on the peninsula; they
        // belong at a zoom where you are looking at one mountain, not the
        // whole map.
        id: 'peaks-minor',
        type: 'symbol',
        source: 'trails',
        'source-layer': 'peaks',
        minzoom: 14,
        filter: ['<', ['to-number', ['get', 'ele'], 0], 600],
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Open Sans Regular'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 13, 10, 16, 12],
          'text-offset': [0, 0.8],
          'symbol-sort-key': ['-', 0, ['to-number', ['get', 'ele'], 0]]
        },
        paint: { 'text-color': '#5b4636', 'text-halo-color': '#fff', 'text-halo-width': 1.2 }
      },
      {
        // 14 features in this region against suburb's 231 — the density that
        // makes an overview readable. This is what orients the map; peak labels
        // cannot, because route cluster badges outrank them in symbol collision.
        id: 'places-settlement',
        type: 'symbol',
        source: 'trails',
        'source-layer': 'places',
        // Below 7, zoomed out past the region, its 14 labels stack into a few
        // pixels over empty background at the lowest text-size stop — the
        // mirror image of the reason peaks-headline is floored at 8. 7 sits
        // below every measured opening zoom (9.92 in the Playwright viewport,
        // 10.3 in a desktop browser, lower on a phone), so it still labels
        // the opening view on any device.
        minzoom: 7,
        filter: ['match', ['get', 'place'], ['city', 'town', 'village'], true, false],
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Open Sans Regular'],
          'text-size': [
            'interpolate', ['linear'], ['zoom'],
            9, ['match', ['get', 'place'], 'city', 14, 'town', 11, 9],
            14, ['match', ['get', 'place'], 'city', 20, 'town', 16, 13]
          ],
          // Lower wins a collision, so rank city above town above village.
          'symbol-sort-key': ['match', ['get', 'place'], 'city', 0, 'town', 1, 2],
          'text-padding': 6
        },
        paint: {
          'text-color': '#4a4a4a',
          'text-halo-color': '#f4f1ea',
          'text-halo-width': 1.6
        }
      },
      {
        // 231 features. Useful once you are looking for a trailhead in a
        // particular suburb, overwhelming at any zoom before that.
        id: 'places-suburb',
        type: 'symbol',
        source: 'trails',
        'source-layer': 'places',
        minzoom: 13,
        filter: ['==', ['get', 'place'], 'suburb'],
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Open Sans Regular'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 13, 10, 16, 12],
          'text-padding': 4
        },
        paint: {
          'text-color': '#6b6b6b',
          'text-halo-color': '#f4f1ea',
          'text-halo-width': 1.4
        }
      },
      {
        // Placed after every other label on purpose. MapLibre places LATER
        // symbol layers FIRST, so lateness is what wins a collision: the paths
        // a selected route names must outrank a suburb or a minor peak. It
        // still loses to the route pins, which MapView appends at runtime after
        // the whole style — which is why the line beneath, and the panel text,
        // carry the information this label only decorates.
        id: 'paths-referenced-label',
        type: 'symbol',
        source: 'trails',
        'source-layer': 'paths',
        minzoom: 12,
        filter: NO_PATHS,
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Open Sans Regular'],
          'symbol-placement': 'line',
          'text-size': ['interpolate', ['linear'], ['zoom'], 12, 11, 16, 14],
          'symbol-spacing': 250,
          // 45 (MapLibre's default), NOT the quiet tier's 30. Measured in the
          // browser at z15 on the Pipe Track: at 30 this layer placed ZERO
          // labels while `paths-named` placed the same name fine — bigger text
          // advances further per glyph around a bend, so the same mountain
          // path breaches the same angle limit only at this tier's size. The
          // effect was the promotion running backwards: the pale tier labelled
          // the selected route's path and the strong one drew nothing.
          'text-max-angle': 45,
          'symbol-sort-key': 0
        },
        paint: {
          // Darker than the quiet tier, with a heavier halo. Only Open Sans
          // Regular ships (tools/tiles/fetch-fonts.sh fetches one stack), so
          // weight is not available to separate these — size, darkness and
          // halo do that work.
          'text-color': '#4a2c18',
          'text-halo-color': '#f4f1ea',
          'text-halo-width': 1.8
        }
      },
      {
        // Last, so it draws over every basemap layer above -- including the
        // roads and place labels that leak past the region on an edge tile.
        // Route pins are added by MapView.svelte at runtime via addLayer(),
        // which always appends to the end of the current layer stack, so they
        // land above this and are never covered by it.
        id: 'region-mask',
        type: 'fill',
        source: 'region-mask',
        // 20 points darker than the #f4f1ea background: distinct enough to
        // read as deliberate letterboxing, not heavy enough to look like a
        // separate map.
        paint: { 'fill-color': '#e0dbd0' }
      }
    ]
  };
}

export function buildStyle(basemap: Basemap, base: string): StyleSpecification {
  return basemap === 'opentopo' ? openTopo(base) : selfHosted(base);
}
