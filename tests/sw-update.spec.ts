import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { cpSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// the honest-update proof, A to B (docs/svelte-conversion.md). not "the store exists"
// but a real transition through the PRODUCTION version path: version A is this
// commit built by the real helper (svelte.config.js appVersion, git tag + commits
// since), version B is the same tree one commit later, built the same way. nothing is
// hand-edited. the test boots A, installs its worker, then the deployment changes
// under the same origin and the test proves:
//
//   - the app reaches update-ready off the genuine version delta, via a SECOND
//     network request for /_app/version.json (the worker serves it network first:
//     cache-first here was the pilot's stale-boot scar)
//   - the worker itself finds, installs and activates B, and takes the page over
//   - one tap reloads into B, and B still boots offline (its precache is real)
//
// both builds are production builds, so this is also the proof that the test hooks
// (window.__quarry, window.__quarryLifecycle) are absent from the shipped bundle.
//
// this spec runs under playwright.update.config.ts with no webServer: it serves the
// two builds itself on the suite's port, because the deployment has to change
// mid-test and vite preview cannot do that.

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const PORT = Number(process.env.PORT || 4177)
const MIME: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.map': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.txt': 'text/plain',
}

type Build = { dir: string; version: string }

// what a build is made of. the clone gives the git state the version helper reads;
// the sources come from THIS working tree, copied over the clone, so an uncommitted
// edit is under test here exactly as it is in the main suite (a clone alone builds
// HEAD, and a local worker edit would then pass untested until committed)
const SOURCES = ['src', 'static', 'svelte.config.js', 'vite.config.ts', 'tsconfig.json', 'package.json']

// clone this checkout, optionally one commit further on, and build it for production.
// the clone shares node_modules by symlink. the version stamp is whatever the helper
// says for that clone's git state, which is the whole point.
function buildVersion(scratch: string, name: string, oneCommitLater: boolean): Build {
  const dir = join(scratch, name)
  execFileSync('git', ['clone', '--quiet', ROOT, dir], { stdio: 'pipe' })
  if (oneCommitLater) {
    execFileSync('git', ['-c', 'user.name=quarry', '-c', 'user.email=quarry@localhost', 'commit', '--quiet', '--allow-empty', '-m', 'version b'], { cwd: dir, stdio: 'pipe' })
  }
  for (const source of SOURCES) {
    rmSync(join(dir, source), { recursive: true, force: true })
    cpSync(join(ROOT, source), join(dir, source), { recursive: true })
  }
  symlinkSync(join(ROOT, 'node_modules'), join(dir, 'node_modules'))
  execFileSync(process.execPath, [join(dir, 'node_modules/@sveltejs/kit/svelte-kit.js'), 'sync'], { cwd: dir, stdio: 'pipe' })
  execFileSync(process.execPath, [join(dir, 'node_modules/vite/bin/vite.js'), 'build'], { cwd: dir, stdio: 'pipe' })
  const build = join(dir, 'build')
  const { version } = JSON.parse(readFileSync(join(build, '_app', 'version.json'), 'utf8')) as { version: string }
  return { dir: build, version }
}

test.describe.configure({ timeout: 120_000 }) // two worker installs and three reloads
// the game's own shape, and a third of the pixels: headless chromium paints this canvas
// in software and the frame cost scales with the viewport (see lifecycle.spec.ts)
test.use({ viewport: { width: 390, height: 844 } })

let scratch: string
let a: Build
let b: Build
let current: Build
let server: Server
let versionHits = 0 // network requests for the version manifest, counted at the server
const origin = `http://127.0.0.1:${PORT}`

test.beforeAll(async () => {
  test.setTimeout(300_000) // two real builds
  scratch = await mkdtemp(join(tmpdir(), 'quarry-ab-'))
  a = buildVersion(scratch, 'a', false)
  b = buildVersion(scratch, 'b', true)
  current = a
  server = createServer((request, response) => {
    const path = decodeURIComponent(new URL(request.url || '/', origin).pathname)
    if (path === '/_app/version.json') versionHits++
    const file = resolve(current.dir, '.' + (path === '/' ? '/index.html' : path))
    if (!file.startsWith(current.dir + '/')) { response.writeHead(404); response.end(); return }
    try {
      const body = readFileSync(file)
      // no http caching anywhere: what the browser sees is what is deployed right now
      response.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' })
      response.end(body)
    } catch {
      response.writeHead(404)
      response.end()
    }
  })
  await new Promise<void>((ok, fail) => { server.once('error', fail); server.listen(PORT, '127.0.0.1', ok) })
})

