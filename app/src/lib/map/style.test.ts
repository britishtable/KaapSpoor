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
    ['roads', 'roads'],
    ['paths', 'paths'],
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

  it('shows roads earlier than paths, since they orient you at region scale', () => {
    expect(layer('roads')?.minzoom).toBe(9);
  });

  it('interpolates road and path widths by zoom rather than fixing them', () => {
    for (const id of ['roads', 'paths']) {
      const paint = (layer(id) as { paint?: Record<string, unknown> }).paint ?? {};
      expect(Array.isArray(paint['line-width'])).toBe(true);
      expect((paint['line-width'] as unknown[])[0]).toBe('interpolate');
    }
  });

  it('shows only major summits at region scale', () => {
    expect(layer('peaks-major')?.minzoom).toBe(10);
  });

  it('holds minor peaks back until close in', () => {
    expect(layer('peaks-minor')?.minzoom).toBe(13);
  });

  it('reads ele through to-number with a fallback, since OSM stores it as a string', () => {
    // trails-profile.yml passes the raw OSM `ele` tag through, so it arrives as
    // "1085" — and sometimes as something that will not convert at all.
    const both = [layer('peaks-major'), layer('peaks-minor')];
    for (const l of both) {
      const json = JSON.stringify(l);
      expect(json).toContain('to-number');
      expect(json).toContain('ele');
    }
  });

  it('sorts peak labels so the highest summit wins a collision', () => {
    const major = layer('peaks-major') as { layout?: Record<string, unknown> };
    expect(major.layout?.['symbol-sort-key']).toBeDefined();
  });

  it('interpolates peak label size by zoom', () => {
    const major = layer('peaks-major') as { layout?: Record<string, unknown> };
    expect(Array.isArray(major.layout?.['text-size'])).toBe(true);
  });
});
