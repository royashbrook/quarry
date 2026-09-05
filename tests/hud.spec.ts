import { expect, test, type Page } from '@playwright/test'

// the first thirty seconds on a phone: the SELL sign must stay readable while
// the camera pans after the first walk, and the coach must say what to do
// with a full pack. sim time throughout: the harness renders at a crawl.
test.use({ viewport: { width: 430, height: 932 } })

type Box = { x: number; y: number; w: number; h: number }
const intersects = (a: Box, b: Box): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

// the camera eases over real frames; wait until two frames agree
async function settle(page: Page): Promise<void> {
  await page.waitForFunction(() => new Promise<boolean>(resolve => {
    const before = window.__quarry.cameraY()
    requestAnimationFrame(() => requestAnimationFrame(() => resolve(Math.abs(window.__quarry.cameraY() - before) < 0.3)))
  }))
}

async function hud(page: Page) {
  await settle(page)
  return page.evaluate(() => new Promise<ReturnType<Window['__quarry']['hud']>>(resolve => requestAnimationFrame(() => resolve(window.__quarry.hud()))))
}

test('the SELL sign never hides under the hud column as the camera pans', async ({ page }) => {
  await page.goto('/'); await page.click('#play-button')
  await expect(page.locator('canvas')).toBeVisible()
  const rocks = await page.evaluate(() => window.__quarry.snapshot().rocks.slice(0, 5))
  let seen = 0
  for (const rock of rocks) {
    await page.evaluate(([x, y]) => window.__quarry.movePlayer({ x, y }), [rock.x - 40, rock.y])
    const boxes = await hud(page)
    if (!boxes.sell) continue // the hut has scrolled fully under the column
    seen += 1
    expect(intersects(boxes.sell, boxes.column), `rock at ${rock.x},${rock.y}: sell ${JSON.stringify(boxes.sell)} vs column ${JSON.stringify(boxes.column)}`).toBe(false)
  }
  expect(seen).toBeGreaterThan(0)
})

test('the coach says CARRY IT TO SELL after the first pickup, until the first sale', async ({ page }) => {
  await page.goto('/'); await page.click('#play-button')
  await expect(page.locator('canvas')).toBeVisible()
  expect((await hud(page)).coach?.text).toBe('DRAG ANYWHERE TO MOVE')
  await page.evaluate(() => {
    const game = window.__quarry
    const rock = game.snapshot().rocks[0]
    game.movePlayer({ x: rock.x - 40, y: rock.y })
    game.advance(2)
  })
  expect((await hud(page)).coach?.text).toMatch(/^CARRY IT TO SELL /)
  await page.evaluate(() => {
    window.__quarry.movePlayer({ x: 100, y: 250 })
    window.__quarry.advance(3)
  })
  expect((await hud(page)).coach).toBeNull()
})
