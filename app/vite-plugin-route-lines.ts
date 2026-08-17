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

const FILE = resolve(process.cwd(), '..', 'data', 'route-lines.geojson');

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
        req.on('end', () => {
          try {
            const { routeId, features } = JSON.parse(body) as {
              routeId: string;
              features: RouteLineFeature[];
            };
            const existing = existsSync(FILE)
              ? (JSON.parse(readFileSync(FILE, 'utf-8')).features as RouteLineFeature[])
              : [];
            const merged = saveRouteLines(existing, features, routeId);
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
