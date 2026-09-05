import { expect, test } from '@playwright/test'
import { clamped, intersects, walkDown } from './helpers'

// a browser that blocks site data (chrome "block all cookies", managed kid
// profiles) throws on the localStorage property itself. the game must still
// boot and play; the save just lives in memory for the session.
test('boots and mines with localStorage denied', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(String(error)))
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() { throw new DOMException('Access is denied for this document.', 'SecurityError') },
    })
  })
  await page.goto('/')
  await expect(page.locator('#start-stats')).toHaveText('a tiny mining game')
  await page.click('#play-button')
  await expect(page.locator('#bottom-nav')).toBeVisible()
  const mined = await page.evaluate(() => {
    const game = window.__quarry
    const rock = game.snapshot().rocks[0]
    game.movePlayer({ x: rock.x - 40, y: rock.y })
    game.advance(4)
    return game.snapshot().stack.length
  })
  expect(mined).toBeGreaterThan(0)
  expect(errors).toEqual([])
})

// a full store throws on setItem. the autosave runs from the frame loop once a
// second, so a throw there used to end the animation chain: a silent freeze.
test('keeps running past the first autosave when setItem throws', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(String(error)))
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => { throw new DOMException('quota', 'QuotaExceededError') }
  })
  await page.goto('/')
  await page.click('#play-button')
  // the save clock runs from boot and sim time from PLAY, on the same frames,
  // so the first autosave always lands before sim time reaches one second.
  // a headless frame can be slow (single-digit fps), hence sim time, not wall.
  const time = () => page.evaluate(() => window.__quarry.snapshot().time)
  await expect.poll(async () => errors.length > 0 || (await time()) > 1.5, { timeout: 30000 }).toBe(true)
  expect(errors).toEqual([])
  expect(await time()).toBeGreaterThan(1.5)
})

// a refused write used to be invisible: play went on, the save lived only in
// memory, and closing the tab lost it. the hud says so while it is true and
// only while it is true.
test('shows a not-saving chip while writes are refused, drops it once one lands', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).__setItem = Storage.prototype.setItem
    Storage.prototype.setItem = () => { throw new DOMException('quota', 'QuotaExceededError') }
  })
  await page.goto('/')
  await page.click('#play-button')
  const note = page.locator('#save-note')
  await expect(note).toBeVisible({ timeout: 30000 })
  await expect(note).toHaveText('not saving on this device')
  await page.evaluate(() => { Storage.prototype.setItem = (window as any).__setItem })
  await expect(note).toBeHidden({ timeout: 30000 })
})

// the chip is a warning, so it reads like one: full size, the house warn
// colour, opaque. and it sits in a slot the hud column reserves for it, so
// the SELL sign (which clamps under the column) never prints through it.
for (const viewport of [{ width: 430, height: 932 }, { width: 430, height: 740 }]) {
  test(`the not-saving chip is legible and clear of the SELL sign at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.addInitScript(() => {
      Storage.prototype.setItem = () => { throw new DOMException('quota', 'QuotaExceededError') }
    })
    await page.goto('/')
    await page.click('#play-button')
    const note = page.locator('#save-note')
    await expect(note).toBeVisible({ timeout: 30000 })
    const style = await note.evaluate(element => {
      const computed = getComputedStyle(element)
      return { fontSize: parseFloat(computed.fontSize), color: computed.color, opacity: parseFloat(computed.opacity) }
    })
    expect.soft(style.fontSize, 'font size').toBeGreaterThanOrEqual(14)
    expect.soft(style.opacity, 'opacity').toBe(1)
    const channels = style.color.match(/[\d.]+/g) ?? []
    expect.soft(channels.length === 4 ? parseFloat(channels[3]) : 1, `colour ${style.color} is translucent`).toBe(1)
    // the first walk, surface to first rock and a little past: the sign
    // clamps under the column somewhere on the way, and that is the spot
    const { start, rock } = await page.evaluate(() => {
      const game = window.__quarry.snapshot()
      return { start: game.player.y, rock: game.rocks[0] }
    })
    let clamps = 0
    for (const { y, boxes } of await walkDown(page, rock.x - 40, start, rock.y + 100)) {
      if (!boxes.sell) continue // the hut has scrolled fully under the column
      if (clamped(boxes)) clamps += 1
      const chip = await note.boundingBox()
      expect(chip).not.toBeNull()
      const chipBox = { x: chip!.x, y: chip!.y, w: chip!.width, h: chip!.height }
      expect(intersects(chipBox, boxes.sell), `miner at y ${y}: chip ${JSON.stringify(chipBox)} vs sell ${JSON.stringify(boxes.sell)}`).toBe(false)
      // the reserved slot is the chip's alone: the depth pill stays above it
      expect(intersects(chipBox, boxes.depth), `miner at y ${y}: chip ${JSON.stringify(chipBox)} vs depth pill ${JSON.stringify(boxes.depth)}`).toBe(false)
    }
    expect(clamps, 'the SELL sign should clamp under the column at some stop').toBeGreaterThan(0)
  })
}
