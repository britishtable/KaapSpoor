// Report measured tile sizes. Phase 0 taught us that projections move a lot
// once real bytes arrive, so the hosting decision waits for this number.
import { statSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dir = resolve(here, '../../app/static/tiles');
const COMMIT_THRESHOLD_MB = 50;

let total = 0;
for (const name of ['trails.pmtiles', 'contours.pmtiles']) {
  const path = resolve(dir, name);
  if (!existsSync(path)) {
    console.log(`${name}: MISSING`);
    continue;
  }
  const mb = statSync(path).size / 1024 / 1024;
  total += mb;
  console.log(`${name}: ${mb.toFixed(1)} MB`);
}
console.log(`total: ${total.toFixed(1)} MB`);
console.log(
  total <= COMMIT_THRESHOLD_MB
    ? `=> under ${COMMIT_THRESHOLD_MB} MB: commit the tiles to the repo.`
    : `=> over ${COMMIT_THRESHOLD_MB} MB: publish as a GitHub Release asset and have CI download them.`
);
