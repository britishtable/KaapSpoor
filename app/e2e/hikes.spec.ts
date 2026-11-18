import { test, expect } from '@playwright/test';

test('a started and finished hike, and a past hike with no date, persist across reload', async ({ page }) => {
  await page.goto('');
  // Wait for hydration before clicking the row. A route row is a real <a href>,
  // and only the Svelte handler suppresses its navigation -- so a click landing
  // before hydration follows the link straight to the route page instead of
  // previewing, and the preview link this test then looks for never appears.
  // (That degradation is correct for a user; it just makes the next step
  // conditional, which a test should not have to be.) data-map-ready is the
  // signal the rest of the suite already uses.
  await expect(page.locator('[data-testid="map"][data-map-ready="true"]')).toBeAttached({
    timeout: 15_000
  });

  // open the first route in the tree (not a nav link like "KaapSpoor" or "Settings")
  await page.getByTestId('route-link').first().click();
  // Since Phase 4c a row click previews the route in the panel rather than
  // navigating. The hike log lives on the full route page, which the
  // preview's own link is now the way to reach: same intent as before, one step
  // longer, and it exercises the path a user actually takes.
  await page.getByRole('link', { name: /full route/i }).click();

  await page.getByRole('button', { name: 'Start hike' }).click();
  await page.getByRole('button', { name: 'Finish hike' }).click();
  // The store persists to IndexedDB asynchronously; wait for the settled UI
  // (the finished line) before reloading.
  await expect(page.getByText('Hike finished. Nice one.')).toBeVisible();
  await page.reload();

  const list = page.locator('.hikes li');
  await expect(list).toHaveCount(1);
  const today = new Intl.DateTimeFormat('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })
    .format(new Date());
  await expect(list.first()).toContainText(today);

  await page.getByRole('button', { name: 'Log a past hike' }).click();
  await page.getByLabel("I don't remember the date").check();
  await page.getByRole('button', { name: 'Save hike' }).click();
  await expect(page.getByText('Date not recorded')).toBeVisible();
  await page.reload();
  await expect(page.locator('.hikes li')).toHaveCount(2);
  await expect(page.getByText('Date not recorded')).toBeVisible();
});
