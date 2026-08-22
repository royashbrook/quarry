import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  retries: process.env.CI ? 1 : 0, // absorb runner variance in ci, never locally
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:4177' },
  webServer: {
    // --host is explicit at the call site too: the url below is IPv4, so the server
    // must answer there or the runner waits out its timeout without running a test
    command: 'npm run build -- --mode test && npm run preview -- --host 127.0.0.1 --port 4177',
    url: 'http://127.0.0.1:4177',
    reuseExistingServer: false,
  },
})
