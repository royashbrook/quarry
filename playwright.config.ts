import { defineConfig } from '@playwright/test'

// the port is an env knob so parallel checkouts can each run the suite on a port of
// their own. 4177 stays the default, so a plain `npm run test:e2e` is unchanged.
const port = process.env.PORT || 4177

export default defineConfig({
  testDir: './tests',
  // the two-build update proof serves its own builds on this same port, so it runs
  // as its own invocation after this one (playwright.update.config.ts)
  testIgnore: 'sw-update.spec.ts',
  retries: process.env.CI ? 1 : 0, // absorb runner variance in ci, never locally
  // headless chromium paints the canvas in software, so at the default 1280x720 a
  // click waits seconds for two stable frames: the click-heavy specs (sheets, contrast,
  // reset) run 20-28s here and the ci runner is slower still (sheets timed out at 30s
  // on its first ci run). menu.spec carried this per file; it is the suite's floor.
  timeout: 60_000,
  workers: 1,
  use: { baseURL: `http://127.0.0.1:${port}` },
  webServer: {
    // --host is explicit at the call site too: the url below is IPv4, so the server
    // must answer there or the runner waits out its timeout without running a test
    command: `npm run build -- --mode test && npm run preview -- --host 127.0.0.1 --port ${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
  },
})
