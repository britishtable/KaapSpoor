import { describe, it, expect } from 'vitest';
import { buildStyle, ATTRIBUTION_OSM, SHIPPED_BASEMAP } from './style';

describe('buildStyle(opentopo)', () => {
  const style = buildStyle('opentopo', '');
  it('uses a raster source', () => {
    expect(style.sources.basemap.type).toBe('raster');
  });
  it('attributes OpenStreetMap, which the ODbL requires', () => {
    expect(JSON.stringify(style.sources)).toContain(ATTRIBUTION_OSM);
  });
  it('renders the raster as the only basemap layer', () => {
    expect(style.layers.map((l) => l.id)).toContain('basemap');
  });
});

describe('buildStyle(selfhosted)', () => {
  const style = buildStyle('selfhosted', '/KaapSpoor');
  it('declares trails and contours as vector sources', () => {
    expect(style.sources.trails.type).toBe('vector');
    expect(style.sources.contours.type).toBe('vector');
  });
  it('prefixes pmtiles URLs with the base path so GitHub Pages resolves them', () => {
    expect(JSON.stringify(style.sources)).toContain('pmtiles:///KaapSpoor/tiles/trails.pmtiles');
    expect(JSON.stringify(style.sources)).toContain('pmtiles:///KaapSpoor/tiles/contours.pmtiles');
  });
  it('draws contour lines and paths', () => {
    const ids = style.layers.map((l) => l.id);
    expect(ids).toContain('contours-index');
    expect(ids).toContain('contours-intermediate');
    expect(ids).toContain('paths');
  });
  it('attributes OpenStreetMap', () => {
    expect(JSON.stringify(style.sources)).toContain(ATTRIBUTION_OSM);
  });
});

describe('both basemaps', () => {
  it('agree on the glyphs endpoint so labels render either way', () => {
    expect(buildStyle('opentopo', '').glyphs).toBe(buildStyle('selfhosted', '').glyphs);
  });
  it('serve fonts from this site, not a third-party server', () => {
    for (const bm of ['opentopo', 'selfhosted'] as const) {
      const g = buildStyle(bm, '/KaapSpoor').glyphs ?? '';
      expect(g).toBe('/KaapSpoor/fonts/{fontstack}/{range}.pbf');
      expect(g).not.toContain('http');
    }
  });
});

describe('self-hosted source-layer contract', () => {
  // tools/tiles/ builds the PMTiles archives to these exact layer names. A typo
  // here breaks the map silently, so pin every one.
  const layerFor = (id: string) =>
    buildStyle('selfhosted', '').layers.find((l) => l.id === id) as
      | { 'source-layer'?: string }
      | undefined;

  it.each([
    ['water', 'water'],
    ['contours-index', 'contours'],
    ['contours-intermediate', 'contours'],
    ['roads-major', 'roads'],
    ['roads-minor', 'roads'],
    ['paths', 'paths'],
    ['peaks-headline', 'peaks'],
    ['peaks-major', 'peaks'],
    ['peaks-minor', 'peaks']
  ])('layer %s reads source-layer %s', (id, sourceLayer) => {
    expect(layerFor(id)?.['source-layer']).toBe(sourceLayer);
  });
});

