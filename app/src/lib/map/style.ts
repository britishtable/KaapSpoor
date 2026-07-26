import type { StyleSpecification } from 'maplibre-gl';

export type Basemap = 'opentopo' | 'selfhosted';

export const ATTRIBUTION_OSM = '© OpenStreetMap contributors';
const ATTRIBUTION_OPENTOPO = `${ATTRIBUTION_OSM}, © <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)`;
const ATTRIBUTION_SELF = `${ATTRIBUTION_OSM}, contours from Copernicus DEM`;

// Free, keyless font endpoint. Both basemaps share it so switching cannot
// silently drop every label.
const GLYPHS = 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf';

function openTopo(): StyleSpecification {
  return {
    version: 8,
    glyphs: GLYPHS,
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
    glyphs: GLYPHS,
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
        id: 'contours',
        type: 'line',
        source: 'contours',
        'source-layer': 'contours',
        paint: {
          'line-color': '#b08968',
          // Indexed 100 m lines read heavier than the 20 m intermediates.
          'line-width': ['case', ['==', ['%', ['get', 'ele'], 100], 0], 1.1, 0.5],
          'line-opacity': 0.7
        }
      },
      {
        id: 'roads',
        type: 'line',
        source: 'trails',
        'source-layer': 'roads',
        paint: { 'line-color': '#cfc7bb', 'line-width': 1.5 }
      },
      {
        id: 'paths',
        type: 'line',
        source: 'trails',
        'source-layer': 'paths',
        paint: { 'line-color': '#8a5a3b', 'line-width': 1.2, 'line-dasharray': [3, 2] }
      },
      {
        id: 'peaks',
        type: 'symbol',
        source: 'trails',
        'source-layer': 'peaks',
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Open Sans Regular'],
          'text-size': 11,
          'text-offset': [0, 0.8]
        },
        paint: { 'text-color': '#5b4636', 'text-halo-color': '#fff', 'text-halo-width': 1.2 }
      }
    ]
  };
}

export function buildStyle(basemap: Basemap, base: string): StyleSpecification {
  return basemap === 'opentopo' ? openTopo() : selfHosted(base);
}
