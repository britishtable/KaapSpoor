import { describe, it, expect } from 'vitest';
import { transform, statValue, type RawDataset } from './transform';

const raw = {
  attribution: 'x', source: 'y', license: 'z', generated: 'g', areas: [],
  routes: [
    {
      slug: 'kasteelspoort', title: 'Kasteelspoort',
      url: 'https://sites.google.com/site/mm/Home/tm/aw/kasteelspoort',
      area: ['tm', 'aw'], coords: { lat: -33.9, lon: 18.3, zoom: 16 },
      grade: '1 ***', grade_source: 'label',
      stats: { Time: '2 hrs', 'Height gain': '530m' },
      sections: { Overview: 'A path.' }, description: 'A path.',
      related: ['/site/mm/Home/tm/aw/other'], attachments: [],
      photos: { deck_ids: ['d1'], inline_urls: ['a', 'b'] }, is_reference: false
    },
    {
      slug: 'other', title: 'Other',
      url: 'https://sites.google.com/site/mm/Home/tm/aw/other',
      area: ['tm', 'aw'], coords: null, grade: null, grade_source: null,
      stats: {}, sections: {}, description: 'Short note.',
      related: [], attachments: [], photos: { deck_ids: [], inline_urls: [] }, is_reference: false
    }
  ]
};

describe('statValue', () => {
  it('matches keys case-insensitively', () => {
    expect(statValue({ 'Height Gain': '410m' }, 'height gain')).toBe('410m');
  });
});

