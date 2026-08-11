import { test, expect, type Page } from '@playwright/test';

const KASTEELSPOORT_ID = 'table-mountain--atlantic-west--kasteelspoort';
const KASTEELSPOORT_TITLE = 'Kasteelspoort path (KP)';
// One of the 31 area-approx routes, and one of the 7 stacked on the Table
// Mountain / Atlantic West centroid (r=3911 m) that the plan calls out as a
// known limitation. Its title is unique in the dataset, so the panel's search
// narrows to it alone.
const APPROX_TITLE = 'Slangolie Ravine';

/**
 * Rendered feature count for a layer, or -1 if the style has no such layer --
 * the same distinction the of() helper inside the opening-view test draws, and
 * for the same reason: queryRenderedFeatures does not throw for an unknown
 * layer, it returns [], so "absent" and "drew nothing" are otherwise identical.
 */
async function renderedCount(page: Page, layer: string): Promise<number> {
  return page.evaluate(async (id) => {
    const el = document.querySelector('[data-testid="map"]') as HTMLElement & {
      __maplibreMap?: import('maplibre-gl').Map;
    };
    const map = el.__maplibreMap!;
    if (!map.loaded() || map.isMoving()) {
      await new Promise<void>((resolve) => map.once('idle', () => resolve()));
    }
    return map.getLayer(id) ? map.queryRenderedFeatures(undefined, { layers: [id] }).length : -1;
  }, layer);
}

/**
 * Selects a route by clicking its row in the FULL, unfiltered tree.
 *
 * Deliberately not "filter to one route, then click it". Filtering leaves a
 * single feature in the pin source, which cannot cluster with anything -- and
 * that hid a real bug: with every route present, a selection framed on its
 * uncertainty bounds sits below clusterMaxZoom, so the selected point is inside
 * a cluster. The circle drew nothing in normal use while a filtered test passed.
 */
