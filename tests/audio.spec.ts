import { expect, test } from '@playwright/test'
import { ready } from './ready'

// the silent-phone bug: an AudioContext that is created but never resumed sits
// 'suspended' forever and every bleep silently skips. this pins the wake path:
// a real gesture must leave the context running.
test.use({ launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] } })

test('the PLAY press itself wakes the audio context', async ({ page }) => {
  await page.goto('/')
  await ready(page)
  expect(await page.evaluate(() => window.__quarry.audioState())).toBe('none')
  await page.click('#play-button') // the first gesture of every session
  await expect.poll(() => page.evaluate(() => window.__quarry.audioState())).toBe('running')
})

test('mining while awake drains pings instead of stockpiling them', async ({ page }) => {
  await page.goto('/')
  await ready(page)
  await page.click('#play-button')
  const box = (await page.locator('canvas').boundingBox())!
  await page.mouse.click(box.x + 40, box.y + 40) // wake audio with a real gesture
  await page.evaluate(() => {
    const game = window.__quarry
    const rock = game.snapshot().rocks[0]
    game.movePlayer({ x: rock.x - 40, y: rock.y })
    game.advance(4)
  })
  await page.waitForTimeout(200) // a couple of frames drain the queue
  const pings = await page.evaluate(() => window.__quarry.snapshot().pings.length)
  expect(pings).toBe(0)
})

// the visibility wake repair, which previously had NO durable proof: nothing in the
// suite crossed the idle boundary or exercised visibilitychange, so the exact bug
// (resume() called directly, leaving idleSuspended set and lastBleepAt stale) could
// come back green. forceAudioIdle() crosses the boundary deterministically instead of
// spending 15 real seconds.
test('returning to a visible tab clears idle suspension', async ({ page }) => {
  await page.goto('/')
  await ready(page)
  await page.click('#play-button')
  await page.mouse.click(200, 400) // a real gesture, so the context exists
  await expect.poll(() => page.evaluate(() => window.__quarry!.audioState())).toBe('running')

  await page.evaluate(() => window.__quarry!.forceAudioIdle())
  await expect.poll(() => page.evaluate(() => window.__quarry!.audioState())).toBe('idle')

  // the tab goes away and comes back
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { value: true, configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    Object.defineProperty(document, 'hidden', { value: false, configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
  })

  // the repair, HALF ONE: idle state cleared
  await expect.poll(() => page.evaluate(() => window.__quarry!.audioState())).toBe('running')

  // the repair, HALF TWO, and this is the half the first version missed: a wake must
  // also restart the idle CLOCK. leaving lastBleepAt stale means the very next
  // idleCheck re-suspends immediately, so 'running' right after the wake proves
  // nothing. it has to SURVIVE the following idle checks.
  await page.waitForTimeout(900) // many RAF frames, so idleCheck has run repeatedly
  expect(await page.evaluate(() => window.__quarry!.audioState())).toBe('running')
})
