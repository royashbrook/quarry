import type { Page } from '@playwright/test'

// shared hud probes: the camera eases over real frames and the harness
// renders at a crawl, so every read waits for the picture to settle first
export type Box = { x: number; y: number; w: number; h: number }
export const intersects = (a: Box, b: Box): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

// the camera eases over real frames; wait until two frames agree
export async function settle(page: Page): Promise<void> {
  await page.waitForFunction(() => new Promise<boolean>(resolve => {
    const before = window.__quarry.cameraY()
    requestAnimationFrame(() => requestAnimationFrame(() => resolve(Math.abs(window.__quarry.cameraY() - before) < 0.3)))
  }))
}

export async function hud(page: Page) {
  await settle(page)
  return page.evaluate(() => new Promise<ReturnType<Window['__quarry']['hud']>>(resolve => requestAnimationFrame(() => resolve(window.__quarry.hud()))))
}

// the first walk: stand the miner by each of the first rocks in turn, the
// spots where the camera pans and the SELL sign clamps under the column, and
// read the hud boxes at each. a null sell means the hut scrolled fully under
export async function walkRocks(page: Page, count = 5) {
  const rocks = await page.evaluate(count => window.__quarry.snapshot().rocks.slice(0, count), count)
  const stops: { rock: { x: number; y: number }; boxes: Awaited<ReturnType<typeof hud>> }[] = []
  for (const rock of rocks) {
    await page.evaluate(([x, y]) => window.__quarry.movePlayer({ x, y }), [rock.x - 40, rock.y])
    stops.push({ rock: { x: rock.x, y: rock.y }, boxes: await hud(page) })
  }
  return stops
}

// the pan itself: stand the miner at each step from the surface down past
// the first rock. somewhere in there the hut nears the column, the SELL sign
// clamps under it, and then the hut scrolls fully under and the sign goes
export async function walkDown(page: Page, x: number, fromY: number, toY: number, step = 20) {
  const stops: { y: number; boxes: Awaited<ReturnType<typeof hud>> }[] = []
  for (let y = fromY; y <= toY; y += step) {
    await page.evaluate(([x, y]) => window.__quarry.movePlayer({ x, y }), [x, y])
    stops.push({ y, boxes: await hud(page) })
  }
  return stops
}

// true when the sign sits at its clamp, just under the column, not at the hut
export const clamped = (boxes: Awaited<ReturnType<typeof hud>>): boolean =>
  boxes.sell !== null && boxes.sell.y <= boxes.column.y + boxes.column.h + 5
