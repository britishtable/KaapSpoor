// Report measured tile sizes per region. Phase 0 taught us that projections
// move a lot once real bytes arrive, so the hosting decision waits for this
// number. Hillshade is the only raster archive and the only one that could
// threaten the 1 GB budget, so it gets its own gate below.
import { readFileSync, statSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dir = resolve(here, '../../app/static/tiles');
const HILLSHADE_GATE_MB = 30;

const { regions } = JSON.parse(
  readFileSync(resolve(here, 'regions.json'), 'utf-8')
);

let total = 0;
let failed = false;
for (const { id } of regions) {
  console.log(`region ${id}:`);
  for (const kind of ['trails', 'contours', 'hillshade']) {
    const path = resolve(dir, `${kind}-${id}.pmtiles`);
    if (!existsSync(path)) {
      // hillshade is optional by design; the other two are not.
      console.log(`  ${kind}: MISSING${kind === 'hillshade' ? ' (optional)' : ''}`);
      if (kind !== 'hillshade') failed = true;
      continue;
    }
    const mb = statSync(path).size / 1024 / 1024;
    total += mb;
    console.log(`  ${kind}: ${mb.toFixed(1)} MB`);
    if (kind === 'hillshade' && mb > HILLSHADE_GATE_MB) {
      console.log(
        `  => hillshade is ${mb.toFixed(1)} MB, over the ${HILLSHADE_GATE_MB} MB gate.` +
          ' Restrict its zoom range or drop it — do not absorb it silently.'
      );
      failed = true;
    }
  }
}
console.log(`total: ${total.toFixed(1)} MB`);
process.exit(failed ? 1 : 0);
