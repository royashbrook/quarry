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
