import { expect, test } from '@playwright/test'

test('total reset takes two taps and wipes the save', async ({ page }) => {
  await page.goto('/'); await page.click('#play-button')
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

  await page.click('[data-sheet="settings"]')
  const reset = page.locator('#reset-save2')
  await reset.click() // arm
  await expect(reset).toContainText('SURE?')
  await reset.click() // fire
  await page.waitForLoadState('load')
  await page.click('#play-button')
  await expect(page.locator('canvas')).toBeVisible()
  const fresh = await page.evaluate(() => window.__quarry.snapshot().save)
  expect(fresh.coins).toBe(0)
  expect(fresh.lifetime).toBe(0)
})

// a store that reads fine but refuses the removal (read-only, full) used to
// reload anyway: the old save came straight back under a button that said
// reset. now the reload waits for a clear that actually happened.
test('a refused removal says so and keeps playing instead of reloading', async ({ page }) => {
  await page.goto('/'); await page.click('#play-button')
  await page.evaluate(() => {
    const game = window.__quarry
    const rock = game.snapshot().rocks[0]
    game.movePlayer({ x: rock.x - 40, y: rock.y })
    game.advance(4)
    game.movePlayer({ x: 100, y: 250 })
    game.advance(3)
  })
  await expect.poll(() => page.evaluate(() => localStorage.getItem('quarry_save_v1') !== null), { timeout: 30000 }).toBe(true)
  await page.evaluate(() => {
    (window as any).__stayed = true // a reload would drop this
    Storage.prototype.removeItem = () => { throw new DOMException('denied', 'SecurityError') }
  })
  await page.click('[data-sheet="settings"]')
  const reset = page.locator('#reset-save2')
  await reset.click() // arm
  await reset.click() // fire
  await expect(reset).toContainText('could not clear the save on this device')
  expect(await page.evaluate(() => (window as any).__stayed)).toBe(true)
  expect(await page.evaluate(() => window.__quarry.snapshot().save.coins)).toBeGreaterThan(0)
})
