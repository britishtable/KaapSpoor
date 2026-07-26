import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173',
    port: 4173,
    reuseExistingServer: false,
    timeout: 120_000
  },
  // Trailing slash matters: specs goto()/click relative URLs with no leading
  // slash (e.g. 'route/x', not '/route/x') so they resolve underneath
  // whichever config's base path — see playwright.subpath.config.ts, whose
  // baseURL has a real path component. Per the WHATWG URL spec a leading '/'
  // re-roots at the origin, which would silently drop a base path prefix;
  // consistent trailing-slash baseURLs plus leading-slash-free specs avoid
  // that regardless of which config is running.
  use: { baseURL: 'http://localhost:4173/' }
});
