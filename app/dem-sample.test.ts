import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { openDem } from './dem-sample';

const FIXTURE = resolve(process.cwd(), 'test-fixtures', 'dem.tif');

describe('openDem', () => {
  it('returns null for a DEM that is not there, rather than throwing', async () => {
    // A clone with no DEM must still be able to draw and save; elevation is
    // the part that goes missing, not the editor.
    expect(await openDem(resolve(process.cwd(), 'no-such-dem.tif'))).toBe(null);
  });

  it('reads the height at a pixel', async () => {
    if (!existsSync(FIXTURE)) return;
    const dem = await openDem(FIXTURE);
    expect(dem).not.toBe(null);
    // North-west pixel centre.
    expect(dem!.sample(18.405, -34.005)).toBeCloseTo(0, 0);
  });

  it('interpolates between pixels rather than stepping', async () => {
    if (!existsSync(FIXTURE)) return;
    const dem = await openDem(FIXTURE);
    // Halfway between the 0 and 100 pixels along the top row.
    const middle = dem!.sample(18.41, -34.005);
    expect(middle).toBeGreaterThan(20);
    expect(middle).toBeLessThan(80);
  });

  it('returns null outside the DEM, so a line leaving the region is honest', async () => {
    if (!existsSync(FIXTURE)) return;
    const dem = await openDem(FIXTURE);
    expect(dem!.sample(20.0, -34.0)).toBe(null);
  });
});
