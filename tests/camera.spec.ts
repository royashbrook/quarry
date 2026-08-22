import { expect, test } from '@playwright/test'
import { ready } from './ready'

// the camera pans DOWN the dig and input maps through the same pan, so a
// pointer press on a visible spot lands on that world point at any depth.
test('camera follows the dig and pointer mapping tracks the pan', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await ready(page)
  await page.click('#play-button')
  await expect(page.locator('canvas')).toBeVisible()

  // deep in zone 1 (still above the first gate): the camera must follow
  await page.evaluate(() => {
    window.__quarry.movePlayer({ x: 270, y: 1000 })
    window.__quarry.advance(1, { x: 0, y: 0 })
  })
  await page.waitForTimeout(700) // camera eases toward the player
  const cameraY = await page.evaluate(() => window.__quarry.cameraY())
  expect(cameraY).toBeGreaterThan(200)

  // freeze the easing camera so both reads below see the same pan
  await page.evaluate(() => window.__quarry.pause(true))

  const box = (await page.locator('canvas').boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  const origin = await page.evaluate(() => window.__quarry.joystickOrigin())
  await page.mouse.up()
  expect(origin).not.toBeNull()
  const expected = await page.evaluate(() => {
    const view = window.__quarry.viewport()
    return window.__quarry.cameraY() + view.originY + view.viewHeight / 2
  })
  expect(origin!.y).toBeCloseTo(expected, 0)
})

// portrait is the design target: at 390x844 every screen-space text draws at
// 13+ css px by construction; this asserts the hud objects are actually there
test('phone portrait renders the hud readable and the world fills the screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await ready(page)
  await page.click('#play-button')
  await expect(page.locator('canvas')).toBeVisible()
  const checks = await page.evaluate(() => {
    const canvas = document.querySelector('canvas')!
    const rect = canvas.getBoundingClientRect()
    const view = window.__quarry.viewport()
    const opaque = (x: number, y: number) => canvas.getContext('2d')!.getImageData(x, y, 1, 1).data[3] === 255
    return {
      fills: Math.round(rect.width) === innerWidth && Math.round(rect.height) === innerHeight,
      corners: [opaque(0, 0), opaque(canvas.width - 1, canvas.height - 1)],
      scale: view.scale,
      contract: window.__quarry.snapshot().save.contract !== null,
    }
  })
  expect(checks.fills).toBe(true)
  expect(checks.corners).toEqual([true, true])
  expect(checks.contract).toBe(true)
  // 390 css px / 540 world = .72: world objects still readable, text is css-fixed anyway
  expect(checks.scale).toBeCloseTo(390 / 540, 2)
})
