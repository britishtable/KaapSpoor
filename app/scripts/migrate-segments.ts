/**
 * One-shot: bring route-lines.geojson drawn before roles existed up to the
 * segment schema.
 *
 * Every pre-existing line is the WHOLE route as the author drew it, which is a
 * `main` — correct as a single-segment route, and split into approach / main /
 * exit whenever they next open it. Idempotent, so running it twice is safe.
 *
 *   npx tsx scripts/migrate-segments.ts
 *
 * TypeScript run through tsx, like scripts/transform.ts, so it can share
 * makeSegmentId with the editor rather than growing a second slug rule that
 * could drift from it.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeSegmentId, isRole, type SegmentRole } from '../src/lib/data/segments';

interface LegacyFeature {
  type: string;
  geometry: { type: string; coordinates: number[][] };
  properties: {
    routeId: string;
    segmentId?: string;
    role?: string;
    name?: string;
    variant?: string;
    note?: string;
    drawn?: string;
  };
}

export function migrateFeatures(features: LegacyFeature[]): LegacyFeature[] {
  const taken = new Set(
    features.map((f) => f.properties.segmentId).filter((id): id is string => !!id)
  );
  return features.map((feature) => {
    const props = feature.properties;
    if (props.role && props.segmentId) return feature;
    const { variant, ...rest } = props;
    const name = rest.name ?? variant;
    const role: SegmentRole = isRole(rest.role) ? rest.role : 'main';
    const next: LegacyFeature['properties'] = { ...rest, role };
    if (name) next.name = name;
    else delete next.name;
    next.segmentId = rest.segmentId ?? makeSegmentId(rest.routeId, role, name ?? '', taken);
    taken.add(next.segmentId);
    return { ...feature, properties: next };
  });
}

const here = dirname(fileURLToPath(import.meta.url));
const FILE = resolve(here, '../../data/route-lines.geojson');

if (process.argv[1] && process.argv[1].endsWith('migrate-segments.ts')) {
  const collection = JSON.parse(readFileSync(FILE, 'utf-8'));
  const features = migrateFeatures(collection.features);
  writeFileSync(FILE, JSON.stringify({ type: 'FeatureCollection', features }, null, 1) + '\n');
  console.log(`Migrated ${features.length} features.`);
}
