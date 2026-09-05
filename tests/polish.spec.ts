import { expect, test } from '@playwright/test'

// phone polish, pinned at a common phone size: the titled contract card, the
// 14 px text floor, the labelled sound toggle, an opaque start card, and a
// build id in about
test.use({ viewport: { width: 430, height: 932 } })

test('the start card is opaque, and about prints the build id', async ({ page }) => {
  await page.goto('/')
  const background = await page.locator('#start-card').evaluate(card => getComputedStyle(card).backgroundColor)
  expect(background).toBe('rgb(143, 203, 107)')
  await page.click('#about-open')
  await expect(page.locator('#build-id')).toHaveText(/^v\d+\.\d+\.\d+ · (?:[0-9a-f]{7,}|local)$/)
})

test('the sound toggle keeps its word in both states', async ({ page }) => {
  await page.goto('/'); await page.click('#play-button')
  await page.click('[data-sheet="settings"]')
  const button = page.locator('#mute-button')
  await expect(button).toHaveText(/SOUND ON/)
  await button.click()
  await expect(button).toHaveText(/SOUND OFF/)
})

test('phone play draws the titled contract card and nothing under 14 px', async ({ page }) => {
  await page.goto('/'); await page.click('#play-button')
  await expect(page.locator('canvas')).toBeVisible()
  await page.evaluate(() => {
    const game = window.__quarry
    const rock = game.snapshot().rocks[0]
    game.movePlayer({ x: rock.x - 40, y: rock.y })
    game.advance(2)
  })
  const drawn = await page.evaluate(() => new Promise<ReturnType<Window['__quarry']['render']>>(resolve => requestAnimationFrame(() => resolve(window.__quarry.render()))))
  expect(drawn.contractTitled).toBe(true)
  expect(drawn.smallestText).toBeGreaterThanOrEqual(14)
})
