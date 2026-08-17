/**
 * Lets the /draw editor write data/route-lines.geojson directly.
 *
 * Registered with `apply: 'serve'`, so it exists under `npm run dev` and never
 * in a build — the deployed site is static files and has no endpoint at all.
 * Without this the author would download a file and move it into place by hand
 * after every route, which is the difference between drawing 184 routes and
 * not bothering.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';
import type { RouteLineFeature } from './src/lib/draw/state';
import { openDem, type Dem } from './dem-sample';

const FILE = resolve(process.cwd(), '..', 'data', 'route-lines.geojson');

/** Where the DEM lives. Copy it out of the tiles work directory once. */
const DEM = process.env.KAAPSPOOR_DEM ?? resolve(process.cwd(), '..', 'data', 'dem', 'dem-cape-town.tif');

/**
 * Heights for every coordinate of every line, written as the third ordinate.
 *
 * Sampled here, once, rather than in the reader's browser: the line does not
 * move after it is drawn, so neither do its numbers.
 */
export function elevate(features: RouteLineFeature[], dem: Dem | null): RouteLineFeature[] {
  if (!dem) return features;
  return features.map((feature) => ({
    ...feature,
    geometry: {
      ...feature.geometry,
      coordinates: feature.geometry.coordinates.map((position) => {
        const [lon, lat] = position;
        const elevation = dem.sample(lon, lat);
        // A point outside the model keeps two ordinates rather than a made-up
        // height; profile.ts renders nothing rather than a wrong shape.
        return elevation === null ? [lon, lat] : [lon, lat, elevation];
      })
    }
  }));
}

/** The whole collection after saving one route's variants over its old ones. */
export function saveRouteLines(
  existing: RouteLineFeature[],
  incoming: RouteLineFeature[],
  routeId: string
): RouteLineFeature[] {
  const others = existing.filter((f) => f.properties.routeId !== routeId);
  return [...others, ...incoming].sort((a, b) =>
    a.properties.routeId.localeCompare(b.properties.routeId)
  );
}

export function routeLinesPlugin(): Plugin {
  return {
    name: 'kaapspoor-route-lines',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__route-lines', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('POST only');
          return;
        }
        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', async () => {
          try {
            const { routeId, features } = JSON.parse(body) as {
              routeId: string;
              features: RouteLineFeature[];
            };
            const existing = existsSync(FILE)
              ? (JSON.parse(readFileSync(FILE, 'utf-8')).features as RouteLineFeature[])
              : [];
            const dem = await openDem(DEM);
            const merged = saveRouteLines(existing, elevate(features, dem), routeId);
            writeFileSync(
              FILE,
              JSON.stringify({ type: 'FeatureCollection', features: merged }, null, 1) + '\n',
              'utf-8'
            );
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ saved: features.length, total: merged.length }));
          } catch (err) {
            res.statusCode = 500;
            res.end(String(err));
          }
        });
      });
    }
  };
}
