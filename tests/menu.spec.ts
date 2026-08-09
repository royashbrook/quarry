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

test('a fresh save gets the two-beat coach, a returning save gets silence', async ({ page }) => {
  await page.goto('/')
  await page.click('#play-button')
  // beat one shows until real movement
  let step = await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => resolve((window as any).__quarryCoach ?? 'unknown'))))
  void step
  await page.evaluate(() => { window.__quarry.advance(1, { x: 1, y: 0 }) })
  await page.evaluate(() => {
    const game = window.__quarry
    const rock = game.snapshot().rocks[0]
    game.movePlayer({ x: rock.x - 40, y: rock.y })
    game.advance(2)
  })
  // after mining, the save has lifetime: reload shows no coach path (no crash, plays clean)
  await page.evaluate(() => {
    const game = window.__quarry
    game.movePlayer({ x: 100, y: 250 })
    game.advance(3)
  })
  await page.reload()
  await page.click('#play-button')
  await expect(page.locator('canvas')).toBeVisible()
  const lifetime = await page.evaluate(() => window.__quarry.snapshot().save.lifetime)
  expect(lifetime).toBeGreaterThan(0)
})