describe('transform', () => {
  it('emits one index entry per route with a stable id', () => {
    expect(transform(raw).index.map((e) => e.id)).toEqual(['tm--aw--kasteelspoort', 'tm--aw--other']);
  });
  it('carries time and height gain out of the stats table', () => {
    const e = transform(raw).index[0];
    expect(e.time).toBe('2 hrs');
    expect(e.heightGain).toBe('530m');
  });
  it('marks entries with a stats table or labelled grade as full', () => {
    const { index } = transform(raw);
    expect(index[0].isFullEntry).toBe(true);
    expect(index[1].isFullEntry).toBe(false);
  });
  it('relates other routes sharing the same area path, excluding itself', () => {
    const kast = transform(raw).content.find((c) => c.id === 'tm--aw--kasteelspoort')!;
    expect(kast.related).toEqual([{ id: 'tm--aw--other', title: 'Other' }]);
  });
  it('counts photos without downloading any', () => {
    expect(transform(raw).content[0].photoCount).toBe(3);
  });
  it('produces globally unique ids', () => {
    const ids = transform(raw).index.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

function dataset(routes: Partial<RawDataset['routes'][number]>[]): RawDataset {
  return {
    routes: routes.map((r) => ({
      slug: 'x', title: 'X', url: 'u', area: ['a'], coords: null,
      grade: null, grade_source: null, stats: {}, sections: {},
      description: '', related: [], attachments: [],
      photos: { deck_ids: [], inline_urls: [] },
      ...r
    }))
  } as RawDataset;
}

describe('transform provenance', () => {
  it('labels a crawl coordinate as crawl when no location entry exists', () => {
    const raw = dataset([{ slug: 'kasteelspoort', coords: { lat: -33.97, lon: 18.39, zoom: 17 } }]);
    const { index } = transform(raw, {});
    expect(index[0].coords).toEqual({ lat: -33.97, lon: 18.39, zoom: 17 });
    expect(index[0].coordsSource).toBe('crawl');
    expect(index[0].coordsAccuracyM).toBeNull();
  });

  it('leaves an unlocated route with a null source', () => {
    const { index } = transform(dataset([{ slug: 'corridor-rib' }]), {});
    expect(index[0].coords).toBeNull();
    expect(index[0].coordsSource).toBeNull();
  });

  it('applies a location entry over a crawl coordinate', () => {
    const raw = dataset([{ slug: 'kasteelspoort', coords: { lat: -33.97, lon: 18.39, zoom: 17 } }]);
    const { index } = transform(raw, {
      'a--kasteelspoort': {
        coords: { lat: -33.98, lon: 18.4, zoom: 16 },
        source: 'curated'
      }
    });
    expect(index[0].coords).toEqual({ lat: -33.98, lon: 18.4, zoom: 16 });
    expect(index[0].coordsSource).toBe('curated');
  });

  it('locates a route from an area-approximate entry, carrying its radius', () => {
    // INVERTED in Phase 4c. This asserted the opposite until the map could draw
    // uncertainty: an area centroid rendered as a plain pin was indistinguishable
    // from a surveyed one, so the gate held it back. The pins layer now draws
    // such a route hollow always, and its accuracy circle when selected, so the
    // radius reaching the app is the point rather than the danger.
    const { index } = transform(dataset([{ slug: 'corridor-rib' }]), {
      'a--corridor-rib': {
        coords: { lat: -33.97, lon: 18.39, zoom: 11 },
        source: 'area-approx',
        accuracyM: 4200
      }
    });
    expect(index[0].coords).toEqual({ lat: -33.97, lon: 18.39, zoom: 11 });
    expect(index[0].coordsSource).toBe('area-approx');
    expect(index[0].coordsAccuracyM).toBe(4200);
  });

  it('carries no accuracy radius for a route located precisely', () => {
    // coordsAccuracyM is the discriminator the app reads to decide hollow vs
    // filled; a stray radius on a surveyed route would draw a circle around a
    // point that has none.
    const { index } = transform(dataset([{ slug: 'corridor-rib' }]), {
      'a--corridor-rib': { coords: { lat: -33.97, lon: 18.39, zoom: 15 }, source: 'curated' }
    });
    expect(index[0].coordsAccuracyM).toBeNull();
  });

  it('does not let an area-approximate entry override a crawl coordinate', () => {
    // NOT inverted with the gate, and deliberately so: this one was never about
    // the map's ability to draw uncertainty. An area centroid is strictly less
    // information than a coordinate for the route itself, so it is a fallback
    // for a route that has nothing, never a replacement for something better.
    // tools/geocode only emits area-approx as a last resort -- none of the 41
    // entries belongs to a route that already had crawl coords -- so this
    // guards a case the current data does not contain and a future re-crawl
    // could easily introduce.
    const raw = dataset([{ slug: 'kasteelspoort', coords: { lat: -33.97, lon: 18.39, zoom: 17 } }]);
    const { index } = transform(raw, {
      'a--kasteelspoort': {
        coords: { lat: -33.5, lon: 19.0, zoom: 11 },
        source: 'area-approx',
        accuracyM: 90000
      }
    });
    expect(index[0].coords).toEqual({ lat: -33.97, lon: 18.39, zoom: 17 });
    expect(index[0].coordsSource).toBe('crawl');
    expect(index[0].coordsAccuracyM).toBeNull();
  });

  it.each(['crawl', 'curated', 'osm-match'] as const)(
    'merges a %s location as before',
    (source) => {
      const { index } = transform(dataset([{ slug: 'corridor-rib' }]), {
        'a--corridor-rib': { coords: { lat: -33.97, lon: 18.39, zoom: 15 }, source }
      });
      expect(index[0].coords).toEqual({ lat: -33.97, lon: 18.39, zoom: 15 });
      expect(index[0].coordsSource).toBe(source);
    }
  );

  it('carries the matched OSM feature for an osm-match location', () => {
    const { index } = transform(dataset([{ slug: 'newlands-ravine' }]), {
      'a--newlands-ravine': {
        coords: { lat: -33.965, lon: 18.435, zoom: 15 },
        source: 'osm-match',
        osm: { type: 'node', id: 7, name: 'Newlands Ravine' }
      }
    });
    expect(index[0].coordsSource).toBe('osm-match');
    expect(index[0].coordsOsm).toEqual({ type: 'node', id: 7, name: 'Newlands Ravine' });
  });

  it('propagates provenance to the per-route content as well as the index', () => {
    const { content } = transform(dataset([{ slug: 'newlands-ravine' }]), {
      'a--newlands-ravine': {
        coords: { lat: -33.965, lon: 18.435, zoom: 15 },
        source: 'osm-match',
        osm: { type: 'node', id: 7, name: 'Newlands Ravine' }
      }
    });
    expect(content[0].coordsSource).toBe('osm-match');
    expect(content[0].coordsOsm).toEqual({ type: 'node', id: 7, name: 'Newlands Ravine' });
  });
});