async function selectFromPanel(page: Page, title: string): Promise<void> {
  await page.getByTestId('route-link').filter({ hasText: title }).first().click();
  await expect(page.getByTestId('preview-body')).toBeVisible();
}

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
    // Wait for the map before touching the panel. Not because this test needs
    // the map, but because it needs the page to have stopped moving: until the
    // style loads, the sidebar is still reflowing under the pointer.
    await expect(page.locator('[data-testid="map"][data-map-ready="true"]')).toBeAttached({
      timeout: 15_000
    });

    const row = page.getByTestId('route-link').first();
    // Hover rather than click: a click previews the route (Phase 4c), which
    // replaces the tree and would take the row out of the document before the
    // shared selection state could be observed. Assert the hovered class, not
    // aria-current — a transient hover deliberately does not claim to be the
    // current item.
    //
    // The hover is retried, not just the assertion. This failed once in CI at
    // the subpath config and passed on re-run; it could not be reproduced in
    // isolation, nor under a 20x CPU throttle, so the mechanism is not proven.
    // What is certain is that toHaveClass already auto-retries and still failed,
    // so the highlight never arrived at all -- meaning the pointer was no longer
    // over the row (a reflow moving it away fires mouseleave) or the listener
    // was not yet attached when the event fired. Both are one-shot misses that
    // re-asserting can never recover and re-hovering always can. If hover truly
    // stops highlighting, this still fails: toPass exhausts its timeout.
    await expect(async () => {
      await row.hover();
      await expect(row).toHaveClass(/hovered/, { timeout: 1000 });
    }).toPass({ timeout: 15_000 });

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
    // fitBounds spans only the located routes inside BASEMAP_BOUNDS (now the
    // ~22x49 km Cape Town region, not the old province-wide box), so the
    // opening zoom sits far higher than the pre-recut z7-8 range -- this
    // measures the actual camera a visitor lands on rather than a hardcoded
    // value, so a framing regression fails here. The band has both a floor
    // (catches fitBounds widening back out to routes outside the region) and
    // a ceiling (catches bounds collapsing to a single point).
    await page.goto('');
    await expect(page.locator('[data-testid="map"][data-map-ready="true"]')).toBeAttached({
      timeout: 15_000
    });

    const countsAt = async (zoom?: number, center?: [number, number]) =>
      page.evaluate(
        async ({ z, c }) => {
          const el = document.querySelector('[data-testid="map"]') as HTMLElement & {
            __maplibreMap?: import('maplibre-gl').Map;
          };
          const map = el.__maplibreMap!;
          // Every call site either omits both zoom and center (measuring the
          // real opening camera) or passes both explicitly — there is no
          // camera this fell back to, so there is nothing to default.
          if (z !== undefined && c !== undefined) {
            map.jumpTo({ center: c, zoom: z });
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
            pins: of('pins') + of('pins-cluster'),
            landcover: of('landcover'),
            placesSettlement: of('places-settlement'),
            placesSuburb: of('places-suburb'),
            peaksHeadline: of('peaks-headline')
          };
        },
        { z: zoom, c: center }
      );

    // No zoom argument: measure the camera fitBounds actually left the map on.
    const overview = await countsAt();
    console.log(`observed opening zoom: ${overview.zoom}`);
    // The assertion that catches a framing regression directly: if boundsOf
    // widens back out to include routes with no basemap under them, this is
    // what fails first.
    expect(overview.zoom).toBeGreaterThan(9);
    expect(overview.zoom).toBeLessThan(15);

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

    // Phase 4b: the opening view must now show what it was given. These were
    // all in the archive and drawn by nothing before this plan.
    expect(overview.landcover).toBeGreaterThan(0);
    expect(overview.placesSettlement).toBeGreaterThan(0);
    // peaksHeadline is deliberately NOT asserted > 0 here. It passed in
    // Playwright's viewport by luck and measured 0 in a real browser at
    // z10.37 (Chrome): confirmed by hiding pins-cluster-count, which took
    // headline peaks from 0 -> 2. MapLibre places later symbol layers first,
    // so the route cluster badges win the collision against peak labels —
    // correct behaviour for a route-discovery map, since the clusters are the
    // point, but it makes this assertion viewport-dependent and flaky. Town
    // labels (placesSettlement, asserted above, rendered 6 in the browser)
    // are what actually orient the overview; peak labels are asserted at the
    // close-in camera below, where clusters have broken apart.
    // Suburbs are 231 features against 14 settlements — they must NOT be here.
    expect(overview.placesSuburb).toBe(0);
    // Absent layers return -1; a rename must fail loudly, not silently pass.
    // peaksHeadline is checked for existence only (see above for why its
    // count is not asserted here).
    for (const v of [overview.landcover, overview.placesSettlement, overview.peaksHeadline]) {
      expect(v).not.toBe(-1);
    }

    // Raster layers are not returned by queryRenderedFeatures, so assert
    // hillshade's presence in the style directly rather than a feature count.
    const hasHillshade = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="map"]') as HTMLElement & {
        __maplibreMap?: import('maplibre-gl').Map;
      };
      return !!el.__maplibreMap!.getLayer('hillshade');
    });
    expect(hasHillshade).toBe(true);

    // No single close-in camera gives every asserted layer real headroom: the
    // 6-camera grid measured for this plan found placesSuburb topping out at
    // 1 feature everywhere at z14/z15 (one label collision away from
    // flaking), while a z13 camera over the same area has it at 7 -- suburb
    // labels are densest right at their own minzoom, before the viewport
    // narrows. peaks-minor cannot be checked at z13 though: that tier starts
    // at z14. So the close-in check is split across the camera where each
    // subject actually has margin, rather than forcing one camera to cover
    // both and accepting a count of 1.

    // Suburbs at z13, the zoom places-suburb starts at and where they are
    // densest before the viewport narrows: 7 features here against 1 at any
    // z14 camera measured, so this does not sit one collision away from
    // failing.
    const suburbView = await countsAt(13, [18.42, -33.96]);
    expect(suburbView.paths).toBeGreaterThan(0);
    expect(suburbView.placesSuburb).toBeGreaterThan(0);

    // Peaks at z14 over Hout Bay/Llandudno, not an arbitrary close-in view:
    // peaks-minor moved to minzoom 14 in a later task of this plan (headline
    // >= 1000m at z8, major 600-999m at z12, minor <600m at z14), so z13
    // renders zero minor peaks everywhere -- that trap is exactly why this is
    // a second camera rather than reusing suburbView. Measured directly: this
    // camera renders Little Lion's Head (437 m) and Houtbaainek by name in
    // peaks-minor. The Table Mountain plateau camera was rejected for this
    // reason -- its named peaks (Blinkwater Peak, Table Mountain itself,
    // etc.) are mostly 900 m+ and land in peaks-major, not here.
    const peakView = await countsAt(14, [18.36, -34.02]);
    expect(peakView.paths).toBeGreaterThan(0);
    expect(peakView.peaksMinor).toBeGreaterThan(0);
  });

  test('constrains the camera to the region, so panning cannot wander off the map', async ({
    page
  }) => {
    // The map is a standalone region (see region.ts and style.ts's
    // region-mask layer), not a window onto a continuous world. Without
    // maxBounds a visitor could still pan clean off the region into the
    // masked-out space beyond it. This reads the real MapLibre camera
    // constraint back, rather than just checking a prop was passed somewhere.
    await page.goto('');
    await expect(page.locator('[data-testid="map"][data-map-ready="true"]')).toBeAttached({
      timeout: 15_000
    });

    const maxBounds = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="map"]') as HTMLElement & {
        __maplibreMap?: import('maplibre-gl').Map;
      };
      const b = el.__maplibreMap!.getMaxBounds();
      if (!b) return null;
      return { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() };
    });

    expect(maxBounds).not.toBeNull();
    // SHIPPED_REGION.bbox: west 18.27, south -34.33, east 18.51, north -33.89.
    // maxBounds must contain the whole region -- a tighter box would clip the
    // camera before it could ever frame the region fitBounds targets.
    expect(maxBounds!.west).toBeLessThanOrEqual(18.27);
    expect(maxBounds!.south).toBeLessThanOrEqual(-34.33);
    expect(maxBounds!.east).toBeGreaterThanOrEqual(18.51);
    expect(maxBounds!.north).toBeGreaterThanOrEqual(-33.89);
  });
});

