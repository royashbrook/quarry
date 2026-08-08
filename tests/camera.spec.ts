import { expect, test } from '@playwright/test'

// the camera pans the wide world and input maps through the SAME pan, so a
// pointer press on a visible spot lands on that world point at any camera x.
test('camera follows into zone 2 and pointer mapping tracks the pan', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 })
  await page.goto('/')
  await expect(page.locator('canvas')).toBeVisible()

  // open the first gate instantly via the sim, then walk in
  await page.evaluate(() => {
    const game = window.__quarry
    const state = game.snapshot()
    void state
    game.movePlayer({ x: 900, y: 400 })
  })
  await page.evaluate(() => {
    const game = window.__quarry
    // cheat the coins in through the sim: mine-and-sell farmed offline would
    // take minutes; the gate pour itself is what we are testing
    for (let i = 0; i < 40; i++) {
      const snap = game.snapshot()
      if (snap.save.gates > 0) break
      game.advance(5)
      if (game.snapshot().save.coins === 0) {
        // grant by selling a mined stack: fastest legal route, gold zone locked,
        // so farm the coal rock by the gate
        const coal = game.snapshot().rocks.find(rock => rock.ore === 'coal')!
        game.movePlayer({ x: coal.x - 40, y: coal.y })
        game.advance(6)
        game.movePlayer({ x: 175, y: 460 })
        game.advance(4)
        game.movePlayer({ x: 900, y: 400 })
      }
    }
    return game.snapshot().save.gates
  })

  const opened = await page.evaluate(() => window.__quarry.snapshot().save.gates)
  expect(opened).toBeGreaterThanOrEqual(1)

  // walk deep into zone 2: the camera must follow
  await page.evaluate(() => {
    window.__quarry.movePlayer({ x: 1400, y: 400 })
    window.__quarry.advance(1, { x: 1, y: 0 })
  })
  await page.waitForTimeout(700) // camera eases toward the player
  const cameraX = await page.evaluate(() => window.__quarry.cameraX())
  expect(cameraX).toBeGreaterThan(300)

  // freeze the easing camera so both reads below see the same pan
  await page.evaluate(() => window.__quarry.pause(true))

  // real pointerdown at the center of the screen maps to a world x offset by the pan
  const box = (await page.locator('canvas').boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  const origin = await page.evaluate(() => window.__quarry.joystickOrigin())
  await page.mouse.up()
  expect(origin).not.toBeNull()
  const expected = await page.evaluate(() => {
    const view = window.__quarry.viewport()
    return window.__quarry.cameraX() + view.originX + view.viewWidth / 2
  })
  expect(origin!.x).toBeCloseTo(expected, 0)
})
