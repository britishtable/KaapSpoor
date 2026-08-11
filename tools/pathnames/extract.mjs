// Extract every named path in the shipped region from the trails PMTiles
// archive, with the number of tile-clipped segments carrying each name.
//
// Run by hand whenever the tiles are rebuilt; the output is committed. CI never
// runs this — it has no tiles when the unit tests execute (see deploy.yml).
//
//   cd tools/pathnames && npm install && npm run extract
//
// The segment count is not decoration: a trail cut at every junction (Contour
// Path is 27 segments) looks very different from a one-segment stub, and Phase
// 4d needs that distinction.
import { PMTiles } from 'pmtiles';
import { VectorTile } from '@mapbox/vector-tile';
// pbf 5 dropped the default export and split reader from writer.
import { PbfReader } from 'pbf';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');

const regions = JSON.parse(readFileSync(resolve(repo, 'tools/tiles/regions.json'), 'utf8'));
// The app ships exactly one region; take it from regions.json rather than a
// literal so this cannot drift from the archive that was actually built.
const region = regions.regions[0];
const archive = resolve(repo, `app/static/tiles/trails-${region.id}.pmtiles`);

const buf = readFileSync(archive);
const tiles = new PMTiles({
  getKey: () => archive,
  getBytes: async (offset, length) => ({
    data: buf.buffer.slice(buf.byteOffset + offset, buf.byteOffset + offset + length)
  })
});

const header = await tiles.getHeader();
const z = header.maxZoom;
const lon2x = (lon) => Math.floor(((lon + 180) / 360) * 2 ** z);
const lat2y = (lat) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
};

const { west, south, east, north } = region.bbox;
const segments = new Map();
let features = 0;
let scanned = 0;

for (let x = lon2x(west); x <= lon2x(east); x++) {
  for (let y = lat2y(north); y <= lat2y(south); y++) {
    const tile = await tiles.getZxy(z, x, y);
    if (!tile) continue;
    scanned++;
    const layer = new VectorTile(new PbfReader(new Uint8Array(tile.data))).layers.paths;
    if (!layer) continue;
    for (let i = 0; i < layer.length; i++) {
      features++;
      const name = layer.feature(i).properties.name;
      if (typeof name === 'string' && name.length) {
        segments.set(name, (segments.get(name) ?? 0) + 1);
      }
    }
  }
}

const names = [...segments]
  .map(([name, count]) => ({ name, segments: count }))
  // Stable order so the committed file diffs cleanly between runs.
  .sort((a, b) => b.segments - a.segments || a.name.localeCompare(b.name));

const generated = new Date().toISOString().slice(0, 10);
writeFileSync(
  resolve(repo, 'data/osm-path-names.json'),
  JSON.stringify({ region: region.id, source: `trails-${region.id}.pmtiles`, generated, names }, null, 2) + '\n'
);

const named = names.reduce((n, e) => n + e.segments, 0);
const report = [
  '# Named paths report',
  '',
  `**Archive:** \`trails-${region.id}.pmtiles\` (z${z}, ${scanned} tiles)`,
  `**Extracted:** ${generated}`,
  '',
  '| | |',
  '|---|---|',
  `| Path features (tile-clipped) | ${features} |`,
  `| Features carrying a name | ${named} (${((named / features) * 100).toFixed(1)}%) |`,
  `| Distinct names | ${names.length} |`,
  '',
  'Segment counts are tile-clipped, so they exceed the number of OSM ways: a way',
  'crossing a tile boundary is counted once per tile. They rank names by extent,',
  'which is what they are for; they are not a way count.',
  '',
  '## Most fragmented names',
  '',
  '| Segments | Name |',
  '|---|---|',
  ...names.slice(0, 25).map((e) => `| ${e.segments} | ${e.name} |`),
  '',
  '## Names that are annotations rather than names',
  '',
  'Kept in the artifact — filtering belongs to the matcher, not the extractor —',
  'but listed here because they would read badly as map labels.',
  '',
  ...names
    .filter((e) => e.name.length > 30 || /[a-z][A-Z]/.test(e.name))
    .map((e) => `- \`${e.name}\``),
  ''
].join('\n');
writeFileSync(resolve(repo, 'data/path-names-report.md'), report);

console.log(`pathnames: ${names.length} distinct names from ${features} features in ${scanned} tiles`);
