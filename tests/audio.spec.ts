import { expect, test } from '@playwright/test'

// the silent-phone bug: an AudioContext that is created but never resumed sits
// 'suspended' forever and every bleep silently skips. this pins the wake path:
// a real gesture must leave the context running.
test.use({ launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] } })

test('a real press wakes the audio context to running', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('canvas')).toBeVisible()
  expect(await page.evaluate(() => window.__quarry.audioState())).toBe('none')
  const box = (await page.locator('canvas').boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.up()
  await expect.poll(() => page.evaluate(() => window.__quarry.audioState())).toBe('running')
})

test('mining while awake drains pings instead of stockpiling them', async ({ page }) => {
  await page.goto('/')
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
