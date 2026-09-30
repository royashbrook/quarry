import { expect, test } from '@playwright/test'
import { ready } from './ready'

// the shop/stats sheets, which shipped with no test of their own.
//
// both cases here are REGRESSIONS review found by hand, so each one exists to keep a
// specific bug from returning green rather than to describe the feature.

test('shop rows track the live engine while the sheet is open', async ({ page }) => {
  await page.goto('/')
  await ready(page)
  await page.click('#play-button')
  await page.waitForTimeout(300)

  // open the shop while broke: the pick control must be disabled
  await page.click('[data-sheet="shop"]')
  await page.waitForTimeout(300)
  const pick = page.locator('[data-buy="pick"]')
  await expect(pick).toBeDisabled()

  // the engine earns WHILE THE SHEET IS OPEN (helpers keep working). the sheet
  // refreshed only on its own actions, so the control stayed disabled for seconds
  // after the coins had arrived.
  // enough trips to actually CROSS the pick price. one trip earns ~5 against a price of
  // 12, so a single run left it correctly disabled and the first version of this test
  // was asserting against a state the engine had not reached.
  await page.evaluate(() => {
    const game = window.__quarry!
    for (let trip = 0; trip < 4; trip++) {
      const rock = game.snapshot().rocks[0]
      game.movePlayer({ x: rock.x - 40, y: rock.y })
      game.advance(6)
      game.movePlayer({ x: 100, y: 250 })
      game.advance(4)
    }
  })

  // no click, no sheet reopen: the open sheet must notice on its own
  await expect(pick).toBeEnabled({ timeout: 4000 })
})

test('prestige arming never survives a sheet switch', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('quarry_save_v1', JSON.stringify({
      version: 2, coins: 9999, lifetime: 99999, mine: 0,
      mines: [{ helpers: 0, gates: 0, gatePaid: 0 }],
      upgrades: { pick: 0, pack: 0, boots: 0, swing: 0, reach: 0, cart: 0 },
      contract: null, contractsDone: 0, monument: 5, monumentPaid: 0, prestige: 0,
    }))
  })
  await page.goto('/')
  await ready(page)

  // FORCE the state the assertion needs. the first version guarded with
  // `if (await prestige.count())`, and a fresh save has monument 0, so the control never
  // existed and the whole test silently skipped: a disarm mutant stayed green. a
  // conditional assertion is not an assertion.
  // seeded via addInitScript, BEFORE any page script runs. writing it from an evaluate
  // after load races the autosave, which is (correctly) not pause-gated and overwrites
  // the seed within a second.
  await page.click('#play-button')
  await page.waitForTimeout(300)

  await page.click('[data-sheet=stats]')
  await page.waitForTimeout(300)
  const prestige = page.locator('#prestige-button')
  await expect(prestige).toHaveCount(1) // unconditional: the control MUST be here

  await prestige.click() // ARM it
  await expect(prestige).toContainText('TAP AGAIN')

  // leave and come back. the component stays MOUNTED, so armed state survived and the
  // returning button still said TAP AGAIN, one tap from wiping progress.
  await page.click('[data-sheet=shop]')
  await page.waitForTimeout(250)
  await page.click('[data-sheet=stats]')
  await page.waitForTimeout(250)

  await expect(page.locator('#prestige-button')).not.toContainText('TAP AGAIN')

  // and the sheets take focus on open, which was wired to settings only
  await page.click('[data-sheet=shop]')
  await page.waitForTimeout(250)
  expect(await page.evaluate(() => document.activeElement?.id)).toBe('sheet-shop')
})
