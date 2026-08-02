import type { StyleSpecification } from 'maplibre-gl';
import { SHIPPED_REGION } from './region';

export type Basemap = 'opentopo' | 'selfhosted';

// The basemap the app actually ships. OpenTopoMap was a staging basemap while the
// map UX was built; shipping it would reintroduce an external dependency.
export const SHIPPED_BASEMAP: Basemap = 'selfhosted';

export const ATTRIBUTION_OSM = '© OpenStreetMap contributors';
const ATTRIBUTION_OPENTOPO = `${ATTRIBUTION_OSM}, © <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)`;
const ATTRIBUTION_SELF = `${ATTRIBUTION_OSM}, contours from Copernicus DEM`;

// Self-hosted glyphs. MapLibre's demotiles font server is a demo service, not
// production infrastructure — depending on it would leave the app with an
// external, rate-limitable dependency for every label. The glyph PBFs are
// fetched into app/static/fonts/ by tools/tiles/fetch-fonts.sh.
// Both basemaps share this so switching cannot silently drop every label.
const glyphs = (base: string) => `${base}/fonts/{fontstack}/{range}.pbf`;

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
        paint: { 'raster-opacity': 0.25 }
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
        // The handful of very high summits that anchor the overview — visible
        // from the opening view rather than only once you have zoomed in past
        // region scale. `ele` is the raw OSM tag, so it is a string and may be
        // unconvertible — to-number's second argument is the fallback, and 0
        // sorts such peaks into the minor layer, never here.
        id: 'peaks-headline',
        type: 'symbol',
        source: 'trails',
        'source-layer': 'peaks',
        minzoom: 7,
        filter: ['>=', ['to-number', ['get', 'ele'], 0], 1500],
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
        // The summits a person actually navigates by. `ele` is the raw OSM tag,
        // so it is a string and may be unconvertible — to-number's second
        // argument is the fallback, and 0 sorts such peaks into the minor layer.
        id: 'peaks-major',
        type: 'symbol',
        source: 'trails',
        'source-layer': 'peaks',
        minzoom: 10,
        filter: [
          'all',
          ['>=', ['to-number', ['get', 'ele'], 0], 1000],
          ['<', ['to-number', ['get', 'ele'], 0], 1500]
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
        // Everything else, including peaks with no usable `ele`. 188 of these
        // carpeted the opening view; they belong at a zoom where you are looking
        // at one mountain rather than a province.
        id: 'peaks-minor',
        type: 'symbol',
        source: 'trails',
        'source-layer': 'peaks',
        minzoom: 13,
        filter: ['<', ['to-number', ['get', 'ele'], 0], 1000],
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
      }
    ]
  };
}

export function buildStyle(basemap: Basemap, base: string): StyleSpecification {
  return basemap === 'opentopo' ? openTopo(base) : selfHosted(base);
}
