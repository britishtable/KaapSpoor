// maplibre-gl v6 loads its worker as a separate ESM file that Vite does not emit,
// so the map silently never becomes ready in a built site unless these are served.
// Copy from the installed package every build: a committed copy would drift out of
// sync the moment maplibre-gl is updated, and nothing would fail to warn us.
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const from = resolve(here, '../node_modules/maplibre-gl/dist');
const to = resolve(here, '../static/maplibre');
const files = ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs'];

mkdirSync(to, { recursive: true });
for (const name of files) {
  copyFileSync(resolve(from, name), resolve(to, name));
}

const { version } = JSON.parse(
  readFileSync(resolve(here, '../node_modules/maplibre-gl/package.json'), 'utf-8')
);
console.log(`maplibre worker: copied ${files.length} files from maplibre-gl@${version}`);
