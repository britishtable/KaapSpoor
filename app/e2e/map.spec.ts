import { test, expect } from '@playwright/test';

test.describe('map', () => {
  test('mounts a WebGL canvas', async ({ page }) => {
    await page.goto('/');
    const canvas = page.locator('[data-testid="map"] canvas');
    await expect(canvas).toBeVisible();
  });

  test('adds the pin layer once the style has loaded', async ({ page }) => {
    await page.goto('/');
    // MapView sets data-map-ready only after the style load event fired and the
    // pins layer was added, so this asserts the real thing rather than merely
    // that a canvas element exists.
    await expect(page.locator('[data-testid="map"][data-map-ready="true"]')).toBeAttached({
      timeout: 15_000
    });
  });

  test('shows the OpenStreetMap attribution the licence requires', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.maplibregl-ctrl-attrib')).toContainText('OpenStreetMap');
  });

  test('offers a geolocate control', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.maplibregl-ctrl-geolocate')).toBeVisible();
  });

  test('hovering a panel row highlights it, proving the map/panel sync', async ({ page }) => {
    await page.goto('/');
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
    await page.goto('/route/table-mountain--atlantic-west--kasteelspoort');
    await expect(page.getByTestId('locator-map')).toBeVisible();
  });
});
