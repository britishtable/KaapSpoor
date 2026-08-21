import { describe, it, expect } from 'vitest';
import { migrateFeatures } from './migrate-segments';

const feature = (props: Record<string, unknown>) => ({
  type: 'Feature',
  geometry: { type: 'LineString', coordinates: [[18.4, -33.96], [18.41, -33.96]] },
  properties: props
});

describe('migrateFeatures', () => {
  it('calls an untagged line the main route', () => {
    const [out] = migrateFeatures([feature({ routeId: 'a--b--c', drawn: '2026-08-17' })]);
    expect(out.properties.role).toBe('main');
    expect(out.properties.segmentId).toBe('a--b--c/main/main');
  });

  it('renames variant to name', () => {
    const [out] = migrateFeatures([
      feature({ routeId: 'a--b--c', variant: 'Right Hand', drawn: '2026-08-17' })
    ]);
    expect(out.properties.name).toBe('Right Hand');
    expect(out.properties.variant).toBeUndefined();
    expect(out.properties.segmentId).toBe('a--b--c/main/right-hand');
  });

  it('keeps note and drawn untouched', () => {
    const [out] = migrateFeatures([
      feature({ routeId: 'a--b--c', note: 'wet in winter', drawn: '2026-08-17' })
    ]);
    expect(out.properties.note).toBe('wet in winter');
    expect(out.properties.drawn).toBe('2026-08-17');
  });

  it('leaves an already-migrated feature exactly as it is', () => {
    const already = feature({
      routeId: 'a--b--c', role: 'approach', segmentId: 'a--b--c/approach/via-x', drawn: '2026-08-20'
    });
    expect(migrateFeatures([already])[0].properties).toEqual(already.properties);
  });

  it('does not hand two lines of one route the same id', () => {
    const out = migrateFeatures([
      feature({ routeId: 'a--b--c', drawn: '2026-08-17' }),
      feature({ routeId: 'a--b--c', drawn: '2026-08-17' })
    ]);
    expect(out[0].properties.segmentId).not.toBe(out[1].properties.segmentId);
  });
});
