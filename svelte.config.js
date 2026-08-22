import adapter from '@sveltejs/adapter-static'
import { execSync } from 'node:child_process'

// major.minor from the last git tag, patch = commits since it. the tag MUST be
// major.minor (v0.1, not v0.1.0): the helper appends commits-since to the whole
// tag, so a 3-part tag yields a 4-part stamp and breaks the canonical vX.Y.Z. the
// no-tag fallback is numeric 0.0.<commit-count> so it satisfies the same anchored
// ^\d+\.\d+\.\d+$ gate the build asserts (a 0.0.0-dev+sha suffix would fail it).
function appVersion() {
  try {
    const tag = execSync('git describe --tags --abbrev=0', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
    const since = execSync(`git rev-list ${tag}..HEAD --count`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
    return `${tag.replace(/^v/, '')}.${since}`
  } catch {
    try {
      const count = execSync('git rev-list HEAD --count', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
      return `0.0.${count}`
    } catch {
      return '0.0.0'
    }
  }
}

/** @type {import('@sveltejs/kit').Config} */
export default {
  kit: {
    // one prerendered page, no server: the whole game is a canvas and a localStorage save
    adapter: adapter({ pages: 'build', assets: 'build', precompress: false, strict: true }),
    // served at its own origin root, keep asset urls relative anyway (matches the pilot)
    paths: { relative: true },
    // poll the deployed version so kit knows an update exists (the honest
    // running-vs-deployed check the About screen reads)
    version: { name: appVersion(), pollInterval: 300000 },
    // the worker is registered by hand in +layout.svelte so dev never gets a stale one
    serviceWorker: { register: false },
  },
}