test.describe('selection and uncertainty', () => {
  test('clicking a pin previews that route without leaving the map', async ({ page }) => {
    await page.goto('');
    await expect(page.locator('[data-testid="map"][data-map-ready="true"]')).toBeAttached({
      timeout: 15_000
    });

    const point = await jumpToKasteelspoort(page);
    const unscrolledBox = await page.locator('[data-testid="map"]').boundingBox();
    if (!unscrolledBox) throw new Error('map container has no bounding box');
    await page.evaluate(
      (y) => window.scrollTo(0, Math.max(0, y - window.innerHeight / 2)),
      unscrolledBox.y + point.y
    );
    const box = await page.locator('[data-testid="map"]').boundingBox();
    if (!box) throw new Error('map container has no bounding box');
    await page.mouse.click(box.x + point.x, box.y + point.y);

    // Scoped to the panel: the pin popup shows the title too, so an unscoped
    // assertion would pass without the preview existing at all.
    const preview = page.locator('.preview');
    await expect(page.getByTestId('preview-body')).toBeVisible();
    // Scoped to the panel: the pin popup names the route too, so an unscoped
    // match would pass on the popup alone and prove nothing about the preview.
    await expect(preview.getByRole('heading', { name: KASTEELSPOORT_TITLE })).toBeVisible();
    // Still on the map, which is the whole point.
    await expect(page).toHaveURL(/\/$|\/KaapSpoor\/$/);
  });

  test('selecting an approximate route draws its uncertainty circle', async ({ page }) => {
    await page.goto('');
    await expect(page.locator('[data-testid="map"][data-map-ready="true"]')).toBeAttached({
      timeout: 15_000
    });

    expect(await renderedCount(page, 'uncertainty')).toBe(0); // layer present, drawing nothing

    await selectFromPanel(page, APPROX_TITLE);

    expect(await renderedCount(page, 'uncertainty')).toBeGreaterThan(0);
  });

  test('selecting a surveyed route draws no uncertainty circle', async ({ page }) => {
    await page.goto('');
    await expect(page.locator('[data-testid="map"][data-map-ready="true"]')).toBeAttached({
      timeout: 15_000
    });

    await selectFromPanel(page, KASTEELSPOORT_TITLE);

    // Zero, not -1: the layer must still exist. A renamed or dropped layer has
    // to fail differently from one correctly drawing nothing.
    expect(await renderedCount(page, 'uncertainty')).toBe(0);
  });

  test('the lifted gate puts approximate routes on the map', async ({ page }) => {
    await page.goto('');
    await expect(page.locator('[data-testid="map"][data-map-ready="true"]')).toBeAttached({
      timeout: 15_000
    });

    const bySource = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="map"]') as HTMLElement & {
        __maplibreMap?: import('maplibre-gl').Map;
      };
      const source = el.__maplibreMap!.getSource('routes') as import('maplibre-gl').GeoJSONSource;
      const data = source.serialize().data as GeoJSON.FeatureCollection;
      const counts: Record<string, number> = {};
      for (const f of data.features) {
        const s = String(f.properties?.coordsSource);
        counts[s] = (counts[s] ?? 0) + 1;
      }
      return { counts, total: data.features.length };
    });

    // Deliberately not a hard-coded total, which drifts with every re-crawl.
    // Before the gate came off this count was exactly zero, and the total was
    // the surveyed count alone.
    const approx = bySource.counts['area-approx'] ?? 0;
    expect(approx).toBeGreaterThan(0);
    expect(bySource.total).toBeGreaterThan(bySource.total - approx);

    // Every approximate route must carry a radius, or its circle cannot be sized.
    const missingRadius = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="map"]') as HTMLElement & {
        __maplibreMap?: import('maplibre-gl').Map;
      };
      const source = el.__maplibreMap!.getSource('routes') as import('maplibre-gl').GeoJSONSource;
      const data = source.serialize().data as GeoJSON.FeatureCollection;
      return data.features.filter(
        (f) => f.properties?.coordsSource === 'area-approx' && !f.properties?.coordsAccuracyM
      ).length;
    });
    expect(missingRadius).toBe(0);
  });
});

