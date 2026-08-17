import { describe, it, expect } from 'vitest';
import { transform, statValue, type RawDataset, type RouteLines } from './transform';

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

describe('route lines', () => {
  function rawWith(slugs: string[]): RawDataset {
    return {
      routes: slugs.map((slug) => ({
        slug, title: slug, url: `https://example.test/${slug}`, area: ['Area'],
        coords: { lat: -34, lon: 18.4, zoom: 15 },
        grade: null, grade_source: null, stats: {}, sections: {}, description: '',
        related: [], attachments: [], photos: { deck_ids: [], inline_urls: [] }
      }))
    };
  }

  const line = (routeId: string, variant?: string, note?: string) => ({
    properties: { routeId, ...(variant ? { variant } : {}), ...(note ? { note } : {}) }
  });

  it('marks a route that has a drawn line', () => {
    const lines = { features: [line('area--with-line')] };
    const { index } = transform(rawWith(['with-line', 'without-line']), {}, [], lines);
    expect(index.find((e) => e.id === 'area--with-line')!.hasLine).toBe(true);
    // Never absent: the panel and the map both branch on it.
    expect(index.find((e) => e.id === 'area--without-line')!.hasLine).toBe(false);
  });

  it('carries each variant and its caption onto the route content', () => {
    // The panel needs the names and notes; only the map needs the geometry, so
    // the coordinates stay out of the per-route JSON entirely.
    const lines = {
      features: [
        line('area--x', 'Left Hand', 'The original line.'),
        line('area--x', 'Right Hand', 'Steeper, and what most parties climb.')
      ]
    };
    const { content } = transform(rawWith(['x']), {}, [], lines);
    expect(content[0].lines).toEqual([
      { variant: 'Left Hand', note: 'The original line.' },
      { variant: 'Right Hand', note: 'Steeper, and what most parties climb.' }
    ]);
  });

  it('gives a single unnamed line an entry with no variant name', () => {
    const { content } = transform(rawWith(['x']), {}, [], { features: [line('area--x')] });
    expect(content[0].lines).toEqual([{ variant: null, note: null }]);
  });

  it('defaults to no lines when nothing has been drawn', () => {
    const { index, content } = transform(rawWith(['x']), {}, []);
    expect(index[0].hasLine).toBe(false);
    expect(content[0].lines).toEqual([]);
  });

  // Deliberately NOT a staleness check against the OSM extract. CI has no PBF
  // when unit tests run, so such a check could only ever take the degraded path
  // and fail for being right.
  it('every line in the committed file belongs to a real route', async () => {
    const { readFileSync, existsSync } = await import('node:fs');
    const { resolve, dirname } = await import('node:path');
    let root = process.cwd();
    while (!existsSync(resolve(root, 'data/routes.json')) && dirname(root) !== root) {
      root = dirname(root);
    }
    const linesPath = resolve(root, 'data/route-lines.geojson');
    const indexPath = resolve(root, 'app/static/data/routes-index.json');
    if (!existsSync(linesPath) || !existsSync(indexPath)) return;
    const lines = JSON.parse(readFileSync(linesPath, 'utf-8')) as RouteLines;
    const ids = new Set(
      (JSON.parse(readFileSync(indexPath, 'utf-8')) as { id: string }[]).map((e) => e.id)
    );
    for (const f of lines.features) expect(ids.has(f.properties.routeId)).toBe(true);
  });
});

describe('mentionedPaths', () => {
  const pathNames = [
    { name: 'Contour Path', segments: 27 },
    { name: 'India Venster', segments: 6 },
    { name: 'B', segments: 1 }
  ];

  const raw = (sections: Record<string, string>): RawDataset => ({
    routes: [
      {
        slug: 'a-route', title: 'A Route', url: 'https://example.invalid/a',
        area: ['Table-Mountain', 'atlantic-west'], coords: { lat: -33.95, lon: 18.4, zoom: 15 },
        grade: null, grade_source: null, stats: {}, sections,
        description: Object.values(sections).join('\n'), related: [], attachments: [],
        photos: { deck_ids: [], inline_urls: [] }
      }
    ]
  });

  it('records the paths a description names', () => {
    const { index } = transform(raw({ '': 'Join the Contour Path, then up India Venster.' }), {}, pathNames);
    expect(index[0].mentionedPaths).toEqual(['Contour Path', 'India Venster']);
  });

  it('is an empty array when a description names none', () => {
    const { index } = transform(raw({ '': 'A pleasant stroll.' }), {}, pathNames);
    expect(index[0].mentionedPaths).toEqual([]);
  });

  it("does not treat the grade 'B' as a path name", () => {
    const { index } = transform(raw({ '': "A fun 'B' grade scramble." }), {}, pathNames);
    expect(index[0].mentionedPaths).toEqual([]);
  });

  it('searches every section, not only the first', () => {
    const { index } = transform(
      raw({ '': 'Preamble.', 'Route Description': 'Follow the Contour Path.' }),
      {}, pathNames
    );
    expect(index[0].mentionedPaths).toEqual(['Contour Path']);
  });

  it('emits only names that were supplied — never an invented one', () => {
    // The anti-drift guarantee: whatever ends up on the map came from the
    // committed artifact, so the style and the data cannot disagree.
    const { index } = transform(raw({ '': 'Join the Contour Path.' }), {}, pathNames);
    const supplied = new Set(pathNames.map((p) => p.name));
    for (const name of index[0].mentionedPaths) expect(supplied.has(name)).toBe(true);
  });

  it('defaults to empty when no path names are supplied at all', () => {
    // A clean clone that has not run tools/pathnames must still build.
    const { index } = transform(raw({ '': 'Join the Contour Path.' }), {});
    expect(index[0].mentionedPaths).toEqual([]);
  });

  it('carries the same names onto the route content', () => {
    const { content } = transform(raw({ '': 'Up India Venster.' }), {}, pathNames);
    expect(content[0].mentionedPaths).toEqual(['India Venster']);
  });
});