test.afterAll(async () => {
  if (server) await new Promise<void>(ok => { server.close(() => ok()); server.closeAllConnections() })
  if (scratch) await rm(scratch, { recursive: true, force: true })
})

// the helper appends commits-since-tag (or the commit count with no tag), so one
// commit later is the last component plus one, and every stamp is X.Y.Z
const bumped = (version: string) => version.replace(/(\d+)$/, n => String(Number(n) + 1))

test('two real builds: an installed A client finds B, the worker installs it, one tap reloads into it, and B holds offline', async ({ page }) => {
  expect(a.version).toMatch(/^\d+\.\d+\.\d+$/)
  expect(b.version).toBe(bumped(a.version))

  // boot A and let its worker take the page (the reload makes the page controlled)
  await page.goto(origin + '/')
  await expect(page.locator('#play-button')).toBeVisible()
  expect(await page.evaluate(() => typeof window.__quarry)).toBe('undefined') // production bundle: no hooks
  expect(await page.evaluate(() => typeof window.__quarryLifecycle)).toBe('undefined')
  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.reload()
  await expect(page.locator('#play-button')).toBeVisible()
  expect(await page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true)

  // A is what is running, and A is up to date with itself
  await page.click('#play-button')
  await page.click('[data-sheet="settings"]')
  await expect(page.locator('.version-stamp')).toHaveText(`v${a.version}`)
  await page.click('#check-updates')
  await expect(page.locator('#check-updates')).toHaveText('✓ UP TO DATE')
  const hitsOnA = versionHits
  expect(hitsOnA).toBeGreaterThan(0)

  // the deployment changes: same origin, same worker still in control
  current = b
  await page.click('#check-updates')
  await expect(page.locator('#check-updates')).toHaveText('↻ UPDATE READY, TAP TO RELOAD')
  expect(versionHits).toBeGreaterThan(hitsOnA) // a SECOND real request, not a cached answer
  await expect(page.locator('.update-toast')).toBeVisible() // kit's updated store saw it too

  // the worker finds B, installs it, activates it and claims the page
  const worker = await page.evaluate(async () => {
    const registration = (await navigator.serviceWorker.getRegistration())!
    const script = registration.active?.scriptURL ?? null
    const claimed = new Promise<boolean>(ok => navigator.serviceWorker.addEventListener('controllerchange', () => ok(true), { once: true }))
    const found = new Promise<ServiceWorker | null>(ok => {
      const early = registration.installing || registration.waiting
      if (early) { ok(early); return }
      registration.addEventListener('updatefound', () => ok(registration.installing), { once: true })
    })
    await registration.update()
    const installing = await found
    if (!installing) return { found: false }
    const settled = new Promise<string>(ok => {
      if (installing.state === 'activated') { ok(installing.state); return }
      installing.addEventListener('statechange', () => {
        if (installing.state === 'activated' || installing.state === 'redundant') ok(installing.state)
      })
    })
    return { found: true, state: await settled, claimed: await claimed, sameScript: installing.scriptURL === script }
  })
  expect(worker).toEqual({ found: true, state: 'activated', claimed: true, sameScript: true })

  // one tap is the reload, and the reload lands on B
  await page.click('#check-updates')
  await expect(page.locator('#play-button')).toBeVisible()
  await page.click('#play-button')
  await page.click('[data-sheet="settings"]')
  await expect(page.locator('.version-stamp')).toHaveText(`v${b.version}`)

  // and B is really installed: it boots with the network gone
  await page.context().setOffline(true)
  await page.reload()
  await expect(page.locator('#play-button')).toBeVisible()
  await page.click('#play-button')
  await page.click('[data-sheet="settings"]')
  await expect(page.locator('.version-stamp')).toHaveText(`v${b.version}`)
  await page.context().setOffline(false)
})
