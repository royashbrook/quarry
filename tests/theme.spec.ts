import { expect, test } from '@playwright/test'
import { ready } from './ready'

// the skinnable rule's DURABLE proof: structure fixed, look swappable.
//
// this exists because the earlier evidence was a throwaway script i ran once. a
// one-off proves the moment, not the property: nothing stopped the next commit from
// re-introducing a literal. this spec is the thing that keeps failing if it does.
//
// it checks BOTH layers a theme has to reach:
//   1. the DOM chrome (computed styles, not css source, so a literal cannot hide)
//   2. the CANVAS hud, which is chrome drawn in pixels and therefore easy to forget

const token = (name: string) => `getComputedStyle(document.documentElement).getPropertyValue('${name}').trim()`

test('a theme swap repaints the chrome and leaves the structure alone', async ({ page }) => {
  await page.goto('/')
  await ready(page)

  const before = await page.evaluate(([surfaceExpr]) => ({
    surface: eval(surfaceExpr) as string,
    playBg: getComputedStyle(document.querySelector('#play-button')!).backgroundColor,
    buttons: document.querySelectorAll('button').length,
    ids: [...document.querySelectorAll('[id]')].map(n => n.id).sort().join(','),
  }), [token('--surface')])

  await page.evaluate(() => { document.documentElement.dataset.theme = 'dusk' })

  const after = await page.evaluate(([surfaceExpr]) => ({
    surface: eval(surfaceExpr) as string,
    playBg: getComputedStyle(document.querySelector('#play-button')!).backgroundColor,
    buttons: document.querySelectorAll('button').length,
    ids: [...document.querySelectorAll('[id]')].map(n => n.id).sort().join(','),
  }), [token('--surface')])

  // the LOOK moves: both the token and something that actually consumes it. asserting
  // the token alone is the trap that shipped a declarations-only "token pass".
  expect(after.surface).not.toBe(before.surface)
  expect(after.playBg).not.toBe(before.playBg)

  // the STRUCTURE does not move: same elements, same ids. that is the compliance bar.
  expect(after.buttons).toBe(before.buttons)
  expect(after.ids).toBe(before.ids)
})

test('the canvas hud repaints with the theme too', async ({ page }) => {
  await page.goto('/')
  await ready(page)
  await page.click('#play-button')
  await page.waitForTimeout(400)
  // freeze the world: a live scene changes pixels on its own, so an unpaused sample
  // proves nothing about the hud. paused, the ONLY thing that can move is the palette.
  await page.evaluate(() => window.__quarry!.pause(true))
  await page.waitForTimeout(250)

  // sample the hud's corner (the coins pill), not the world: a signature, so any
  // palette change registers without pinning exact pixels
  const signature = () => page.evaluate(() => {
    const canvas = document.querySelector('canvas')!
    // the WHOLE canvas, not a 120x40 corner: a narrow sample missed hud literals that
    // live outside it, which is how 'the hud repaints' passed while literals survived.
    const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
    const seen = new Set<number>()
    let sum = 0
    for (let i = 0; i < data.length; i += 4) {
      const rgb = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2]
      seen.add(rgb)
      sum += data[i] + data[i + 1] * 3 + data[i + 2] * 7
    }
    return { sum, palette: seen.size }
  })

  const before = await signature()
  // control: paused and unthemed, two samples must be IDENTICAL. without this the test
  // cannot tell a repaint from ordinary motion.
  await page.waitForTimeout(250)
  expect((await signature()).sum).toBe(before.sum)

  await page.evaluate(() => { document.documentElement.dataset.theme = 'dusk' })
  await page.waitForTimeout(400) // one repaint under the new tokens
  const after = await signature()

  // a canvas hud that kept its booted palette is the exact bug this guards
  expect(after.sum).not.toBe(before.sum)
})

// the HUD must follow the SHAPE tokens too, not just the colours.
//
// review restored both contract-card radii to literals and the colour-only spec above
// still passed 2/2. a theme proof that varies one axis proves one axis. this varies
// --radius alone, holding colour fixed, so only the shape can move the pixels.
test('the canvas hud follows the radius token, not just colour', async ({ page }) => {
  await page.goto('/')
  await ready(page)
  await page.click('#play-button')
  await page.waitForTimeout(400)
  // freeze the world so the only thing that can move pixels is the token
  await page.evaluate(() => window.__quarry!.pause(true))
  await page.waitForTimeout(250)

  const shot = () => page.evaluate(() => {
    const canvas = document.querySelector('canvas')!
    const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
    let sum = 0
    for (let i = 0; i < data.length; i += 4) sum += data[i] + data[i + 1] * 3 + data[i + 2] * 7
    return sum
  })

  const before = await shot()
  // control: nothing changed, so nothing may move
  await page.waitForTimeout(250)
  expect(await shot()).toBe(before)

  // vary ONLY the shape token, colours untouched
  await page.evaluate(() => document.documentElement.style.setProperty('--radius', '0px'))
  await page.waitForTimeout(400)

  // square corners must reach the canvas. this also pins toPx: a `0` that fell back to
  // 16 would leave the corners rounded and the pixels identical.
  expect(await shot()).not.toBe(before)
})
