/**
 * Reads heights out of the Copernicus DEM that tools/tiles already clips.
 *
 * Used ONLY by the /draw editor's dev-server middleware, so `geotiff` never
 * reaches the client bundle. Sampling happens once, when the author saves a
 * line; readers get numbers, not a terrain model.
 *
 * The DEM is 1 arc-second — about 30 m — so a sample is the height of a
 * 30 m cell, not of a footstep. Everything downstream treats it as an estimate.
 */

import { fromFile } from 'geotiff';
import type { TypedArray } from 'geotiff';

export interface Dem {
  sample(lon: number, lat: number): number | null;
}

export async function openDem(path: string): Promise<Dem | null> {
  let raster: TypedArray;
  let width: number;
  let height: number;
  let bbox: number[];
  try {
    const tiff = await fromFile(path);
    const image = await tiff.getImage();
    width = image.getWidth();
    height = image.getHeight();
    bbox = image.getBoundingBox(); // [west, south, east, north]
    const bands = await image.readRasters({ interleave: false });
    const [band] = bands;
    if (!band) return null;
    raster = band;
  } catch {
    // Missing or unreadable: the caller carries on without elevation.
    return null;
  }

  const [west, south, east, north] = bbox;
  if (
    west === undefined ||
    south === undefined ||
    east === undefined ||
    north === undefined
  ) {
    return null;
  }

  const at = (x: number, y: number): number => {
    const cx = Math.min(Math.max(x, 0), width - 1);
    const cy = Math.min(Math.max(y, 0), height - 1);
    return raster[cy * width + cx] ?? NaN;
  };

  return {
    sample(lon: number, lat: number): number | null {
      if (lon < west || lon > east || lat < south || lat > north) return null;
      // Pixel coordinates, with row 0 at the NORTH edge.
      const px = ((lon - west) / (east - west)) * width - 0.5;
      const py = ((north - lat) / (north - south)) * height - 0.5;
      const x0 = Math.floor(px);
      const y0 = Math.floor(py);
      const tx = px - x0;
      const ty = py - y0;
      // Bilinear, so a point between cell centres does not step.
      const top = at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx;
      const bottom = at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx;
      const value = top * (1 - ty) + bottom * ty;
      return Number.isFinite(value) ? Math.round(value * 10) / 10 : null;
    }
  };
}
