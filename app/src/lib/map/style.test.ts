import { describe, it, expect } from 'vitest';
import { buildStyle, ATTRIBUTION_OSM, SHIPPED_BASEMAP } from './style';
import { SHIPPED_REGION } from './region';

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
    ['peaks-minor', 'peaks'],
    ['landcover', 'landcover'],
    ['places-settlement', 'places'],
    ['places-suburb', 'places']
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

  // filter doesn't exist on every LayerSpecification variant (e.g. background),
  // so narrow explicitly rather than letting the union leak into every assertion.
  const filterOf = (id: string) => (layer(id) as { filter?: unknown })?.filter;

  it('tiers peaks for a peninsula whose highest point is 1086 m', () => {
    // Measured in region: 0 peaks >= 1500 (the old headline threshold, which
    // rendered nothing), 4 in 1000-1499, 13 in 700-999, 31 in 400-699.
    const ele = ['to-number', ['get', 'ele'], 0];
    expect(filterOf('peaks-headline')).toEqual(['>=', ele, 1000]);
    expect(filterOf('peaks-major')).toEqual([
      'all', ['>=', ele, 600], ['<', ele, 1000]
    ]);
    expect(filterOf('peaks-minor')).toEqual(['<', ele, 600]);
  });

  it('shows the four highest summits below any opening zoom', () => {
    // fitBounds derives the opening zoom from the pane: 9.92 measured in the
    // Playwright viewport, 10.3 in a desktop browser, lower on a phone. A
    // headline minzoom inside that range leaves some viewports with no peak
    // label at all, which is the defect this tier exists to fix. 8 clears it.
    expect(layer('peaks-headline')?.minzoom).toBe(8);
    expect(layer('peaks-major')?.minzoom).toBe(12);
    expect(layer('peaks-minor')?.minzoom).toBe(14);
  });

  it('still partitions every peak into exactly one tier', () => {
    const h = filterOf('peaks-headline') as unknown[];
    const mj = filterOf('peaks-major') as unknown[];
    const mn = filterOf('peaks-minor') as unknown[];
    // headline >= 1000; major [600,1000); minor < 600 — exhaustive and
    // non-overlapping, including a peak whose ele is missing (scores 0).
    expect(h[0]).toBe('>=');
    expect(h[2]).toBe(1000);
    expect(mj[0]).toBe('all');
    expect(mn[0]).toBe('<');
    expect(mn[2]).toBe(600);
  });

  it('partitions sample elevations into exactly one tier, including an unusable ele', () => {
    // Behavioural check, not just a shape check: evaluates the actual filter
    // expressions against sample ele values (numbers, numeric strings, an
    // unconvertible string, and missing values) so a silently overlapping or
    // gapped threshold would fail here even if the arrays still looked right.
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

    const headline = filterOf('peaks-headline') as unknown[];
    const major = filterOf('peaks-major') as unknown[];
    const minor = filterOf('peaks-minor') as unknown[];

    const samples: unknown[] = [2000, 1086, '1086', 1000, '1000', 999, 600, '600', 599, 0, 'bad', undefined, null];
    for (const ele of samples) {
      const hits = [headline, major, minor].filter((f) => evalFilter(f, ele));
      expect(hits.length).toBe(1);
    }
    // An unconvertible ele scores 0 via the to-number fallback and must land
    // specifically in minor, not merely in "exactly one" tier.
    expect(evalFilter(minor, 'bad')).toBe(true);
    expect(evalFilter(minor, undefined)).toBe(true);
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
    // Regression test for the defect an earlier pass introduced: giving every
    // layer a minzoom left nothing drawing but background, water and pins.
    // The opening zoom is not a constant — fitBounds derives it from the pane
    // size (9.92 measured in the Playwright viewport, ~10.3 in a desktop
    // browser, lower on a phone) — so the bound here must clear the lowest
    // plausible opening zoom, not just one measurement. roads-major and
    // peaks-headline are the two layers meant to survive it; if either
    // regains a minzoom above 8, some viewport's overview goes blank again.
    const minzoomOrZero = (id: string) => layer(id)?.minzoom ?? 0;
    expect(minzoomOrZero('roads-major')).toBeLessThanOrEqual(8);
    expect(minzoomOrZero('peaks-headline')).toBeLessThanOrEqual(8);
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

  it('ramps hillshade opacity so overview zoom stays subtle and close-in zoom reads terrain', () => {
    // Flat 0.25 buried the peninsula in a dark mass at overview zoom; a
    // ramped expression fixed it (verified live at z10.3 and z12.5). This
    // samples the stops rather than asserting a scalar, since the paint value
    // is now an interpolate expression, not a number.
    const layer = style.layers.find((l) => l.id === 'hillshade') as {
      paint?: Record<string, unknown>;
    };
    const opacity = layer.paint?.['raster-opacity'] as unknown[];
    expect(opacity[0]).toBe('interpolate');
    const stops = opacity.slice(3);
    const outputs: number[] = [];
    for (let i = 1; i < stops.length; i += 2) outputs.push(stops[i] as number);
    expect(outputs.length).toBeGreaterThan(0);
    for (const o of outputs) {
      expect(o).toBeGreaterThan(0);
      expect(o).toBeLessThanOrEqual(0.35);
    }
    // Inverting the ramp would restore the defect it exists to fix — a heavy
    // wash at overview zoom where relief compresses — and every bound above
    // would still pass. Assert the direction, not just the range.
    expect(outputs).toEqual([...outputs].sort((a, b) => a - b));
  });

  it('fills landcover between the hillshade and the water', () => {
    const ids = style.layers.map((l) => l.id);
    expect(ids).toContain('landcover');
    expect(ids.indexOf('landcover')).toBeGreaterThan(ids.indexOf('hillshade'));
    expect(ids.indexOf('landcover')).toBeLessThan(ids.indexOf('water'));
  });

  it('colours every landcover class present in the region', () => {
    // Measured in the shipped archive at the opening view: vineyard 296,
    // scrub 184, wood 50, heath 44, beach 32, grassland 20, forest 17,
    // orchard 17, sand 7, bare_rock 2. A class with no case falls through to
    // the default and silently reads as bare ground.
    const layer = style.layers.find((l) => l.id === 'landcover') as {
      paint?: Record<string, unknown>;
    };
    const json = JSON.stringify(layer.paint?.['fill-color']);
    for (const cls of [
      'vineyard', 'scrub', 'wood', 'heath', 'beach',
      'grassland', 'forest', 'orchard', 'sand', 'bare_rock'
    ]) {
      expect(json).toContain(cls);
    }
  });

  it('groups fynbos so scrub and heath read as one thing', () => {
    const layer = style.layers.find((l) => l.id === 'landcover') as {
      paint?: Record<string, unknown>;
    };
    const expr = JSON.stringify(layer.paint?.['fill-color']);
    // Both OSM tags describe the same vegetation on this peninsula; a reader
    // should not see two different greens for it.
    const scrubColour = expr.match(/"scrub","heath"[^"]*"(#[0-9a-f]{6})"/i);
    expect(scrubColour).not.toBeNull();
  });

  it('keeps landcover translucent enough for the hillshade to shape it', () => {
    const layer = style.layers.find((l) => l.id === 'landcover') as {
      paint?: Record<string, unknown>;
    };
    const opacity = layer.paint?.['fill-opacity'] as number;
    // Opaque would erase the shading underneath; near-zero would erase the
    // colour. Both are silent failures that look like "the palette is wrong".
    expect(opacity).toBeGreaterThanOrEqual(0.3);
    expect(opacity).toBeLessThanOrEqual(0.75);
  });

  it('labels settlements from the overview and suburbs only close in', () => {
    const settlement = style.layers.find((l) => l.id === 'places-settlement') as {
      minzoom?: number; filter?: unknown;
    };
    const suburb = style.layers.find((l) => l.id === 'places-suburb') as {
      minzoom?: number; filter?: unknown;
    };
    // The map opens near z10.3. City/town/village is 14 features in region —
    // the right density to orient by. Suburb is 231 and would bury everything.
    expect(settlement.minzoom ?? 0).toBeLessThanOrEqual(10);
    expect(suburb.minzoom).toBeGreaterThanOrEqual(13);
  });

  it('floors places-settlement below the opening view, not below the region', () => {
    // Mirror image of the peaks-headline floor: with no minzoom at all,
    // places-settlement's 14 labels stack into a few pixels over empty
    // background when zoomed out past the region, clamped to their lowest
    // text-size stop. 7 is not tuned to one measurement of the opening
    // zoom — it sits below the lowest plausible opening zoom across
    // viewports (9.92 in the Playwright pane, 10.3 in a desktop browser,
    // lower on a phone), the same margin peaks-headline's floor of 8 keeps.
    const settlement = style.layers.find((l) => l.id === 'places-settlement') as {
      minzoom?: number;
    };
    expect(settlement.minzoom).toBe(7);
  });

  it('splits places so the two tiers cannot both draw the same feature', () => {
    const settlement = style.layers.find((l) => l.id === 'places-settlement') as {
      filter?: unknown;
    };
    const suburb = style.layers.find((l) => l.id === 'places-suburb') as {
      filter?: unknown;
    };
    expect(JSON.stringify(settlement.filter)).toContain('city');
    expect(JSON.stringify(settlement.filter)).toContain('town');
    expect(JSON.stringify(settlement.filter)).toContain('village');
    expect(JSON.stringify(suburb.filter)).toContain('suburb');
    expect(JSON.stringify(settlement.filter)).not.toContain('suburb');
  });

  it('ranks settlements so a city outranks a village in a collision', () => {
    // Deep equality, matching the peak layers' equivalent assertion: a plain
    // toBeDefined() would still pass with city and village reversed.
    const settlement = style.layers.find((l) => l.id === 'places-settlement') as {
      layout?: Record<string, unknown>;
    };
    const expected = ['match', ['get', 'place'], 'city', 0, 'town', 1, 2];
    expect(settlement.layout?.['symbol-sort-key']).toEqual(expected);
  });

  it('draws place labels above the lines they sit on', () => {
    const ids = style.layers.map((l) => l.id);
    expect(ids.indexOf('places-settlement')).toBeGreaterThan(ids.indexOf('roads-major'));
    expect(ids.indexOf('places-settlement')).toBeGreaterThan(ids.indexOf('contours-index'));
  });
});

describe('region mask', () => {
  // planetiler's --bounds decides which tiles are built, not where their
  // features end -- an edge tile still carries whole roads and place labels
  // past SHIPPED_REGION, which then render on bare background. The mask
  // covers the rest of the world so the region reads as the whole map.
  const style = buildStyle('selfhosted', '');
  const maskLayer = style.layers[style.layers.length - 1] as {
    id: string; type: string; source: string; paint?: Record<string, unknown>;
  };
  const maskSource = style.sources['region-mask'] as {
    type: string; data: { geometry: { type: string; coordinates: number[][][] } };
  };

  it('is the last layer, so it draws over every basemap layer including leaking labels', () => {
    expect(maskLayer.id).toBe('region-mask');
    // Belt-and-braces: also confirm nothing else in the array claims the id,
    // i.e. this really is the layer at the tail, not a coincidental match.
    expect(style.layers.filter((l) => l.id === 'region-mask')).toHaveLength(1);
  });

  it('is a fill layer painted 20 points darker than the #f4f1ea background', () => {
    expect(maskLayer.type).toBe('fill');
    expect(maskLayer.source).toBe('region-mask');
    expect(maskLayer.paint?.['fill-color']).toBe('#e0dbd0');
  });

  it("derives the hole from SHIPPED_REGION.bbox, so a region change can't desync it", () => {
    const { west, south, east, north } = SHIPPED_REGION.bbox;
    const [outer, hole] = maskSource.data.geometry.coordinates;
    expect(maskSource.data.geometry.type).toBe('Polygon');
    // Outer ring: the whole world.
    expect(outer[0]).toEqual([-180, -85]);
    expect(outer).toContainEqual([180, 85]);
    // Hole: exactly the shipped region's bbox corners.
    const holeLons = hole.map((c) => c[0]);
    const holeLats = hole.map((c) => c[1]);
    expect(Math.min(...holeLons)).toBe(west);
    expect(Math.max(...holeLons)).toBe(east);
    expect(Math.min(...holeLats)).toBe(south);
    expect(Math.max(...holeLats)).toBe(north);
  });

  it('winds the outer ring counter-clockwise and the hole clockwise, per RFC 7946', () => {
    // Shoelace formula: positive signed area is counter-clockwise, negative
    // is clockwise, for coordinates given as (lon, lat).
    const signedArea = (ring: number[][]): number => {
      let sum = 0;
      for (let i = 0; i < ring.length - 1; i++) {
        const [x0, y0] = ring[i];
        const [x1, y1] = ring[i + 1];
        sum += x0 * y1 - x1 * y0;
      }
      return sum / 2;
    };
    const [outer, hole] = maskSource.data.geometry.coordinates;
    expect(signedArea(outer)).toBeGreaterThan(0);
    expect(signedArea(hole)).toBeLessThan(0);
  });

  it('closes both rings, since GeoJSON requires the first and last position to match', () => {
    const [outer, hole] = maskSource.data.geometry.coordinates;
    expect(outer[0]).toEqual(outer[outer.length - 1]);
    expect(hole[0]).toEqual(hole[hole.length - 1]);
  });
});
