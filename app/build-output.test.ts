import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Guarded like transform.test.ts's anti-drift check: CI runs the unit tests
// before anything is built, so this asserts on a developer machine that has
// run `npm run build` and stays quiet on a clean checkout.
const build = resolve(process.cwd(), 'build');

describe('the built site', () => {
  it('does not ship the route editor', () => {
    if (!existsSync(build)) return;
    expect(existsSync(resolve(build, 'draw'))).toBe(false);
    expect(existsSync(resolve(build, 'draw.html'))).toBe(false);
  });

  it('still ships the pages that matter', () => {
    // strict: false removes the adapter's own guarantee that every route was
    // prerendered, so the pages we DO want are asserted here instead.
    if (!existsSync(build)) return;
    expect(existsSync(resolve(build, 'index.html'))).toBe(true);
    expect(existsSync(resolve(build, 'route'))).toBe(true);
    expect(existsSync(resolve(build, 'data', 'routes-index.json'))).toBe(true);
  });
});
