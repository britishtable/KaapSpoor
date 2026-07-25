import { test, expect } from '@playwright/test';

test('a done-toggle persists across reload', async ({ page }) => {
  await page.goto('/');
  // open the first route in the tree (not a nav link like "KaapSpoor" or "Settings")
  await page.getByTestId('route-link').first().click();
  const done = page.getByLabel(/mark done/i);
  await done.check();
  // The checkbox is controlled by a Svelte store that persists to IndexedDB
  // asynchronously; the DOM can briefly reflect "checked" before the write
  // resolves. Wait for the settled, post-write state before reloading.
  await expect(done).toBeChecked();
  await page.reload();
  await expect(page.getByLabel(/mark done/i)).toBeChecked();
});
