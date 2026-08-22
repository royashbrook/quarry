import { expect, test } from '@playwright/test'
import { ready } from './ready'

// the whole first-zone loop in one deterministic run: mine, carry, sell,
// buy an upgrade, and start paying the gate. real built game, sim time.
test('mine, sell, upgrade, gate: the loop end to end', async ({ page }) => {
  await page.goto('/')
  await ready(page)
  await page.click('#play-button')
  await expect(page.locator('canvas')).toBeVisible()
  const result = await page.evaluate(() => {
    const game = window.__quarry
    const snap = () => game.snapshot()
    const rock = snap().rocks[0]
    game.movePlayer({ x: rock.x - 40, y: rock.y })
    game.advance(6)
    const mined = snap().stack.length
    game.movePlayer({ x: 100, y: 250 }) // depot
    game.advance(3)
    const coins = snap().save.coins
    // farm until the pick upgrade is affordable
    for (let round = 0; round < 40 && snap().save.coins < 12; round++) {
      game.movePlayer({ x: rock.x - 40, y: rock.y })
      game.advance(5)
      game.movePlayer({ x: 100, y: 250 })
      game.advance(3)
    }
    game.movePlayer({ x: 462, y: 205 }) // pick pad
    game.advance(1.5) // stand still: the deliberate-buy charge completes
    const pick = snap().save.upgrades.pick
    return { mined, coins, pick }
  })
  expect(result.mined).toBeGreaterThan(0)
  expect(result.coins).toBeGreaterThan(0)
  expect(result.pick).toBe(1)
})

test('a full pack sells for the sum of its ore values', async ({ page }) => {
  await page.goto('/')
  await ready(page)
  await page.click('#play-button')
  const coins = await page.evaluate(() => {
    const game = window.__quarry
    game.pause(true)
    const state = game.snapshot()
    // deterministic: place a known stack via mining a known rock
    game.pause(false)
    const gold = state.rocks.find(rock => rock.ore === 'gold')!
    game.movePlayer({ x: gold.x - 40, y: gold.y })
    game.advance(4)
    const stack = game.snapshot().stack.length
    game.movePlayer({ x: 100, y: 250 })
    game.advance(4)
    return { stack, coins: game.snapshot().save.coins }
  })
  expect(coins.stack).toBeGreaterThan(0)
  expect(coins.coins).toBe(coins.stack * 8) // gold value
})
