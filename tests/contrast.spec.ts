import { expect, test } from '@playwright/test'
import { ready } from './ready'

// COMPUTED-STYLE contrast, under every theme.
//
// this class has now bitten three times: the template's secondary button at 1.194:1, and
// quarry's dusk warn twice (once because an alternate omitted the token and fell back,
// once because i "fixed" it to 2.03:1 by copying a palette from a game whose dusk has a
// DARK card, while quarry's is light). every one of those passed the static lint,
// because a linter cannot resolve what a token computes to on the surface behind it.
//
// so the gate is the browser: walk the real shell chrome, read the real computed colours,
// and assert AA. this is the check that would have caught all three.

const AA_NORMAL = 4.5
const AA_LARGE = 3.0

// contrast measured in the page from computed styles, walking up for a real background
const probe = () => {
  const luminance = (rgb: number[]) => {
    const s = rgb.map(v => {
      const c = v / 255
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
    })
    return 0.2126 * s[0] + 0.7152 * s[1] + 0.0722 * s[2]
  }
  const parse = (value: string) => (value.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number)
  // COMPOSITE translucent layers instead of skipping them. skipping meant an 80%-alpha
  // background was ignored and the gate reported the layer behind it: review measured an
  // actual 1.169:1 while this said 5.056:1. a measuring instrument that skips the hard
  // case is worse than none, because it reports confidence.
  const composite = (over: number[], under: number[], alpha: number) =>
    over.map((c, i) => c * alpha + under[i] * (1 - alpha))
  const effectiveBackground = (el: Element): number[] => {
    const stack: { rgb: number[]; alpha: number }[] = []
    let node: Element | null = el
    while (node) {
      const bg = getComputedStyle(node).backgroundColor
      const parts = (bg.match(/[\d.]+/g) ?? []).map(Number)
      const alpha = parts.length > 3 ? parts[3] : 1
      if (alpha > 0) stack.push({ rgb: parts.slice(0, 3), alpha })
      if (alpha >= 0.999) break
      node = node.parentElement
    }
    let base = [255, 255, 255]
    for (let i = stack.length - 1; i >= 0; i--) base = composite(stack[i].rgb, base, stack[i].alpha)
    return base
  }
  const out: { text: string; ratio: number; large: boolean }[] = []
  for (const el of document.querySelectorAll('button, a, dt, dd, h1, h2, p, span')) {
    const rect = el.getBoundingClientRect()
    if (!rect.width || !rect.height) continue
    const style = getComputedStyle(el)
    if (style.visibility === 'hidden' || style.opacity === '0') continue
    // WCAG 1.4.3 exempts INACTIVE controls. this is the spec's carve-out, not a fudge:
    // a disabled shop price is deliberately de-emphasised to read as unavailable.
    if ((el as HTMLButtonElement).disabled) continue
    const text = (el.textContent ?? '').trim()
    if (!text || el.querySelector('button, a, dt, dd, h1, h2, p, span')) continue
    const fgParts = (style.color.match(/[\d.]+/g) ?? []).map(Number)
    const fgAlpha = fgParts.length > 3 ? fgParts[3] : 1
    const bg = effectiveBackground(el)
    const fg = composite(fgParts.slice(0, 3), bg, fgAlpha)
    const [hi, lo] = [luminance(fg), luminance(bg)].sort((a, b) => b - a)
    const size = Number.parseFloat(style.fontSize)
    const bold = Number(style.fontWeight) >= 700
    out.push({
      text: text.slice(0, 24),
      ratio: Number(((hi + 0.05) / (lo + 0.05)).toFixed(2)),
      large: size >= 24 || (bold && size >= 18.66),
    })
  }
  return out
}

for (const theme of ['(default)', 'dusk']) {
  test(`shell text clears AA contrast under ${theme}`, async ({ page }) => {
    await page.goto('/')
    await ready(page)
    if (theme !== '(default)') {
      await page.evaluate(() => { document.documentElement.dataset.theme = 'dusk' })
      await page.waitForTimeout(200)
    }

    // the start card, then the in-game chrome and every sheet: the bug lived in a
    // sheet control, so checking only the first screen would have missed it
    const surfaces: (() => Promise<void>)[] = [
      async () => {},
      async () => { await page.click('#play-button'); await page.waitForTimeout(300) },
      async () => { await page.click('[data-sheet="shop"]'); await page.waitForTimeout(250) },
      async () => { await page.click('[data-sheet="stats"]'); await page.waitForTimeout(250) },
      async () => { await page.click('[data-sheet="settings"]'); await page.waitForTimeout(250) },
      async () => { await page.click('#about-open2'); await page.waitForTimeout(250) },
    ]

    const failures: string[] = []
    for (const reach of surfaces) {
      await reach()
      for (const hit of await page.evaluate(probe)) {
        const floor = hit.large ? AA_LARGE : AA_NORMAL
        if (hit.ratio < floor) failures.push(`"${hit.text}" ${hit.ratio}:1 (needs ${floor})`)
      }
    }

    expect(failures, `unreadable shell text under ${theme}:\n  ${failures.join('\n  ')}`).toEqual([])
  })
}
