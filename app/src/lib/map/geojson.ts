import type { RouteIndexEntry } from '$lib/data/types';

export interface RoutePinProps {
  id: string;
  title: string;
  grade: string | null;
}

export function routesToGeoJSON(
  entries: RouteIndexEntry[]
): GeoJSON.FeatureCollection<GeoJSON.Point, RoutePinProps> {
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

export function boundsOf(
  entries: RouteIndexEntry[]
): [[number, number], [number, number]] | null {
  const located = entries.filter((e) => e.coords !== null);
  if (located.length === 0) return null;
  const lons = located.map((e) => e.coords!.lon);
  const lats = located.map((e) => e.coords!.lat);
  return [
    [Math.min(...lons), Math.min(...lats)],
    [Math.max(...lons), Math.max(...lats)]
  ];
}
