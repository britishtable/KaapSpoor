import type { RouteIndexEntry } from '$lib/data/types';
import type { FeatureCollection, Point } from 'geojson';

export interface RoutePinProps {
  id: string;
  title: string;
  grade: string | null;
}

export function routesToGeoJSON(
  entries: RouteIndexEntry[]
): FeatureCollection<Point, RoutePinProps> {
  return {
    type: 'FeatureCollection',
    features: entries
      .filter((e) => e.coords !== null)
      .map((e) => ({
        type: 'Feature',
        // MapLibre requires a feature id to drive feature-state (done styling).
        id: e.id,
        geometry: { type: 'Point', coordinates: [e.coords!.lon, e.coords!.lat] },
        properties: { id: e.id, title: e.title, grade: e.grade }
      }))
  };
}

// The basemap's tile bbox (tools/tiles/bbox.json). Routes outside it pin over
// blank background, and including them in the opening view zooms the map so far
// out that nothing else renders — measured at z6.9 desktop, z4.7 mobile. They
// stay pinned and findable; they just do not get to frame the map.
// Plan 2 widens the tile bbox east to 24.0, at which point Otter and Robberg
// come inside it and rejoin the framing automatically.
export const BASEMAP_BOUNDS = { west: 17.8, south: -34.5, east: 20.9, north: -32.4 };

export function boundsOf(
  entries: RouteIndexEntry[]
): [[number, number], [number, number]] | null {
  const located = entries.filter((e) => e.coords !== null);
  if (located.length === 0) return null;

  const withinBasemap = located.filter(
    (e) =>
      e.coords!.lon >= BASEMAP_BOUNDS.west &&
      e.coords!.lon <= BASEMAP_BOUNDS.east &&
      e.coords!.lat >= BASEMAP_BOUNDS.south &&
      e.coords!.lat <= BASEMAP_BOUNDS.north
  );
  // Fall back to every located route only if none are within the basemap --
  // an all-outside set should still frame on *something* rather than opening
  // on nothing (the null case is reserved for zero located routes at all).
  const framing = withinBasemap.length > 0 ? withinBasemap : located;

  const lons = framing.map((e) => e.coords!.lon);
  const lats = framing.map((e) => e.coords!.lat);
  return [
    [Math.min(...lons), Math.min(...lats)],
    [Math.max(...lons), Math.max(...lats)]
  ];
}
