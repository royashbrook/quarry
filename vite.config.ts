import { sveltekit } from '@sveltejs/kit/vite'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [sveltekit()],
  build: { sourcemap: true },
  // bind IPv4 explicitly. the default binding answers on ::1, while playwright's
  // baseURL waits on 127.0.0.1, so the runner times out before a single test runs.
  // this was in the pre-conversion config and the rewrite dropped it.
  server: { host: '127.0.0.1', port: 4173 },
  preview: { host: '127.0.0.1', port: 4173 },
  // the deterministic engine's unit suite: engine.test.ts imports src/engine.ts in
  // node, the same module the UI imports, so seed-determinism is proven the same way
  // after the svelte wrap as before it
  test: { include: ['src/**/*.test.ts'] },
})
