import { expect, test } from '@playwright/test'

test('total reset takes two taps and wipes the save', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('canvas')).toBeVisible()
  // earn something so there is progress to lose
  await page.evaluate(() => {
    const game = window.__quarry
    const rock = game.snapshot().rocks[0]
    game.movePlayer({ x: rock.x - 40, y: rock.y })
    game.advance(4)
    game.movePlayer({ x: 100, y: 250 })
    game.advance(3)
  })
  const coins = await page.evaluate(() => window.__quarry.snapshot().save.coins)
  expect(coins).toBeGreaterThan(0)

  await page.click('#save-button')
  const reset = page.locator('#reset-save')
  await reset.click() // arm
  await expect(reset).toHaveText('!?')
  // closing the dialog must disarm rather than leave a live trigger
  await page.keyboard.press('Escape')
  await page.click('#save-button')
  await expect(reset).toHaveText('🗑')

  await reset.click() // arm again
  await reset.click() // fire
  await page.waitForLoadState('load')
  await expect(page.locator('canvas')).toBeVisible()
  const fresh = await page.evaluate(() => window.__quarry.snapshot().save)
  expect(fresh.coins).toBe(0)
  expect(fresh.lifetime).toBe(0)
})
