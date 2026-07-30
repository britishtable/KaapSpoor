import { test, expect, type Page } from '@playwright/test';

const KASTEELSPOORT_ID = 'table-mountain--atlantic-west--kasteelspoort';

// MapView stashes the live MapLibre instance on the map container for tests
// only (see the __maplibreMap comment in MapView.svelte) — WebGL pixels are
// not queryable from Playwright, and it is the only way to assert on real
// MapLibre state such as feature ids and rendered/source feature counts.
// Pins cluster below zoom 13 (clusterMaxZoom), so tests that need an
// individual, un-clustered pin jump to a known route at zoom 15 first.
async function jumpToKasteelspoort(page: Page): Promise<{ x: number; y: number }> {
  return page.evaluate(async (id) => {
    const el = document.querySelector('[data-testid="map"]') as HTMLElement & {
      __maplibreMap?: import('maplibre-gl').Map;
    };
    const map = el.__maplibreMap!;
    // Relative fetch: resolves under whichever project's base path the
    // current document was served from (see playwright.config.ts).
    const routes = (await (await fetch('data/routes-index.json')).json()) as Array<{
      id: string;
      coords: { lon: number; lat: number } | null;
    }>;
    const target = routes.find((r) => r.id === id);
    if (!target?.coords) throw new Error(`fixture route ${id} has no coords`);
    map.jumpTo({ center: [target.coords.lon, target.coords.lat], zoom: 15 });
    await new Promise<void>((resolve) => map.once('idle', () => resolve()));
    const point = map.project([target.coords.lon, target.coords.lat]);
    return { x: point.x, y: point.y };
  }, KASTEELSPOORT_ID);
}

