/**
 * Writes a tiny GeoTIFF the sampling tests can read, so they need neither WSL
 * nor the real 5 MB DEM. Four pixels covering 18.40–18.42 E, -34.02–-34.00 S,
 * with heights that make bilinear interpolation visible: 0, 100, 200, 300.
 */
import { writeArrayBuffer } from 'geotiff';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const width = 2;
const height = 2;
// Row-major from the top-left (north-west) corner, as GeoTIFF stores it.
const values = new Float32Array([0, 100, 200, 300]);

const buffer = await writeArrayBuffer(values, {
  width,
  height,
  ModelTiepoint: [0, 0, 0, 18.4, -34.0, 0],
  ModelPixelScale: [0.01, 0.01, 0],
  GeographicTypeGeoKey: 4326,
  SampleFormat: [3] // IEEE floating point
});

const out = resolve(import.meta.dirname, '..', 'test-fixtures', 'dem.tif');
writeFileSync(out, Buffer.from(buffer));
console.log(`wrote ${out}`);
