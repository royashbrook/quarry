import { expect, test } from '@playwright/test'

test('start card gates play, bottom nav opens sheets, menu shop buys from anywhere', async ({ page }) => {
  await page.goto('/')
  // start card is up, game paused behind it
  await expect(page.locator('#start-card')).toBeVisible()
  const frozen = await page.evaluate(() => window.__quarry.snapshot().time)
  await page.waitForTimeout(400)
  expect(await page.evaluate(() => window.__quarry.snapshot().time)).toBe(frozen)

  await page.click('#play-button')
  await expect(page.locator('#start-card')).toBeHidden()
  await expect(page.locator('#bottom-nav')).toBeVisible()

  // earn a little, then buy from the sheet while deep in the pit
  await page.evaluate(() => {
    const game = window.__quarry
    const rock = game.snapshot().rocks[0]
    for (let round = 0; round < 4; round++) {
      game.movePlayer({ x: rock.x - 40, y: rock.y })
      game.advance(6)
      game.movePlayer({ x: 100, y: 250 })
      game.advance(3)
    }
    game.movePlayer({ x: 270, y: 900 }) // nowhere near any pad
  })
  await page.click('[data-sheet="shop"]')
  await expect(page.locator('#sheet-shop')).toBeVisible()
  const pick = page.locator('[data-buy="pick"]')
  await expect(pick).toBeEnabled()
  const level = await page.evaluate(() => window.__quarry.snapshot().save.upgrades.pick)
  await pick.click()
  expect(await page.evaluate(() => window.__quarry.snapshot().save.upgrades.pick)).toBe(level + 1)

  // stats sheet renders the numbers
  await page.click('[data-sheet="stats"]')
  await expect(page.locator('#sheet-stats')).toBeVisible()
  await expect(page.locator('#stats-list')).toContainText('lifetime earned')

  // backdrop closes everything
  await page.click('#sheet-backdrop', { position: { x: 10, y: 10 } })
  await expect(page.locator('#sheet-stats')).toBeHidden()
})