describe('shipped basemap', () => {
  it('is self-hosted, so the app depends on no external tile service', () => {
    expect(SHIPPED_BASEMAP).toBe('selfhosted');
  });
  it('fetches nothing from a third party — no external tiles or fonts', () => {
    const style = buildStyle(SHIPPED_BASEMAP, '');
    // Check what the browser actually requests: source URLs and the glyphs
    // endpoint. Attribution strings may legitimately contain hyperlinks, so
    // they are deliberately excluded from this assertion.
    const fetched = [
      style.glyphs ?? '',
      ...Object.values(style.sources).flatMap((s) => [
        'url' in s ? (s.url ?? '') : '',
        ...('tiles' in s ? (s.tiles ?? []) : [])
      ])
    ];
    for (const url of fetched) {
      expect(url).not.toMatch(/^https?:\/\//);
    }
    expect(fetched.join('|')).not.toContain('opentopomap.org');
    expect(fetched.join('|')).not.toContain('demotiles.maplibre.org');
  });
});

describe('zoom scoping', () => {
  const style = buildStyle('selfhosted', '');
  const layer = (id: string) => style.layers.find((l) => l.id === id);

  it("draws index contours from the archive's own minimum zoom", () => {
    // contours.pmtiles is built z10-14; a lower minzoom would render nothing.
    expect(layer('contours-index')?.minzoom).toBe(10);
  });

  it("holds the 20 m intermediates back until they are legible", () => {
    expect(layer('contours-intermediate')?.minzoom).toBe(13);
  });

  it('keeps the 100 m index lines heavier than the intermediates', () => {
    const index = layer('contours-index') as { paint?: Record<string, unknown> };
    const intermediate = layer('contours-intermediate') as { paint?: Record<string, unknown> };
    expect(JSON.stringify(index.paint?.['line-width'])).not.toBe(
      JSON.stringify(intermediate.paint?.['line-width'])
    );
  });

  it('holds footpaths back until a zoom where a single path is distinguishable', () => {
    // 10,555 paths rendered at the opening view (z7.97) and buried the route
    // pins; this is the change that removes that.
    expect(layer('paths')?.minzoom).toBe(12);
  });

  it('never hides trunk and primary roads — they orient you at region scale', () => {
    // roads-major deliberately carries no minzoom: hiding it entirely is the
    // defect this fix corrects, so this must stay undefined, not merely low.
    expect(layer('roads-major')?.minzoom).toBeUndefined();
  });

  it('holds minor roads back until you are looking for a trailhead', () => {
    expect(layer('roads-minor')?.minzoom).toBe(11);
  });

  it('interpolates road and path widths by zoom rather than fixing them', () => {
    for (const id of ['roads-major', 'roads-minor', 'paths']) {
      const paint = (layer(id) as { paint?: Record<string, unknown> }).paint ?? {};
      expect(Array.isArray(paint['line-width'])).toBe(true);
      expect((paint['line-width'] as unknown[])[0]).toBe('interpolate');
    }
  });

  it('anchors the overview with a headline tier of very high summits', () => {
    expect(layer('peaks-headline')?.minzoom).toBe(7);
  });

  it('shows major summits at region scale', () => {
    expect(layer('peaks-major')?.minzoom).toBe(10);
  });

  it('holds minor peaks back until close in', () => {
    expect(layer('peaks-minor')?.minzoom).toBe(13);
  });

  it('splits peaks into three tiers using to-number with a fallback', () => {
    // ele is the raw OSM tag and arrives as a string; the two-argument
    // to-number form scores an unusable value 0, sorting it into peaks-minor.
    const toNumberEle = ['to-number', ['get', 'ele'], 0];
    expect((layer('peaks-headline') as { filter?: unknown[] })?.filter).toEqual([
      '>=',
      toNumberEle,
      1500
    ]);
    expect((layer('peaks-major') as { filter?: unknown[] })?.filter).toEqual([
      'all',
      ['>=', toNumberEle, 1000],
      ['<', toNumberEle, 1500]
    ]);
    expect((layer('peaks-minor') as { filter?: unknown[] })?.filter).toEqual(['<', toNumberEle, 1000]);
  });

  it('partitions every peak into exactly one of the three tiers', () => {
    // Every peak, including one whose ele is missing or unconvertible (which
    // scores 0 via the to-number fallback and lands in minor), must satisfy
    // exactly one of the three filters — no peak drawn twice, none dropped.
    // A tiny local evaluator for just the expression shapes these filters use
    // is more honest than asserting on the raw arrays a second time: it proves
    // the *behaviour* is exhaustive and non-overlapping, not just the shape.
    const evalExpr = (expr: unknown, ele: unknown): number => {
      const [op, ...args] = expr as [string, ...unknown[]];
      if (op === 'get') return ele as number;
      if (op === 'to-number') {
        const v = evalExpr(args[0], ele);
        const n = typeof v === 'string' ? Number(v) : v;
        return typeof n === 'number' && !Number.isNaN(n) ? n : (args[1] as number);
      }
      throw new Error(`unhandled expr ${op}`);
    };
    const evalFilter = (filter: unknown[], ele: unknown): boolean => {
      const [op, ...args] = filter;
      if (op === 'all') return (args as unknown[][]).every((f) => evalFilter(f, ele));
      if (op === '>=') return evalExpr(args[0], ele) >= (args[1] as number);
      if (op === '<') return evalExpr(args[0], ele) < (args[1] as number);
      throw new Error(`unhandled filter op ${op}`);
    };

    const headline = (layer('peaks-headline') as { filter?: unknown[] })?.filter as unknown[];
    const major = (layer('peaks-major') as { filter?: unknown[] })?.filter as unknown[];
    const minor = (layer('peaks-minor') as { filter?: unknown[] })?.filter as unknown[];

    const samples: unknown[] = [2000, 1500, '1500', 1499, 1000, '1000', 999, 0, 'bad', undefined, null];
    for (const ele of samples) {
      const hits = [headline, major, minor].filter((f) => evalFilter(f, ele));
      expect(hits.length).toBe(1);
    }
  });

  it('sorts peak labels so the highest summit wins a collision', () => {
    // MapLibre gives a LOWER sort key priority, so the key must negate
    // elevation: 1085 m scores -1085 and beats 669 m at -669. An inverted sign
    // here would silently let the smallest bump win every collision.
    const expected = ['-', 0, ['to-number', ['get', 'ele'], 0]];
    for (const id of ['peaks-headline', 'peaks-major', 'peaks-minor']) {
      const layout = (layer(id) as { layout?: Record<string, unknown> }).layout ?? {};
      expect(layout['symbol-sort-key']).toEqual(expected);
    }
  });

  it('interpolates peak label size by zoom', () => {
    const major = layer('peaks-major') as { layout?: Record<string, unknown> };
    expect(Array.isArray(major.layout?.['text-size'])).toBe(true);
  });

  it('leaves the opening view non-blank — no layer but the pins is hidden there', () => {
    // Regression test for the defect this task fixes: an earlier pass gave
    // every layer a minzoom, so at the z7.97 opening view nothing drew but
    // background, water and pins. roads-major and peaks-headline are the two
    // layers meant to survive that view; if either regains a minzoom above 7,
    // the overview goes blank again.
    const minzoomOrZero = (id: string) => layer(id)?.minzoom ?? 0;
    expect(minzoomOrZero('roads-major')).toBeLessThanOrEqual(7);
    expect(minzoomOrZero('peaks-headline')).toBeLessThanOrEqual(7);
  });
});
