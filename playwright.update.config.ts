import { defineConfig } from '@playwright/test'

// the A -> B service-worker update proof (tests/sw-update.spec.ts) builds two real
// versions and serves them from its own server, swapping the deployment mid-test.
// vite preview cannot do that, and the main run's preview server holds the port for
// its whole life, so this spec is its own invocation with no webServer: the spec
// listens on the suite's port itself. `npm run test:e2e` chains the two runs.
const port = Number(process.env.PORT || 4177)

export default defineConfig({
  testDir: './tests',
  testMatch: 'sw-update.spec.ts',
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  use: { baseURL: `http://127.0.0.1:${port}` },
})
