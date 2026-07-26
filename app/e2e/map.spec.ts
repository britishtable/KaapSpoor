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
});
