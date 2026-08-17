/**
 * Re-samples every line already in data/route-lines.geojson against the DEM.
 *
 * `npm run draw -- --elevate` invokes this. It exists as its own tsx script,
 * rather than as logic inlined in draw.mjs, because draw.mjs is plain .mjs
 * and cannot import TypeScript -- and this repo already runs `tsx
 * scripts/transform.ts` for `build:data`, so the pattern is established.
 *
 * Reuses openDem() and elevate() from the dev-server middleware rather than
 * re-implementing sampling here, so there is one implementation of "what a
 * saved line's heights look like", exercised by both the Save button and
 * this re-run. This exact code path is what was hand-run to elevate the
 * four routes drawn before the DEM was wired in (158/75/65/154 points).
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDem } from '../dem-sample';
import { elevate, FILE, DEM } from '../vite-plugin-route-lines';
import type { RouteLineFeature } from '../src/lib/draw/state';

async function main() {
  if (!existsSync(FILE)) {
    console.error(`No route lines at ${FILE} -- nothing to sample.`);
    process.exitCode = 1;
    return;
  }

  const dem = await openDem(DEM);
  if (!dem) {
    console.error(`Could not open the DEM at ${DEM}.`);
    console.error('Set KAAPSPOOR_DEM, or copy the tile-build DEM into data/dem/.');
    process.exitCode = 1;
    return;
  }

  const collection = JSON.parse(readFileSync(FILE, 'utf-8')) as {
    features: RouteLineFeature[];
  };
  const sampled = elevate(collection.features, dem);

  writeFileSync(
    FILE,
    JSON.stringify({ type: 'FeatureCollection', features: sampled }, null, 1) + '\n',
    'utf-8'
  );

  console.log(`Sampled against ${DEM}:\n`);
  for (const feature of sampled) {
    const label = feature.properties.variant
      ? `${feature.properties.routeId} (${feature.properties.variant})`
      : feature.properties.routeId;
    const withHeight = feature.geometry.coordinates.filter((c) => c.length === 3).length;
    console.log(`  ${label}: ${withHeight}/${feature.geometry.coordinates.length} points sampled`);
  }
  console.log(`\n${sampled.length} line(s) written to ${FILE}.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();
