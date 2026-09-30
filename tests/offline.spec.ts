import { expect, test } from '@playwright/test'
import { ready } from './ready'

test('reloads offline after the first visit', async ({ page }) => {
  await page.goto('/')
  await ready(page)
  await page.click('#play-button')
  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.reload()
  await ready(page)
  await page.context().setOffline(true)
  await page.reload()
  await ready(page)
  await expect(page.locator('canvas')).toBeVisible()
  await page.context().setOffline(false)
})
