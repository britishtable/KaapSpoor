import { test, expect, type Page } from '@playwright/test';

type Target = { id: string; on: [number, number]; off: [number, number] };

/** A route with a drawn line, a point half way along it, and one about 200 m off every part of it. */
async function findTarget(page: Page): Promise<Target | null> {
  await page.goto('');
  return page.evaluate(async () => {
    const routes = (await (await fetch('data/routes-index.json')).json()) as Array<{
      id: string; hasLine: boolean; coords: unknown;
    }>;
    const lines = (await (await fetch('data/route-lines.geojson')).json()) as {
      features: { properties: { routeId: string; role: string }; geometry: { coordinates: number[][] } }[];
    };
    const metres = (a: number[], b: number[]) =>
      Math.hypot((a[0] - b[0]) * 92_300, (a[1] - b[1]) * 111_320);
    for (const r of routes.filter((x) => x.hasLine && x.coords)) {
      const mine = lines.features.filter((f) => f.properties.routeId === r.id);
      const main = mine.find((f) => f.properties.role === 'main') ?? mine[0];
      if (!main) continue;
      const c = main.geometry.coordinates;
      const on = c[Math.floor(c.length / 2)];
      const all = mine.flatMap((f) => f.geometry.coordinates);
      // Step away in eight directions until a point is at least 180 m from every vertex.
      for (let reach = 200; reach <= 1000; reach += 100) {
        for (let k = 0; k < 8; k++) {
          const a = (k * Math.PI) / 4;
          const off = [on[0] + (Math.cos(a) * reach) / 92_300, on[1] + (Math.sin(a) * reach) / 111_320];
          if (all.every((p) => metres(p, off) > 180)) {
            return { id: r.id, on: [on[0], on[1]], off: [off[0], off[1]] } as const;
          }
        }
      }
    }
    return null;
  }) as Promise<Target | null>;
}

const at = (p: [number, number]) => ({ longitude: p[0], latitude: p[1], accuracy: 8 });

test.describe('live position', () => {
  test.beforeEach(async ({ context, page }) => {
    await context.grantPermissions(['geolocation']);
    // Counts the watches the page has open; an init script survives navigations in this page.
    await page.addInitScript(() => {
      const w = window as unknown as { __watching: number };
      w.__watching = 0;
      const geo = navigator.geolocation;
      const watch = geo.watchPosition.bind(geo);
      const clear = geo.clearWatch.bind(geo);
      geo.watchPosition = (...args) => { w.__watching++; return watch(...args); };
      geo.clearWatch = (id) => { w.__watching--; clear(id); };
    });
  });
  const watching = (page: Page) =>
    page.evaluate(() => (window as unknown as { __watching: number }).__watching);

  test('on route, then off it, with distances and a mark on the map and profile', async ({ context, page }) => {
    const target = await findTarget(page);
    test.skip(!target, 'no route in this build has a line yet');
    await context.setGeolocation(at(target!.on));
    await page.goto(`route/${target!.id}`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Show where I am' }).click();
    await expect(page.getByText('On route', { exact: true })).toBeVisible();
    await expect(page.getByTestId('live-distances')).toHaveText(/^\S+ k?m done · \S+ k?m to go$/);

    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const el = document.querySelector('[data-testid="locator-map"]') as HTMLElement & {
              __maplibreMap?: import('maplibre-gl').Map;
            };
            const map = el.__maplibreMap;
            return map?.getLayer('position') ? map.queryRenderedFeatures(undefined, { layers: ['position'] }).length : 0;
          }),
        { timeout: 20_000 }
      )
      .toBeGreaterThan(0);

    await context.setGeolocation(at(target!.off));
    await expect(page.getByText(/^Off route by \S+ k?m$/)).toBeVisible();
  });

  test('leaving the route page stops the watch', async ({ context, page }) => {
    const target = await findTarget(page);
    test.skip(!target, 'no route in this build has a line yet');
    await context.setGeolocation(at(target!.on));
    await page.goto(`route/${target!.id}`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Show where I am' }).click();
    await expect.poll(() => watching(page)).toBe(1);
    // A client-side navigation: the document, and so the counter, lives on.
    await page.getByRole('link', { name: 'Home' }).first().click();
    await expect(page.getByRole('button', { name: 'Stop showing where I am' })).toHaveCount(0);
    await expect.poll(() => watching(page)).toBe(0);
  });
});
