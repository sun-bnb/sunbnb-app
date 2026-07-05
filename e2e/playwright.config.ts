import { defineConfig, devices } from '@playwright/test'

// E2E layer for the Sunbnb apps. Manual / on-demand only — NOT wired into turbo, CI,
// the pre-push hook, or the promote/deploy scripts (see README.md). Run with `npm run e2e`.
//
// The mkcert self-signed HTTPS + cookie-banner mechanics that the verifier-sunbnb skill's
// handle.mjs absorbs for ad-hoc verify scripts are reproduced here at the config/fixture level:
//   - ignoreHTTPSErrors  → mkcert (both the test context and the webServer readiness poll)
//   - cookie dismiss      → e2e/fixtures.ts (auto, per test)

const USER_APP = 'https://local.sunbnb.app:3002'

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL: USER_APP,
    ignoreHTTPSErrors: true, // mkcert — same as handle.mjs openApp()
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    viewport: { width: 1100, height: 900 },
  },

  // One project per test layer (see LAYERS.md). `smoke` is the boot precondition; `layer-0`
  // is the critical core (a few must-pass tests incl. the full partner→booking happy path);
  // layers 1-3 grade outward to "the rest". Run a layer with `--project=layer-N` (npm run e2e:lN),
  // the critical gate with `npm run e2e:critical`, or everything with `npm run e2e`.
  projects: [
    { name: 'smoke', testMatch: /smoke\.spec\.ts/, use: { ...devices['Desktop Chrome'] } },
    { name: 'layer-0', testDir: './tests/layer-0', use: { ...devices['Desktop Chrome'] } },
    { name: 'layer-1', testDir: './tests/layer-1', use: { ...devices['Desktop Chrome'] } },
    { name: 'layer-2', testDir: './tests/layer-2', use: { ...devices['Desktop Chrome'] } },
    { name: 'layer-3', testDir: './tests/layer-3', use: { ...devices['Desktop Chrome'] } },
  ],

  // Boot the user app if it isn't already up; reuse a dev server the developer already has
  // running. `source .env.local` because the custom HTTPS server (apps/user/server.js) needs it.
  webServer: {
    command: 'bash -c "source .env.local && npm run dev"',
    cwd: '../apps/user',
    url: USER_APP,
    ignoreHTTPSErrors: true,
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