test.describe('camera ownership', () => {
  test('panning is not undone by the selection, which owns the camera only once', async ({
    page
  }) => {
    // The camera responds to a CHANGE of selection. It used to re-issue its move
    // on every run of the effect that paints hover/selection state -- and that
    // effect depends on hoveredId, which the pins layer's own mouseenter fires
    // constantly while the pointer crosses pins. So panning away from a selected
    // route yanked you back the moment the cursor passed a pin. Measured before
    // the fix: two flyTo calls from pointer movement alone, returning the centre
    // to the selection exactly.
    await page.goto('');
    await expect(page.locator('[data-testid="map"][data-map-ready="true"]')).toBeAttached({
      timeout: 15_000
    });

    await page.getByTestId('route-link').filter({ hasText: KASTEELSPOORT_TITLE }).first().click();
    await expect(page.getByTestId('preview-body')).toBeVisible();

    const centre = () =>
      page.evaluate(async () => {
        const el = document.querySelector('[data-testid="map"]') as HTMLElement & {
          __maplibreMap?: import('maplibre-gl').Map;
        };
        const map = el.__maplibreMap!;
        if (map.isMoving()) await new Promise<void>((r) => map.once('idle', () => r()));
        const c = map.getCenter();
        return { lng: +c.lng.toFixed(5), lat: +c.lat.toFixed(5) };
      });

    const settled = await centre();

    const box = (await page.locator('[data-testid="map"]').boundingBox())!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) await page.mouse.move(cx - i * 20, cy + i * 6, { steps: 2 });
    await page.mouse.up();

    const panned = await centre();
    expect(panned).not.toEqual(settled);

    // Sweep the pointer across pins, which is what panning does incidentally.
    for (let i = 0; i < 30; i++) await page.mouse.move(box.x + 200 + i * 12, cy - 40, { steps: 1 });
    await page.waitForTimeout(1500);

    // The view the user panned to is still theirs.
    expect(await centre()).toEqual(panned);
  });

  test('selecting still takes the camera to the route, and again for the next one', async ({
    page
  }) => {
    // The other half of the contract above. Suppressing the camera on every
    // re-run must not suppress it on a real change of selection -- that failure
    // would look like "selection does nothing" and no other test would catch it.
    await page.goto('');
    await expect(page.locator('[data-testid="map"][data-map-ready="true"]')).toBeAttached({
      timeout: 15_000
    });

    const centre = () =>
      page.evaluate(async () => {
        const el = document.querySelector('[data-testid="map"]') as HTMLElement & {
          __maplibreMap?: import('maplibre-gl').Map;
        };
        const map = el.__maplibreMap!;
        if (map.isMoving()) await new Promise<void>((r) => map.once('idle', () => r()));
        const c = map.getCenter();
        return { lng: +c.lng.toFixed(5), lat: +c.lat.toFixed(5) };
      });

    const opening = await centre();

    await selectFromPanel(page, KASTEELSPOORT_TITLE);
    const first = await centre();
    expect(first).not.toEqual(opening);

    // A second, different route must move it again rather than staying put.
    await page.getByRole('button', { name: /close/i }).click();
    await selectFromPanel(page, APPROX_TITLE);
    const second = await centre();
    expect(second).not.toEqual(first);
  });

});

