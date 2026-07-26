import { defineConfig } from '@playwright/test';

// Runs the same e2e/ specs a second time against a production-shaped build:
// BASE_PATH=/KaapSpoor, exactly what .github/workflows/deploy.yml ships,
// on a different port so this webServer never collides with
// playwright.config.ts's own. Every route this branch fixed — the maplibre
// worker URL, pmtiles URLs, font URLs, in-app links — was base-path
// dependent, so a suite that only ever exercised BASE_PATH='' would pass CI
// while shipping a broken production site.
//
// A separate config (not a second Playwright "project" sharing one config)
// on purpose: Playwright starts every webServer concurrently and does not
// wait for one to finish before starting another, so two `npm run build`
// invocations under a single config's webServer list would race on the
// static/maplibre and static/data output that `npm run build` writes as a
// side effect. Two full sequential `playwright test` runs — see package.json's
// "test:e2e" — cost a bit more time but avoid that race entirely.
const PORT = 4174;
const BASE_PATH = '/KaapSpoor';

export default defineConfig({
  testDir: './e2e',
  webServer: {
    command: `npm run build && npm run preview -- --port ${PORT}`,
    port: PORT,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { BASE_PATH }
  },
  use: { baseURL: `http://localhost:${PORT}${BASE_PATH}/` }
});
