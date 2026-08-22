import { expect, test } from '@playwright/test'
import { ready } from './ready'

// executable proof for the resize-restarts-coach regression.
//
// v1 of this spec was FALSE-POSITIVE CAPABLE and review proved it: it never asserted the
// pre-resize coach state was actually 'mine', and `bottomInset() > 0` was already true
// from PLAY, so deleting the resize measurement entirely left it green (probe returned
// 64 / 64 / 64 across both viewport changes). a test that passes when the feature is
// removed is not a test.
//
// so this version forces a DETERMINISTIC nav-height change and asserts before/after
// values, plus the semantic precondition.

test('a resize does not restart the coach, but does remeasure the nav', async ({ page }) => {
  await page.goto('/')
  await ready(page)
  await page.evaluate(() => localStorage.removeItem('quarry_save_v1'))
  await page.reload()
  await ready(page)
  await page.click('#play-button')
  await page.waitForTimeout(400)

  // PRECONDITION, asserted not assumed: a fresh save starts the coach at 'move'
  expect(await page.evaluate(() => window.__quarry!.coachStep())).toBe('move')

  // walk past the threshold so the coach advances to its SECOND beat
  await page.evaluate(() => {
    window.__quarry!.movePlayer({ x: 300, y: 700 })
    window.__quarry!.advance(0.5, { x: 0, y: 0 })
  })
  await page.waitForTimeout(200)
  expect(await page.evaluate(() => window.__quarry!.coachStep())).toBe('mine')

  const insetBefore = await page.evaluate(() => window.__quarry!.bottomInset())
  expect(insetBefore).toBeGreaterThan(0)

  // force a nav height the resize MUST pick up. without this the inset never changes,
  // so an assertion on it proves nothing (that was exactly the v1 hole).
  await page.addStyleTag({ content: '#bottom-nav button { padding: 2.4rem 0 !important }' })
  await page.setViewportSize({ width: 414, height: 896 })
  await page.waitForTimeout(500)

  const insetAfter = await page.evaluate(() => window.__quarry!.bottomInset())

  // the nav WAS remeasured: the value actually moved
  expect(insetAfter).toBeGreaterThan(insetBefore)

  // and the coach did NOT restart: still on beat two, not back to 'move'
  expect(await page.evaluate(() => window.__quarry!.coachStep())).toBe('mine')
})
