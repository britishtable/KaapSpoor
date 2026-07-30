import type { StyleSpecification } from 'maplibre-gl';

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
        url: `pmtiles://${base}/tiles/trails.pmtiles`,
        attribution: ATTRIBUTION_SELF
      },
      contours: {
        type: 'vector',
        url: `pmtiles://${base}/tiles/contours.pmtiles`,
        attribution: ATTRIBUTION_SELF
      }
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#f4f1ea' } },
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
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.6, 13, 1.1, 16, 1.8],
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
          'line-width': ['interpolate', ['linear'], ['zoom'], 13, 0.4, 16, 0.8],
          'line-opacity': 0.55
        }
      },
      {
        // Roads earn their place at region scale — they are how you find a
        // trailhead — but hairline-thin until you are close.
        id: 'roads',
        type: 'line',
        source: 'trails',
        'source-layer': 'roads',
        minzoom: 9,
        paint: {
          'line-color': '#cfc7bb',
          'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0.5, 12, 1.2, 16, 3]
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
        // The summits a person actually navigates by. `ele` is the raw OSM tag,
        // so it is a string and may be unconvertible — to-number's second
        // argument is the fallback, and 0 sorts such peaks into the minor layer.
        id: 'peaks-major',
        type: 'symbol',
        source: 'trails',
        'source-layer': 'peaks',
        minzoom: 10,
        filter: ['>=', ['to-number', ['get', 'ele'], 0], 1000],
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
      }
    ]
  };
}

export function buildStyle(basemap: Basemap, base: string): StyleSpecification {
  return basemap === 'opentopo' ? openTopo(base) : selfHosted(base);
}
