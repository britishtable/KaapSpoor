import { render, screen } from '@testing-library/svelte';
import { describe, it, expect } from 'vitest';
import StatsStrip from './StatsStrip.svelte';
import type { RouteContent } from '../data/types';

const base: RouteContent = {
  id: 'a', title: 'Blind Gully', area: ['table-mountain', 'atlantic-west'],
  coords: { lat: -33.95, lon: 18.4, zoom: 14 },
  coordsSource: 'crawl', coordsAccuracyM: null, coordsOsm: null,
  grade: '3 ***', gradeSource: 'label', time: '5 hours', heightGain: '700 m',
  isFullEntry: true,
  sections: { Overview: 'A long walk up a big hill.' },
  description: 'Overview:\nA long walk up a big hill.',
  related: [], attachments: [], photoCount: 0,
  sourceUrl: 'https://example.invalid/route',
  segments: [],
  mentionedPaths: [],
  hasLine: false,
  lineStats: null
};

describe('StatsStrip', () => {
  it('states the drawn distance and marks the ascent as an estimate', () => {
    // "≈" is not decoration. The DEM is 30 m and the line follows simplified
    // tile geometry, so a bare "520 m" would claim a precision neither has.
    render(StatsStrip, { route: { ...base, lineStats: { distanceM: 2400, ascentM: 520 } } });
    expect(screen.getByText('2.4 km')).toBeTruthy();
    expect(screen.getByText('≈ 520 m')).toBeTruthy();
  });

  it('keeps the guide’s own height gain beside the computed one', () => {
    // The guide's sentence is the author's and outranks a computed number.
    render(StatsStrip, {
      route: { ...base, heightGain: '560m : from Rontree parking 170m to 730m approx',
               lineStats: { distanceM: 2400, ascentM: 520 } }
    });
    expect(screen.getByText(/560m : from Rontree parking/)).toBeTruthy();
    expect(screen.getByText('≈ 520 m')).toBeTruthy();
  });

  it('says nothing about ascent when the line has no heights', () => {
    render(StatsStrip, { route: { ...base, lineStats: { distanceM: 2400, ascentM: null } } });
    expect(screen.getByText('2.4 km')).toBeTruthy();
    expect(screen.queryByText(/≈/)).toBeNull();
  });

  it('omits distance and ascent once the route page has a real plan, leaving RoutePlan the only place they appear', () => {
    // I5: before this, StatsStrip printed the DEFAULT plan's figures from
    // route.lineStats while RoutePlan's header printed the CHOSEN plan's --
    // two different numbers on screen after any pick or a reverse.
    render(StatsStrip, {
      route: { ...base, lineStats: { distanceM: 2400, ascentM: 520 } },
      hasPlan: true
    });
    expect(screen.queryByText('2.4 km')).toBeNull();
    expect(screen.queryByText('≈ 520 m')).toBeNull();
    // Fields that do not come from the drawn line stay put.
    expect(screen.getByText('5 hours')).toBeTruthy();
    expect(screen.getByText('700 m')).toBeTruthy();
  });
});
