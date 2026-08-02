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
    expect(JSON.stringify(style.sources)).toContain(
      'pmtiles:///KaapSpoor/tiles/trails-cape-town.pmtiles'
    );
    expect(JSON.stringify(style.sources)).toContain(
      'pmtiles:///KaapSpoor/tiles/contours-cape-town.pmtiles'
    );
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

describe('roads filters', () => {
  // roads-major/roads-minor are the entire mechanism that cut 5,180 road
  // features down to a few hundred at the overview; nothing previously
  // asserted the filters themselves, so dropping the '!' below would
  // double-draw every trunk/primary road at z11+ with every other test green.
  const style = buildStyle('selfhosted', '');
  const layer = (id: string) => style.layers.find((l) => l.id === id) as { filter?: unknown };

  const roadsMajorFilter = ['match', ['get', 'highway'], ['trunk', 'primary'], true, false];

  it('roads-major matches exactly trunk and primary highways', () => {
    expect(layer('roads-major').filter).toEqual(roadsMajorFilter);
  });

  it("roads-minor's filter is precisely the negation of roads-major's", () => {
    // Structural comparison against roads-major's own filter, not a second
    // hand-copied literal, so the two cannot silently drift apart.
    const major = layer('roads-major').filter;
    const minor = layer('roads-minor').filter;
    expect(minor).toEqual(['!', major]);
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

  it('keeps the 100 m index lines heavier than the intermediates at every shared zoom', () => {
    // A plain "the two arrays differ" check would pass even if the index line
    // went thinner than the intermediate, so this actually samples the
    // interpolation and compares the numbers at each zoom they both draw.
    const index = layer('contours-index') as { paint?: Record<string, unknown> };
    const intermediate = layer('contours-intermediate') as { paint?: Record<string, unknown> };
    const sampleWidth = (expr: unknown, zoom: number): number => {
      const arr = expr as unknown[];
      const stops = arr.slice(3); // ['interpolate', ['linear'], ['zoom'], z0, w0, z1, w1, ...]
      const pairs: [number, number][] = [];
      for (let i = 0; i < stops.length; i += 2) pairs.push([stops[i] as number, stops[i + 1] as number]);
      if (zoom <= pairs[0][0]) return pairs[0][1];
      for (let i = 0; i < pairs.length - 1; i++) {
        const [z0, w0] = pairs[i];
        const [z1, w1] = pairs[i + 1];
        if (zoom >= z0 && zoom <= z1) return w0 + ((w1 - w0) * (zoom - z0)) / (z1 - z0);
      }
      return pairs[pairs.length - 1][1];
    };
    // Shared range: contours-intermediate exists from its own minzoom (13)
    // through the top of contours-index's stops (16).
    for (const zoom of [13, 14, 15, 16]) {
      const iw = sampleWidth(index.paint?.['line-width'], zoom);
      const jw = sampleWidth(intermediate.paint?.['line-width'], zoom);
      expect(iw).toBeGreaterThan(jw);
    }
  });

  it('makes each layer visibly on at its own minzoom, not a sub-pixel hairline', () => {
    // A width under ~0.8px at the zoom a layer switches on reads as "not
    // there" rather than "there but thin" -- the exact defect this asserts.
    const firstStop = (id: string) => {
      const width = (layer(id) as { paint?: Record<string, unknown> }).paint?.['line-width'] as
        | unknown[]
        | undefined;
      return width?.[4] as number; // ['interpolate', ['linear'], ['zoom'], z0, w0, ...]
    };
    expect(firstStop('contours-index')).toBeGreaterThanOrEqual(0.8);
    expect(firstStop('contours-intermediate')).toBeGreaterThanOrEqual(0.8);
    expect(firstStop('roads-minor')).toBeGreaterThanOrEqual(0.8);
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

  it('declares hillshade as a raster source at the archive zoom range', () => {
    const src = style.sources.hillshade as {
      type: string; url?: string; minzoom?: number; maxzoom?: number; attribution?: string;
    };
    expect(src.type).toBe('raster');
    expect(src.url).toContain('hillshade-cape-town.pmtiles');
    // The archive is built z9-13. Declaring the range lets MapLibre overzoom
    // rather than request tiles that do not exist.
    expect(src.minzoom).toBe(9);
    expect(src.maxzoom).toBe(13);
    expect(src.attribution).toContain('Copernicus');
  });

  it('draws hillshade underneath the terrain it shades', () => {
    const ids = style.layers.map((l) => l.id);
    expect(ids).toContain('hillshade');
    // Under contours and water, above only the background: shading is a
    // backdrop, not a layer competing with the lines that carry the detail.
    expect(ids.indexOf('hillshade')).toBe(1);
    expect(ids.indexOf('hillshade')).toBeLessThan(ids.indexOf('contours-index'));
    expect(ids.indexOf('hillshade')).toBeLessThan(ids.indexOf('water'));
  });

  it('keeps hillshade subtle enough that contours stay primary', () => {
    const layer = style.layers.find((l) => l.id === 'hillshade') as {
      paint?: Record<string, unknown>;
    };
    const opacity = layer.paint?.['raster-opacity'] as number;
    expect(opacity).toBeGreaterThan(0);
    expect(opacity).toBeLessThanOrEqual(0.35);
  });
});