test.describe('pin popup', () => {
  test('states the grade without its trailing prose', async ({ page }) => {
    // The grade field is "<level><stars>: <prose>", and the prose runs to 132
    // characters on this route. A popup is an annotation on the map; dumping the
    // whole field turned it into a paragraph floating over the terrain.
    await page.goto('');
    await expect(page.locator('[data-testid="map"][data-map-ready="true"]')).toBeAttached({
      timeout: 15_000
    });

    const point = await page.evaluate(async () => {
      const el = document.querySelector('[data-testid="map"]') as HTMLElement & {
        __maplibreMap?: import('maplibre-gl').Map;
      };
      const map = el.__maplibreMap!;
      const routes = (await (await fetch('data/routes-index.json')).json()) as Array<{
        id: string;
        coords: { lon: number; lat: number } | null;
      }>;
      const t = routes.find((r) => r.id === 'table-mountain--atlantic-west--hairpin-route')!;
      map.jumpTo({ center: [t.coords!.lon, t.coords!.lat], zoom: 16 });
      await new Promise<void>((r) => map.once('idle', () => r()));
      const p = map.project([t.coords!.lon, t.coords!.lat]);
      return { x: p.x, y: p.y };
    });

    const box = (await page.locator('[data-testid="map"]').boundingBox())!;
    await page.mouse.click(box.x + point.x, box.y + point.y);

    const popup = page.locator('.route-popup');
    await expect(popup).toBeVisible();
    await expect(popup.locator('.rp-level')).toHaveText('5');
    await expect(popup).not.toContainText('bundu-bashing');
    // The grade reaches assistive tech as one fact, not as a run of glyph names.
    await expect(popup.locator('.rp-grade')).toHaveAttribute('aria-label', 'Grade 5, 1 star');
    await expect(page.getByRole('link', { name: 'Open route' })).toBeVisible();
  });
});

test.describe('named paths', () => {
  // Kasteelspoort's description names mapped paths; this is asserted rather
  // than assumed by the first test below, so a re-crawl that changed the prose
  // fails loudly here instead of quietly weakening every later assertion.
  test('highlights the paths a selected route names, and clears them again', async ({ page }) => {
    await page.goto('.');
    await expect(page.locator('[data-testid="map"][data-map-ready="true"]')).toBeAttached({
      timeout: 30_000
    });

    const namesFor = async (id: string) =>
      page.evaluate(async (routeId) => {
        const routes = (await (await fetch('data/routes-index.json')).json()) as Array<{
          id: string;
          mentionedPaths: string[];
        }>;
        return routes.find((r) => r.id === routeId)?.mentionedPaths ?? [];
      }, id);

    const expected = await namesFor(KASTEELSPOORT_ID);
    expect(expected.length).toBeGreaterThan(0);

    await selectFromPanel(page, KASTEELSPOORT_TITLE);

    const filterNames = async (layer: string) =>
      page.evaluate((id) => {
        const el = document.querySelector('[data-testid="map"]') as HTMLElement & {
          __maplibreMap?: import('maplibre-gl').Map;
        };
        // ['in', ['get','name'], ['literal', [...]]]
        const filter = el.__maplibreMap!.getFilter(id) as unknown[] | undefined;
        const literal = filter?.[2] as unknown[] | undefined;
        return (literal?.[1] as string[]) ?? [];
      }, layer);

    for (const layer of ['paths-referenced', 'paths-referenced-casing', 'paths-referenced-label']) {
      expect(await filterNames(layer)).toEqual(expected);
    }

    // The camera flies to z14 on selection, above the layer's z11 floor, so
    // the highlight must actually be on screen — not merely filtered for.
    expect(await renderedCount(page, 'paths-referenced')).toBeGreaterThan(0);

    await page.getByRole('button', { name: /close preview/i }).click();
    for (const layer of ['paths-referenced', 'paths-referenced-casing', 'paths-referenced-label']) {
      expect(await filterNames(layer)).toEqual([]);
    }
    expect(await renderedCount(page, 'paths-referenced')).toBe(0);
  });

  test('labels named paths once you are close in', async ({ page }) => {
    await page.goto('.');
    await expect(page.locator('[data-testid="map"][data-map-ready="true"]')).toBeAttached({
      timeout: 30_000
    });

    // Deliberately no assertion at the opening view: label placement there
    // turns on viewport luck and route cluster badges win the collision, so
    // such a test would pass or fail on pane size rather than correctness.
    await page.evaluate(async () => {
      const el = document.querySelector('[data-testid="map"]') as HTMLElement & {
        __maplibreMap?: import('maplibre-gl').Map;
      };
      const map = el.__maplibreMap!;
      // Table Mountain's upper contour path network, well inside the region.
      map.jumpTo({ center: [18.4028, -33.9575], zoom: 14 });
      await new Promise<void>((resolve) => map.once('idle', () => resolve()));
    });

    expect(await renderedCount(page, 'paths-named')).toBeGreaterThan(0);
  });
});
