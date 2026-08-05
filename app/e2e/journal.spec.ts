import { test, expect } from '@playwright/test';

test('a done-toggle persists across reload', async ({ page }) => {
  await page.goto('');
  // open the first route in the tree (not a nav link like "KaapSpoor" or "Settings")
  await page.getByTestId('route-link').first().click();
  // Since Phase 4c a row click previews the route in the panel rather than
  // navigating. The journal controls live on the full route page, which the
  // preview's own link is now the way to reach: same intent as before, one step
  // longer, and it exercises the path a user actually takes.
  await page.getByRole('link', { name: /full route/i }).click();
  const done = page.getByLabel(/mark done/i);
  await done.check();
  // The checkbox is controlled by a Svelte store that persists to IndexedDB
  // asynchronously; the DOM can briefly reflect "checked" before the write
  // resolves. Wait for the settled, post-write state before reloading.
  await expect(done).toBeChecked();
  await page.reload();
  await expect(page.getByLabel(/mark done/i)).toBeChecked();
});
