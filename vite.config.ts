import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vitest/config'

// the build id printed in about: package version plus the short sha, or
// 'local' when the build is not from a checkout
const version = (JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }).version
let sha = 'local'
try { sha = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() } catch { /* no git, no sha */ }

export default defineConfig({
  define: { __BUILD__: JSON.stringify(`${version} · ${sha}`) },
  server: { host: '127.0.0.1', port: 4173 },
  preview: { host: '127.0.0.1', port: 4173 },
  test: { include: ['src/**/*.test.ts'] },
})
