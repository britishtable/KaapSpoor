import { statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const LIMIT_BYTES = 1024 * 1024 * 1024; // 1 GB GitHub Pages hard limit
const dir = process.argv[2] ?? 'build';

function size(path) {
  const s = statSync(path);
  if (!s.isDirectory()) return s.size;
  return readdirSync(path).reduce((sum, name) => sum + size(join(path, name)), 0);
}

const total = size(dir);
const mb = (total / 1024 / 1024).toFixed(1);
console.log(`published size: ${mb} MB`);
if (total > LIMIT_BYTES) {
  console.error(`FAIL: ${mb} MB exceeds the 1 GB GitHub Pages limit.`);
  process.exit(1);
}