test.describe('map', () => {
  test('mounts a WebGL canvas', async ({ page }) => {
    await page.goto('');
    const canvas = page.locator('[data-testid="map"] canvas');
    await expect(canvas).toBeVisible();
  });

  test('adds the pin layer once the style has loaded', async ({ page }) => {
    await page.goto('');
    // MapView sets data-map-ready only after the style load event fired and the
    // pins layer was added, so this asserts the real thing rather than merely
    // that a canvas element exists.
    await expect(page.locator('[data-testid="map"][data-map-ready="true"]')).toBeAttached({
      timeout: 15_000
    });
  });

  test('shows the OpenStreetMap attribution the licence requires', async ({ page }) => {
    await page.goto('');
    await expect(page.locator('.maplibregl-ctrl-attrib')).toContainText('OpenStreetMap');
  });

  test('offers a geolocate control', async ({ page }) => {
    await page.goto('');
    await expect(page.locator('.maplibregl-ctrl-geolocate')).toBeVisible();
  });

  test('hovering a panel row highlights it, proving the map/panel sync', async ({ page }) => {
    await page.goto('');
    const row = page.getByTestId('route-link').first();
    // Hover rather than click: a click navigates away, which would end the test
    // before the shared selection state could be observed. Assert the hovered
    // class, not aria-current — a transient hover deliberately does not claim
    // to be the current item.
    await row.hover();
    await expect(row).toHaveClass(/hovered/);
    await expect(row).not.toHaveAttribute('aria-current', 'true');
  });

  test('a located route page shows its locator map', async ({ page }) => {
    await page.goto('route/table-mountain--atlantic-west--kasteelspoort');
    await expect(page.getByTestId('locator-map')).toBeVisible();
  });

  test('promoteId binds real string feature ids, so setFeatureState can match them', async ({
    page
  }) => {
    // Regression proof for: MapLibre GeoJSON sources parseInt() a string
    // feature.id (routes-index.svelte-shared/maplibre-gl-shared-dev.mjs:
    // "if (typeof feature.id === 'string') this.id = parseInt(feature.id, 10)"),
    // which turns our slug ids ("table-mountain--...") into NaN. Without
    // `promoteId: 'id'` on the source, setFeatureState({id: '<slug>'}) would
    // never match a rendered feature and done/active pin styling would be
    // silently dead. This asserts the id MapLibre actually rendered with is
    // the real slug string, not NaN/undefined/a number.
    await page.goto('');
    await expect(page.locator('[data-testid="map"][data-map-ready="true"]')).toBeAttached({
      timeout: 15_000
    });

    await jumpToKasteelspoort(page);

    const ids = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="map"]') as HTMLElement & {
        __maplibreMap?: import('maplibre-gl').Map;
      };
      const features = el.__maplibreMap!.queryRenderedFeatures(undefined, { layers: ['pins'] });
      return features.map((f) => f.id);
    });

    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      expect(typeof id).toBe('string');
      expect(id).not.toBe('NaN');
      expect((id as string).length).toBeGreaterThan(0);
    }
    expect(ids).toContain(KASTEELSPOORT_ID);
  });

  test('filtering the panel also filters the map pins, not just the list', async ({ page }) => {
    // +page.svelte passes the *filtered* entries into MapView. Before the fix,
    // MapView wrote the GeoJSON source once inside map.on('load') and never
    // again, so this would have stayed at the unfiltered count.
    await page.goto('');
    await expect(page.locator('[data-testid="map"][data-map-ready="true"]')).toBeAttached({
      timeout: 15_000
    });

    const pinCount = () =>
      page.evaluate(() => {
        const el = document.querySelector('[data-testid="map"]') as HTMLElement & {
          __maplibreMap?: import('maplibre-gl').Map;
        };
        const source = el.__maplibreMap!.getSource('routes') as import('maplibre-gl').GeoJSONSource;
        // serialize().data is exactly what was last passed to setData — the
        // ground truth of what the map's been told to show, independent of
        // clustering/zoom/viewport, which querying rendered features is not.
        const data = source.serialize().data as GeoJSON.FeatureCollection;
        return data.features.length;
      });

    const before = await pinCount();
    expect(before).toBeGreaterThan(1);

    await page.getByLabel('Search routes').fill('Kasteelspoort');
    await expect.poll(pinCount).toBeLessThan(before);
    expect(await pinCount()).toBeGreaterThanOrEqual(1);
  });

  test('fills the viewport instead of stretching to the sidebar content height', async ({
    page
  }) => {
    // Regression test for a bug where body { min-height: 100dvh } (rather than
    // height) left main's flex-basis, and therefore .split's `height: 100%`,
    // resolving against content size instead of the viewport. With all 184
    // routes rendered inside always-open <details>, the sidebar's full content
    // height became the height every ancestor -- main, .split, and the map
    // pane -- stretched to match (measured at 7180px against a 720px
    // viewport), and the sidebar's own overflow-y: auto never engaged because
    // its box was unbounded. This asserts the map pane stays viewport-sized,
    // the home page itself does not scroll, and the sidebar scrolls
    // internally instead.
    await page.goto('');
    await expect(page.locator('[data-testid="map"][data-map-ready="true"]')).toBeAttached({
      timeout: 15_000
    });

    const viewport = page.viewportSize();
    if (!viewport) throw new Error('no viewport size');

    const headerHeight = await page.locator('header').evaluate((el) => el.getBoundingClientRect().height);
    const expectedMapHeight = viewport.height - headerHeight;

    const mapHeight = await page
      .locator('[data-testid="map"]')
      .evaluate((el) => el.getBoundingClientRect().height);
    // Within 10% of the viewport-minus-header height -- nowhere close to the
    // ~10x-too-tall figure the bug produced.
    expect(mapHeight).toBeGreaterThan(expectedMapHeight * 0.9);
    expect(mapHeight).toBeLessThan(expectedMapHeight * 1.1);

    const scrollHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    // A small tolerance for scrollbars/subpixel rounding, not the ~10x
    // overflow the bug produced.
    expect(scrollHeight).toBeLessThan(viewport.height + 20);

    const sidebar = await page
      .locator('.split aside')
      .evaluate((el) => ({ scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }));
    // All 184 routes are rendered at once, so the sidebar's content is
    // guaranteed to overflow its box -- proving it scrolls internally rather
    // than growing the page.
    expect(sidebar.scrollHeight).toBeGreaterThan(sidebar.clientHeight);
  });

  test('clicking a pin opens a popup whose route link navigates client-side', async ({ page }) => {
    // Also covers the setHTML -> setDOMContent change: the popup must still
    // render the title/grade/link correctly when built from DOM nodes.
    await page.goto('');
    await expect(page.locator('[data-testid="map"][data-map-ready="true"]')).toBeAttached({
      timeout: 15_000
    });

    const point = await jumpToKasteelspoort(page);
    // The map pane can be far taller than the viewport (it stretches to the
    // full, always-expanded route-tree sidebar's content height rather than
    // being clipped to the viewport — a pre-existing layout characteristic,
    // not something this fix wave touches), so the projected pixel is
    // frequently well below the visible area. Scroll it into view before
    // measuring the container's on-screen position, or the click below lands
    // outside the viewport entirely.
    const unscrolledBox = await page.locator('[data-testid="map"]').boundingBox();
    if (!unscrolledBox) throw new Error('map container has no bounding box');
    const docY = unscrolledBox.y + point.y;
    await page.evaluate((y) => window.scrollTo(0, Math.max(0, y - window.innerHeight / 2)), docY);

    const box = await page.locator('[data-testid="map"]').boundingBox();
    if (!box) throw new Error('map container has no bounding box');
    await page.mouse.click(box.x + point.x, box.y + point.y);

    const link = page.getByRole('link', { name: 'Open route' });
    await expect(link).toBeVisible();

    // A full page load tears down the JS realm and any global set on
    // `window`; a client-side SvelteKit navigation does not. This is the
    // most direct way to tell the two apart from outside the page.
    await page.evaluate(() => {
      (window as unknown as { __kaapspoorNoReload?: boolean }).__kaapspoorNoReload = true;
    });

    await link.click();

    await expect(page).toHaveURL(new RegExp(`route/${KASTEELSPOORT_ID}$`));
    expect(
      await page.evaluate(
        () => (window as unknown as { __kaapspoorNoReload?: boolean }).__kaapspoorNoReload
      )
    ).toBe(true);
  });

  test('the opening view is not buried under paths and minor peaks', async ({ page }) => {
    // fitBounds spans every located route, including three (Otter, Robberg, Mt
    // Zebra Park) far outside the basemap's tile bbox, which pushes the real
    // opening zoom well below the z7.97 an earlier fix assumed -- measured
    // z6.89 desktop / ~z4.7 mobile before the framing fix in geojson.ts's
    // boundsOf/BASEMAP_BOUNDS. This measures the actual camera a visitor
    // lands on rather than a hardcoded z8, so a framing regression fails here.
    await page.goto('');
    await expect(page.locator('[data-testid="map"][data-map-ready="true"]')).toBeAttached({
      timeout: 15_000
    });

    const countsAt = async (zoom?: number) =>
      page.evaluate(async (z) => {
        const el = document.querySelector('[data-testid="map"]') as HTMLElement & {
          __maplibreMap?: import('maplibre-gl').Map;
        };
        const map = el.__maplibreMap!;
        if (z !== undefined) {
          map.jumpTo({ center: [18.42, -33.96], zoom: z });
        }
        // Only wait for 'idle' if the map isn't already settled -- it's only
        // guaranteed to fire again if something is still moving/loading, and
        // when z is omitted (measuring the real opening camera) the map may
        // already be idle by the time this runs.
        if (!map.loaded() || map.isMoving()) {
          await new Promise<void>((resolve) => map.once('idle', () => resolve()));
        }
        // queryRenderedFeatures does NOT throw for an unknown layer — it fires
        // an error event and returns []. So "layer absent" and "layer drew
        // nothing" are indistinguishable from its return value alone, and at
        // the opening view the expected count is 0 for exactly the layers most
        // worth protecting. Ask the style directly instead.
        const of = (id: string) =>
          map.getLayer(id) ? map.queryRenderedFeatures(undefined, { layers: [id] }).length : -1;
        return {
          zoom: map.getZoom(),
          paths: of('paths'),
          peaksMinor: of('peaks-minor'),
          peaksMajor: of('peaks-major'),
          roadsMajor: of('roads-major'),
          pins: of('pins') + of('pins-cluster')
        };
      }, zoom);

    // No zoom argument: measure the camera fitBounds actually left the map on.
    const overview = await countsAt();
    console.log(`observed opening zoom: ${overview.zoom}`);
    // The assertion that catches a framing regression directly: if boundsOf
    // widens back out to include routes with no basemap under them, this is
    // what fails first.
    expect(overview.zoom).toBeGreaterThan(7);

    // -1 means the layer is missing from the style entirely — a rename or a
    // deletion, which must fail differently from "correctly scoped out".
    expect(overview.paths).not.toBe(-1);
    expect(overview.peaksMinor).not.toBe(-1);
    expect(overview.roadsMajor).not.toBe(-1);
    expect(overview.paths).toBe(0);
    expect(overview.peaksMinor).toBe(0);
    // The pins are the point of the map: at the zoom it opens on, they must be
    // the thing that renders.
    expect(overview.pins).toBeGreaterThan(0);
    // Regression proof for the over-correction this fix addresses: hiding
    // roads entirely left the overview blank apart from background, water and
    // pins. Trunk/primary roads must still render at the opening view.
    expect(overview.roadsMajor).toBeGreaterThan(0);

    // z13 over the Atlantic seaboard, not an arbitrary close-in view: a
    // screenshot of exactly this camera showed Blinkwater Needle, Blinkwater
    // Peak, St Michael Peak, Fernwood Peak, Junction Peak, Cleft Peak, Reserve
    // Peak and Fountain Peak — all named, all under 1000 m, so all in the minor
    // layer. Picking a plateau view instead could legitimately render zero
    // minor peaks and fail for being right.
    const closeIn = await countsAt(13);
    expect(closeIn.paths).toBeGreaterThan(0);
    expect(closeIn.peaksMinor).toBeGreaterThan(0);
  });
});
